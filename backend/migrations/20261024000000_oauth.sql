-- OAuth credentials stay server-local and never enter task synchronization.
CREATE TABLE oauth_clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    redirects TEXT NOT NULL,
    secret_hash TEXT,
    auth_method TEXT NOT NULL
);
CREATE TABLE oauth_requests (
    id_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    state TEXT NOT NULL,
    challenge TEXT NOT NULL,
    scope TEXT NOT NULL,
    expires INTEGER NOT NULL,
    epoch TEXT NOT NULL,
    code_hash TEXT UNIQUE
);
CREATE TABLE oauth_grants (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    access_hash TEXT NOT NULL UNIQUE,
    refresh_hash TEXT UNIQUE,
    scope TEXT NOT NULL,
    expires INTEGER NOT NULL,
    refresh_expires INTEGER NOT NULL,
    epoch TEXT NOT NULL
);
CREATE TABLE oauth_used_refresh (
    hash TEXT PRIMARY KEY,
    grant_id TEXT NOT NULL,
    expires INTEGER NOT NULL
);
