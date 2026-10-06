-- Keep the journal and visibility bindings installed by 0003 intact.
-- Extending an already-live proof does not change feed membership. Shortening
-- it can make a cursor outlive the proof, so it still requires a refresh.
DROP TRIGGER activity_publication_update;
CREATE TRIGGER activity_publication_update AFTER UPDATE ON possessions
WHEN OLD.profile IS NOT NEW.profile OR OLD.token_id IS NOT NEW.token_id
  OR OLD.nonce IS NOT NEW.nonce OR OLD.owner IS NOT NEW.owner
  OR NEW.expires<OLD.expires
  OR (OLD.expires<=CAST(strftime('%s','now') AS INTEGER)
      AND NEW.expires>CAST(strftime('%s','now') AS INTEGER))
BEGIN
  UPDATE activity_state SET revision=revision+1 WHERE id=1;
END;

-- Retry timestamps/search bookkeeping do not change an activity row. Content,
-- validation and identity changes still invalidate the visibility snapshot.
DROP TRIGGER activity_metadata_update;
CREATE TRIGGER activity_metadata_update AFTER UPDATE ON discovery_metadata
WHEN OLD.valid IS NOT NEW.valid OR OLD.version IS NOT NEW.version
  OR OLD.metadata_json IS NOT NEW.metadata_json
  OR OLD.token_id IS NOT NEW.token_id OR OLD.metadata_hash IS NOT NEW.metadata_hash
  OR OLD.creator IS NOT NEW.creator
BEGIN
  UPDATE activity_state SET revision=revision+1 WHERE id=1;
END;

UPDATE activity_state SET revision=revision+1 WHERE id=1;
