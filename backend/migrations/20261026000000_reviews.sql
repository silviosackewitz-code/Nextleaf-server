CREATE TABLE reviews (
    id TEXT PRIMARY KEY CHECK(id IN ('list:single-actions','list:someday-ideas') OR (id LIKE 'project:%' AND length(id)>8)),
    data_json TEXT NOT NULL CHECK(json_valid(data_json)),
    revision TEXT NOT NULL,
    undo_json TEXT CHECK(undo_json IS NULL OR json_valid(undo_json))
);
