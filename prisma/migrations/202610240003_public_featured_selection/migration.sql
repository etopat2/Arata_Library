-- Editorially selected homepage placement; absence is not inferred as featured.
ALTER TABLE app."Publication" ADD COLUMN "featuredAt" timestamptz(6);
CREATE INDEX publication_featured_at ON app."Publication" ("featuredAt");
