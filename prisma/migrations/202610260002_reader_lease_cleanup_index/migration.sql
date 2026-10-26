-- Expired reader leases are purged in bounded batches by the worker.
CREATE INDEX "ReaderLease_expiresAt_idx" ON app."ReaderLease" ("expiresAt");
