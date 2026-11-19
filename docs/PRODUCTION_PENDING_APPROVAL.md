# Historical pending SQL — do not execute

The former root-level `SUPABASE_PENDING_CHANGES.sql` has been moved to `supabase/pending/SUPABASE_PENDING_CHANGES_REVIEW_REQUIRED.sql`. It contains outdated RPC signatures and draft policies that conflict with the current production schema. It is retained only for historical context and must not be run on production or a new project.

Use the timestamped migrations under `supabase/migrations` and `docs/RELEASE_STATUS_2026-11-19.md` as the current source of truth.
