ALTER TABLE app."NotificationPreference"
  DROP CONSTRAINT "NotificationPreference_userId_fkey",
  ADD CONSTRAINT "NotificationPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES app."User"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;
