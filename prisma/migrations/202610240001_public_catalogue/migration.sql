-- Additive public discovery metadata. Source manuscripts and private asset keys remain separate.
ALTER TYPE app."PublicationStatus" ADD VALUE 'FORTHCOMING';

ALTER TABLE app."Publication"
  ADD COLUMN subtitle varchar(400),
  ADD COLUMN description text,
  ADD COLUMN subject varchar(160),
  ADD COLUMN keywords text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN "licenceCode" varchar(100),
  ADD COLUMN "releaseAt" timestamptz(6);

CREATE TABLE app."Contributor" (
  id uuid PRIMARY KEY,
  "displayName" varchar(240) NOT NULL,
  slug varchar(200) NOT NULL UNIQUE,
  biography text
);

CREATE TABLE app."PublicationContributor" (
  "publicationId" uuid NOT NULL REFERENCES app."Publication"(id) ON DELETE CASCADE,
  "contributorId" uuid NOT NULL REFERENCES app."Contributor"(id) ON DELETE RESTRICT,
  role varchar(60) NOT NULL,
  ordinal integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("publicationId", "contributorId", role),
  CONSTRAINT publication_contributor_ordinal CHECK (ordinal >= 0),
  CONSTRAINT publication_contributor_role CHECK (role IN ('AUTHOR', 'EDITOR', 'REVIEWER', 'ILLUSTRATOR', 'TRANSLATOR'))
);
CREATE INDEX publication_contributor_person_role ON app."PublicationContributor" ("contributorId", role);

ALTER TABLE app."Chapter" ADD COLUMN "previewText" text;
ALTER TABLE app."Resource"
  ADD COLUMN description text,
  ADD COLUMN format varchar(40),
  ADD COLUMN "bodyText" text,
  ADD COLUMN attribution text,
  ADD COLUMN "copyrightNotice" text;

CREATE INDEX publication_public_facet ON app."Publication" (status, kind, subject, "releaseAt");
CREATE INDEX publication_metadata_fts ON app."Publication" USING gin
  (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(subtitle, '') || ' ' || coalesce(description, '') || ' ' || coalesce(subject, '')));
CREATE INDEX resource_metadata_fts ON app."Resource" USING gin
  (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce("bodyText", '')));
