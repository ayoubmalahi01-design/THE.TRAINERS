-- THE TRAINERS: manager-only, confirmed tenant deletion.
-- Additive only: creates one RPC; does not alter or replay existing migrations.
-- The function is never executed by this migration.
create or replace function public.delete_institution(
  p_institution_id uuid,
  p_confirmation_name text
) returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_name text;
  v_profiles integer := 0;
  v_invitations integer := 0;
  v_otp integer := 0;
  v_objects integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if public.current_app_role() <> 'manager'
     or public.current_institution_id() is distinct from p_institution_id then
    raise exception 'Only this institution manager may delete the institution' using errcode = '42501';
  end if;

  select i.name into v_name
  from public.institutions i
  where i.id = p_institution_id
  for update;

  if v_name is null then
    raise exception 'Institution not found';
  end if;
  if p_confirmation_name is distinct from v_name then
    raise exception 'Institution name confirmation does not match';
  end if;

  -- Preserve authentication identities and historical audit events, but detach
  -- every institution account and mark it rejected so it cannot keep tenant access.
  update public.profiles
     set institution_id = null,
         account_status = 'rejected',
         approved_by = null,
         approved_at = null,
         updated_at = now()
   where institution_id = p_institution_id;
  get diagnostics v_profiles = row_count;

  delete from public.invitations where institution_id = p_institution_id;
  get diagnostics v_invitations = row_count;

  delete from public.otp_codes where institution_id = p_institution_id;
  get diagnostics v_otp = row_count;

  -- All four production buckets are private and use institution_id as the
  -- first path segment. Remove their objects in the same transaction.
  delete from storage.objects
   where bucket_id in ('trainer-avatars','trainer-media','trainer-medical','trainer-report-templates')
     and left(name, length(p_institution_id::text) + 1) = p_institution_id::text || '/';
  get diagnostics v_objects = row_count;

  -- Tenant-owned records cascade. audit_logs uses SET NULL, preserving history.
  delete from public.institutions where id = p_institution_id;

  return jsonb_build_object(
    'deleted', true,
    'institution_id', p_institution_id,
    'detached_profiles', v_profiles,
    'deleted_invitations', v_invitations,
    'deleted_otp_rows', v_otp,
    'deleted_storage_objects', v_objects,
    'auth_identities_preserved_as_rejected', true,
    'audit_history_preserved', true
  );
end;
$$;

revoke all on function public.delete_institution(uuid, text) from public;
revoke all on function public.delete_institution(uuid, text) from anon;
grant execute on function public.delete_institution(uuid, text) to authenticated;
