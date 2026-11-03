mod mcp;
mod mcp_permissions;
pub mod nirvana;
mod oauth;
mod perspectives;
mod reviews;
pub mod schedule;
mod web_security;

use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
    routing::{get, patch},
    Json, Router,
};
use chrono::Utc;
use rmcp::schemars;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{sqlite::SqlitePoolOptions, FromRow, SqlitePool};
use std::{collections::HashMap, env, net::SocketAddr, path::PathBuf};
use tower_http::{
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    pool: SqlitePool,
}
type ApiResult<T> = Result<Json<T>, (StatusCode, Json<Value>)>;

fn bad_request(message: &str) -> (StatusCode, Json<Value>) {
    (StatusCode::BAD_REQUEST, Json(json!({"error": message})))
}
fn internal(error: sqlx::Error) -> (StatusCode, Json<Value>) {
    tracing::error!("Database error: {error}");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"error":"database error"})),
    )
}
fn not_found() -> (StatusCode, Json<Value>) {
    (StatusCode::NOT_FOUND, Json(json!({"error":"not found"})))
}
fn stamp() -> String {
    Utc::now().to_rfc3339()
}
fn uid() -> String {
    Uuid::new_v4().to_string()
}
fn required_name(input: &str) -> Result<String, (StatusCode, Json<Value>)> {
    let name = input.trim();
    if name.is_empty() || name.len() > 200 {
        Err(bad_request("Name must be 1–200 characters"))
    } else {
        Ok(name.to_owned())
    }
}

fn check_text(value: Option<&str>) -> Result<(), (StatusCode, Json<Value>)> {
    if value.is_some_and(|v| v.len() > 1_000_000) {
        return Err(bad_request("Text must not exceed 1,000,000 bytes"));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, FromRow)]
struct Area {
    id: String,
    name: String,
    sort_order: i64,
    archived: bool,
}
#[derive(Debug, Deserialize, rmcp::schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
struct NewArea {
    name: String,
}
async fn list_areas(State(state): State<AppState>) -> ApiResult<Vec<Area>> {
    let rows = sqlx::query_as::<_, Area>(
        "SELECT id, name, sort_order, archived FROM areas ORDER BY sort_order, name",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(internal)?;
    Ok(Json(rows))
}
async fn create_area(State(state): State<AppState>, Json(input): Json<NewArea>) -> ApiResult<Area> {
    let name = required_name(&input.name)?;
    let id = uid();
    let now = stamp();
    let order: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(sort_order), 0) + 100 FROM areas")
        .fetch_one(&state.pool)
        .await
        .map_err(internal)?;
    sqlx::query(
        "INSERT INTO areas (id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&name)
    .bind(order)
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(internal)?;
    Ok(Json(Area {
        id,
        name,
        sort_order: order,
        archived: false,
    }))
}

#[derive(Debug, Clone, Serialize, FromRow)]
struct Tag {
    id: String,
    name: String,
    kind: String,
    archived: bool,
}
#[derive(Debug, Deserialize, rmcp::schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
struct NewTag {
    name: String,
    kind: Option<String>,
}
#[derive(Debug, Deserialize, rmcp::schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
struct UpdateTag {
    name: Option<String>,
    /// tag or person. Changing kind preserves every assignment.
    kind: Option<String>,
    /// Hide from new assignments without removing existing links. False restores it.
    archived: Option<bool>,
    expected: Option<serde_json::Map<String, Value>>,
}
#[derive(Debug, Deserialize, rmcp::schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
struct UpdateArea {
    name: Option<String>,
    archived: Option<bool>,
    expected: Option<serde_json::Map<String, Value>>,
}
fn valid_tag_kind(kind: &str) -> Result<(), (StatusCode, Json<Value>)> {
    if matches!(kind, "tag" | "person") {
        Ok(())
    } else {
        Err(bad_request("Tag kind must be tag or person"))
    }
}
fn conflict(message: &str) -> (StatusCode, Json<Value>) {
    (StatusCode::CONFLICT, Json(json!({"error":message})))
}
async fn list_tags(State(state): State<AppState>) -> ApiResult<Vec<Tag>> {
    Ok(Json(
        sqlx::query_as::<_, Tag>(
            "SELECT id,name,kind,archived FROM tags ORDER BY name COLLATE NOCASE",
        )
        .fetch_all(&state.pool)
        .await
        .map_err(internal)?,
    ))
}
async fn create_tag(State(state): State<AppState>, Json(input): Json<NewTag>) -> ApiResult<Tag> {
    let name = required_name(&input.name)?;
    let kind = input.kind.as_deref().unwrap_or("tag");
    valid_tag_kind(kind)?;
    let mut tx = state
        .pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(internal)?;
    sqlx::query("INSERT INTO tags(id,name,kind) VALUES(?,?,?) ON CONFLICT(name) DO NOTHING")
        .bind(uid())
        .bind(&name)
        .bind(kind)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    let tag = sqlx::query_as::<_, Tag>("SELECT id,name,kind,archived FROM tags WHERE name=?")
        .bind(name)
        .fetch_one(&mut *tx)
        .await
        .map_err(internal)?;
    if tag.archived {
        return Err(conflict("This tag is archived. Restore it in Manage Tags."));
    }
    if input.kind.is_some() && tag.kind != kind {
        return Err(conflict(
            "This name already belongs to a different tag kind. Change its kind in Manage Tags.",
        ));
    }
    tx.commit().await.map_err(internal)?;
    Ok(Json(tag))
}
async fn update_tag(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<UpdateTag>,
) -> ApiResult<Tag> {
    let name = input.name.as_deref().map(required_name).transpose()?;
    if let Some(kind) = &input.kind {
        valid_tag_kind(kind)?;
    }
    let mut tx = state
        .pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(internal)?;
    let current = sqlx::query_as::<_, Tag>("SELECT id,name,kind,archived FROM tags WHERE id=?")
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(internal)?
        .ok_or_else(not_found)?;
    check_expected(&mut tx, "tags", &id, input.expected.as_ref()).await?;
    if let Some(name) = &name {
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM tags WHERE name=? AND id!=?)")
                .bind(name)
                .bind(&id)
                .fetch_one(&mut *tx)
                .await
                .map_err(internal)?;
        if exists {
            return Err(conflict("A tag with this name already exists."));
        }
    }
    sqlx::query("UPDATE tags SET name=COALESCE(?,name),kind=COALESCE(?,kind),archived=COALESCE(?,archived) WHERE id=?")
        .bind(&name).bind(&input.kind).bind(input.archived).bind(&id).execute(&mut *tx).await.map_err(internal)?;
    // Imported waiting_for text has no IDs. Exact person-name references follow renames.
    if (current.kind == "person" || input.kind.as_deref() == Some("person"))
        && name.as_ref().is_some_and(|n| n != &current.name)
    {
        sqlx::query("UPDATE tasks SET waiting_for=?,updated_at=? WHERE waiting_for=?")
            .bind(&name)
            .bind(stamp())
            .bind(&current.name)
            .execute(&mut *tx)
            .await
            .map_err(internal)?;
    }
    let tag = sqlx::query_as::<_, Tag>("SELECT id,name,kind,archived FROM tags WHERE id=?")
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    Ok(Json(tag))
}
async fn update_area(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<UpdateArea>,
) -> ApiResult<Area> {
    let name = input.name.as_deref().map(required_name).transpose()?;
    let mut tx = state
        .pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(internal)?;
    check_expected(&mut tx, "areas", &id, input.expected.as_ref()).await?;
    let changed = sqlx::query("UPDATE areas SET name=COALESCE(?,name),archived=COALESCE(?,archived),updated_at=? WHERE id=?")
        .bind(name).bind(input.archived).bind(stamp()).bind(&id).execute(&mut *tx).await.map_err(internal)?;
    if changed.rows_affected() == 0 {
        return Err(not_found());
    }
    let area =
        sqlx::query_as::<_, Area>("SELECT id,name,sort_order,archived FROM areas WHERE id=?")
            .bind(id)
            .fetch_one(&mut *tx)
            .await
            .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    Ok(Json(area))
}

#[derive(Debug, Clone, Serialize, FromRow)]
struct Project {
    id: String,
    area_id: Option<String>,
    name: String,
    notes: String,
    project_type: String,
    status: String,
    sort_order: i64,
    completed_at: Option<String>,
    due_date: Option<String>,
    starred: bool,
    #[sqlx(skip)]
    tags: Vec<String>,
}
#[derive(Debug, Deserialize, rmcp::schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
struct NewProject {
    name: String,
    area_id: Option<String>,
    project_type: Option<String>,
    notes: Option<String>,
}
#[derive(Debug, Deserialize, rmcp::schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
struct ProjectFilter {
    area_id: Option<String>,
}
async fn list_projects(
    State(state): State<AppState>,
    Query(filter): Query<ProjectFilter>,
) -> ApiResult<Vec<Project>> {
    let mut rows = sqlx::query_as::<_, Project>(
        "SELECT id,area_id,name,notes,project_type,status,sort_order,completed_at,due_date,starred FROM projects WHERE (? IS NULL OR area_id = ?) ORDER BY sort_order,name"
    ).bind(&filter.area_id).bind(&filter.area_id).fetch_all(&state.pool).await.map_err(internal)?;
    let links: Vec<(String, String)> = sqlx::query_as("SELECT pt.project_id,t.name FROM project_tags pt JOIN tags t ON t.id=pt.tag_id ORDER BY t.name").fetch_all(&state.pool).await.map_err(internal)?;
    let mut tags: HashMap<String, Vec<String>> = HashMap::new();
    for (id, name) in links {
        tags.entry(id).or_default().push(name);
    }
    for project in &mut rows {
        project.tags = tags.remove(&project.id).unwrap_or_default();
    }
    Ok(Json(rows))
}
async fn create_project(
    State(state): State<AppState>,
    Json(input): Json<NewProject>,
) -> ApiResult<Project> {
    let name = required_name(&input.name)?;
    let project_type = input.project_type.unwrap_or_else(|| "parallel".into());
    if project_type != "sequential" && project_type != "parallel" {
        return Err(bad_request("Invalid project_type"));
    }
    let mut tx = state
        .pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(internal)?;
    if let Some(area) = &input.area_id {
        ensure_area(&mut tx, area, None).await?;
    }
    let now = stamp();
    let id = uid();
    check_text(input.notes.as_deref())?;
    let notes = input.notes.unwrap_or_default();
    let order: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(sort_order), 0) + 100 FROM projects")
        .fetch_one(&mut *tx)
        .await
        .map_err(internal)?;
    sqlx::query("INSERT INTO projects (id,area_id,name,notes,project_type,status,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,'active',?,?,?)")
        .bind(&id).bind(&input.area_id).bind(&name).bind(&notes).bind(&project_type).bind(order).bind(&now).bind(&now)
        .execute(&mut *tx).await.map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    Ok(Json(Project {
        id,
        area_id: input.area_id,
        name,
        notes,
        project_type,
        status: "active".into(),
        sort_order: order,
        completed_at: None,
        due_date: None,
        starred: false,
        tags: Vec::new(),
    }))
}
#[derive(Debug, Deserialize, rmcp::schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
struct UpdateProject {
    /// Original values of edited fields. A mismatch returns 409 instead of overwriting newer changes.
    expected: Option<serde_json::Map<String, Value>>,
    name: Option<String>,
    notes: Option<String>,
    project_type: Option<String>,
    status: Option<String>,
    starred: Option<bool>,
    tags: Option<Vec<String>>,
    #[serde(default, deserialize_with = "nullable")]
    area_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "nullable")]
    due_date: Option<Option<String>>,
}
async fn update_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<UpdateProject>,
) -> ApiResult<Project> {
    if input.name.is_none()
        && input.notes.is_none()
        && input.project_type.is_none()
        && input.status.is_none()
        && input.starred.is_none()
        && input.tags.is_none()
        && input.area_id.is_none()
        && input.due_date.is_none()
    {
        return Err(bad_request("No changes"));
    }
    check_text(input.notes.as_deref())?;
    let name = input.name.as_deref().map(required_name).transpose()?;
    if input
        .project_type
        .as_deref()
        .is_some_and(|v| !matches!(v, "parallel" | "sequential"))
    {
        return Err(bad_request("Invalid project_type"));
    }
    if input
        .status
        .as_deref()
        .is_some_and(|v| !matches!(v, "active" | "someday" | "completed"))
    {
        return Err(bad_request("Invalid project status"));
    }
    if let Some(Some(date)) = &input.due_date {
        if schedule::date(date).is_err() {
            return Err(bad_request("Dates must use YYYY-MM-DD"));
        }
    }
    let tags = input
        .tags
        .as_ref()
        .map(|items| {
            items
                .iter()
                .map(|v| required_name(v))
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()?;
    let mut tx = state
        .pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(internal)?;
    check_expected(&mut tx, "projects", &id, input.expected.as_ref()).await?;
    let previous_status: Option<String> = sqlx::query_scalar("SELECT status FROM projects WHERE id=?")
        .bind(&id).fetch_optional(&mut *tx).await.map_err(internal)?;
    if previous_status.as_deref() == Some("completed") && input.status.as_deref().is_some_and(|s| s != "completed") {
        let _ = reviews::reopened(&mut tx, &id).await?;
    }
    if let Some(Some(area)) = &input.area_id {
        ensure_area(&mut tx, area, Some(("projects", &id))).await?;
    }
    let result = sqlx::query("UPDATE projects SET name=COALESCE(?,name),notes=COALESCE(?,notes),project_type=COALESCE(?,project_type),starred=COALESCE(?,starred),completed_at=CASE WHEN ? IS NULL THEN completed_at WHEN ?='completed' THEN COALESCE(completed_at,?) ELSE NULL END,status=COALESCE(?,status),area_id=CASE WHEN ? THEN ? ELSE area_id END,due_date=CASE WHEN ? THEN ? ELSE due_date END,updated_at=? WHERE id=?")
        .bind(name).bind(input.notes).bind(input.project_type).bind(input.starred)
        .bind(&input.status).bind(&input.status).bind(stamp()).bind(&input.status)
        .bind(input.area_id.is_some()).bind(input.area_id.flatten())
        .bind(input.due_date.is_some()).bind(input.due_date.flatten()).bind(stamp()).bind(&id)
        .execute(&mut *tx).await.map_err(internal)?;
    if result.rows_affected() == 0 {
        return Err(not_found());
    }
    if let Some(tags) = tags {
        replace_tags(&mut tx, "project_tags", "project_id", &id, &tags).await?;
    }
    tx.commit().await.map_err(internal)?;
    list_projects(State(state), Query(ProjectFilter { area_id: None }))
        .await?
        .0
        .into_iter()
        .find(|p| p.id == id)
        .map(Json)
        .ok_or_else(not_found)
}

async fn replace_tags(
    conn: &mut sqlx::SqliteConnection,
    links: &str,
    owner: &str,
    id: &str,
    names: &[String],
) -> Result<(), (StatusCode, Json<Value>)> {
    for name in names {
        let archived: Option<bool> = sqlx::query_scalar("SELECT archived FROM tags WHERE name=?")
            .bind(name)
            .fetch_optional(&mut *conn)
            .await
            .map_err(internal)?;
        if archived == Some(true) {
            let assigned: bool = sqlx::query_scalar(&format!("SELECT EXISTS(SELECT 1 FROM {links} x JOIN tags t ON t.id=x.tag_id WHERE {owner}=? AND t.name=?)"))
                .bind(id).bind(name).fetch_one(&mut *conn).await.map_err(internal)?;
            if !assigned {
                return Err(conflict("This tag is archived. Restore it in Manage Tags."));
            }
        }
    }
    sqlx::query(&format!("DELETE FROM {links} WHERE {owner}=?"))
        .bind(id)
        .execute(&mut *conn)
        .await
        .map_err(internal)?;
    for name in names {
        sqlx::query("INSERT INTO tags(id,name) VALUES(?,?) ON CONFLICT(name) DO NOTHING")
            .bind(uid())
            .bind(name)
            .execute(&mut *conn)
            .await
            .map_err(internal)?;
        sqlx::query(&format!(
            "INSERT OR IGNORE INTO {links}({owner},tag_id) SELECT ?,id FROM tags WHERE name=?"
        ))
        .bind(id)
        .bind(name)
        .execute(&mut *conn)
        .await
        .map_err(internal)?;
    }
    Ok(())
}

// Compare and update share the SQLite writer transaction, including writes from another MCP process.
async fn check_expected(
    conn: &mut sqlx::SqliteConnection,
    table: &str,
    id: &str,
    expected: Option<&serde_json::Map<String, Value>>,
) -> Result<(), (StatusCode, Json<Value>)> {
    let Some(expected) = expected else {
        return Ok(());
    };
    let allowed = if table == "tags" {
        &["name", "kind", "archived"][..]
    } else if table == "areas" {
        &["name", "archived"][..]
    } else if table == "tasks" {
        &[
            "title",
            "notes",
            "status",
            "starred",
            "tags",
            "project_id",
            "area_id",
            "due_date",
            "defer_until",
            "recurrence",
            "waiting_for",
            "estimated_minutes",
            "energy",
        ][..]
    } else {
        &[
            "name",
            "notes",
            "project_type",
            "status",
            "starred",
            "tags",
            "area_id",
            "due_date",
        ][..]
    };
    if expected.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err(bad_request("Unknown expected field"));
    }
    if expected.is_empty() {
        return Ok(());
    }
    let (links, owner) = if table == "tasks" {
        ("task_tags", "task_id")
    } else {
        ("project_tags", "project_id")
    };
    let fields=expected.keys().filter(|key|key.as_str()!="tags").map(|key| {
        let value = if key=="area_id" && table=="tasks" {"CASE WHEN project_id IS NOT NULL THEN (SELECT area_id FROM projects WHERE projects.id=tasks.project_id) ELSE area_id END"} else {key};
        format!("'{key}',{value}")
    }).collect::<Vec<_>>().join(",");
    let row: Option<String> = sqlx::query_scalar(&format!(
        "SELECT json_object({fields}) FROM {table} WHERE id=?"
    ))
    .bind(id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(internal)?;
    let mut current: Value =
        serde_json::from_str(&row.ok_or_else(not_found)?).expect("SQLite JSON result");
    if let Some(raw) = current["recurrence"].as_str() {
        current["recurrence"] =
            serde_json::from_str(raw).map_err(|_| bad_request("Invalid stored repeat rule"))?;
    }
    if expected.contains_key("archived") {
        current["archived"] = json!(current["archived"].as_i64() == Some(1));
    }
    if expected.contains_key("starred") {
        current["starred"] = json!(current["starred"].as_i64() == Some(1));
    }
    if expected.contains_key("tags") {
        let names:Vec<String>=sqlx::query_scalar(&format!("SELECT t.name FROM {links} x JOIN tags t ON t.id=x.tag_id WHERE {owner}=? ORDER BY t.name"))
            .bind(id).fetch_all(&mut *conn).await.map_err(internal)?;
        current["tags"] = json!(names);
    }
    let changed: Vec<&String> = expected
        .iter()
        .filter(|(key, value)| current.get(*key) != Some(*value))
        .map(|(key, _)| key)
        .collect();
    if !changed.is_empty() {
        return Err((
            StatusCode::CONFLICT,
            Json(
                json!({"error":"This item changed while you were editing. Your draft has been kept. Reopen the item to review the latest values.","fields":changed}),
            ),
        ));
    }
    Ok(())
}

async fn ensure_area(
    conn: &mut sqlx::SqliteConnection,
    id: &str,
    existing: Option<(&str, &str)>,
) -> Result<(), (StatusCode, Json<Value>)> {
    let archived: Option<bool> = sqlx::query_scalar("SELECT archived FROM areas WHERE id=?")
        .bind(id)
        .fetch_optional(&mut *conn)
        .await
        .map_err(internal)?;
    let Some(archived) = archived else {
        return Err(bad_request("Unknown area_id"));
    };
    if archived {
        if let Some((table, owner)) = existing {
            let field = if table == "tasks" {
                "CASE WHEN project_id IS NOT NULL THEN (SELECT area_id FROM projects WHERE projects.id=tasks.project_id) ELSE area_id END"
            } else {
                "area_id"
            };
            let assigned: bool = sqlx::query_scalar(&format!(
                "SELECT EXISTS(SELECT 1 FROM {table} WHERE id=? AND {field}=?)"
            ))
            .bind(owner)
            .bind(id)
            .fetch_one(&mut *conn)
            .await
            .map_err(internal)?;
            if assigned {
                return Ok(());
            }
        }
        return Err(conflict(
            "This area is archived. Restore it in Manage Tags.",
        ));
    }
    Ok(())
}
async fn ensure_project(pool: &SqlitePool, id: &str) -> Result<(), (StatusCode, Json<Value>)> {
    let found: Option<i64> = sqlx::query_scalar("SELECT 1 FROM projects WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(internal)?;
    if found.is_none() {
        return Err(bad_request("Unknown project_id"));
    }
    Ok(())
}

#[derive(Debug, Clone, FromRow)]
struct TaskRow {
    id: String,
    project_id: Option<String>,
    area_id: Option<String>,
    title: String,
    notes: String,
    status: String,
    sort_order: i64,
    due_date: Option<String>,
    defer_until: Option<String>,
    recurrence: Option<sqlx::types::Json<schedule::RepeatRule>>,
    completed_at: Option<String>,
    created_at: String,
    updated_at: String,
    starred: bool,
    waiting_for: Option<String>,
    estimated_minutes: Option<i64>,
    energy: Option<i64>,
    project_type: Option<String>,
    project_status: Option<String>,
    project_area_id: Option<String>,
}
#[derive(Debug, Clone, Serialize)]
struct Task {
    id: String,
    project_id: Option<String>,
    area_id: Option<String>,
    title: String,
    notes: String,
    status: String,
    sort_order: i64,
    due_date: Option<String>,
    defer_until: Option<String>,
    recurrence: Option<sqlx::types::Json<schedule::RepeatRule>>,
    completed_at: Option<String>,
    created_at: String,
    updated_at: String,
    starred: bool,
    waiting_for: Option<String>,
    estimated_minutes: Option<i64>,
    energy: Option<i64>,
    tags: Vec<String>,
    available: bool,
    blocked_by_sequence: bool,
}
#[derive(Debug, Default, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
struct TaskFilter {
    view: Option<String>,
    area_id: Option<String>,
    project_id: Option<String>,
}
#[derive(Debug, Deserialize, rmcp::schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
struct NewTask {
    title: String,
    starred: Option<bool>,
    project_id: Option<String>,
    area_id: Option<String>,
    status: Option<String>,
    notes: Option<String>,
    defer_until: Option<String>,
}
#[derive(Debug, Deserialize, rmcp::schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
struct UpdateTask {
    /// Original values of edited fields. A mismatch returns 409 instead of overwriting newer changes.
    expected: Option<serde_json::Map<String, Value>>,
    title: Option<String>,
    status: Option<String>,
    #[serde(default, deserialize_with = "nullable")]
    estimated_minutes: Option<Option<i64>>,
    #[serde(default, deserialize_with = "nullable")]
    energy: Option<Option<i64>>,
    notes: Option<String>,
    starred: Option<bool>,
    tags: Option<Vec<String>>,
    #[serde(default, deserialize_with = "nullable")]
    project_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "nullable")]
    area_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "nullable")]
    due_date: Option<Option<String>>,
    #[serde(default, deserialize_with = "nullable")]
    defer_until: Option<Option<String>>,
    #[serde(default, deserialize_with = "nullable")]
    recurrence: Option<Option<schedule::RepeatRule>>,
    #[serde(default, deserialize_with = "nullable")]
    waiting_for: Option<Option<String>>,
}
// A missing field leaves its value unchanged; explicit null clears it.
fn nullable<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> Result<Option<Option<T>>, D::Error> {
    Option::<T>::deserialize(deserializer).map(Some)
}
fn valid_task_status(status: &str) -> bool {
    matches!(
        status,
        "inbox" | "next" | "waiting" | "scheduled" | "someday" | "completed" | "later" | "trash"
    )
}

// Centralized rule: the first unfinished task of each sequential project is its only
// candidate for Next. If that first task is Waiting/Scheduled/Someday, don't skip it.
#[cfg(test)]
fn decorate_tasks(rows: Vec<TaskRow>) -> Vec<Task> {
    decorate_tasks_on(rows, Utc::now().date_naive())
}
fn decorate_tasks_on(rows: Vec<TaskRow>, today: chrono::NaiveDate) -> Vec<Task> {
    let mut first_open: HashMap<String, String> = HashMap::new();
    for task in &rows {
        if let (Some(project_id), Some(kind)) = (&task.project_id, &task.project_type) {
            if kind == "sequential"
                && !matches!(task.status.as_str(), "completed" | "trash" | "recurring")
                && task.project_status.as_deref() == Some("active")
            {
                first_open
                    .entry(project_id.clone())
                    .or_insert_with(|| task.id.clone());
            }
        }
    }
    let today = today.to_string();
    rows.into_iter()
        .map(|task| {
            let in_sequence = task.project_type.as_deref() == Some("sequential");
            let blocked = in_sequence
                && !matches!(task.status.as_str(), "completed" | "trash" | "recurring")
                && first_open
                    .get(task.project_id.as_deref().unwrap_or(""))
                    .map(String::as_str)
                    != Some(task.id.as_str());
            let deferred = task
                .defer_until
                .as_deref()
                .is_some_and(|date| date.get(..10).is_some_and(|date| date > today.as_str()));
            let project_active = task.project_status.as_deref().is_none_or(|s| s == "active");
            let available = task.status == "next" && project_active && !deferred && !blocked;
            Task {
                id: task.id,
                project_id: task.project_id.clone(),
                area_id: if task.project_id.is_some() {
                    task.project_area_id
                } else {
                    task.area_id
                },
                title: task.title,
                notes: task.notes,
                status: task.status,
                sort_order: task.sort_order,
                due_date: task.due_date,
                defer_until: task.defer_until,
                recurrence: task.recurrence,
                completed_at: task.completed_at,
                created_at: task.created_at,
                updated_at: task.updated_at,
                starred: task.starred,
                waiting_for: task.waiting_for,
                estimated_minutes: task.estimated_minutes,
                energy: task.energy,
                tags: Vec::new(),
                available,
                blocked_by_sequence: blocked,
            }
        })
        .collect()
}
async fn fetch_tasks(pool: &SqlitePool) -> Result<Vec<Task>, (StatusCode, Json<Value>)> {
    let clock = schedule::read_clock(&mut *pool.acquire().await.map_err(internal)?)
        .await
        .map_err(internal)?;
    let rows = sqlx::query_as::<_,TaskRow>(
        "SELECT t.id,t.project_id,t.area_id,t.title,t.notes,t.status,t.sort_order,t.due_date,t.defer_until,t.recurrence,t.completed_at,t.created_at,t.updated_at,t.starred,t.waiting_for,t.estimated_minutes,t.energy, p.project_type,p.status AS project_status,p.area_id AS project_area_id FROM tasks t LEFT JOIN projects p ON t.project_id=p.id ORDER BY t.sort_order,t.created_at,t.id"
    ).fetch_all(pool).await.map_err(internal)?;
    let links: Vec<(String, String)> = sqlx::query_as(
        "SELECT tt.task_id,t.name FROM task_tags tt JOIN tags t ON t.id=tt.tag_id ORDER BY t.name",
    )
    .fetch_all(pool)
    .await
    .map_err(internal)?;
    let mut tags: HashMap<String, Vec<String>> = HashMap::new();
    for (id, name) in links {
        tags.entry(id).or_default().push(name);
    }
    let mut tasks = decorate_tasks_on(rows, clock.today(Utc::now()));
    for task in &mut tasks {
        task.tags = tags.remove(&task.id).unwrap_or_default();
    }
    Ok(tasks)
}
fn matches_view(task: &Task, view: &str) -> bool {
    match view {
        "next" => task.available,
        "all" => !matches!(task.status.as_str(), "completed" | "trash"),
        "focus" => {
            task.starred && !matches!(task.status.as_str(), "completed" | "trash" | "recurring")
        }
        "scheduled" => matches!(task.status.as_str(), "scheduled" | "recurring"),
        _ => task.status == view,
    }
}
async fn list_tasks(
    State(state): State<AppState>,
    Query(filter): Query<TaskFilter>,
) -> ApiResult<Vec<Task>> {
    let view = filter.view.as_deref().unwrap_or("all");
    if !matches!(
        view,
        "all"
            | "inbox"
            | "next"
            | "waiting"
            | "scheduled"
            | "someday"
            | "completed"
            | "later"
            | "focus"
            | "trash"
    ) {
        return Err(bad_request("Invalid view"));
    }
    let mut rows = fetch_tasks(&state.pool).await?;
    if view == "completed" {
        rows.sort_by(|a, b| {
            b.completed_at
                .cmp(&a.completed_at)
                .then_with(|| b.updated_at.cmp(&a.updated_at))
                .then_with(|| a.id.cmp(&b.id))
        });
    }
    Ok(Json(
        rows.into_iter()
            .filter(|task| {
                matches_view(task, view)
                    && filter
                        .area_id
                        .as_ref()
                        .is_none_or(|id| task.area_id.as_ref() == Some(id))
                    && filter
                        .project_id
                        .as_ref()
                        .is_none_or(|id| task.project_id.as_ref() == Some(id))
            })
            .collect(),
    ))
}
async fn get_task(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult<Task> {
    fetch_tasks(&state.pool)
        .await?
        .into_iter()
        .find(|task| task.id == id)
        .map(Json)
        .ok_or_else(not_found)
}
async fn create_task(
    State(state): State<AppState>,
    Json(mut input): Json<NewTask>,
) -> ApiResult<Task> {
    let title = required_name(&input.title)?;
    if let Some(date) = &input.defer_until {
        schedule::date(date).map_err(bad_request)?;
    }
    check_text(input.notes.as_deref())?;
    if input.project_id.is_some() {
        input.area_id = None;
    }
    let mut status = input.status.unwrap_or_else(|| "inbox".into());
    if input.defer_until.is_some()
        && !matches!(status.as_str(), "completed" | "trash" | "recurring")
    {
        status = "scheduled".into();
    }
    if status == "scheduled" && input.defer_until.is_none() {
        return Err(bad_request("Scheduled tasks require a start date"));
    }
    if !valid_task_status(&status) {
        return Err(bad_request("Invalid task status"));
    }
    if let Some(id) = &input.project_id {
        ensure_project(&state.pool, id).await?;
    }
    let mut tx = state
        .pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(internal)?;
    if let Some(id) = &input.area_id {
        ensure_area(&mut tx, id, None).await?;
    }
    let id = uid();
    let now = stamp();
    let order: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(sort_order),0)+100 FROM tasks WHERE project_id IS ?",
    )
    .bind(&input.project_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(internal)?;
    let completed_at = if status == "completed" {
        Some(now.clone())
    } else {
        None
    };
    sqlx::query("INSERT INTO tasks (id,project_id,area_id,title,notes,status,sort_order,completed_at,created_at,updated_at,starred,defer_until) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(&id).bind(&input.project_id).bind(&input.area_id).bind(&title).bind(input.notes.unwrap_or_default())
        .bind(&status).bind(order).bind(completed_at).bind(&now).bind(&now).bind(input.starred.unwrap_or(false)).bind(input.defer_until)
        .execute(&mut *tx).await.map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    fetch_tasks(&state.pool)
        .await?
        .into_iter()
        .find(|task| task.id == id)
        .map(Json)
        .ok_or_else(not_found)
}
async fn update_task(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(mut input): Json<UpdateTask>,
) -> ApiResult<Task> {
    if input.title.is_none()
        && input.status.is_none()
        && input.estimated_minutes.is_none()
        && input.energy.is_none()
        && input.notes.is_none()
        && input.starred.is_none()
        && input.tags.is_none()
        && input.project_id.is_none()
        && input.area_id.is_none()
        && input.due_date.is_none()
        && input.defer_until.is_none()
        && input.recurrence.is_none()
        && input.waiting_for.is_none()
    {
        return Err(bad_request("No changes"));
    }
    let title = input.title.as_deref().map(required_name).transpose()?;
    if let Some(Some(rule)) = &input.recurrence {
        rule.validate().map_err(bad_request)?;
        if input.status.as_deref().is_some_and(|s| s != "recurring") {
            return Err(bad_request("A repeat rule requires Recurring state"));
        }
        input.status = Some("recurring".into());
        input.defer_until = Some(None);
    }
    check_text(input.notes.as_deref())?;
    check_text(input.waiting_for.as_ref().and_then(|v| v.as_deref()))?;
    if input
        .status
        .as_ref()
        .is_some_and(|s| !valid_task_status(s) && s != "recurring")
    {
        return Err(bad_request("Invalid task status"));
    }
    if input
        .estimated_minutes
        .flatten()
        .is_some_and(|minutes| minutes < 0)
    {
        return Err(bad_request("Time must be a non-negative number of minutes"));
    }
    if input
        .energy
        .flatten()
        .is_some_and(|energy| !(0..=3).contains(&energy))
    {
        return Err(bad_request("Energy must be between 0 and 3"));
    }
    for date in [&input.due_date, &input.defer_until]
        .into_iter()
        .flatten()
        .flatten()
    {
        schedule::date(date).map_err(bad_request)?;
    }
    if let Some(Some(project)) = &input.project_id {
        ensure_project(&state.pool, project).await?;
    }
    let tags = input
        .tags
        .as_ref()
        .map(|tags| {
            tags.iter()
                .map(|tag| required_name(tag))
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()?;
    let mut tx = state
        .pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(internal)?;
    check_expected(&mut tx, "tasks", &id, input.expected.as_ref()).await?;
    let (old_status, old_date, old_rule, old_project): (
        String,
        Option<String>,
        Option<sqlx::types::Json<schedule::RepeatRule>>,
        Option<String>,
    ) = sqlx::query_as("SELECT status,defer_until,recurrence,project_id FROM tasks WHERE id=?")
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(internal)?
        .ok_or_else(not_found)?;
    if let Some(Some(rule)) = &mut input.recurrence {
        sqlx::query("INSERT OR IGNORE INTO repeat_cycles(template_id,rule_id) VALUES(?,?)")
            .bind(&id)
            .bind(old_rule.as_ref().map(|r| &r.id).unwrap_or(&rule.id))
            .execute(&mut *tx)
            .await
            .map_err(internal)?;
        rule.id = sqlx::query_scalar("SELECT rule_id FROM repeat_cycles WHERE template_id=?")
            .bind(&id)
            .fetch_one(&mut *tx)
            .await
            .map_err(internal)?;
        if old_rule.as_ref().is_some_and(|old| {
            old.frequency != rule.frequency
                || old.interval != rule.interval
                || old.start != rule.start
                || old.until != rule.until
                || old.due_days != rule.due_days
        }) && old_rule
            .as_ref()
            .and_then(|old| old.catch_up_through.as_ref())
            == rule.catch_up_through.as_ref()
        {
            rule.catch_up_through = None;
        }
    }
    if input.status.as_deref() == Some("recurring")
        && old_status != "recurring"
        && old_rule.is_none()
        && input.recurrence.as_ref().is_none_or(|r| r.is_none())
        && !matches!(old_status.as_str(), "trash" | "completed")
    {
        return Err(bad_request("Supply a repeat rule to start repeating"));
    }
    if input
        .status
        .as_deref()
        .is_some_and(|s| !matches!(s, "recurring" | "completed" | "trash"))
    {
        input.recurrence = Some(None);
    }
    let status = input.status.as_deref().unwrap_or(&old_status);
    let date = input.defer_until.as_ref().unwrap_or(&old_date);
    if !matches!(status, "completed" | "trash" | "recurring") {
        if date.is_some() && (input.defer_until.is_some() || matches!(status, "next" | "scheduled"))
        {
            input.status = Some("scheduled".into());
        } else if status == "scheduled" && date.is_none() {
            if input.defer_until == Some(None) {
                input.status = Some("next".into());
            } else {
                return Err(bad_request("Scheduled tasks require a start date"));
            }
        }
    }
    if input.project_id.as_ref().unwrap_or(&old_project).is_some() {
        input.area_id = Some(None);
    }
    if input.recurrence == Some(None) && input.status.is_none() {
        let status: Option<String> = sqlx::query_scalar("SELECT status FROM tasks WHERE id=?")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(internal)?;
        if status.as_deref() == Some("recurring") {
            input.status = Some("next".into());
        }
    }
    if let Some(Some(area)) = &input.area_id {
        ensure_area(&mut tx, area, Some(("tasks", &id))).await?;
    }
    let result = sqlx::query(r#"UPDATE tasks SET
        title=COALESCE(?,title), notes=COALESCE(?,notes),
        completed_at=CASE WHEN ? IS NULL THEN completed_at WHEN ?='completed' THEN COALESCE(completed_at,?) ELSE NULL END,
        status=COALESCE(?,status), starred=COALESCE(?,starred),
        estimated_minutes=CASE WHEN ? THEN ? ELSE estimated_minutes END,
        energy=CASE WHEN ? THEN ? ELSE energy END,
        sort_order=CASE WHEN ? AND project_id IS NOT ? THEN (SELECT COALESCE(MAX(sort_order),0)+100 FROM tasks WHERE project_id IS ?) ELSE sort_order END,
        project_id=CASE WHEN ? THEN ? ELSE project_id END,
        area_id=CASE WHEN ? THEN ? WHEN ? THEN NULL ELSE area_id END,
        due_date=CASE WHEN ? THEN ? ELSE due_date END,
        defer_until=CASE WHEN ? THEN ? ELSE defer_until END,
        recurrence=CASE WHEN ? THEN ? ELSE recurrence END,
        waiting_for=CASE WHEN ? THEN ? ELSE waiting_for END,
        updated_at=? WHERE id=?"#)
        .bind(title).bind(input.notes).bind(&input.status).bind(&input.status).bind(stamp())
        .bind(&input.status).bind(input.starred)
        .bind(input.estimated_minutes.is_some()).bind(input.estimated_minutes.flatten())
        .bind(input.energy.is_some()).bind(input.energy.flatten())
        .bind(input.project_id.is_some()).bind(input.project_id.as_ref().and_then(|v| v.as_deref())).bind(input.project_id.as_ref().and_then(|v| v.as_deref()))
        .bind(input.project_id.is_some()).bind(input.project_id.as_ref().and_then(|v| v.as_deref()))
        .bind(input.area_id.is_some()).bind(input.area_id.flatten()).bind(input.project_id.as_ref().is_some_and(|v| v.is_some()))
        .bind(input.due_date.is_some()).bind(input.due_date.flatten())
        .bind(input.defer_until.is_some()).bind(input.defer_until.flatten())
        .bind(input.recurrence.is_some()).bind(input.recurrence.flatten().map(sqlx::types::Json))
        .bind(input.waiting_for.is_some()).bind(input.waiting_for.flatten())
        .bind(stamp()).bind(&id).execute(&mut *tx).await.map_err(internal)?;
    if result.rows_affected() == 0 {
        return Err(not_found());
    }
    if let Some(tags) = tags {
        replace_tags(&mut tx, "task_tags", "task_id", &id, &tags).await?;
    }
    tx.commit().await.map_err(internal)?;
    fetch_tasks(&state.pool)
        .await?
        .into_iter()
        .find(|task| task.id == id)
        .map(Json)
        .ok_or_else(not_found)
}

pub mod sync;
pub use mcp::serve_stdio;

pub async fn create_pool(
    path: &std::path::Path,
) -> Result<SqlitePool, Box<dyn std::error::Error + Send + Sync>> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(
            sqlx::sqlite::SqliteConnectOptions::new()
                .filename(path)
                .create_if_missing(true)
                .foreign_keys(true)
                .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
                .busy_timeout(std::time::Duration::from_secs(15)),
        )
        .await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    schedule::migrate_dates(&pool).await?;
    sync::migrate_client_state(&pool).await?;
    Ok(pool)
}

pub fn api_router(pool: SqlitePool) -> Router {
    configured_api_router(pool, false)
}
fn configured_api_router(pool: SqlitePool, mcp_enabled: bool) -> Router {
    let state = AppState { pool };
    let api = Router::new()
        .route(
            "/health",
            get(move || async move {
                Json(json!({"status":"ok","capabilities":["task-editing","item-creation","project-editing","mcp","sync","conditional-updates","tag-management","sync-v6","reviews","perspectives","mcp-permissions","scheduling","repeat-backlog-confirmation"],"mcp":{"enabled":mcp_enabled,"path":"/mcp"}}))
            }),
        )
        .route("/mcp/permissions", get(mcp_permissions::get).patch(mcp_permissions::save))
        .route("/reviews", get(reviews::list).patch(reviews::update))
        .route("/reviews/confirm", axum::routing::post(reviews::confirm))
        .route("/reviews/undo", axum::routing::post(reviews::undo))
        .route("/reviews/{id}/tasks", get(reviews::tasks))
        .route("/schedule/preview", axum::routing::post(schedule::preview))
        .route("/schedule/timezone", axum::routing::post(schedule::report_timezone))
        .route("/perspectives", get(perspectives::list).post(perspectives::create))
        .route("/perspectives/preview", axum::routing::post(perspectives::preview))
        .route("/perspectives/{id}", patch(perspectives::update))
        .route("/perspectives/{id}/tasks", get(perspectives::tasks))
        .route("/areas", get(list_areas).post(create_area))
        .route("/areas/{id}", patch(update_area))
        .route("/projects", get(list_projects).post(create_project))
        .route("/projects/{id}", patch(update_project))
        .route("/tags", get(list_tags).post(create_tag))
        .route("/tags/{id}", patch(update_tag))
        .route("/tasks", get(list_tasks).post(create_task))
        .route("/tasks/{id}", get(get_task).patch(update_task))
        .route("/sync", get(sync::get_snapshot).post(sync::exchange).layer(axum::extract::DefaultBodyLimit::max(16 * 1024 * 1024)))
        .with_state(state);
    Router::new().nest("/api", api)
}

pub async fn run() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "nextleaf_server=info,tower_http=info".into()),
        )
        .init();
    let bind: SocketAddr = env::var("TASKMANAGER_BIND")
        .unwrap_or_else(|_| "127.0.0.1:8787".into())
        .parse()?;
    let database_url = env::var("TASKMANAGER_DATABASE_URL")
        .unwrap_or_else(|_| "sqlite://../data/taskmanager.db".into());
    let db_path = database_url.trim_start_matches("sqlite://");
    if db_path != ":memory:" {
        if let Some(parent) = std::path::Path::new(db_path).parent() {
            std::fs::create_dir_all(parent)?;
        }
    }
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(
            database_url
                .parse::<sqlx::sqlite::SqliteConnectOptions>()?
                .create_if_missing(true)
                .foreign_keys(true)
                .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
                .busy_timeout(std::time::Duration::from_secs(15)),
        )
        .await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    schedule::migrate_dates(&pool).await?;
    sync::migrate_client_state(&pool).await?;
    tokio::spawn(schedule::run(pool.clone(), true));
    let oauth = oauth::OAuth::from_env(pool.clone())?;
    let mcp_enabled =
        oauth.is_some() || env::var("NEXTLEAF_MCP_TOKEN").is_ok_and(|token| !token.is_empty());
    let mcp_router = mcp::router(AppState { pool: pool.clone() }, oauth)?;
    let web_dir = PathBuf::from(
        env::var("TASKMANAGER_WEB_DIR").unwrap_or_else(|_| "../frontend/dist".into()),
    );
    let funnel_bind = mcp::funnel_bind(
        &env::var("NEXTLEAF_MCP_BIND").unwrap_or_default(),
        mcp_enabled,
        &env::var("NEXTLEAF_MCP_HOSTS").unwrap_or_default(),
    )?;
    let mut app = configured_api_router(pool, mcp_enabled).merge(mcp_router.clone());
    if web_dir.join("index.html").exists() {
        app = app.fallback_service(
            ServeDir::new(&web_dir).not_found_service(ServeFile::new(web_dir.join("index.html"))),
        );
        tracing::info!("Serving web build from {}", web_dir.display());
    }
    let mut hosts: Vec<String> = env::var("NEXTLEAF_HTTP_HOSTS")
        .or_else(|_| env::var("NEXTLEAF_MCP_HOSTS"))
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_owned)
        .collect();
    hosts.extend(["localhost".into(), "127.0.0.1".into(), "[::1]".into()]);
    app = app
        .layer(axum::middleware::from_fn_with_state(
            hosts,
            web_security::protect,
        ))
        .layer(TraceLayer::new_for_http());
    let listener = tokio::net::TcpListener::bind(bind).await?;
    tracing::info!("Nextleaf listening on http://{bind}");
    if let Some(bind) = funnel_bind {
        // Funnel must never receive the private web/REST/sync router.
        let mcp_listener = tokio::net::TcpListener::bind(bind).await?;
        tracing::info!("Nextleaf MCP-only listener on http://{bind}/mcp");
        tokio::try_join!(async { axum::serve(listener, app).await }, async {
            axum::serve(mcp_listener, mcp_router).await
        },)?;
    } else {
        axum::serve(listener, app).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn example(id: &str, project: &str, status: &str, order: i64) -> TaskRow {
        TaskRow {
            id: id.into(),
            project_id: Some(project.into()),
            area_id: None,
            title: id.into(),
            notes: String::new(),
            status: status.into(),
            sort_order: order,
            due_date: None,
            defer_until: None,
            recurrence: None,
            completed_at: None,
            created_at: "2026-10-17T10:00:00Z".into(),
            updated_at: "2026-10-17T10:00:00Z".into(),
            starred: false,
            waiting_for: None,
            estimated_minutes: None,
            energy: None,
            project_type: Some("sequential".into()),
            project_status: Some("active".into()),
            project_area_id: None,
        }
    }
    #[test]
    fn sequential_exposes_only_first_unfinished() {
        let tasks = decorate_tasks(vec![
            example("one", "project", "next", 100),
            example("two", "project", "next", 200),
        ]);
        assert!(tasks[0].available);
        assert!(!tasks[1].available);
        assert!(tasks[1].blocked_by_sequence);
    }
    #[test]
    fn waiting_first_blocks_second() {
        let tasks = decorate_tasks(vec![
            example("one", "project", "waiting", 100),
            example("two", "project", "next", 200),
        ]);
        assert!(!tasks[0].available);
        assert!(!tasks[1].available);
    }
    #[test]
    fn completed_first_releases_second() {
        let tasks = decorate_tasks(vec![
            example("one", "project", "completed", 100),
            example("two", "project", "next", 200),
        ]);
        assert!(tasks[1].available);
    }
    #[test]
    fn imported_states_do_not_resurrect_trash_or_execute_repeat_templates() {
        let mut rows = vec![
            example("trash", "p", "trash", 100),
            example("repeat", "p", "recurring", 200),
            example("next", "p", "next", 300),
        ];
        rows[0].starred = true;
        let tasks = decorate_tasks(rows);
        assert!(!matches_view(&tasks[0], "all"));
        assert!(!matches_view(&tasks[0], "focus"));
        assert!(matches_view(&tasks[0], "trash"));
        assert!(matches_view(&tasks[1], "scheduled"));
        assert!(!tasks[1].available);
        assert!(tasks[2].available);
    }
    #[tokio::test]
    async fn new_items_create_focus_atomically_and_reuse_tags() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let state = AppState { pool };
        let Json(first) = create_tag(
            State(state.clone()),
            Json(NewTag {
                name: " Laptop ".into(),
                kind: None,
            }),
        )
        .await
        .unwrap();
        let Json(again) = create_tag(
            State(state.clone()),
            Json(NewTag {
                name: "Laptop".into(),
                kind: None,
            }),
        )
        .await
        .unwrap();
        assert_eq!(first.id, again.id);
        assert_eq!(list_tags(State(state.clone())).await.unwrap().0.len(), 1);
        assert!(create_tag(
            State(state.clone()),
            Json(NewTag {
                name: "  ".into(),
                kind: None
            })
        )
        .await
        .is_err());
        for starred in [false, true] {
            let Json(task) = create_task(
                State(state.clone()),
                Json(
                    serde_json::from_value(
                        json!({"title":"New action", "status":"next", "starred":starred}),
                    )
                    .unwrap(),
                ),
            )
            .await
            .unwrap();
            assert_eq!(task.starred, starred);
            assert_eq!(task.status, "next");
            assert_eq!(matches_view(&task, "focus"), starred);
        }
    }
    #[tokio::test]
    async fn logbook_shows_latest_completion_first() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        for (id, order, status, completed) in [
            ("older", 100, "completed", Some("2026-10-01")),
            ("latest", 300, "completed", Some("2026-10-17T22:00:00Z")),
            ("open", 200, "next", None),
        ] {
            sqlx::query("INSERT INTO tasks(id,title,status,sort_order,completed_at,created_at,updated_at) VALUES(?,?,?,?,?,'2026-10-01','2026-10-17')")
                .bind(id).bind(id).bind(status).bind(order).bind(completed).execute(&pool).await.unwrap();
        }
        let Json(tasks) = list_tasks(
            State(AppState { pool }),
            Query(TaskFilter {
                view: Some("completed".into()),
                ..Default::default()
            }),
        )
        .await
        .unwrap();
        assert_eq!(
            tasks.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(),
            vec!["latest", "older"]
        );
    }
    #[tokio::test]
    async fn effort_updates_preserve_other_fields_and_support_clearing() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        sqlx::query("INSERT INTO tasks(id,title,notes,status,completed_at,created_at,updated_at) VALUES('task','Keep title','Keep notes','completed','2026-10-17','2026-10-17','2026-10-17')").execute(&pool).await.unwrap();
        let state = AppState { pool };
        for (payload, time, energy) in [
            (
                json!({"estimated_minutes":45,"energy":3}),
                Some(45),
                Some(3),
            ),
            (json!({"energy":0}), Some(45), Some(0)),
            (json!({"estimated_minutes":null}), None, Some(0)),
            (json!({"energy":null}), None, None),
        ] {
            let Json(task) = update_task(
                State(state.clone()),
                Path("task".into()),
                Json(serde_json::from_value(payload).unwrap()),
            )
            .await
            .unwrap();
            assert_eq!((task.estimated_minutes, task.energy), (time, energy));
            assert_eq!(task.title, "Keep title");
            assert_eq!(task.notes, "Keep notes");
            assert_eq!(task.status, "completed");
            assert_eq!(task.completed_at.as_deref(), Some("2026-10-17"));
        }
        for payload in [
            json!({"estimated_minutes":-1,"title":"Do not save"}),
            json!({"energy":4}),
            json!({"energy":-1}),
            json!({}),
        ] {
            let error = update_task(
                State(state.clone()),
                Path("task".into()),
                Json(serde_json::from_value(payload).unwrap()),
            )
            .await
            .unwrap_err();
            assert_eq!(error.0, StatusCode::BAD_REQUEST);
        }
        assert!(serde_json::from_value::<UpdateTask>(json!({"energy":1.5})).is_err());
        assert!(serde_json::from_value::<UpdateTask>(json!({"estimated_minutes":"45"})).is_err());
        let task = fetch_tasks(&state.pool).await.unwrap().remove(0);
        assert_eq!(task.title, "Keep title");
        assert_eq!((task.estimated_minutes, task.energy), (None, None));
        assert_eq!(
            update_task(
                State(state),
                Path("missing".into()),
                Json(serde_json::from_value(json!({"energy":2})).unwrap())
            )
            .await
            .unwrap_err()
            .0,
            StatusCode::NOT_FOUND
        );
    }
    #[tokio::test]
    async fn task_editor_updates_atomically_and_moves_to_end_of_project() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO areas(id,name,created_at,updated_at) VALUES('area','Area','now','now')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO projects(id,name,area_id,project_type,created_at,updated_at) VALUES('project','Project','area','sequential','now','now')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO tasks(id,title,status,sort_order,project_id,created_at,updated_at) VALUES('first','First','next',100,'project','now','now'),('edit','Original','inbox',10,NULL,'now','now')").execute(&pool).await.unwrap();
        let state = AppState { pool };
        let Json(task) = update_task(State(state.clone()),Path("edit".into()),Json(serde_json::from_value(json!({"title":" New title ","notes":"Line one\nLine two","project_id":"project","area_id":null,"status":"next","tags":[" Laptop ","Laptop","Work"],"starred":true,"due_date":"2026-11-01","defer_until":"2026-10-01","waiting_for":"Someone"})).unwrap())).await.unwrap();
        assert_eq!(task.title, "New title");
        assert_eq!(task.notes, "Line one\nLine two");
        assert_eq!(task.project_id.as_deref(), Some("project"));
        assert_eq!(task.area_id.as_deref(), Some("area"));
        assert_eq!(task.sort_order, 200);
        assert!(task.blocked_by_sequence);
        assert!(task.starred);
        assert_eq!(task.tags, vec!["Laptop", "Work"]);
        for payload in [
            json!({"title":"Bad","due_date":"not-a-date"}),
            json!({"title":"Bad","tags":[" "]}),
            json!({"title":"Bad","project_id":"missing"}),
        ] {
            assert!(update_task(
                State(state.clone()),
                Path("edit".into()),
                Json(serde_json::from_value(payload).unwrap())
            )
            .await
            .is_err());
        }
        sqlx::query("CREATE TRIGGER reject_tag BEFORE INSERT ON tags WHEN NEW.name='Reject' BEGIN SELECT RAISE(ABORT,'test failure'); END").execute(&state.pool).await.unwrap();
        assert!(update_task(
            State(state.clone()),
            Path("edit".into()),
            Json(serde_json::from_value(json!({"title":"Bad","tags":["Reject"]})).unwrap())
        )
        .await
        .is_err());
        let unchanged = fetch_tasks(&state.pool)
            .await
            .unwrap()
            .into_iter()
            .find(|task| task.id == "edit")
            .unwrap();
        assert_eq!(unchanged.title, "New title");
        assert_eq!(unchanged.tags, vec!["Laptop", "Work"]);
        let Json(task) = update_task(State(state),Path("edit".into()),Json(serde_json::from_value(json!({"project_id":null,"area_id":null,"tags":[],"notes":"","due_date":null,"defer_until":null,"waiting_for":null,"starred":false})).unwrap())).await.unwrap();
        assert!(
            task.project_id.is_none()
                && task.area_id.is_none()
                && task.due_date.is_none()
                && task.defer_until.is_none()
                && task.waiting_for.is_none()
        );
        assert!(task.tags.is_empty() && task.notes.is_empty() && !task.starred);
        assert!(!task.blocked_by_sequence);
        assert_eq!(task.status, "next");
    }
    #[tokio::test]
    async fn project_settings_are_atomic_and_recalculate_next_without_reordering() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                "sqlite::memory:"
                    .parse::<sqlx::sqlite::SqliteConnectOptions>()
                    .unwrap()
                    .foreign_keys(true),
            )
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO areas(id,name,created_at,updated_at) VALUES('a','Area','now','now')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO projects(id,name,notes,area_id,created_at,updated_at) VALUES('p','Original','Keep notes','a','now','now')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO tasks(id,title,status,project_id,sort_order,created_at,updated_at) VALUES('first','First','next','p',100,'now','now'),('second','Second','next','p',200,'now','now')").execute(&pool).await.unwrap();
        let state = AppState { pool };
        let Json(project) = update_project(State(state.clone()),Path("p".into()),Json(serde_json::from_value(json!({"name":" Renamed ","project_type":"sequential","due_date":"2028-02-29","starred":true,"tags":[" Work ","Work"]})).unwrap())).await.unwrap();
        assert_eq!(project.name, "Renamed");
        assert_eq!(project.notes, "Keep notes");
        assert_eq!(project.tags, vec!["Work"]);
        assert!(project.starred);
        let tasks = fetch_tasks(&state.pool).await.unwrap();
        assert!(tasks[0].available && !tasks[1].available);
        assert_eq!((tasks[0].sort_order, tasks[1].sort_order), (100, 200));
        for payload in [
            json!({"name":"Bad","project_type":"invalid"}),
            json!({"name":"Bad","status":"trash"}),
            json!({"name":"Bad","area_id":"missing"}),
            json!({"name":"Bad","due_date":"2027-02-29"}),
            json!({"name":"Bad","tags":[" "]}),
            json!({}),
        ] {
            assert_eq!(
                update_project(
                    State(state.clone()),
                    Path("p".into()),
                    Json(serde_json::from_value(payload).unwrap())
                )
                .await
                .unwrap_err()
                .0,
                StatusCode::BAD_REQUEST
            );
        }
        sqlx::query("CREATE TRIGGER reject_project_tag BEFORE INSERT ON tags WHEN NEW.name='Reject' BEGIN SELECT RAISE(ABORT,'test failure'); END").execute(&state.pool).await.unwrap();
        assert!(update_project(
            State(state.clone()),
            Path("p".into()),
            Json(serde_json::from_value(json!({"name":"Bad","tags":["Reject"]})).unwrap())
        )
        .await
        .is_err());
        let project = list_projects(State(state.clone()), Query(ProjectFilter { area_id: None }))
            .await
            .unwrap()
            .0
            .remove(0);
        assert_eq!(project.name, "Renamed");
        assert_eq!(project.tags, vec!["Work"]);
        let Json(project) = update_project(State(state.clone()),Path("p".into()),Json(serde_json::from_value(json!({"area_id":null,"due_date":null,"tags":[],"starred":false,"status":"completed"})).unwrap())).await.unwrap();
        assert!(
            project.area_id.is_none()
                && project.due_date.is_none()
                && project.tags.is_empty()
                && !project.starred
                && project.completed_at.is_some()
        );
        assert!(fetch_tasks(&state.pool)
            .await
            .unwrap()
            .iter()
            .all(|t| t.status == "next" && !t.available));
        let Json(project) = update_project(
            State(state.clone()),
            Path("p".into()),
            Json(
                serde_json::from_value(json!({"status":"active","project_type":"parallel"}))
                    .unwrap(),
            ),
        )
        .await
        .unwrap();
        assert!(project.completed_at.is_none());
        assert!(fetch_tasks(&state.pool)
            .await
            .unwrap()
            .iter()
            .all(|t| t.available));
        assert_eq!(
            update_project(
                State(state),
                Path("missing".into()),
                Json(serde_json::from_value(json!({"notes":"test"})).unwrap())
            )
            .await
            .unwrap_err()
            .0,
            StatusCode::NOT_FOUND
        );
    }

    #[tokio::test]
    async fn reviewed_task_invariants_preserve_schedule_and_project_inheritance() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let state = AppState { pool };
        sqlx::raw_sql("INSERT INTO areas(id,name,created_at,updated_at) VALUES('a','A','now','now'),('b','B','now','now'); INSERT INTO projects(id,name,area_id,created_at,updated_at) VALUES('p','P','b','now','now');").execute(&state.pool).await.unwrap();
        let task = create_task(State(state.clone()), Json(serde_json::from_value(json!({"title":"Task", "project_id":"p", "area_id":"a", "status":"next", "defer_until":"2099-10-25"})).unwrap())).await.unwrap().0;
        assert_eq!(task.area_id.as_deref(), Some("b"));
        assert_eq!(task.status, "scheduled");
        let id = task.id;
        for changes in [
            json!({"status":"completed"}),
            json!({"status":"scheduled"}),
            json!({"status":"trash"}),
            json!({"status":"scheduled"}),
        ] {
            let t = update_task(
                State(state.clone()),
                Path(id.clone()),
                Json(serde_json::from_value(changes).unwrap()),
            )
            .await
            .unwrap()
            .0;
            assert_eq!(t.defer_until.as_deref(), Some("2099-10-25"));
        }
        let t = update_task(
            State(state.clone()),
            Path(id.clone()),
            Json(serde_json::from_value(json!({"defer_until":null})).unwrap()),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(t.status, "next");
        for date in ["2026-10-5", " 2026-12-24", "2026-10-19T22:00:00Z"] {
            assert!(update_task(
                State(state.clone()),
                Path(id.clone()),
                Json(serde_json::from_value(json!({"due_date":date})).unwrap())
            )
            .await
            .is_err());
            assert!(update_project(
                State(state.clone()),
                Path("p".into()),
                Json(serde_json::from_value(json!({"due_date":date})).unwrap())
            )
            .await
            .is_err());
        }
        let rule = json!({"id":uid(),"frequency":"weekly","interval":1,"start":"2099-01-01","until":null,"due_days":null,"paused":false});
        let mut t = update_task(
            State(state.clone()),
            Path(id.clone()),
            Json(serde_json::from_value(json!({"recurrence":rule})).unwrap()),
        )
        .await
        .unwrap()
        .0;
        let cycle = t.recurrence.as_ref().unwrap().id.clone();
        for changes in [
            json!({"status":"trash"}),
            json!({"status":"recurring"}),
            json!({"status":"completed"}),
            json!({"status":"recurring"}),
        ] {
            t = update_task(
                State(state.clone()),
                Path(id.clone()),
                Json(serde_json::from_value(changes).unwrap()),
            )
            .await
            .unwrap()
            .0;
            assert_eq!(t.recurrence.as_ref().unwrap().id, cycle);
        }
        let _ = update_task(
            State(state.clone()),
            Path(id.clone()),
            Json(serde_json::from_value(json!({"status":"next","recurrence":null})).unwrap()),
        )
        .await
        .unwrap();
        let mut changed = rule;
        changed["id"] = json!(uid());
        t = update_task(
            State(state.clone()),
            Path(id.clone()),
            Json(serde_json::from_value(json!({"recurrence":changed})).unwrap()),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(t.recurrence.as_ref().unwrap().id, cycle);
        assert!(update_task(
            State(state.clone()),
            Path(id),
            Json(serde_json::from_value(json!({"notes":"x".repeat(1_000_001)})).unwrap())
        )
        .await
        .is_err());
    }
    #[tokio::test]
    async fn reads_do_not_wait_for_scheduler_write_lock() {
        let directory = std::env::temp_dir().join(format!("nextleaf-read-{}", uid()));
        let pool = create_pool(&directory.join("test.db")).await.unwrap();
        let tx = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(2), fetch_tasks(&pool))
            .await
            .unwrap()
            .unwrap();
        tx.rollback().await.unwrap();
        pool.close().await;
        std::fs::remove_dir_all(directory).unwrap();
    }
}
