-- Preserve the six-column profile insert shape for preceding Workers.
-- Omitted media fields keep these references during older-client saves.
CREATE TABLE profile_media (
  address TEXT PRIMARY KEY, avatar TEXT, cover TEXT
);
CREATE TRIGGER profile_media_delete AFTER DELETE ON profiles BEGIN
  DELETE FROM profile_media WHERE address=OLD.address;
END;
