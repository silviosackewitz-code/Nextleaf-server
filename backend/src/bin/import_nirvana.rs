use nextleaf_server::nirvana::{import, Result, Snapshot};
use sqlx::{sqlite::SqliteConnectOptions, Connection, SqliteConnection};

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        return Err(
            "Usage: import_nirvana SNAPSHOT.json EXISTING_DATABASE.db (back up first)".into(),
        );
    }
    let snapshot: Snapshot = serde_json::from_slice(&std::fs::read(&args[1])?)?;
    let options = SqliteConnectOptions::new()
        .filename(&args[2])
        .create_if_missing(false)
        .foreign_keys(true);
    let mut conn = SqliteConnection::connect_with(&options).await?;
    sqlx::migrate!("./migrations").run(&mut conn).await?;
    let (inserted, skipped) = import(&mut conn, snapshot).await?;
    println!("Imported {inserted} items; skipped {skipped} already imported items. All imported projects use Parallel as requested. Manual order, recurrence rules and exact timestamps are not supplied by MCP.");
    Ok(())
}
