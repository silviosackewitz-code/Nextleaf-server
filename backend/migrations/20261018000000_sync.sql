-- Identity and retry records belong to each database, never to the shared snapshot.
CREATE TABLE sync_identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1), id TEXT NOT NULL);
CREATE TABLE sync_receipts (id TEXT PRIMARY KEY, client_id TEXT NOT NULL UNIQUE, sequence INTEGER NOT NULL, request_json TEXT NOT NULL, response_json TEXT NOT NULL);
CREATE TABLE sync_client (singleton INTEGER PRIMARY KEY CHECK(singleton=1), state_json TEXT NOT NULL);
