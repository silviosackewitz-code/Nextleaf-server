ALTER TABLE projects ADD COLUMN completed_at TEXT;

CREATE TABLE tasks_new (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    area_id TEXT REFERENCES areas(id) ON DELETE SET NULL,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'inbox' CHECK (status IN ('inbox','next','waiting','scheduled','someday','completed','later','recurring','trash')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    due_date TEXT,
    defer_until TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    starred INTEGER NOT NULL DEFAULT 0,
    waiting_for TEXT,
    estimated_minutes INTEGER CHECK (estimated_minutes >= 0),
    energy INTEGER CHECK (energy BETWEEN 0 AND 3)
);
INSERT INTO tasks_new (id,project_id,area_id,title,notes,status,sort_order,due_date,defer_until,completed_at,created_at,updated_at)
SELECT id,project_id,area_id,title,notes,status,sort_order,due_date,defer_until,completed_at,created_at,updated_at FROM tasks;
CREATE TABLE task_tags_backup AS SELECT task_id,tag_id FROM task_tags;
DROP TABLE task_tags;
DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;
CREATE INDEX idx_tasks_project_sort ON tasks(project_id,sort_order,created_at,id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE TABLE task_tags (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id,tag_id)
);
INSERT INTO task_tags SELECT task_id,tag_id FROM task_tags_backup;
DROP TABLE task_tags_backup;

-- Original records make the one-time import auditable and safe to repeat.
CREATE TABLE nirvana_imports (
    source_id TEXT PRIMARY KEY,
    target_id TEXT NOT NULL UNIQUE,
    item_type TEXT NOT NULL CHECK (item_type IN ('task','project')),
    raw_json TEXT NOT NULL
);
