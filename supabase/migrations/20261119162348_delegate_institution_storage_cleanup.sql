-- Storage object bytes must be removed through the Supabase Storage API, not
-- by deleting storage.objects directly. The authenticated Edge Function performs
-- that cleanup first, then calls this private transactional database procedure.
create or replace function app_private.delete_institution_impl(
  p_institution_id uuid,
  p_confirmation_name text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_profiles integer := 0;
  v_invitations integer := 0;
  v_otp integer := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if public.current_app_role() <> 'manager' or public.current_institution_id() is distinct from p_institution_id then
    raise exception 'Only this institution manager may delete the institution' using errcode = '42501';
  end if;
  select i.name into v_name from public.institutions i where i.id = p_institution_id for update;
  if v_name is null then raise exception 'Institution not found'; end if;
  if p_confirmation_name is distinct from v_name then raise exception 'Institution name confirmation does not match'; end if;
  update public.profiles set institution_id = null, account_status = 'rejected', approved_by = null, approved_at = null, updated_at = now()
   where institution_id = p_institution_id;
  get diagnostics v_profiles = row_count;
  delete from public.invitations where institution_id = p_institution_id;
  get diagnostics v_invitations = row_count;
  delete from public.otp_codes where institution_id = p_institution_id;
  get diagnostics v_otp = row_count;
  delete from public.institutions where id = p_institution_id;
  return jsonb_build_object('deleted', true, 'institution_id', p_institution_id,
    'detached_profiles', v_profiles, 'deleted_invitations', v_invitations,
    'deleted_otp_rows', v_otp, 'storage_cleanup_delegated_to_edge_function', true,
    'auth_identities_preserved_as_rejected', true, 'audit_history_preserved', true);
end;
$$;
revoke all on function app_private.delete_institution_impl(uuid, text) from public, anon;
grant execute on function app_private.delete_institution_impl(uuid, text) to authenticated;
