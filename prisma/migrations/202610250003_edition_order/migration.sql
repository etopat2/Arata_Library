-- Preserve existing editions and assign deterministic order within each publication or volume.
ALTER TABLE app."Edition" ADD COLUMN ordinal integer NOT NULL DEFAULT 1;

WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY "publicationId", "volumeId" ORDER BY "createdAt", id
  )::integer AS position
  FROM app."Edition"
)
UPDATE app."Edition" e SET ordinal = ranked.position
FROM ranked WHERE e.id = ranked.id;

ALTER TABLE app."Edition" ADD CONSTRAINT edition_ordinal_positive CHECK (ordinal > 0);
CREATE UNIQUE INDEX edition_standalone_order ON app."Edition" ("publicationId", ordinal)
  WHERE "volumeId" IS NULL;
CREATE UNIQUE INDEX edition_volume_order ON app."Edition" ("volumeId", ordinal)
  WHERE "volumeId" IS NOT NULL;
CREATE INDEX edition_publication_volume_ordinal_idx ON app."Edition" ("publicationId", "volumeId", ordinal);
