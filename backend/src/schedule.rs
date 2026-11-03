use super::*;
use chrono::{DateTime, Datelike, Days, Months, NaiveDate};
use sqlx::SqliteConnection;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RepeatRule {
    pub id: String,
    pub frequency: String,
    pub interval: u32,
    pub start: String,
    pub until: Option<String>,
    pub due_days: Option<u32>,
    pub paused: bool,
    /// Explicit approval for more than 100 missed copies appearing on or before this date.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catch_up_through: Option<String>,
}
pub fn date(value: &str) -> Result<NaiveDate, &'static str> {
    let parsed =
        NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| "Use a valid YYYY-MM-DD date")?;
    if parsed.to_string() != value || !(1900..=9999).contains(&parsed.year()) {
        return Err("Use canonical YYYY-MM-DD dates from 1900 through 9999");
    }
    Ok(parsed)
}
pub(crate) fn legacy_date(value: &str, clock: &Clock) -> Result<String, String> {
    let day = if let Ok(timestamp) = DateTime::parse_from_rfc3339(value) {
        clock.today(timestamp.with_timezone(&Utc))
    } else {
        NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d").map_err(|e| e.to_string())?
    };
    let result = day.to_string();
    date(&result).map_err(str::to_owned)?;
    Ok(result)
}
pub(crate) async fn migrate_dates(pool: &SqlitePool) -> Result<(), String> {
    let mut tx = pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(|e| e.to_string())?;
    let clock = read_clock(&mut tx).await.map_err(|e| e.to_string())?;
    for (table, field) in [
        ("tasks", "due_date"),
        ("tasks", "defer_until"),
        ("projects", "due_date"),
    ] {
        let rows: Vec<(String, String)> = sqlx::query_as(&format!(
            "SELECT id,{field} FROM {table} WHERE {field} IS NOT NULL"
        ))
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        for (id, raw) in rows {
            if date(&raw).is_ok() {
                continue;
            }
            let canonical = legacy_date(&raw, &clock)?;
            sqlx::query("INSERT OR IGNORE INTO date_repairs VALUES(?,?,?,?)")
                .bind(table)
                .bind(&id)
                .bind(field)
                .bind(&raw)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
            sqlx::query(&format!("UPDATE {table} SET {field}=? WHERE id=?"))
                .bind(canonical)
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().await.map_err(|e| e.to_string())
}
impl RepeatRule {
    pub fn validate(&self) -> Result<(), &'static str> {
        if Uuid::parse_str(&self.id).is_err() {
            return Err("Invalid repeat identity");
        }
        if !matches!(
            self.frequency.as_str(),
            "daily" | "weekly" | "monthly" | "yearly"
        ) || !(1..=1000).contains(&self.interval)
        {
            return Err("Choose a repeat interval from 1 to 1000");
        }
        let start = date(&self.start)?;
        if let Some(day) = &self.catch_up_through {
            date(day)?;
        }
        if self
            .until
            .as_deref()
            .map(date)
            .transpose()?
            .is_some_and(|end| end < start)
        {
            return Err("The repeat end cannot precede its start");
        }
        if self.due_days.is_some_and(|days| days > 365) {
            return Err("Due dates support up to 365 days of advance notice");
        }
        Ok(())
    }
    fn occurrence(&self, index: u32) -> Option<NaiveDate> {
        let start = date(&self.start).ok()?;
        let count = index.checked_mul(self.interval)?;
        // Anchor every occurrence to the original day, so Jan 31 -> Feb 28 -> Mar 31.
        let result = match self.frequency.as_str() {
            "daily" => start.checked_add_days(Days::new(count.into())),
            "weekly" => start.checked_add_days(Days::new(u64::from(count) * 7)),
            "monthly" => start.checked_add_months(Months::new(count)),
            "yearly" => start.checked_add_months(Months::new(count.checked_mul(12)?)),
            _ => None,
        }?;
        (self
            .until
            .as_deref()
            .is_none_or(|end| result.to_string().as_str() <= end)
            && result.year() <= 9999)
            .then_some(result)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct Clock {
    pub timezone: String,
    pub updated_at: String,
}
impl Default for Clock {
    fn default() -> Self {
        Self {
            timezone: "UTC".into(),
            updated_at: "1970-01-01T00:00:00Z".into(),
        }
    }
}
impl Clock {
    pub fn validate(&self) -> Result<(), String> {
        self.timezone
            .parse::<chrono_tz::Tz>()
            .map_err(|_| "Unknown time zone")?;
        DateTime::parse_from_rfc3339(&self.updated_at)
            .map_err(|_| "Invalid time zone timestamp")?;
        Ok(())
    }
    pub fn today(&self, now: DateTime<Utc>) -> NaiveDate {
        now.with_timezone(
            &self
                .timezone
                .parse::<chrono_tz::Tz>()
                .unwrap_or(chrono_tz::UTC),
        )
        .date_naive()
    }
    pub fn newer_than(&self, other: &Self) -> bool {
        (
            DateTime::parse_from_rfc3339(&self.updated_at).ok(),
            &self.timezone,
        ) > (
            DateTime::parse_from_rfc3339(&other.updated_at).ok(),
            &other.timezone,
        )
    }
}
pub(crate) async fn read_clock(conn: &mut SqliteConnection) -> Result<Clock, sqlx::Error> {
    let (timezone, updated_at) =
        sqlx::query_as("SELECT timezone,updated_at FROM schedule_clock WHERE singleton=1")
            .fetch_one(conn)
            .await?;
    Ok(Clock {
        timezone,
        updated_at,
    })
}
pub(crate) async fn write_clock(
    conn: &mut SqliteConnection,
    clock: &Clock,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE schedule_clock SET timezone=?,updated_at=? WHERE singleton=1")
        .bind(&clock.timezone)
        .bind(&clock.updated_at)
        .execute(conn)
        .await?;
    Ok(())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Timezone {
    timezone: String,
}
pub(super) async fn report_timezone(
    State(state): State<AppState>,
    Json(input): Json<Timezone>,
) -> ApiResult<Value> {
    let clock = Clock {
        timezone: input.timezone,
        updated_at: stamp(),
    };
    clock
        .validate()
        .map_err(|_| bad_request("Unknown time zone"))?;
    let mut tx = state
        .pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(internal)?;
    write_clock(&mut tx, &clock).await.map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    tick(&state.pool).await.map_err(internal)?;
    Ok(Json(json!({"timezone":clock.timezone})))
}

pub async fn tick(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    advance(&mut tx, Utc::now()).await?;
    tx.commit().await
}
pub async fn run(pool: SqlitePool, server: bool) {
    let mut timer = tokio::time::interval(std::time::Duration::from_secs(30));
    loop {
        timer.tick().await;
        if pool.is_closed() {
            return;
        }
        let result = async {
            let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
            if server {
                advance_server(&mut tx, Utc::now()).await?;
            } else {
                advance(&mut tx, Utc::now()).await?;
            }
            tx.commit().await
        }
        .await;
        if let Err(error) = result {
            tracing::error!("Scheduling failed: {error}");
        }
    }
}
pub(crate) async fn advance(
    conn: &mut SqliteConnection,
    now: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    // Connected desktops leave generation to the server; offline edits still remain local.
    let remote: Option<String> = sqlx::query_scalar(
        "SELECT json_extract(state_json,'$.remote_url') FROM sync_client WHERE singleton=1 AND json_extract(state_json,'$.last_sync') IS NOT NULL AND COALESCE(json_extract(state_json,'$.suspended'),0)=0",
    )
    .fetch_optional(&mut *conn)
    .await?
    .flatten();
    if remote.is_some_and(|s| !s.is_empty()) {
        return Ok(());
    }
    advance_server(conn, now).await
}
pub(crate) async fn advance_server(
    conn: &mut SqliteConnection,
    now: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    let clock = read_clock(conn).await?;
    if clock.updated_at == Clock::default().updated_at {
        return Ok(());
    }
    let today = clock.today(now);
    sqlx::query("UPDATE tasks SET status='next',starred=1,defer_until=NULL,updated_at=? WHERE status='scheduled' AND defer_until IS NOT NULL AND substr(defer_until,1,10)<=?")
        .bind(now.to_rfc3339()).bind(today.to_string()).execute(&mut *conn).await?;
    let templates: Vec<(String, String)> = sqlx::query_as("SELECT t.id,t.recurrence FROM tasks t LEFT JOIN projects p ON p.id=t.project_id WHERE t.status='recurring' AND t.recurrence IS NOT NULL AND (p.id IS NULL OR p.status='active') ORDER BY t.id").fetch_all(&mut *conn).await?;
    let existing: std::collections::HashSet<String> =
        sqlx::query_scalar::<_, String>("SELECT id FROM tasks")
            .fetch_all(&mut *conn)
            .await?
            .into_iter()
            .collect();
    let records: i64 = sqlx::query_scalar("SELECT (SELECT COUNT(*) FROM tasks)+(SELECT COUNT(*) FROM projects)+(SELECT COUNT(*) FROM areas)+(SELECT COUNT(*) FROM tags)")
        .fetch_one(&mut *conn).await?;
    let mut remaining = 100.min((50_000 - records).max(0));
    if remaining == 0 {
        return Ok(());
    }
    for (template, raw) in templates {
        let rule: RepeatRule =
            serde_json::from_str(&raw).map_err(|e| sqlx::Error::Decode(Box::new(e)))?;
        rule.validate()
            .map_err(|e| sqlx::Error::Protocol(e.into()))?;
        if rule.paused {
            continue;
        }
        let pending = pending_days(&template, &rule, today, &existing);
        if pending.len() > 100
            && pending.last().is_some_and(|day| {
                let appears = day
                    .checked_sub_days(Days::new(rule.due_days.unwrap_or(0).into()))
                    .unwrap();
                rule.catch_up_through
                    .as_deref()
                    .is_none_or(|approved| appears.to_string().as_str() > approved)
            })
        {
            // Pause visibly instead of generating an unconfirmed backlog over successive passes.
            sqlx::query("UPDATE tasks SET recurrence=json_set(recurrence,'$.paused',json('true')),updated_at=? WHERE id=?")
                .bind(now.to_rfc3339()).bind(&template).execute(&mut *conn).await?;
            continue;
        }
        for day in pending {
            let id = occurrence_id(&template, &rule.id, day);
            let result = sqlx::query("INSERT OR IGNORE INTO tasks(id,project_id,area_id,title,notes,status,sort_order,due_date,defer_until,completed_at,created_at,updated_at,starred,waiting_for,estimated_minutes,energy,recurrence) SELECT ?,project_id,area_id,title,notes,'next',(SELECT COALESCE(MAX(sort_order),0)+100 FROM tasks WHERE project_id IS source.project_id),?,NULL,NULL,?,?,1,waiting_for,estimated_minutes,energy,NULL FROM tasks source WHERE id=?")
                .bind(&id).bind(rule.due_days.map(|_| day.to_string())).bind(now.to_rfc3339()).bind(now.to_rfc3339()).bind(&template).execute(&mut *conn).await?;
            if result.rows_affected() > 0 {
                sqlx::query("INSERT INTO task_tags(task_id,tag_id) SELECT ?,tag_id FROM task_tags WHERE task_id=?").bind(&id).bind(&template).execute(&mut *conn).await?;
                remaining -= 1;
                if remaining == 0 {
                    return Ok(());
                }
            }
        }
    }
    Ok(())
}

fn occurrence_id(template: &str, cycle: &str, day: NaiveDate) -> String {
    Uuid::new_v5(
        &Uuid::NAMESPACE_URL,
        format!("nextleaf:{template}:{cycle}:{day}").as_bytes(),
    )
    .to_string()
}
fn pending_days(
    template: &str,
    rule: &RepeatRule,
    today: NaiveDate,
    existing: &std::collections::HashSet<String>,
) -> Vec<NaiveDate> {
    // shortcut: scan calendar history on worker/preview only; index a cursor if archives become slow.
    (0..)
        .map_while(|index| rule.occurrence(index))
        .take_while(|day| {
            day.checked_sub_days(Days::new(rule.due_days.unwrap_or(0).into()))
                .is_some_and(|appears| appears <= today)
        })
        .filter(|day| !existing.contains(&occurrence_id(template, &rule.id, *day)))
        .collect()
}
#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct PreviewInput {
    template_id: String,
    rule: RepeatRule,
}
pub(super) async fn preview(
    State(state): State<AppState>,
    Json(mut input): Json<PreviewInput>,
) -> ApiResult<Value> {
    input.rule.validate().map_err(bad_request)?;
    let mut tx = state.pool.begin().await.map_err(internal)?;
    if let Some(cycle) =
        sqlx::query_scalar::<_, String>("SELECT rule_id FROM repeat_cycles WHERE template_id=?")
            .bind(&input.template_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(internal)?
    {
        input.rule.id = cycle;
    }
    let clock = read_clock(&mut tx).await.map_err(internal)?;
    let today = clock.today(Utc::now());
    let existing = sqlx::query_scalar::<_, String>("SELECT id FROM tasks")
        .fetch_all(&mut *tx)
        .await
        .map_err(internal)?
        .into_iter()
        .collect();
    let count = pending_days(&input.template_id, &input.rule, today, &existing).len();
    Ok(Json(json!({"count": count, "through": today.to_string()})))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn rule(start: &str, frequency: &str) -> RepeatRule {
        RepeatRule {
            id: uid(),
            start: start.into(),
            frequency: frequency.into(),
            interval: 1,
            until: None,
            due_days: None,
            paused: false,
            catch_up_through: None,
        }
    }
    fn instant(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }
    async fn pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }
    async fn advance_at(pool: &SqlitePool, now: &str) {
        let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
        advance(&mut tx, instant(now)).await.unwrap();
        tx.commit().await.unwrap();
    }
    async fn zone(pool: &SqlitePool, timezone: &str) {
        write_clock(
            &mut *pool.acquire().await.unwrap(),
            &Clock {
                timezone: timezone.into(),
                updated_at: "2026-10-18T12:00:00Z".into(),
            },
        )
        .await
        .unwrap();
    }
    async fn insert(
        pool: &SqlitePool,
        id: &str,
        status: &str,
        day: Option<&str>,
        repeat: Option<RepeatRule>,
    ) {
        sqlx::query("INSERT INTO tasks(id,title,notes,status,sort_order,defer_until,created_at,updated_at,recurrence) VALUES(?,?,'Keep notes',?,100,?,'2026-10-18T12:00:00Z','2026-10-18T12:00:00Z',?)").bind(id).bind(id).bind(status).bind(day).bind(repeat.map(sqlx::types::Json)).execute(pool).await.unwrap();
    }
    #[test]
    fn anchored_month_year_end_and_validation() {
        let mut monthly = rule("2027-01-31", "monthly");
        assert_eq!(monthly.occurrence(1).unwrap().to_string(), "2027-02-28");
        assert_eq!(monthly.occurrence(2).unwrap().to_string(), "2027-03-31");
        monthly.until = Some("2027-02-28".into());
        assert!(monthly.occurrence(2).is_none());
        assert_eq!(
            rule("2024-02-29", "yearly")
                .occurrence(4)
                .unwrap()
                .to_string(),
            "2028-02-29"
        );
        monthly.interval = 0;
        assert!(monthly.validate().is_err());
        assert!(date("2026-2-1").is_err());
        assert!(date("2026-02-30").is_err());
        assert!(Clock {
            timezone: "Unknown/Zone".into(),
            ..Clock::default()
        }
        .validate()
        .is_err());
    }
    #[test]
    fn travel_and_daylight_saving_use_calendar_days() {
        let berlin = Clock {
            timezone: "Europe/Berlin".into(),
            ..Clock::default()
        };
        let mexico = Clock {
            timezone: "America/Hermosillo".into(),
            ..Clock::default()
        };
        assert_eq!(
            berlin.today(instant("2026-10-18T22:30:00Z")).to_string(),
            "2026-10-19"
        );
        assert_eq!(
            mexico.today(instant("2026-10-18T22:30:00Z")).to_string(),
            "2026-10-18"
        );
        assert_eq!(
            berlin.today(instant("2026-03-28T23:30:00Z")).to_string(),
            "2026-03-29"
        );
        assert_eq!(
            berlin.today(instant("2026-10-25T23:30:00Z")).to_string(),
            "2026-10-26"
        );
    }
    #[tokio::test]
    async fn dates_activate_once_and_preserve_other_states() {
        let p = pool().await;
        zone(&p, "Europe/Berlin").await;
        for state in ["scheduled", "waiting", "completed", "trash", "recurring"] {
            insert(&p, state, state, Some("2026-10-19"), None).await;
        }
        advance_at(&p, "2026-10-18T21:59:59Z").await;
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT status FROM tasks WHERE id='scheduled'")
                .fetch_one(&p)
                .await
                .unwrap(),
            "scheduled"
        );
        advance_at(&p, "2026-10-18T22:00:00Z").await;
        let row: (String, bool, Option<String>, String) = sqlx::query_as(
            "SELECT status,starred,defer_until,updated_at FROM tasks WHERE id='scheduled'",
        )
        .fetch_one(&p)
        .await
        .unwrap();
        assert_eq!((&*row.0, row.1, row.2), ("next", true, None));
        advance_at(&p, "2026-10-20T00:00:00Z").await;
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT updated_at FROM tasks WHERE id='scheduled'")
                .fetch_one(&p)
                .await
                .unwrap(),
            row.3
        );
        for state in ["waiting", "completed", "trash", "recurring"] {
            assert_eq!(
                sqlx::query_scalar::<_, String>("SELECT status FROM tasks WHERE id=?")
                    .bind(state)
                    .fetch_one(&p)
                    .await
                    .unwrap(),
                state
            );
        }
    }
    #[tokio::test]
    async fn repeat_copies_keep_metadata_and_never_resurrect_deleted_occurrences() {
        let p = pool().await;
        zone(&p, "Europe/Berlin").await;
        let mut repeat = rule("2026-10-20", "daily");
        repeat.due_days = Some(1);
        repeat.until = Some("2026-10-21".into());
        insert(&p, "template", "recurring", None, Some(repeat.clone())).await;
        sqlx::query("INSERT INTO tags(id,name,kind) VALUES('contact','Contact','person')")
            .execute(&p)
            .await
            .unwrap();
        sqlx::query("INSERT INTO task_tags VALUES('template','contact')")
            .execute(&p)
            .await
            .unwrap();
        advance_at(&p, "2026-10-18T22:00:00Z").await;
        let rows: Vec<(String, String, String, bool, Option<String>)> = sqlx::query_as(
            "SELECT id,notes,due_date,starred,recurrence FROM tasks WHERE id!='template'",
        )
        .fetch_all(&p)
        .await
        .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(
            (&*rows[0].1, &*rows[0].2, rows[0].3, rows[0].4.clone()),
            ("Keep notes", "2026-10-20", true, None)
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM task_tags WHERE task_id=?")
                .bind(&rows[0].0)
                .fetch_one(&p)
                .await
                .unwrap(),
            1
        );
        sqlx::query("UPDATE tasks SET status='trash' WHERE id=?")
            .bind(&rows[0].0)
            .execute(&p)
            .await
            .unwrap();
        advance_at(&p, "2026-10-22T12:00:00Z").await;
        advance_at(&p, "2026-10-22T12:00:00Z").await;
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM tasks")
                .fetch_one(&p)
                .await
                .unwrap(),
            3
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT status FROM tasks WHERE id=?")
                .bind(&rows[0].0)
                .fetch_one(&p)
                .await
                .unwrap(),
            "trash"
        );
        repeat.paused = true;
        insert(&p, "paused", "recurring", None, Some(repeat)).await;
        insert(&p, "unknown-import", "recurring", None, None).await;
        advance_at(&p, "2026-10-22T12:00:00Z").await;
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM tasks")
                .fetch_one(&p)
                .await
                .unwrap(),
            5
        );
    }
    #[tokio::test]
    async fn connected_desktop_does_not_execute_server_schedule() {
        let p = pool().await;
        zone(&p, "Europe/Berlin").await;
        insert(&p, "deferred", "scheduled", Some("2026-10-19"), None).await;
        insert(
            &p,
            "template",
            "recurring",
            None,
            Some(rule("2026-10-19", "daily")),
        )
        .await;
        sqlx::query("INSERT INTO sync_client VALUES(1,?)")
            .bind(r#"{"remote_url":"https://example.invalid","last_sync":"2026-10-19T00:00:00Z"}"#)
            .execute(&p)
            .await
            .unwrap();
        advance_at(&p, "2026-10-20T12:00:00Z").await;
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM tasks")
                .fetch_one(&p)
                .await
                .unwrap(),
            2
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT status FROM tasks WHERE id='deferred'")
                .fetch_one(&p)
                .await
                .unwrap(),
            "scheduled"
        );
    }

    #[tokio::test]
    async fn large_backlogs_wait_for_explicit_approval_then_generate_every_copy_once() {
        let p = pool().await;
        zone(&p, "UTC").await;
        let repeat = rule("2026-01-01", "daily");
        insert(&p, "backlog", "recurring", None, Some(repeat.clone())).await;
        for _ in 0..4 {
            advance_at(&p, "2026-10-19T12:00:00Z").await;
        }
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM tasks")
                .fetch_one(&p)
                .await
                .unwrap(),
            1
        );
        let mut paused: sqlx::types::Json<RepeatRule> =
            sqlx::query_scalar("SELECT recurrence FROM tasks WHERE id='backlog'")
                .fetch_one(&p)
                .await
                .unwrap();
        assert!(paused.paused);
        paused.paused = false;
        paused.catch_up_through = Some("2026-10-19".into());
        sqlx::query("UPDATE tasks SET recurrence=? WHERE id='backlog'")
            .bind(paused)
            .execute(&p)
            .await
            .unwrap();
        advance_at(&p, "2026-10-19T12:00:00Z").await;
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM tasks")
                .fetch_one(&p)
                .await
                .unwrap(),
            101
        );
        for _ in 0..4 {
            advance_at(&p, "2026-10-19T12:00:00Z").await;
        }
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM tasks")
                .fetch_one(&p)
                .await
                .unwrap(),
            293
        );
        advance_at(&p, "2027-10-19T12:00:00Z").await;
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM tasks")
                .fetch_one(&p)
                .await
                .unwrap(),
            293
        );
    }
    #[tokio::test]
    async fn tentative_connection_does_not_disable_scheduling_and_server_ignores_client_metadata() {
        let p = pool().await;
        zone(&p, "UTC").await;
        insert(&p, "due", "scheduled", Some("2026-10-19"), None).await;
        sqlx::query("INSERT INTO sync_client VALUES(1,?)")
            .bind(r#"{"remote_url":"https://wrong.invalid"}"#)
            .execute(&p)
            .await
            .unwrap();
        advance_at(&p, "2026-10-19T12:00:00Z").await;
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT status FROM tasks WHERE id='due'")
                .fetch_one(&p)
                .await
                .unwrap(),
            "next"
        );
        insert(&p, "server-due", "scheduled", Some("2026-10-19"), None).await;
        sqlx::query("UPDATE sync_client SET state_json=?")
            .bind(r#"{"remote_url":"https://wrong.invalid","last_sync":"2026-10-19"}"#)
            .execute(&p)
            .await
            .unwrap();
        advance_server(
            &mut *p.acquire().await.unwrap(),
            instant("2026-10-19T12:00:00Z"),
        )
        .await
        .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT status FROM tasks WHERE id='server-due'")
                .fetch_one(&p)
                .await
                .unwrap(),
            "next"
        );
    }
}
