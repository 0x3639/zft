-- Preserve the original global counter for preceding Workers, but let new
-- readers check only publication generations in their scope and public-ID range.
-- Journal events remain the identity after their visibility binding is revoked.
CREATE TABLE activity_publication_clock (
  id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL
);
INSERT INTO activity_publication_clock VALUES(1,0);
CREATE TABLE activity_publication_revisions (
  event_id INTEGER PRIMARY KEY, revision INTEGER NOT NULL
);

DROP TRIGGER activity_publication_insert;
CREATE TRIGGER activity_publication_insert AFTER INSERT ON possessions BEGIN
  INSERT INTO public_events(kind,actor,token_id,nonce,owner,mint_hash,occurred_at)
    VALUES('published',NEW.profile,NEW.token_id,NEW.nonce,NEW.owner,
      (SELECT block_hash FROM chain_events WHERE kind='Minted' AND token_id=NEW.token_id),NEW.published_at);
  INSERT INTO activity_publications VALUES(NEW.profile,NEW.token_id,NEW.nonce,last_insert_rowid());
  UPDATE activity_state SET revision=revision+1 WHERE id=1;
  UPDATE activity_publication_clock SET revision=revision+1 WHERE id=1;
  INSERT INTO activity_publication_revisions
    SELECT b.event_id,c.revision FROM activity_publications b CROSS JOIN activity_publication_clock c
    WHERE b.profile=NEW.profile AND b.token_id=NEW.token_id AND b.nonce=NEW.nonce AND c.id=1;
END;

DROP TRIGGER activity_publication_update;
CREATE TRIGGER activity_publication_update AFTER UPDATE ON possessions
WHEN OLD.profile IS NOT NEW.profile OR OLD.token_id IS NOT NEW.token_id
  OR OLD.nonce IS NOT NEW.nonce OR OLD.owner IS NOT NEW.owner
  OR NEW.expires<OLD.expires
  OR (OLD.expires<=CAST(strftime('%s','now') AS INTEGER)
      AND NEW.expires>CAST(strftime('%s','now') AS INTEGER))
BEGIN
  UPDATE activity_state SET revision=revision+1 WHERE id=1;
  UPDATE activity_publication_clock SET revision=revision+1 WHERE id=1;
  INSERT INTO activity_publication_revisions
    SELECT b.event_id,c.revision FROM activity_publications b CROSS JOIN activity_publication_clock c
    WHERE c.id=1 AND (
      (b.profile=OLD.profile AND b.token_id=OLD.token_id AND b.nonce=OLD.nonce)
      OR (b.profile=NEW.profile AND b.token_id=NEW.token_id AND b.nonce=NEW.nonce))
    ON CONFLICT(event_id) DO UPDATE SET revision=excluded.revision;
END;

DROP TRIGGER activity_publication_delete;
CREATE TRIGGER activity_publication_delete AFTER DELETE ON possessions BEGIN
  UPDATE activity_state SET revision=revision+1 WHERE id=1;
  UPDATE activity_publication_clock SET revision=revision+1 WHERE id=1;
  -- Record the changed generation before removing its binding; otherwise its
  -- disappearance could evade the cursor's scoped revision check.
  INSERT INTO activity_publication_revisions
    SELECT b.event_id,c.revision FROM activity_publications b CROSS JOIN activity_publication_clock c
    WHERE b.profile=OLD.profile AND b.token_id=OLD.token_id AND b.nonce=OLD.nonce AND c.id=1
    ON CONFLICT(event_id) DO UPDATE SET revision=excluded.revision;
  DELETE FROM activity_publications WHERE profile=OLD.profile AND token_id=OLD.token_id AND nonce=OLD.nonce;
END;

UPDATE activity_state SET revision=revision+1 WHERE id=1;
