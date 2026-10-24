-- Match Prisma's declared on-update policy for contributor links.
ALTER TABLE app."PublicationContributor"
  DROP CONSTRAINT "PublicationContributor_publicationId_fkey",
  ADD CONSTRAINT "PublicationContributor_publicationId_fkey"
    FOREIGN KEY ("publicationId") REFERENCES app."Publication"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE app."PublicationContributor"
  DROP CONSTRAINT "PublicationContributor_contributorId_fkey",
  ADD CONSTRAINT "PublicationContributor_contributorId_fkey"
    FOREIGN KEY ("contributorId") REFERENCES app."Contributor"(id)
    ON DELETE RESTRICT ON UPDATE CASCADE;
