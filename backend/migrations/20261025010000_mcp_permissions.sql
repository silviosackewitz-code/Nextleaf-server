-- Security policy is local to this database and is never synchronized.
CREATE TABLE mcp_permissions (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 allowed_json TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0
);
INSERT INTO mcp_permissions(singleton,enabled,allowed_json) VALUES(1,1,'["read", "tasks.create", "tasks.edit", "tasks.trash", "projects.create", "projects.edit", "tags.create", "tags.edit", "tags.archive", "areas.create", "areas.edit", "areas.archive", "perspectives.create", "perspectives.edit", "perspectives.delete", "import"]');
