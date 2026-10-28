-- The original integrity check required approval before DNS proof was recorded.
-- Independent review must instead follow proof; the guard trigger validates
-- latest proof, independent reviewer and review window at approval time.
ALTER TABLE app."InstitutionDomain"
  DROP CONSTRAINT institution_domain_verified_evidence;
ALTER TABLE app."InstitutionDomain"
  ADD CONSTRAINT institution_domain_verified_evidence CHECK (
    "verifiedAt" IS NULL OR "ownershipProofHash" IS NOT NULL
  );
