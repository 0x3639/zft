CREATE TABLE chain_events (
  block_number INTEGER NOT NULL, log_index INTEGER NOT NULL, block_hash TEXT NOT NULL,
  tx_hash TEXT NOT NULL, kind TEXT NOT NULL, token_id TEXT NOT NULL,
  from_address TEXT, to_address TEXT, creator TEXT, metadata_hash TEXT,
  PRIMARY KEY (block_number, log_index)
);
CREATE INDEX events_token ON chain_events(token_id, kind, block_number DESC, log_index DESC);
CREATE INDEX events_creator ON chain_events(creator, block_number DESC, log_index DESC);
CREATE TABLE checkpoints (block_number INTEGER PRIMARY KEY, block_hash TEXT NOT NULL);
CREATE TABLE index_status (id INTEGER PRIMARY KEY CHECK(id=1), head INTEGER NOT NULL, synced_at INTEGER NOT NULL, error TEXT);
CREATE VIEW indexed_items AS
SELECT m.token_id, m.metadata_hash, m.creator, m.block_number AS mint_block, m.log_index AS mint_log,
 (SELECT to_address FROM chain_events t WHERE t.kind='Transfer' AND t.token_id=m.token_id ORDER BY block_number DESC, log_index DESC LIMIT 1) AS owner,
 (SELECT COUNT(*)-1 FROM chain_events t WHERE t.kind='Transfer' AND t.token_id=m.token_id) AS nonce
FROM chain_events m WHERE m.kind='Minted';
CREATE TABLE profiles (
 address TEXT PRIMARY KEY, name TEXT NOT NULL, bio TEXT NOT NULL,
 featured TEXT, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE relations (
 actor TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('follow','like')),
 target TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(actor,kind,target)
);
CREATE INDEX relations_target ON relations(kind,target,created_at DESC,actor);
CREATE TABLE possessions (
 profile TEXT NOT NULL, token_id TEXT NOT NULL, owner TEXT NOT NULL,
 nonce TEXT NOT NULL, signature TEXT NOT NULL, expires INTEGER NOT NULL,
 published_at INTEGER NOT NULL, PRIMARY KEY(profile,token_id,nonce)
);
CREATE INDEX possessions_profile ON possessions(profile,published_at DESC);
