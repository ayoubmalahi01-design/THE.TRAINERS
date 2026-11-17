-- THE TRAINERS — Production Hotfix Recovery Note
-- Date: 2026-11-17
-- Project: rxkyryaplszuklagvidi
-- Status: RECOVERY NOTE — exact SQL not available

-- ===========================================================================
-- WARNING: This file is NOT an executable migration.
-- The exact SQL statements executed in Production on 2026-11-17 could not be
-- recovered from the project source, logs, or documentation.
-- Do NOT execute this file against Production.
-- ===========================================================================

-- Confirmed applied changes (from user report and production inspection):
-- 1. Migration 20261116192616 — removed obsolete trigger attendance_followup_refresh
--    (kept attendance_followup_trg calling track_absence_followup())
-- 2. Migration 20261116192646 — dropped trainer_storage_member_rw, added
--    trainer_avatars_delete and trainer_media_update policies
-- 3. Migration 20261116192658 — excluded platform owner from report reads
-- 4. Migration 20261116213108 — created submit_daily_report(p_report_id uuid) RPC
-- 5. Notice notification trigger: notify_new_notice() + UPDATE trigger for is_published
-- 6. notifications.notice_id column added (UUID FK to admin_notices, ON DELETE SET NULL)
-- 7. Partial unique index: notifications_notice_recipient_once
-- 8. Push subscriptions table: public.push_subscriptions (created in Production)
-- 9. Storage media deletion: trainer_media_delete_own replaced with stricter checks

-- What is MISSING (exact SQL statements):
-- - The precise CREATE FUNCTION / ALTER POLICY / CREATE TRIGGER statements
--   executed for each of the above changes.
-- - The exact column definitions and constraint names for notice_id.
-- - The exact index definition for notifications_notice_recipient_once.
-- - The exact push_subscriptions table DDL (already documented in
--   supabase/push_subscriptions_pending.sql, but production version may differ).

-- Required to complete this backup:
-- 1. Export the actual SQL from Supabase Dashboard (SQL Editor > History)
--    or from the migration tracking table (supabase_migrations.schema_migrations).
-- 2. Provide the exact migration timestamps and SQL bodies.
-- 3. Verify against the production schema using read-only introspection.

-- DO NOT fabricate or reconstruct SQL from descriptions alone.
-- This note exists only to document what is known and what is missing.
