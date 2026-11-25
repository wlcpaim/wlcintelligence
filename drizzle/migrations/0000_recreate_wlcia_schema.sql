create or replace function public.set_updated_at() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;

create table public.chat_versions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(),
  name text not null, slug text not null, base_version text not null default 'base',
  chat_instruction text not null, copilot_instruction text not null, rules jsonb not null default '[]'::jsonb,
  repo_full_name text, github_path text, github_sha text, sync_error text, synced_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (user_id, slug));
create table public.cloudflare_connections (
  user_id uuid primary key default auth.uid(), account_id text not null, account_name text,
  db_key text, db_project_id text, db_url text, last_checked_at timestamptz, last_error text,
  status text not null default 'connected', token_ciphertext text not null, token_hint text, token_iv text not null,
  connected_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.code_projects (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(), name text not null,
  source text not null default 'blank', repo_full_name text, branch text, base_sha text, cf_project text, deploy_url text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.code_files (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(),
  project_id uuid not null references public.code_projects(id) on delete cascade,
  path text not null, content text not null default '', base_content text, deleted boolean not null default false,
  updated_at timestamptz not null default now(), unique (project_id, path));
create table public.code_project_backups (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(),
  project_id uuid not null references public.code_projects(id) on delete cascade,
  message text not null, files_snapshot jsonb not null, files_count integer not null default 0,
  commit_sha text, parent_sha text, created_at timestamptz not null default now());
create table public.conversations (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(),
  title text not null default 'Nova conversa', is_pinned boolean not null default false,
  title_generated boolean not null default false, title_manual boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.messages (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null, content text not null, created_at timestamptz not null default now());
create table public.gemini_keys (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(),
  label text not null, key_ciphertext text not null, key_iv text not null, key_hint text not null,
  google_project text not null default '', model text not null default 'gemini-2.5-flash',
  enabled boolean not null default true, is_primary boolean not null default false, status text not null default 'unknown',
  cooldown_until timestamptz, last_checked_at timestamptz, last_error text, last_used_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.github_connections (
  user_id uuid primary key default auth.uid(), account_id bigint, auth_type text not null default 'pat',
  avatar_url text, display_name text, email text, html_url text, login text, scopes text,
  last_checked_at timestamptz, last_error text, status text not null default 'connected',
  token_ciphertext text not null, token_iv text not null, token_hint text not null, token_expires_at timestamptz,
  connected_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.github_selection (
  user_id uuid primary key default auth.uid(), repo_full_name text not null, updated_at timestamptz not null default now());
create table public.integration_runs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(),
  provider text not null, kind text not null, ok boolean not null default false, http_status integer,
  key_id uuid, detail text, created_at timestamptz not null default now());
create table public.integration_status (
  user_id uuid not null default auth.uid(), provider text not null, auth_type text not null default 'api_key',
  status text not null default 'disconnected', last_checked_at timestamptz, last_error text, last_used_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (user_id, provider));
create table public.legacy_users (
  original_user_id uuid primary key, email text not null, display_name text, new_user_id uuid,
  imported_at timestamptz not null default now(), claimed_at timestamptz);
create index legacy_users_email_idx on public.legacy_users (lower(email));
create table public.system_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(),
  project_id text not null, role text not null, source text not null, content text not null,
  created_at timestamptz not null default now());
create table public.system_sessions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, session_key text not null,
  active_project_id text, pending_plan jsonb, updated_at timestamptz not null default now(),
  unique (user_id, session_key));
create table public.version_training_messages (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid(),
  version_id uuid not null references public.chat_versions(id) on delete cascade,
  role text not null, content text not null, created_at timestamptz not null default now());

do $$ declare t text; begin
  foreach t in array array['chat_versions','cloudflare_connections','code_projects','code_files','code_project_backups','conversations','messages','gemini_keys','github_connections','github_selection','integration_runs','integration_status','system_events','system_sessions','version_training_messages'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "own_select" on public.%I for select to authenticated using (auth.uid() = user_id)', t);
    execute format('create policy "own_insert" on public.%I for insert to authenticated with check (auth.uid() = user_id)', t);
    execute format('create policy "own_update" on public.%I for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
    execute format('create policy "own_delete" on public.%I for delete to authenticated using (auth.uid() = user_id)', t);
    execute format('create index on public.%I (user_id)', t);
  end loop;
  foreach t in array array['chat_versions','cloudflare_connections','code_projects','code_files','conversations','gemini_keys','github_connections','github_selection','integration_status','system_sessions'] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;
grant all on public.legacy_users to service_role;
alter table public.legacy_users enable row level security;

alter publication supabase_realtime add table public.system_events;

create or replace function public.claim_legacy_account() returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_email text; v_old uuid; t text;
begin
  if v_uid is null then return jsonb_build_object('claimed', false, 'reason', 'not_authenticated'); end if;
  select u.email into v_email from auth.users u where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null then return jsonb_build_object('claimed', false, 'reason', 'email_not_verified'); end if;
  if (select count(*) from public.legacy_users l where lower(l.email) = lower(v_email) and l.new_user_id is null) <> 1 then
    return jsonb_build_object('claimed', false, 'reason', 'no_unique_match'); end if;
  select l.original_user_id into v_old from public.legacy_users l where lower(l.email) = lower(v_email) and l.new_user_id is null;
  foreach t in array array['chat_versions','cloudflare_connections','code_projects','code_files','code_project_backups','conversations','messages','gemini_keys','github_connections','github_selection','integration_runs','integration_status','system_events','system_sessions','version_training_messages'] loop
    execute format('update public.%I set user_id = $1 where user_id = $2', t) using v_uid, v_old;
  end loop;
  update public.legacy_users set new_user_id = v_uid, claimed_at = now() where original_user_id = v_old;
  return jsonb_build_object('claimed', true);
end $$;
revoke all on function public.claim_legacy_account() from public, anon;
grant execute on function public.claim_legacy_account() to authenticated;

create or replace function public.lookup_auth_email(p_email text)
returns table(exists_account boolean, confirmed boolean, has_password boolean)
language sql security definer set search_path = '' as $$
  select true, u.email_confirmed_at is not null, u.encrypted_password is not null and u.encrypted_password <> ''
  from auth.users u where lower(u.email) = lower(p_email) limit 1
$$;
revoke all on function public.lookup_auth_email(text) from public, anon, authenticated;
grant execute on function public.lookup_auth_email(text) to service_role;

create or replace function public.inspect_schema() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('database', current_database(), 'version', current_setting('server_version'),
    'tables', coalesce((select jsonb_agg(jsonb_build_object(
      'name', c.relname, 'comment', obj_description(c.oid, 'pg_class'), 'rls_enabled', c.relrowsecurity,
      'estimated_rows', greatest(c.reltuples, 0)::bigint,
      'columns', (select coalesce(jsonb_agg(jsonb_build_object('name', a.attname, 'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
          'nullable', not a.attnotnull, 'default', pg_get_expr(d.adbin, d.adrelid)) order by a.attnum), '[]'::jsonb)
        from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
        where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped),
      'constraints', (select coalesce(jsonb_agg(jsonb_build_object('name', k.conname, 'type', k.contype, 'definition', pg_get_constraintdef(k.oid))), '[]'::jsonb)
        from pg_constraint k where k.conrelid = c.oid),
      'indexes', (select coalesce(jsonb_agg(jsonb_build_object('name', i.indexname, 'definition', i.indexdef)), '[]'::jsonb)
        from pg_indexes i where i.schemaname = 'public' and i.tablename = c.relname),
      'policies', (select coalesce(jsonb_agg(jsonb_build_object('name', p.policyname, 'command', p.cmd, 'roles', to_jsonb(p.roles), 'using', p.qual, 'check', p.with_check)), '[]'::jsonb)
        from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)
    ) order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'), '[]'::jsonb))
$$;
revoke all on function public.inspect_schema() from public, anon;
grant execute on function public.inspect_schema() to authenticated, service_role;

create or replace function public.exec_migration(p_sql text) returns jsonb language plpgsql security definer set search_path = public as $$
begin execute p_sql; return jsonb_build_object('ok', true); end $$;
revoke all on function public.exec_migration(text) from public, anon, authenticated;
grant execute on function public.exec_migration(text) to service_role;