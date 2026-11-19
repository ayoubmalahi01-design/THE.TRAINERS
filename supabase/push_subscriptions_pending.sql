-- THE TRAINERS – Legacy Push Subscription Schema Reference
-- The table is now included in THE_TRAINERS_SETUP.sql and already exists in production.
-- Do NOT run this file separately. It stores browser subscriptions only; a VAPID sender
-- is not implemented/deployed, so it does not provide push delivery after app closure.

-- Push subscriptions table: one row per device/browser.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
create index if not exists push_subscriptions_institution_idx on public.push_subscriptions(institution_id);

alter table public.push_subscriptions enable row level security;

-- Users can manage their own subscriptions.
drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and institution_id = public.current_institution_id());

-- Platform owner can see all subscriptions (for debugging only).
drop policy if exists push_subscriptions_owner_read on public.push_subscriptions;
create policy push_subscriptions_owner_read on public.push_subscriptions for select to authenticated
  using (public.is_platform_owner());

-- Grant access to authenticated users only.
grant select, insert, update, delete on public.push_subscriptions to authenticated;
revoke all on public.push_subscriptions from anon;
