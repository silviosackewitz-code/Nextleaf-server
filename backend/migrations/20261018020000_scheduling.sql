ALTER TABLE tasks ADD COLUMN recurrence TEXT;
CREATE TABLE schedule_clock (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    timezone TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
INSERT INTO schedule_clock VALUES(1, 'UTC', '1970-01-01T00:00:00Z');
