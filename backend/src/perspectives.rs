//! Saved task queries share the existing GTD decoration and scheduling clock.
use super::*;
use std::collections::HashSet;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, schemars::JsonSchema)]
#[serde(default, deny_unknown_fields)]
pub(super) struct Rules {
    pub completed: bool,
    pub states: Vec<String>,
    pub availability: String,
    pub areas: Vec<String>,
    pub projects: Vec<String>,
    pub tags: Vec<String>,
    pub tag_mode: String,
    pub contacts: Vec<String>,
    pub waiting: Vec<String>,
    pub focus: Option<bool>,
    pub due: String,
    pub from: Option<String>,
    pub through: Option<String>,
    pub minutes: Option<i64>,
    pub no_minutes: bool,
    pub energies: Vec<i64>,
    pub no_energy: bool,
    pub first_per_project: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, schemars::JsonSchema)]
#[serde(default, deny_unknown_fields)]
pub(super) struct Definition {
    pub version: u32,
    pub rules: Rules,
    pub grouping: String,
    pub sorting: String,
    pub notes: String,
    pub icon: String,
    pub pinned: bool,
    pub project_limit: Option<i64>,
}
impl Default for Definition {
    fn default() -> Self {
        Self {
            version: 1,
            rules: Rules::default(),
            grouping: "unified".into(),
            sorting: "order".into(),
            notes: "none".into(),
            icon: "◈".into(),
            pinned: true,
            project_limit: None,
        }
    }
}
impl Definition {
    pub(super) fn validate(&self) -> Result<(), String> {
        let r = &self.rules;
        if self.version != 1
            || !["unified", "project", "area", "state", "due"].contains(&self.grouping.as_str())
            || !["order", "due", "title", "minutes", "completed"].contains(&self.sorting.as_str())
            || !["none", "preview", "full"].contains(&self.notes.as_str())
            || !["◈", "◇", "☆", "◎", "▦", "→"].contains(&self.icon.as_str())
            || self.project_limit.is_some_and(|n| !(1..=9).contains(&n))
            || !["", "available", "blocked"].contains(&r.availability.as_str())
            || !["", "all", "any", "none", "untagged"].contains(&r.tag_mode.as_str())
            || ![
                "",
                "overdue",
                "today",
                "through_today",
                "week",
                "range",
                "none",
            ]
            .contains(&r.due.as_str())
            || r.states.iter().any(|s| {
                !["inbox", "next", "waiting", "scheduled", "someday", "later"].contains(&s.as_str())
            })
            || (r.completed
                && (!r.states.is_empty() || !r.availability.is_empty() || r.first_per_project))
            || (!r.completed && self.sorting == "completed")
            || r.minutes.is_some_and(|n| !(0..=525600).contains(&n))
            || (r.no_minutes && r.minutes.is_some())
            || (r.no_energy && !r.energies.is_empty())
            || r.energies.iter().any(|n| !(0..=3).contains(n))
            || (r.tag_mode == "untagged" && !r.tags.is_empty())
        {
            return Err("Invalid Perspective rules or presentation".into());
        }
        for values in [
            &r.states,
            &r.areas,
            &r.projects,
            &r.tags,
            &r.contacts,
            &r.waiting,
        ] {
            if values.len() > 100
                || values.iter().any(|s| s.len() > 200)
                || values.iter().collect::<HashSet<_>>().len() != values.len()
            {
                return Err("Perspective choices must be unique and limited to 100 values".into());
            }
        }
        if r.waiting.iter().any(|s| s.is_empty() || s.trim() != s) {
            return Err("Invalid Waiting for text".into());
        }
        for d in [&r.from, &r.through].into_iter().flatten() {
            schedule::date(d).map_err(|e| e.to_string())?;
        }
        if r.due == "range"
            && (r.from.is_none() && r.through.is_none()
                || r.from.is_some() && r.through.is_some() && r.from > r.through)
        {
            return Err("Choose a valid due date range".into());
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, FromRow)]
pub(super) struct Perspective {
    pub id: String,
    pub name: String,
    #[sqlx(rename = "filters_json")]
    pub definition: sqlx::types::Json<Definition>,
    pub sort_order: i64,
    pub updated_at: String,
    pub deleted: bool,
}
#[derive(Serialize)]
pub(super) struct Summary {
    #[serde(flatten)]
    perspective: Perspective,
    count: Option<usize>,
    error: Option<String>,
}
#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct Save {
    pub name: String,
    pub definition: Definition,
    pub sort_order: i64,
    #[serde(default)]
    pub deleted: bool,
    pub expected_updated_at: Option<String>,
}
struct Context {
    tasks: Vec<Task>,
    tags: Vec<Tag>,
    areas: HashSet<String>,
    projects: HashSet<String>,
    today: chrono::NaiveDate,
}
impl Context {
    async fn load(state: &AppState) -> Result<Self, (StatusCode, Json<Value>)> {
        let clock = schedule::read_clock(&mut *state.pool.acquire().await.map_err(internal)?)
            .await
            .map_err(internal)?;
        Ok(Self {
            tasks: fetch_tasks(&state.pool).await?,
            tags: list_tags(State(state.clone())).await?.0,
            areas: list_areas(State(state.clone()))
                .await?
                .0
                .into_iter()
                .map(|a| a.id)
                .collect(),
            projects: sqlx::query_scalar("SELECT id FROM projects")
                .fetch_all(&state.pool)
                .await
                .map_err(internal)?
                .into_iter()
                .collect(),
            today: clock.today(Utc::now()),
        })
    }
    fn query(&self, d: &Definition) -> Result<Vec<Task>, String> {
        d.validate()?;
        let r = &d.rules;
        for (ids, known, label) in [
            (&r.areas, &self.areas, "Area"),
            (&r.projects, &self.projects, "project"),
        ] {
            if ids.iter().any(|id| !id.is_empty() && !known.contains(id)) {
                return Err(format!(
                    "Missing {label} reference. Edit this Perspective's rules."
                ));
            }
        }
        let names = |ids: &[String]| -> Result<Vec<String>, String> {
            ids.iter()
                .map(|id| {
                    self.tags
                        .iter()
                        .find(|t| &t.id == id)
                        .map(|t| t.name.clone())
                        .ok_or_else(|| {
                            "Missing tag/contact reference. Edit this Perspective's rules.".into()
                        })
                })
                .collect()
        };
        let tags = names(&r.tags)?;
        let contacts = names(&r.contacts)?;
        let today = self.today.to_string();
        let week = self
            .today
            .checked_add_days(chrono::Days::new(6))
            .unwrap_or(self.today)
            .to_string();
        let mut first = HashSet::new();
        let mut tasks: Vec<Task> = self
            .tasks
            .iter()
            .filter(|t| {
                // Select before narrowing so a later action cannot replace an excluded first action.
                let first_action = !r.first_per_project
                    || !t.available
                    || t.project_id
                        .as_ref()
                        .is_none_or(|id| first.insert(id.clone()));
                if !first_action || r.first_per_project && !t.available {
                    return false;
                }
                if if r.completed {
                    t.status != "completed"
                } else {
                    t.project_trashed || matches!(t.status.as_str(), "completed" | "trash" | "recurring")
                } {
                    return false;
                }
                if !r.states.is_empty() && !r.states.contains(&t.status) {
                    return false;
                }
                if r.availability == "available" && !t.available
                    || r.availability == "blocked" && t.available
                {
                    return false;
                }
                if !r.areas.is_empty()
                    && !r
                        .areas
                        .iter()
                        .any(|id| id == t.area_id.as_deref().unwrap_or(""))
                {
                    return false;
                }
                if !r.projects.is_empty()
                    && !r
                        .projects
                        .iter()
                        .any(|id| id == t.project_id.as_deref().unwrap_or(""))
                {
                    return false;
                }
                let has_tag = |name: &String| {
                    t.tags.contains(name)
                        || t.waiting_for.as_deref().map(str::trim) == Some(name.as_str())
                };
                if match r.tag_mode.as_str() {
                    "untagged" => {
                        !t.tags.is_empty()
                            || t.waiting_for
                                .as_deref()
                                .is_some_and(|s| !s.trim().is_empty())
                    }
                    "any" => !tags.is_empty() && !tags.iter().any(has_tag),
                    "none" => tags.iter().any(has_tag),
                    _ => !tags.iter().all(has_tag),
                } {
                    return false;
                }
                if (!contacts.is_empty() || !r.waiting.is_empty())
                    && !contacts.iter().any(has_tag)
                    && !r
                        .waiting
                        .iter()
                        .any(|w| t.waiting_for.as_deref().map(str::trim) == Some(w.as_str()))
                {
                    return false;
                }
                if r.focus.is_some_and(|v| t.starred != v) {
                    return false;
                }
                if r.no_minutes && t.estimated_minutes.is_some()
                    || r.minutes
                        .is_some_and(|n| t.estimated_minutes.is_none_or(|m| m > n))
                {
                    return false;
                }
                if r.no_energy && t.energy.is_some()
                    || !r.energies.is_empty() && t.energy.is_none_or(|n| !r.energies.contains(&n))
                {
                    return false;
                }
                let due = t.due_date.as_deref();
                match r.due.as_str() {
                    "overdue" => due.is_some_and(|s| s < today.as_str()),
                    "today" => due == Some(today.as_str()),
                    "through_today" => due.is_some_and(|s| s <= today.as_str()),
                    "week" => due.is_some_and(|s| s >= today.as_str() && s <= week.as_str()),
                    "none" => due.is_none(),
                    "range" => due.is_some_and(|s| {
                        r.from.as_deref().is_none_or(|f| s >= f)
                            && r.through.as_deref().is_none_or(|e| s <= e)
                    }),
                    _ => true,
                }
            })
            .cloned()
            .collect();
        fn optional<T: Ord>(a: &Option<T>, b: &Option<T>) -> std::cmp::Ordering {
            match (a, b) {
                (Some(a), Some(b)) => a.cmp(b),
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (Some(_), None) => std::cmp::Ordering::Less,
                _ => std::cmp::Ordering::Equal,
            }
        }
        tasks.sort_by(|a, b| {
            let order = match d.sorting.as_str() {
                "due" => optional(&a.due_date, &b.due_date),
                "minutes" => optional(&a.estimated_minutes, &b.estimated_minutes),
                "title" => a.title.to_lowercase().cmp(&b.title.to_lowercase()),
                "completed" => optional(
                    &a.completed_at.as_ref().map(|v| std::cmp::Reverse(v)),
                    &b.completed_at.as_ref().map(|v| std::cmp::Reverse(v)),
                ),
                _ => a.sort_order.cmp(&b.sort_order),
            };
            order
                .then(a.sort_order.cmp(&b.sort_order))
                .then(a.id.cmp(&b.id))
        });
        Ok(tasks)
    }
}
pub(super) async fn list(State(state): State<AppState>) -> ApiResult<Vec<Summary>> {
    let rows = sqlx::query_as::<_, Perspective>(
        "SELECT * FROM saved_views WHERE deleted=0 ORDER BY sort_order,name,id",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(internal)?;
    let context = Context::load(&state).await?;
    let mut result: Vec<Summary> = rows
        .into_iter()
        .map(|p| {
            let query = context.query(&p.definition);
            Summary {
                count: query.as_ref().ok().map(Vec::len),
                error: query.err(),
                perspective: p,
            }
        })
        .collect();
    result.sort_by_key(|s| !s.perspective.definition.pinned);
    Ok(Json(result))
}
pub(super) async fn preview(
    State(state): State<AppState>,
    Json(definition): Json<Definition>,
) -> ApiResult<Vec<Task>> {
    Ok(Json(
        Context::load(&state)
            .await?
            .query(&definition)
            .map_err(|e| bad_request(&e))?,
    ))
}
pub(super) async fn tasks(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Vec<Task>> {
    let p = sqlx::query_as::<_, Perspective>("SELECT * FROM saved_views WHERE id=? AND deleted=0")
        .bind(id)
        .fetch_optional(&state.pool)
        .await
        .map_err(internal)?
        .ok_or_else(not_found)?;
    preview(State(state), Json(p.definition.0)).await
}
pub(super) async fn create(
    State(state): State<AppState>,
    Json(input): Json<Save>,
) -> ApiResult<Perspective> {
    persist(state, uid(), input, false).await
}
pub(super) async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<Save>,
) -> ApiResult<Perspective> {
    persist(state, id, input, true).await
}
async fn persist(state: AppState, id: String, input: Save, update: bool) -> ApiResult<Perspective> {
    let name = required_name(&input.name)?;
    input.definition.validate().map_err(|e| bad_request(&e))?;
    if !input.deleted {
        Context::load(&state)
            .await?
            .query(&input.definition)
            .map_err(|e| bad_request(&e))?;
    }
    let mut tx = state
        .pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(internal)?;
    let now = stamp();
    if update {
        let old: Perspective = sqlx::query_as("SELECT * FROM saved_views WHERE id=?")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(internal)?
            .ok_or_else(not_found)?;
        if input.expected_updated_at.as_deref() != Some(&old.updated_at) {
            return Err(conflict(
                "This Perspective changed. Reopen it before saving.",
            ));
        }
        sqlx::query("UPDATE saved_views SET name=?,filters_json=?,sort_order=?,updated_at=?,deleted=? WHERE id=?")
            .bind(&name).bind(sqlx::types::Json(&input.definition)).bind(input.sort_order).bind(&now).bind(input.deleted).bind(&id).execute(&mut *tx).await.map_err(internal)?;
    } else {
        if input.deleted || input.expected_updated_at.is_some() {
            return Err(bad_request("Invalid new Perspective"));
        }
        sqlx::query("INSERT INTO saved_views(id,name,filters_json,sort_order,created_at,updated_at,deleted) VALUES(?,?,?,?,?,?,0)")
            .bind(&id).bind(&name).bind(sqlx::types::Json(&input.definition)).bind(input.sort_order).bind(&now).bind(&now).execute(&mut *tx).await.map_err(internal)?;
    }
    tx.commit().await.map_err(internal)?;
    Ok(Json(Perspective {
        id,
        name,
        definition: sqlx::types::Json(input.definition),
        sort_order: input.sort_order,
        updated_at: now,
        deleted: input.deleted,
    }))
}
#[cfg(test)]
mod tests {
    use super::*;
    async fn state() -> AppState {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        AppState { pool }
    }
    async fn add(s: &AppState, title: &str, patch: Value) -> Task {
        let t = create_task(
            State(s.clone()),
            Json(serde_json::from_value(json!({"title":title,"status":"next"})).unwrap()),
        )
        .await
        .unwrap()
        .0;
        update_task(
            State(s.clone()),
            Path(t.id),
            Json(serde_json::from_value(patch).unwrap()),
        )
        .await
        .unwrap()
        .0
    }
    #[tokio::test]
    async fn combined_rules_inherit_area_keep_sequence_and_follow_renames() {
        let s = state().await;
        let area = create_area(
            State(s.clone()),
            Json(NewArea {
                name: "Personal".into(),
            }),
        )
        .await
        .unwrap()
        .0;
        let tag = create_tag(
            State(s.clone()),
            Json(NewTag {
                name: "Laptop".into(),
                kind: None,
            }),
        )
        .await
        .unwrap()
        .0;
        let p = create_project(
            State(s.clone()),
            Json(
                serde_json::from_value(
                    json!({"name":"Nextleaf","area_id":area.id,"project_type":"sequential"}),
                )
                .unwrap(),
            ),
        )
        .await
        .unwrap()
        .0;
        let first = add(
            &s,
            "First",
            json!({"project_id":p.id,"status":"waiting","waiting_for":"Supplier"}),
        )
        .await;
        let later = add(&s, "Later", json!({"project_id":p.id,"tags":["Laptop"]})).await;
        let mut d = Definition::default();
        d.rules.areas = vec![area.id];
        d.rules.projects = vec![p.id];
        d.rules.tags = vec![tag.id.clone()];
        d.rules.states = vec!["next".into()];
        d.rules.availability = "available".into();
        assert!(preview(State(s.clone()), Json(d.clone()))
            .await
            .unwrap()
            .0
            .is_empty());
        let _ = update_task(
            State(s.clone()),
            Path(first.id),
            Json(serde_json::from_value(json!({"status":"completed"})).unwrap()),
        )
        .await
        .unwrap();
        assert_eq!(
            preview(State(s.clone()), Json(d.clone())).await.unwrap().0[0].id,
            later.id
        );
        let _ = update_tag(
            State(s.clone()),
            Path(tag.id.clone()),
            Json(serde_json::from_value(json!({"name":"Notebook","archived":true})).unwrap()),
        )
        .await
        .unwrap();
        assert_eq!(
            preview(State(s.clone()), Json(d.clone()))
                .await
                .unwrap()
                .0
                .len(),
            1
        );
        d.rules.tags.push("missing".into());
        assert!(preview(State(s), Json(d)).await.is_err());
    }
    #[tokio::test]
    async fn tags_contacts_effort_dates_and_stable_sorting() {
        let s = state().await;
        let laptop = create_tag(
            State(s.clone()),
            Json(NewTag {
                name: "Laptop".into(),
                kind: None,
            }),
        )
        .await
        .unwrap()
        .0;
        let garage = create_tag(
            State(s.clone()),
            Json(NewTag {
                name: "Garage".into(),
                kind: None,
            }),
        )
        .await
        .unwrap()
        .0;
        let alice = create_tag(
            State(s.clone()),
            Json(NewTag {
                name: "Alice".into(),
                kind: Some("person".into()),
            }),
        )
        .await
        .unwrap()
        .0;
        let a=add(&s,"A",json!({"tags":["Laptop","Garage"],"due_date":"2026-10-24","estimated_minutes":20,"energy":1})).await;
        let b = add(&s, "B", json!({"tags":["Laptop"],"due_date":"2026-10-30"})).await;
        let c = add(
            &s,
            "C",
            json!({"status":"waiting","waiting_for":"External supplier"}),
        )
        .await;
        let person = add(&s, "D", json!({"status":"waiting","waiting_for":"Alice"})).await;
        let mut context = Context::load(&s).await.unwrap();
        context.today = schedule::date("2026-10-24").unwrap();
        let mut d = Definition::default();
        d.rules.tags = vec![laptop.id, garage.id];
        d.rules.tag_mode = "all".into();
        assert_eq!(
            context
                .query(&d)
                .unwrap()
                .iter()
                .map(|t| t.id.clone())
                .collect::<Vec<_>>(),
            vec![a.id.clone()]
        );
        d.rules.tag_mode = "any".into();
        assert_eq!(context.query(&d).unwrap().len(), 2);
        d.rules.tag_mode = "none".into();
        assert_eq!(context.query(&d).unwrap().len(), 2);
        d.rules.tags.clear();
        d.rules.tag_mode = "untagged".into();
        assert!(context.query(&d).unwrap().is_empty());
        d = Definition::default();
        d.rules.waiting = vec!["External supplier".into()];
        assert_eq!(context.query(&d).unwrap()[0].id, c.id);
        d.rules.waiting.clear();
        d.rules.contacts = vec![alice.id];
        assert_eq!(context.query(&d).unwrap()[0].id, person.id);
        d = Definition::default();
        d.rules.minutes = Some(30);
        d.rules.energies = vec![1];
        assert_eq!(context.query(&d).unwrap()[0].id, a.id);
        d.rules.no_minutes = true;
        assert!(d.validate().is_err());
        d = Definition::default();
        d.rules.due = "week".into();
        d.sorting = "due".into();
        assert_eq!(
            context
                .query(&d)
                .unwrap()
                .iter()
                .map(|t| &t.id)
                .collect::<Vec<_>>(),
            vec![&a.id, &b.id]
        );
        context.today = schedule::date("2026-10-25").unwrap();
        assert_eq!(context.query(&d).unwrap()[0].id, b.id);
        d = Definition::default();
        d.sorting = "minutes".into();
        assert_eq!(context.query(&d).unwrap()[0].id, a.id);
        d.rules.no_energy = true;
        assert_eq!(context.query(&d).unwrap().len(), 3);
        d.rules.no_energy = false;
        d.rules.due = "range".into();
        assert!(d.validate().is_err());
    }
    #[tokio::test]
    async fn persistence_preview_stale_edits_and_soft_delete_do_not_touch_tasks() {
        let s = state().await;
        add(&s, "Keep me", json!({"notes":"Preserve this"})).await;
        let input = || Save {
            name: "My view".into(),
            definition: Definition::default(),
            sort_order: 100,
            deleted: false,
            expected_updated_at: None,
        };
        let _ = preview(State(s.clone()), Json(Definition::default()))
            .await
            .unwrap();
        assert!(list(State(s.clone())).await.unwrap().0.is_empty());
        let p = create(State(s.clone()), Json(input())).await.unwrap().0;
        assert_eq!(list(State(s.clone())).await.unwrap().0[0].count, Some(1));
        let mut edit = input();
        edit.name = "Updated".into();
        edit.expected_updated_at = Some(p.updated_at.clone());
        let saved = update(State(s.clone()), Path(p.id.clone()), Json(edit))
            .await
            .unwrap()
            .0;
        let mut stale = input();
        stale.expected_updated_at = Some(p.updated_at);
        assert_eq!(
            update(State(s.clone()), Path(p.id.clone()), Json(stale))
                .await
                .unwrap_err()
                .0,
            StatusCode::CONFLICT
        );
        let mut delete = input();
        delete.deleted = true;
        delete.expected_updated_at = Some(saved.updated_at);
        let _ = update(State(s.clone()), Path(p.id.clone()), Json(delete))
            .await
            .unwrap();
        assert!(list(State(s.clone())).await.unwrap().0.is_empty());
        assert!(tasks(State(s.clone()), Path(p.id)).await.is_err());
        assert_eq!(fetch_tasks(&s.pool).await.unwrap().len(), 1);
    }
    #[test]
    fn malformed_definitions_fail_closed() {
        assert!(serde_json::from_value::<Definition>(json!({"surprise":true})).is_err());
        for v in [
            json!({"version":2}),
            json!({"grouping":"sql"}),
            json!({"rules":{"completed":true,"states":["next"]}}),
            json!({"rules":{"tags":["x","x"]}}),
            json!({"rules":{"energies":[99]}}),
        ] {
            assert!(serde_json::from_value::<Definition>(v)
                .unwrap()
                .validate()
                .is_err());
        }
    }
}
