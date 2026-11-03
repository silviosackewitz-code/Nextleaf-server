//! Review dates are checkpoints, independent of task deadlines and recurring tasks.
use super::*;
use chrono::{Days, Months, NaiveDate};
use sqlx::SqliteConnection;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct Schedule {
    pub interval: u32,
    pub unit: String,
    pub last_reviewed: Option<String>,
    pub next_review: Option<String>,
}
impl Default for Schedule {
    fn default() -> Self {
        Self {
            interval: 1,
            unit: "weeks".into(),
            last_reviewed: None,
            next_review: None,
        }
    }
}
impl Schedule {
    pub fn validate(&self) -> Result<(), String> {
        if !(1..=1000).contains(&self.interval)
            || !matches!(self.unit.as_str(), "days" | "weeks" | "months")
        {
            return Err("Choose 1–1000 days, weeks or months".into());
        }
        for date in [&self.last_reviewed, &self.next_review]
            .into_iter()
            .flatten()
        {
            schedule::date(date).map_err(str::to_owned)?;
        }
        Ok(())
    }
    fn next(&self, today: NaiveDate) -> Result<String, String> {
        self.validate()?;
        let result = match self.unit.as_str() {
            "days" => today.checked_add_days(Days::new(self.interval.into())),
            "weeks" => today.checked_add_days(Days::new(u64::from(self.interval) * 7)),
            _ => today.checked_add_months(Months::new(self.interval)),
        }
        .ok_or("Review date is out of range")?
        .to_string();
        schedule::date(&result).map_err(str::to_owned)?;
        Ok(result)
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(deny_unknown_fields)]
pub(super) struct Record {
    pub id: String,
    pub data_json: String,
    pub revision: String,
    pub undo_json: Option<String>,
}
impl Record {
    pub fn validate(&self) -> Result<(), String> {
        if !valid_target(&self.id) || Uuid::parse_str(&self.revision).is_err() {
            return Err("Invalid review identity or revision".into());
        }
        parse(&self.data_json)?.validate()?;
        if let Some(raw) = &self.undo_json {
            parse(raw)?.validate()?;
        }
        Ok(())
    }
}
fn parse(raw: &str) -> Result<Schedule, String> {
    serde_json::from_str(raw).map_err(|_| "Invalid review schedule".into())
}
pub(super) fn valid_target(id: &str) -> bool {
    matches!(id, "list:single-actions" | "list:someday-ideas")
        || id
            .strip_prefix("project:")
            .is_some_and(|p| !p.is_empty() && p.len() <= 120)
}
async fn record(conn: &mut SqliteConnection, id: &str) -> ApiResult<Option<Record>> {
    Ok(Json(
        sqlx::query_as("SELECT id,data_json,revision,undo_json FROM reviews WHERE id=?")
            .bind(id)
            .fetch_optional(conn)
            .await
            .map_err(internal)?,
    ))
}
async fn target(conn: &mut SqliteConnection, id: &str) -> ApiResult<()> {
    if !valid_target(id) {
        return Err(bad_request("Unknown review target; Inbox has no schedule"));
    }
    if let Some(project) = id.strip_prefix("project:") {
        let status: Option<String> = sqlx::query_scalar("SELECT status FROM projects WHERE id=?")
            .bind(project)
            .fetch_optional(conn)
            .await
            .map_err(internal)?;
        match status.as_deref() {
            None => return Err(not_found()),
            Some("completed") => return Err(bad_request("Completed projects do not need review")),
            _ => (),
        }
    }
    Ok(Json(()))
}
async fn write(
    conn: &mut SqliteConnection,
    id: &str,
    value: &Schedule,
    undo: Option<String>,
) -> ApiResult<Record> {
    value.validate().map_err(|e| bad_request(&e))?;
    let row = Record {
        id: id.into(),
        data_json: serde_json::to_string(value).unwrap(),
        revision: uid(),
        undo_json: undo,
    };
    sqlx::query("INSERT INTO reviews(id,data_json,revision,undo_json) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json,revision=excluded.revision,undo_json=excluded.undo_json")
        .bind(&row.id).bind(&row.data_json).bind(&row.revision).bind(&row.undo_json)
        .execute(conn).await.map_err(internal)?;
    Ok(Json(row))
}
fn expect(row: &Option<Record>, expected: &Option<String>) -> ApiResult<()> {
    if row.as_ref().map(|r| &r.revision) != expected.as_ref() {
        return Err(conflict(
            "Review changed. Reload before saving or confirming.",
        ));
    }
    Ok(Json(()))
}
async fn today(conn: &mut SqliteConnection) -> Result<NaiveDate, (StatusCode, Json<Value>)> {
    Ok(schedule::read_clock(conn)
        .await
        .map_err(internal)?
        .today(Utc::now()))
}
#[derive(Debug, Serialize)]
pub(super) struct Unit {
    pub id: String,
    pub name: String,
    pub project_id: Option<String>,
    pub status: Option<String>,
    pub schedule: Schedule,
    pub revision: Option<String>,
    pub count: usize,
    pub due: bool,
    pub confirm_next: Option<String>,
    pub can_undo: bool,
}
#[derive(Debug, Serialize)]
pub(super) struct Overview {
    pub today: String,
    pub inbox_count: usize,
    pub units: Vec<Unit>,
}
fn contains(id: &str, task: &Task) -> bool {
    if matches!(task.status.as_str(), "inbox" | "completed" | "trash") {
        return false;
    }
    match id {
        "list:single-actions" => task.project_id.is_none() && task.status != "someday",
        "list:someday-ideas" => task.project_id.is_none() && task.status == "someday",
        _ => id
            .strip_prefix("project:")
            .is_some_and(|p| task.project_id.as_deref() == Some(p)),
    }
}
pub(super) async fn list(State(state): State<AppState>) -> ApiResult<Overview> {
    let day = today(&mut *state.pool.acquire().await.map_err(internal)?).await?;
    let tasks = fetch_tasks(&state.pool).await?;
    let projects = list_projects(State(state.clone()), Query(ProjectFilter { area_id: None }))
        .await?
        .0;
    let rows: Vec<Record> = sqlx::query_as("SELECT id,data_json,revision,undo_json FROM reviews")
        .fetch_all(&state.pool)
        .await
        .map_err(internal)?;
    let rows: HashMap<_, _> = rows.into_iter().map(|r| (r.id.clone(), r)).collect();
    let mut targets: Vec<_> = projects
        .into_iter()
        .filter(|p| p.status != "completed")
        .map(|p| {
            (
                format!("project:{}", p.id),
                p.name,
                Some(p.id),
                Some(p.status),
            )
        })
        .collect();
    targets.extend([
        (
            "list:single-actions".into(),
            "Single actions".into(),
            None,
            None,
        ),
        (
            "list:someday-ideas".into(),
            "Someday ideas".into(),
            None,
            None,
        ),
    ]);
    let mut units = Vec::new();
    for (id, name, project_id, status) in targets {
        let row = rows.get(&id);
        let schedule = row
            .map(|r| parse(&r.data_json))
            .transpose()
            .map_err(|e| bad_request(&e))?
            .unwrap_or_default();
        let count = tasks.iter().filter(|t| contains(&id, t)).count();
        let due = (project_id.is_some() || count > 0)
            && schedule
                .next_review
                .as_deref()
                .is_none_or(|s| s <= day.to_string().as_str());
        units.push(Unit {
            id,
            name,
            project_id,
            status,
            count,
            due,
            confirm_next: schedule.next(day).ok(),
            schedule,
            revision: row.map(|r| r.revision.clone()),
            can_undo: row.is_some_and(|r| r.undo_json.is_some()),
        });
    }
    units.sort_by(|a, b| {
        a.project_id
            .is_none()
            .cmp(&b.project_id.is_none())
            .then_with(|| a.schedule.next_review.cmp(&b.schedule.next_review))
            .then_with(|| a.name.cmp(&b.name))
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(Json(Overview {
        today: day.to_string(),
        inbox_count: tasks.iter().filter(|t| t.status == "inbox").count(),
        units,
    }))
}
pub(super) async fn tasks(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Vec<Task>> {
    let _ = target(&mut *state.pool.acquire().await.map_err(internal)?, &id).await?;
    Ok(Json(
        fetch_tasks(&state.pool)
            .await?
            .into_iter()
            .filter(|t| contains(&id, t))
            .collect(),
    ))
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct Change {
    pub id: String,
    pub expected_revision: Option<String>,
    pub interval: u32,
    pub unit: String,
    pub next_review: Option<String>,
}
pub(super) async fn update(
    State(state): State<AppState>,
    Json(input): Json<Change>,
) -> ApiResult<Record> {
    let mut tx = state
        .pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(internal)?;
    let _ = target(&mut tx, &input.id).await?;
    let row = record(&mut tx, &input.id).await?.0;
    let _ = expect(&row, &input.expected_revision)?;
    let mut value = row
        .as_ref()
        .map(|r| parse(&r.data_json))
        .transpose()
        .map_err(|e| bad_request(&e))?
        .unwrap_or_default();
    value.interval = input.interval;
    value.unit = input.unit;
    value.next_review = input.next_review;
    let result = write(&mut tx, &input.id, &value, None).await?;
    tx.commit().await.map_err(internal)?;
    Ok(result)
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct Confirm {
    pub id: String,
    pub expected_revision: Option<String>,
    /// Day returned by list_reviews, preventing an unnoticed midnight date change.
    pub expected_day: String,
}
pub(super) async fn confirm(
    State(state): State<AppState>,
    Json(input): Json<Confirm>,
) -> ApiResult<Record> {
    let mut tx = state
        .pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(internal)?;
    let _ = target(&mut tx, &input.id).await?;
    let row = record(&mut tx, &input.id).await?.0;
    let _ = expect(&row, &input.expected_revision)?;
    let mut value = row
        .as_ref()
        .map(|r| parse(&r.data_json))
        .transpose()
        .map_err(|e| bad_request(&e))?
        .unwrap_or_default();
    let day = today(&mut tx).await?;
    if input.expected_day != day.to_string() {
        return Err(conflict(
            "The review day changed. Refresh before confirming.",
        ));
    }
    let undo = serde_json::to_string(&value).unwrap();
    value.last_reviewed = Some(day.to_string());
    value.next_review = Some(value.next(day).map_err(|e| bad_request(&e))?);
    let result = write(&mut tx, &input.id, &value, Some(undo)).await?;
    tx.commit().await.map_err(internal)?;
    Ok(result)
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct Undo {
    pub id: String,
    pub expected_revision: String,
}
pub(super) async fn undo(
    State(state): State<AppState>,
    Json(input): Json<Undo>,
) -> ApiResult<Record> {
    let mut tx = state
        .pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(internal)?;
    let _ = target(&mut tx, &input.id).await?;
    let row = record(&mut tx, &input.id).await?.0;
    let _ = expect(&row, &Some(input.expected_revision))?;
    let value = parse(
        row.as_ref()
            .and_then(|r| r.undo_json.as_deref())
            .ok_or_else(|| bad_request("No review confirmation to undo"))?,
    )
    .map_err(|e| bad_request(&e))?;
    let result = write(&mut tx, &input.id, &value, None).await?;
    tx.commit().await.map_err(internal)?;
    Ok(result)
}
pub(super) async fn reopened(conn: &mut SqliteConnection, project: &str) -> ApiResult<()> {
    let id = format!("project:{project}");
    let mut value = record(conn, &id)
        .await?
        .0
        .map(|r| parse(&r.data_json))
        .transpose()
        .map_err(|e| bad_request(&e))?
        .unwrap_or_default();
    value.next_review = Some(today(conn).await?.to_string());
    let _ = write(conn, &id, &value, None).await?;
    Ok(Json(()))
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
    async fn project(s: &AppState) -> Project {
        create_project(
            State(s.clone()),
            Json(serde_json::from_value(json!({"name":"Review project"})).unwrap()),
        )
        .await
        .unwrap()
        .0
    }
    async fn add(s: &AppState, state: &str, project: Option<&str>) -> Task {
        create_task(
            State(s.clone()),
            Json(
                serde_json::from_value(json!({"title":state,"status":state,"project_id":project}))
                    .unwrap(),
            ),
        )
        .await
        .unwrap()
        .0
    }
    async fn confirm_unit(s: &AppState, id: &str, revision: Option<String>) -> ApiResult<Record> {
        let day = list(State(s.clone())).await.unwrap().0.today;
        confirm(
            State(s.clone()),
            Json(Confirm {
                id: id.into(),
                expected_revision: revision,
                expected_day: day,
            }),
        )
        .await
    }
    #[test]
    fn dates_restart_from_actual_review_and_clamp_calendar_months() {
        let weekly = Schedule::default();
        for (day, next) in [
            ("2026-10-26", "2026-11-02"),
            ("2026-10-28", "2026-11-04"),
            ("2026-10-30", "2026-11-06"),
        ] {
            assert_eq!(weekly.next(schedule::date(day).unwrap()).unwrap(), next);
        }
        let monthly = Schedule {
            unit: "months".into(),
            ..weekly.clone()
        };
        for (day, next) in [
            ("2027-01-31", "2027-02-28"),
            ("2027-02-28", "2027-03-28"),
            ("2028-01-31", "2028-02-29"),
        ] {
            assert_eq!(monthly.next(schedule::date(day).unwrap()).unwrap(), next);
        }
        assert!(weekly.next(schedule::date("9999-12-31").unwrap()).is_err());
        assert!(Schedule {
            interval: 0,
            ..weekly.clone()
        }
        .validate()
        .is_err());
        assert!(Schedule {
            unit: "years".into(),
            ..weekly
        }
        .validate()
        .is_err());
    }
    #[tokio::test]
    async fn inbox_is_always_unscheduled_and_never_filtered_by_project_or_area() {
        let s = state().await;
        let p = project(&s).await;
        let inbox = add(&s, "inbox", Some(&p.id)).await;
        let a = list(State(s.clone())).await.unwrap().0;
        assert_eq!(a.inbox_count, 1);
        assert!(a.units.iter().all(|u| u.id != "inbox"));
        assert_eq!(
            confirm_unit(&s, "inbox", None).await.unwrap_err().0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            update(
                State(s.clone()),
                Json(Change {
                    id: "inbox".into(),
                    expected_revision: None,
                    interval: 1,
                    unit: "weeks".into(),
                    next_review: None
                })
            )
            .await
            .unwrap_err()
            .0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM reviews")
                .fetch_one(&s.pool)
                .await
                .unwrap(),
            0
        );
        let _ = update_task(
            State(s.clone()),
            Path(inbox.id),
            Json(serde_json::from_value(json!({"status":"next"})).unwrap()),
        )
        .await
        .unwrap();
        assert_eq!(list(State(s.clone())).await.unwrap().0.inbox_count, 0);
        add(&s, "inbox", None).await;
        assert_eq!(list(State(s)).await.unwrap().0.inbox_count, 1);
    }
    #[tokio::test]
    async fn full_project_content_someday_and_empty_projects_remain_reviewable() {
        let s = state().await;
        let p = project(&s).await;
        for status in ["next", "waiting", "later", "someday"] {
            add(&s, status, Some(&p.id)).await;
        }
        let _ = update_project(
            State(s.clone()),
            Path(p.id.clone()),
            Json(
                serde_json::from_value(json!({"status":"someday","project_type":"sequential"}))
                    .unwrap(),
            ),
        )
        .await
        .unwrap();
        let rows = tasks(State(s.clone()), Path(format!("project:{}", p.id)))
            .await
            .unwrap()
            .0;
        assert_eq!(rows.len(), 4);
        assert!(rows.iter().all(|t| !t.available));
        let empty = project(&s).await;
        let a = add(&s, "waiting", None).await;
        let b = add(&s, "someday", None).await;
        assert_eq!(
            tasks(State(s.clone()), Path("list:single-actions".into()))
                .await
                .unwrap()
                .0[0]
                .id,
            a.id
        );
        assert_eq!(
            tasks(State(s.clone()), Path("list:someday-ideas".into()))
                .await
                .unwrap()
                .0[0]
                .id,
            b.id
        );
        assert!(list(State(s))
            .await
            .unwrap()
            .0
            .units
            .iter()
            .any(|u| u.project_id.as_deref() == Some(&empty.id) && u.due && u.count == 0));
    }
    #[tokio::test]
    async fn confirmation_postpone_undo_and_stale_writes_preserve_tasks() {
        let s = state().await;
        let p = project(&s).await;
        let id = format!("project:{}", p.id);
        let t = add(&s, "next", Some(&p.id)).await;
        let first = confirm_unit(&s, &id, None).await.unwrap().0;
        assert!(
            !list(State(s.clone()))
                .await
                .unwrap()
                .0
                .units
                .iter()
                .find(|u| u.id == id)
                .unwrap()
                .due
        );
        assert_eq!(
            confirm_unit(&s, &id, None).await.unwrap_err().0,
            StatusCode::CONFLICT
        );
        let restored = undo(
            State(s.clone()),
            Json(Undo {
                id: id.clone(),
                expected_revision: first.revision.clone(),
            }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(parse(&restored.data_json).unwrap(), Schedule::default());
        assert_eq!(
            undo(
                State(s.clone()),
                Json(Undo {
                    id: id.clone(),
                    expected_revision: first.revision
                })
            )
            .await
            .unwrap_err()
            .0,
            StatusCode::CONFLICT
        );
        let postponed = update(
            State(s.clone()),
            Json(Change {
                id: id.clone(),
                expected_revision: Some(restored.revision),
                interval: 4,
                unit: "weeks".into(),
                next_review: Some("2099-12-01".into()),
            }),
        )
        .await
        .unwrap()
        .0;
        assert!(parse(&postponed.data_json).unwrap().last_reviewed.is_none());
        let early = confirm_unit(&s, &id, Some(postponed.revision))
            .await
            .unwrap()
            .0;
        let value = parse(&early.data_json).unwrap();
        let day = schedule::date(value.last_reviewed.as_deref().unwrap()).unwrap();
        assert_eq!(value.next_review, Some((day + Days::new(28)).to_string()));
        assert_eq!(
            get_task(State(s), Path(t.id)).await.unwrap().0.status,
            "next"
        );
    }
    #[tokio::test]
    async fn reopen_is_due_and_retains_interval_without_fabricating_confirmation() {
        let s = state().await;
        let p = project(&s).await;
        let id = format!("project:{}", p.id);
        let _ = update(
            State(s.clone()),
            Json(Change {
                id: id.clone(),
                expected_revision: None,
                interval: 3,
                unit: "months".into(),
                next_review: Some("2099-01-01".into()),
            }),
        )
        .await
        .unwrap();
        let _ = update_project(
            State(s.clone()),
            Path(p.id.clone()),
            Json(serde_json::from_value(json!({"status":"completed"})).unwrap()),
        )
        .await
        .unwrap();
        assert!(list(State(s.clone()))
            .await
            .unwrap()
            .0
            .units
            .iter()
            .all(|u| u.id != id));
        let _ = update_project(
            State(s.clone()),
            Path(p.id),
            Json(serde_json::from_value(json!({"status":"someday"})).unwrap()),
        )
        .await
        .unwrap();
        let unit = list(State(s))
            .await
            .unwrap()
            .0
            .units
            .into_iter()
            .find(|u| u.id == id)
            .unwrap();
        assert!(unit.due);
        assert_eq!(unit.schedule.interval, 3);
        assert!(unit.schedule.last_reviewed.is_none());
    }
    #[tokio::test]
    async fn bad_date_or_midnight_change_rolls_back_confirmation() {
        let s = state().await;
        let id = "list:single-actions";
        let _ = update(
            State(s.clone()),
            Json(Change {
                id: id.into(),
                expected_revision: None,
                interval: 1,
                unit: "weeks".into(),
                next_review: Some("2026-2-30".into()),
            }),
        )
        .await
        .unwrap_err();
        let err = confirm(
            State(s.clone()),
            Json(Confirm {
                id: id.into(),
                expected_revision: None,
                expected_day: "1900-01-01".into(),
            }),
        )
        .await
        .unwrap_err();
        assert_eq!(err.0, StatusCode::CONFLICT);
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM reviews")
                .fetch_one(&s.pool)
                .await
                .unwrap(),
            0
        );
    }
}
