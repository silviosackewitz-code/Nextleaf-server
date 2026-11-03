-- Keep a template's cycle identity even after Stop Repeating.
CREATE TABLE repeat_cycles (
    template_id TEXT PRIMARY KEY REFERENCES tasks(id),
    rule_id TEXT NOT NULL
);
INSERT INTO repeat_cycles SELECT id,json_extract(recurrence,'$.id') FROM tasks WHERE recurrence IS NOT NULL;
-- Preserve superseded direct assignments for audit while enforcing project inheritance.
CREATE TABLE task_area_repairs (task_id TEXT PRIMARY KEY, area_id TEXT NOT NULL);
INSERT INTO task_area_repairs SELECT id,area_id FROM tasks WHERE project_id IS NOT NULL AND area_id IS NOT NULL;
UPDATE tasks SET area_id=NULL WHERE project_id IS NOT NULL;

CREATE TABLE date_repairs (
    entity TEXT NOT NULL, record_id TEXT NOT NULL, field TEXT NOT NULL, original TEXT NOT NULL,
    PRIMARY KEY(entity,record_id,field)
);
UPDATE tasks SET status='next' WHERE status='scheduled' AND defer_until IS NULL;
UPDATE tasks SET status='scheduled' WHERE status='next' AND defer_until IS NOT NULL;
