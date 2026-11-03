//! MCP-only policy. The private application is the authority; agents cannot grant rights.
use super::*;

pub(super) const PERMISSIONS: &[(&str, &str, &str)] = &[
    (
        "read",
        "Read tasks, projects, metadata, Perspectives and reviews",
        "Reading",
    ),
    (
        "tasks.create",
        "Create tasks and repeating occurrences",
        "Tasks",
    ),
    ("tasks.edit", "Edit, complete and restore tasks", "Tasks"),
    ("tasks.trash", "Move tasks to Trash", "Tasks"),
    ("reviews.schedule", "Change review schedules", "Review"),
    ("reviews.confirm", "Confirm and undo reviews when instructed", "Review"),
    ("projects.create", "Create projects", "Projects"),
    ("projects.edit", "Edit and complete projects", "Projects"),
    (
        "tags.create",
        "Create tags and contacts",
        "Tags and Contacts",
    ),
    (
        "tags.edit",
        "Rename and reclassify tags and contacts",
        "Tags and Contacts",
    ),
    (
        "tags.archive",
        "Archive and restore tags and contacts",
        "Tags and Contacts",
    ),
    ("areas.create", "Create Areas", "Areas"),
    ("areas.edit", "Rename Areas", "Areas"),
    ("areas.archive", "Archive and restore Areas", "Areas"),
    (
        "perspectives.create",
        "Create and duplicate Perspectives",
        "Perspectives",
    ),
    (
        "perspectives.edit",
        "Edit and restore Perspectives",
        "Perspectives",
    ),
    (
        "perspectives.delete",
        "Delete Perspectives (keeps tasks)",
        "Perspectives",
    ),
    (
        "import",
        "Import Nirvana snapshots (requires all import-related write rights)",
        "Import",
    ),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Policy {
    pub enabled: bool,
    pub allowed: Vec<String>,
    pub revision: i64,
}
impl Policy {
    pub fn allows(&self, key: &str) -> bool {
        self.enabled && self.allowed.iter().any(|p| p == key)
    }
}
pub(super) async fn load(pool: &SqlitePool) -> ApiResult<Policy> {
    let (enabled, raw, revision): (bool, String, i64) = sqlx::query_as(
        "SELECT enabled,allowed_json,revision FROM mcp_permissions WHERE singleton=1",
    )
    .fetch_one(pool)
    .await
    .map_err(internal)?;
    let allowed: Vec<String> = serde_json::from_str(&raw).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":"Invalid MCP permissions; access denied"})),
        )
    })?;
    Ok(Json(Policy {
        enabled,
        allowed,
        revision,
    }))
}
pub(super) async fn get(State(state): State<AppState>) -> ApiResult<Value> {
    let policy = load(&state.pool).await?.0;
    Ok(Json(
        json!({"policy": policy, "permissions": PERMISSIONS.iter().map(|(id,label,group)|
        json!({"id":id,"label":label,"group":group})).collect::<Vec<_>>()}),
    ))
}
pub(super) async fn save(
    State(state): State<AppState>,
    Json(input): Json<Policy>,
) -> ApiResult<Policy> {
    if input.revision < 0
        || input.allowed.len() > PERMISSIONS.len()
        || input
            .allowed
            .iter()
            .any(|id| !PERMISSIONS.iter().any(|(key, _, _)| key == id))
        || input
            .allowed
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != input.allowed.len()
    {
        return Err(bad_request("Invalid MCP permissions"));
    }
    let changed = sqlx::query("UPDATE mcp_permissions SET enabled=?,allowed_json=?,revision=revision+1 WHERE singleton=1 AND revision=?")
        .bind(input.enabled).bind(sqlx::types::Json(&input.allowed)).bind(input.revision)
        .execute(&state.pool).await.map_err(internal)?.rows_affected();
    if changed != 1 {
        return Err(conflict("MCP permissions changed. Reload before saving."));
    }
    Ok(Json(Policy {
        revision: input.revision + 1,
        ..input
    }))
}

// Unknown tools are denied until explicitly assigned a permission here.
pub(super) fn base_permission(name: &str) -> Option<&'static str> {
    Some(match name {
        "list_reviews" | "review_tasks" | "list_tasks"
        | "get_task"
        | "list_projects"
        | "list_tags"
        | "list_areas"
        | "list_perspectives"
        | "perspective_tasks"
        | "preview_perspective"
        | "preview_repeat" => "read",
        "update_review_schedule" => "reviews.schedule",
        "confirm_review" | "undo_review" => "reviews.confirm",
        "create_task" => "tasks.create",
        "update_task" => "tasks.edit",
        "create_project" => "projects.create",
        "update_project" => "projects.edit",
        "create_tag" => "tags.create",
        "update_tag" => "tags.edit",
        "create_area" => "areas.create",
        "update_area" => "areas.edit",
        "create_perspective" => "perspectives.create",
        "update_perspective" => "perspectives.edit",
        "import_nirvana" => "import",
        _ => return None,
    })
}
fn denied(key: &str) -> (StatusCode, Json<Value>) {
    (
        StatusCode::FORBIDDEN,
        Json(
            json!({"error":format!("MCP permission denied: {key}. Only the owner can change access in Settings > MCP access.")}),
        ),
    )
}
pub(super) async fn authorize(pool: &SqlitePool, name: &str, args: &Value) -> ApiResult<()> {
    let policy = load(pool).await?.0;
    let need = |key: &str| {
        if policy.allows(key) {
            Ok(())
        } else {
            Err(denied(key))
        }
    };
    need(base_permission(name).ok_or_else(|| denied("unknown tool"))?)?;
    let changes = &args["changes"];
    if (name == "update_task" && changes["status"] == "trash")
        || (name == "create_task" && args["status"] == "trash")
    {
        need("tasks.trash")?;
    }
    if name == "update_task"
        && (!changes["recurrence"].is_null() || changes["status"] == "recurring")
    {
        need("tasks.create")?;
    }
    if name == "update_tag" && changes.get("archived").is_some_and(|v| !v.is_null()) {
        need("tags.archive")?;
    }
    if name == "update_area" && changes.get("archived").is_some_and(|v| !v.is_null()) {
        need("areas.archive")?;
    }
    if name == "update_perspective" && changes["deleted"] == true {
        need("perspectives.delete")?;
    }
    if name == "import_nirvana" {
        for (key, _, _) in PERMISSIONS {
            if *key != "read" && !key.starts_with("reviews.") {
                need(key)?;
            }
        }
    }
    // Task/project tag assignment can create tags in the shared domain operation.
    if matches!(name, "update_task" | "update_project") && !policy.allows("tags.create") {
        if let Some(tags) = changes["tags"].as_array() {
            for tag in tags.iter().filter_map(Value::as_str) {
                let exists: bool =
                    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM tags WHERE name=?)")
                        .bind(tag.trim())
                        .fetch_one(pool)
                        .await
                        .map_err(internal)?;
                if !exists {
                    return Err(denied("tags.create"));
                }
            }
        }
    }
    Ok(Json(()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::{to_bytes, Body};
    use tower::ServiceExt;
    #[tokio::test]
    async fn private_settings_validate_and_reject_stale_saves_without_affecting_domain_api() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let state = AppState { pool: pool.clone() };
        let initial = load(&pool).await.unwrap().0;
        let readonly = Policy {
            enabled: true,
            allowed: vec!["read".into()],
            revision: initial.revision,
        };
        let saved = save(State(state.clone()), Json(readonly.clone()))
            .await
            .unwrap()
            .0;
        assert_eq!(saved.revision, initial.revision + 1);
        assert_eq!(
            save(State(state.clone()), Json(readonly))
                .await
                .unwrap_err()
                .0,
            StatusCode::CONFLICT
        );
        for allowed in [vec!["unknown".into()], vec!["read".into(), "read".into()]] {
            assert_eq!(
                save(
                    State(state.clone()),
                    Json(Policy {
                        allowed,
                        ..saved.clone()
                    })
                )
                .await
                .unwrap_err()
                .0,
                StatusCode::BAD_REQUEST
            );
        }
        let app = api_router(pool.clone());
        let request = axum::http::Request::builder()
            .method("POST")
            .uri("/api/tasks")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"title":"Owner edit"}"#))
            .unwrap();
        assert_eq!(
            app.clone().oneshot(request).await.unwrap().status(),
            StatusCode::OK
        );
        let response = app
            .oneshot(
                axum::http::Request::builder()
                    .uri("/api/mcp/permissions")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let body: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 100000).await.unwrap()).unwrap();
        assert_eq!(body["policy"]["allowed"], json!(["read"]));
        sqlx::query("UPDATE mcp_permissions SET allowed_json='invalid'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(authorize(&pool, "list_tasks", &json!({})).await.is_err());
    }
}
