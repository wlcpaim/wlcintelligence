create or replace function public.claim_legacy_account() returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_email text; v_old uuid;
begin
  if v_uid is null then return jsonb_build_object('claimed', false, 'reason', 'not_authenticated'); end if;
  select u.email into v_email from auth.users u where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null then return jsonb_build_object('claimed', false, 'reason', 'email_not_verified'); end if;
  if (select count(*) from public.legacy_users l where lower(l.email) = lower(v_email) and l.new_user_id is null) <> 1 then
    return jsonb_build_object('claimed', false, 'reason', 'no_unique_match'); end if;
  select l.original_user_id into v_old from public.legacy_users l where lower(l.email) = lower(v_email) and l.new_user_id is null;
  if v_old = v_uid then return jsonb_build_object('claimed', false, 'reason', 'same_id'); end if;
  update public.chat_versions set user_id = v_uid where user_id = v_old;
  update public.cloudflare_connections set user_id = v_uid where user_id = v_old;
  update public.code_projects set user_id = v_uid where user_id = v_old;
  update public.code_files set user_id = v_uid where user_id = v_old;
  update public.code_project_backups set user_id = v_uid where user_id = v_old;
  update public.conversations set user_id = v_uid where user_id = v_old;
  update public.messages set user_id = v_uid where user_id = v_old;
  update public.gemini_keys set user_id = v_uid where user_id = v_old;
  update public.github_connections set user_id = v_uid where user_id = v_old;
  update public.github_selection set user_id = v_uid where user_id = v_old;
  update public.integration_runs set user_id = v_uid where user_id = v_old;
  update public.integration_status set user_id = v_uid where user_id = v_old;
  update public.system_events set user_id = v_uid where user_id = v_old;
  update public.system_sessions set user_id = v_uid where user_id = v_old;
  update public.version_training_messages set user_id = v_uid where user_id = v_old;
  update public.legacy_users set new_user_id = v_uid, claimed_at = now() where original_user_id = v_old;
  return jsonb_build_object('claimed', true);
end $$;
revoke all on function public.claim_legacy_account() from public, anon;
grant execute on function public.claim_legacy_account() to authenticated;