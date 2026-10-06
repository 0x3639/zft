-- Track metadata visibility per item while preserving the preceding Worker's
-- global revision behavior. New readers subtract this clock from that counter
-- and check only metadata for items within their feed's scope and upper bounds.
-- Existing metadata is the baseline; no journal or publication rows are removed.
CREATE TABLE activity_metadata_clock (
  id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL
);
INSERT INTO activity_metadata_clock VALUES(1,0);
CREATE TABLE activity_metadata_revisions (
  token_id TEXT PRIMARY KEY, revision INTEGER NOT NULL
);

DROP TRIGGER activity_metadata_insert;
CREATE TRIGGER activity_metadata_insert AFTER INSERT ON discovery_metadata BEGIN
  UPDATE activity_state SET revision=revision+1 WHERE id=1;
  UPDATE activity_metadata_clock SET revision=revision+1 WHERE id=1;
  INSERT INTO activity_metadata_revisions
    SELECT NEW.token_id,revision FROM activity_metadata_clock WHERE id=1
    ON CONFLICT(token_id) DO UPDATE SET revision=excluded.revision;
END;

DROP TRIGGER activity_metadata_update;
CREATE TRIGGER activity_metadata_update AFTER UPDATE ON discovery_metadata
WHEN OLD.valid IS NOT NEW.valid OR OLD.version IS NOT NEW.version
  OR OLD.metadata_json IS NOT NEW.metadata_json
  OR OLD.token_id IS NOT NEW.token_id OR OLD.metadata_hash IS NOT NEW.metadata_hash
  OR OLD.creator IS NOT NEW.creator
BEGIN
  UPDATE activity_state SET revision=revision+1 WHERE id=1;
  UPDATE activity_metadata_clock SET revision=revision+1 WHERE id=1;
  INSERT INTO activity_metadata_revisions
    SELECT OLD.token_id,revision FROM activity_metadata_clock WHERE id=1
    ON CONFLICT(token_id) DO UPDATE SET revision=excluded.revision;
  INSERT INTO activity_metadata_revisions
    SELECT NEW.token_id,revision FROM activity_metadata_clock WHERE id=1
    ON CONFLICT(token_id) DO UPDATE SET revision=excluded.revision;
END;

DROP TRIGGER activity_metadata_delete;
CREATE TRIGGER activity_metadata_delete AFTER DELETE ON discovery_metadata BEGIN
  UPDATE activity_state SET revision=revision+1 WHERE id=1;
  UPDATE activity_metadata_clock SET revision=revision+1 WHERE id=1;
  INSERT INTO activity_metadata_revisions
    SELECT OLD.token_id,revision FROM activity_metadata_clock WHERE id=1
    ON CONFLICT(token_id) DO UPDATE SET revision=excluded.revision;
END;

UPDATE activity_state SET revision=revision+1 WHERE id=1;
