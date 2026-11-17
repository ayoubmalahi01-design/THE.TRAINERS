# THE TRAINERS — Production Pending Approval

## Items Requiring Explicit User Approval Before Execution

### 1. Notice Read Tracking (Section 13)
**File:** `SUPABASE_PENDING_CHANGES.sql` (Section 13)
**SQL:**
```sql
create table if not exists public.notice_reads (
  notice_id uuid not null references public.admin_notices(id) on delete cascade,
  reader_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notice_id, reader_id)
);
```
**Purpose:** Per-user read tracking for admin_notices.
**Impact:** New table, RLS policies, index. Additive only.
**Risk:** Low — additive, data-preserving.
**Safe to apply:** Yes.

### 2. Notice Delete Policy (Section 14)
**File:** `SUPABASE_PENDING_CHANGES.sql` (Section 14)
**SQL:**
```sql
drop policy if exists admin_notices_delete on public.admin_notices;
create policy admin_notices_delete on public.admin_notices for delete to authenticated
using (
  institution_id = public.current_institution_id()
  and (
    public.current_app_role() = 'manager'
    or (public.current_app_role() = 'admin' and author_id = auth.uid())
  )
);
```
**Purpose:** Allow manager/admin to delete notices in their institution.
**Impact:** New DELETE policy on admin_notices.
**Risk:** Medium — changes deletion permissions.
**Safe to apply:** Yes, but verify role mapping first.

### 3. Push Subscriptions Table
**File:** `supabase/push_subscriptions_pending.sql`
**Purpose:** Store Web Push subscriptions per user/device.
**Impact:** New table, RLS policies, indexes, trigger.
**Risk:** Low — additive only.
**Safe to apply:** Yes.

### 4. Report Read Policy Fix (C1/C2)
**Issue:** `THE_TRAINERS_SETUP.sql` still creates `reports_owner_read_all` policy (removed in production).
**Required change:** Remove `reports_owner_read_all` and `report_exports_owner_view` from THE_TRAINERS_SETUP.sql.
**Risk:** Low — aligns source with production.
**Safe to apply:** Yes (source-only change, no production SQL).

### 5. Report INSERT/UPDATE Policy Tightening (M1)
**Issue:** INSERT policy allows direct finalized report creation.
**Required change:** Add `and not is_finalized` to WITH CHECK clauses.
**Risk:** Medium — could break report submission if not tested.
**Safe to apply:** Only after verifying `submit_daily_report` RPC handles all transitions.

### 6. Edge Functions Deployment
**Functions:** invite-user, verify-otp, send-whatsapp, send-sms
**Required secrets:** OTP_DELIVERY_SECRET, SUPABASE_SMS_API_URL, SUPABASE_SMS_API_KEY, SUPABASE_SMS_FROM_NUMBER, SUPABASE_WHATSAPP_API_URL, SUPABASE_WHATSAPP_API_KEY, SUPABASE_WHATSAPP_FROM_NUMBER
**Risk:** High — requires external provider configuration.
**Safe to apply:** Only after secrets are configured.

### 7. VAPID Keys for Web Push
**Required:** Generate VAPID keys, store as Supabase secrets.
**Risk:** Medium — requires key generation and storage.
**Safe to apply:** Only after keys are generated and stored securely.

### 8. Report Deletion Semantics (M5)
**Issue:** `reviewed` vs `old/historical` distinction not encoded in data model.
**Required:** User decision on what constitutes "old/historical" report.
**Risk:** High — affects deletion permissions.
**Safe to apply:** Only after user confirms the business rule.

### 9. Avatar UPDATE Institution Check (M2)
**Issue:** UPDATE policy lacks institution verification.
**Required change:** Add institution check to trainer_avatars_update policy.
**Risk:** Low — strengthens security.
**Safe to apply:** Yes.

### 10. Media DELETE Conversation Check (M4)
**Issue:** Delete policy only checks user folder, not conversation membership.
**Required change:** Add conversation membership check to trainer_media_delete policy.
**Risk:** Low — strengthens security.
**Safe to apply:** Yes.
