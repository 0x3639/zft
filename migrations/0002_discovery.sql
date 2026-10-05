-- Additive migration: existing profile creation times are deliberately unknown.
CREATE TABLE profile_discovery (address TEXT PRIMARY KEY, created_at INTEGER, search_name TEXT);
INSERT INTO profile_discovery(address) SELECT address FROM profiles;
CREATE INDEX profiles_newest ON profile_discovery(created_at DESC,address);
CREATE TRIGGER profile_discovery_insert AFTER INSERT ON profiles BEGIN INSERT INTO profile_discovery VALUES(NEW.address,CAST(strftime('%s','now') AS INTEGER)*1000,NULL); END;
CREATE TRIGGER profile_discovery_update AFTER UPDATE ON profiles BEGIN UPDATE profile_discovery SET search_name=NULL WHERE address=NEW.address; END;
CREATE TRIGGER profile_discovery_delete AFTER DELETE ON profiles BEGIN DELETE FROM profile_discovery WHERE address=OLD.address; END;
CREATE TABLE discovery_metadata (
 token_id TEXT NOT NULL, metadata_hash TEXT NOT NULL, creator TEXT NOT NULL,
 version INTEGER NOT NULL, valid INTEGER NOT NULL, title_key TEXT,
 metadata_json TEXT, checked_at INTEGER NOT NULL, retry_at INTEGER NOT NULL,
 PRIMARY KEY(token_id,metadata_hash,creator)
);
CREATE INDEX discovery_titles ON discovery_metadata(valid,version,title_key,token_id);
CREATE TABLE discovery_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
INSERT INTO discovery_state VALUES(1,1);
CREATE TRIGGER discovery_events_insert AFTER INSERT ON chain_events BEGIN UPDATE discovery_state SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER discovery_events_delete AFTER DELETE ON chain_events BEGIN UPDATE discovery_state SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER discovery_profiles_insert AFTER INSERT ON profiles BEGIN UPDATE discovery_state SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER discovery_profiles_update AFTER UPDATE ON profiles BEGIN UPDATE discovery_state SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER discovery_profiles_delete AFTER DELETE ON profiles BEGIN UPDATE discovery_state SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER discovery_relations_insert AFTER INSERT ON relations BEGIN UPDATE discovery_state SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER discovery_relations_delete AFTER DELETE ON relations BEGIN UPDATE discovery_state SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER discovery_possessions_insert AFTER INSERT ON possessions BEGIN UPDATE discovery_state SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER discovery_possessions_update AFTER UPDATE ON possessions BEGIN UPDATE discovery_state SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER discovery_possessions_delete AFTER DELETE ON possessions BEGIN UPDATE discovery_state SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER discovery_metadata_insert AFTER INSERT ON discovery_metadata BEGIN UPDATE discovery_state SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER discovery_metadata_update AFTER UPDATE ON discovery_metadata BEGIN UPDATE discovery_state SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER discovery_metadata_delete AFTER DELETE ON discovery_metadata BEGIN UPDATE discovery_state SET revision=revision+1 WHERE id=1; END;

CREATE TRIGGER discovery_profile_search_update AFTER UPDATE ON profile_discovery BEGIN UPDATE discovery_state SET revision=revision+1 WHERE id=1; END;
