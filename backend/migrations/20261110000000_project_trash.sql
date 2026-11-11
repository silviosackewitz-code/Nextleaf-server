-- A project in Trash keeps its row, status and tasks; the flag only hides them.
ALTER TABLE projects ADD COLUMN trashed INTEGER NOT NULL DEFAULT 0 CHECK (trashed IN (0,1));
