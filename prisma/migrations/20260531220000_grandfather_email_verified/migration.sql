-- Grandfather credentials users that pre-date the email-verification launch.
--
-- Sprint 7 added /api/auth/signup -> Postmark verification email + AuthToken
-- migration (20260531180000). Users created before that migration could not have
-- triggered the new flow, so they keep `emailVerified IS NULL` and would be locked
-- out the moment we flip on the login gate. This UPDATE sets `emailVerified = NOW()`
-- for any credentials user (`password IS NOT NULL`) created before the AuthToken
-- migration was applied. Idempotent — re-running is a no-op because the WHERE
-- clause requires `emailVerified IS NULL`.
--
-- Google-only users (`password IS NULL`) are intentionally skipped: NextAuth fills
-- in their `emailVerified` from the IdP claim at first sign-in, so they should
-- never reach this state to begin with.
DO $$
DECLARE
  cutoff TIMESTAMP;
  affected INT;
BEGIN
  SELECT COALESCE(finished_at, started_at) INTO cutoff
  FROM _prisma_migrations
  WHERE migration_name = '20260531180000_add_auth_token'
  LIMIT 1;

  IF cutoff IS NULL THEN
    -- Sprint 7 deploy completed at 2026-05-31 21:49:14 UTC. Anything before this
    -- absolutely could not have used the new verification flow.
    cutoff := '2026-05-31 21:50:00+00';
    RAISE NOTICE 'AuthToken migration timestamp not found; using fallback cutoff: %', cutoff;
  END IF;

  UPDATE "User"
  SET "emailVerified" = NOW()
  WHERE "emailVerified" IS NULL
    AND "password" IS NOT NULL
    AND "createdAt" < cutoff;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RAISE NOTICE 'Grandfathered % credentials user(s) created before %', affected, cutoff;
END $$;
