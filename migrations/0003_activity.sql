-- Public actions start here: current state is not evidence of historical events.
-- Triggers make the state transition and its journal entry one atomic write,
-- including writes from the preceding Worker during a rolling deployment.
CREATE TABLE public_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK(kind IN ('profile_created','profile_updated','follow','unfollow','like','unlike','published')),
  actor TEXT NOT NULL, target TEXT, token_id TEXT, nonce TEXT, owner TEXT,
  mint_hash TEXT, occurred_at INTEGER NOT NULL
);
CREATE INDEX public_events_actor ON public_events(actor,id DESC);
CREATE INDEX public_events_target ON public_events(target,id DESC);
CREATE TABLE activity_publications (
  profile TEXT NOT NULL, token_id TEXT NOT NULL, nonce TEXT NOT NULL,
  event_id INTEGER NOT NULL, PRIMARY KEY(profile,token_id,nonce)
);
CREATE TABLE activity_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, follow_revision INTEGER NOT NULL);
INSERT INTO activity_state VALUES(1,1,1);
CREATE TABLE chain_event_times (
  block_number INTEGER NOT NULL, block_hash TEXT NOT NULL, timestamp INTEGER NOT NULL,
  PRIMARY KEY(block_number,block_hash)
);

CREATE TRIGGER activity_profile_insert AFTER INSERT ON profiles BEGIN
  INSERT INTO public_events(kind,actor,occurred_at) VALUES('profile_created',NEW.address,NEW.updated_at);
END;
CREATE TRIGGER activity_profile_update AFTER UPDATE ON profiles
WHEN OLD.name<>NEW.name OR OLD.bio<>NEW.bio OR OLD.featured IS NOT NEW.featured BEGIN
  INSERT INTO public_events(kind,actor,occurred_at) VALUES('profile_updated',NEW.address,NEW.updated_at);
END;
CREATE TRIGGER activity_relation_insert AFTER INSERT ON relations BEGIN
  INSERT INTO public_events(kind,actor,target,occurred_at) VALUES(NEW.kind,NEW.actor,NEW.target,NEW.created_at);
  UPDATE activity_state SET follow_revision=follow_revision+1 WHERE id=1 AND NEW.kind='follow';
END;
CREATE TRIGGER activity_relation_delete AFTER DELETE ON relations BEGIN
  INSERT INTO public_events(kind,actor,target,occurred_at) VALUES(CASE OLD.kind WHEN 'follow' THEN 'unfollow' ELSE 'unlike' END,OLD.actor,OLD.target,MAX(OLD.created_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)));
  UPDATE activity_state SET follow_revision=follow_revision+1 WHERE id=1 AND OLD.kind='follow';
END;
CREATE TRIGGER activity_publication_insert AFTER INSERT ON possessions BEGIN
  INSERT INTO public_events(kind,actor,token_id,nonce,owner,mint_hash,occurred_at)
    VALUES('published',NEW.profile,NEW.token_id,NEW.nonce,NEW.owner,
      (SELECT block_hash FROM chain_events WHERE kind='Minted' AND token_id=NEW.token_id),NEW.published_at);
  INSERT INTO activity_publications VALUES(NEW.profile,NEW.token_id,NEW.nonce,last_insert_rowid());
  UPDATE activity_state SET revision=revision+1 WHERE id=1;
END;
-- Renewal of the same possession is not a new public event.
CREATE TRIGGER activity_publication_update AFTER UPDATE ON possessions BEGIN
  UPDATE activity_state SET revision=revision+1 WHERE id=1;
END;
-- Never expose removed token/epoch associations in an "unpublished" feed row.
-- Retain the internal journal, but revoke its visibility binding permanently.
CREATE TRIGGER activity_publication_delete AFTER DELETE ON possessions BEGIN
  DELETE FROM activity_publications WHERE profile=OLD.profile AND token_id=OLD.token_id AND nonce=OLD.nonce;
  UPDATE activity_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER activity_chain_delete AFTER DELETE ON chain_events BEGIN
  DELETE FROM chain_event_times WHERE block_number=OLD.block_number AND block_hash=OLD.block_hash
    AND NOT EXISTS(SELECT 1 FROM chain_events WHERE block_number=OLD.block_number AND block_hash=OLD.block_hash);
  UPDATE activity_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER activity_time_insert AFTER INSERT ON chain_event_times
WHEN EXISTS(SELECT 1 FROM chain_events WHERE block_number=NEW.block_number AND block_hash=NEW.block_hash) BEGIN
  UPDATE activity_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER activity_metadata_insert AFTER INSERT ON discovery_metadata BEGIN
  UPDATE activity_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER activity_metadata_update AFTER UPDATE ON discovery_metadata BEGIN
  UPDATE activity_state SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER activity_metadata_delete AFTER DELETE ON discovery_metadata BEGIN
  UPDATE activity_state SET revision=revision+1 WHERE id=1;
END;
