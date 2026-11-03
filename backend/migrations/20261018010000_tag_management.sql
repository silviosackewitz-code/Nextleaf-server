-- Archive keeps all existing assignments; tags and people share stable IDs.
ALTER TABLE tags ADD COLUMN kind TEXT NOT NULL DEFAULT 'tag' CHECK (kind IN ('tag','person'));
ALTER TABLE tags ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1));
ALTER TABLE areas ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1));
