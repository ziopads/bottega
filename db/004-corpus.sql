-- 004: The corpus. REQUIREMENTS §8 (K-1 to K-8), §12 (O-4, O-5),
-- ARCHITECTURE §4 "Corpus", §11 "The library", §12.
--
-- Documents are either the platform library's (manuals, contributed by users,
-- approved by the platform administrator) or one account's private documents
-- (books and the like, shareable). Their text is extracted page by page and
-- split into passages ("chunks") with a keyword index and an embedding, by
-- the app itself, in resumable batches (decided 10 October 2026).
--
-- THE GATE. Processing costs money (embeddings) and every file costs storage,
-- so both are metered (decided 10 October 2026):
--
--   - only active accounts upload at all (the bullpen, 002);
--   - each account has a monthly page allowance and a storage allowance, set
--     platform-wide in platform_settings and overridable per account in
--     account_limits by the administrator;
--   - the platform as a whole has a monthly page ceiling, a circuit breaker
--     that pauses processing for everyone when reached;
--   - a document longer than the per-document maximum is refused;
--   - pages are claimed from the allowance before they are processed
--     (claim_pages), so two batches cannot both spend the last of it, and
--     every claim is a row in processing_usage: usage is a sum, not a guess;
--   - the platform administrator is exempt, as the operator.
--
-- Uploading a manual the library already holds costs nothing: its SHA-256
-- fingerprint finds the existing copy, and the person is linked to it.
--
-- VECTORS. Embeddings are voyage-4 at 1024 dimensions stored as halfvec
-- (half precision, half the bytes), with an HNSW index for cosine distance.
-- Needs pgvector 0.7 or later, which Neon provides.
--
-- Requires 002 and 003. Safe to run twice.

begin;

create extension if not exists vector;

-- Settings and allowances ------------------------------------------------------------

create table if not exists platform_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  text not null default app_actor()
);

insert into platform_settings (key, value) values
  ('limits', jsonb_build_object(
     'storage_bytes', 5368709120,          -- 5 GB per account
     'pages_per_month', 3000,              -- pages processed per account per calendar month
     'max_document_pages', 1500,           -- longer documents are refused
     'platform_pages_per_month', 30000     -- the circuit breaker for everyone
  ))
on conflict (key) do nothing;

-- Per-account overrides. A null column means the platform default.
create table if not exists account_limits (
  user_id             text primary key references accounts(user_id) on delete cascade,
  storage_bytes       bigint check (storage_bytes is null or storage_bytes >= 0),
  pages_per_month     int check (pages_per_month is null or pages_per_month >= 0),
  max_document_pages  int check (max_document_pages is null or max_document_pages > 0),
  updated_at          timestamptz not null default now()
);

-- Changes to settings and allowances are access changes: logged.
create or replace function limits_log() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  if tg_table_name = 'platform_settings' then
    perform log_access('setting_changed', null, null, null,
      case when tg_op = 'UPDATE' then jsonb_build_object(old.key, old.value) end,
      jsonb_build_object(new.key, new.value), null);
  else
    perform log_access('limits_changed', new.user_id, null, null,
      case when tg_op = 'UPDATE' then to_jsonb(old) - 'updated_at' end,
      to_jsonb(new) - 'updated_at', null);
  end if;
  return new;
end;
$body$;
drop trigger if exists platform_settings_log on platform_settings;
create trigger platform_settings_log after insert or update on platform_settings
  for each row execute function limits_log();
drop trigger if exists account_limits_log on account_limits;
create trigger account_limits_log after insert or update on account_limits
  for each row execute function limits_log();

-- An account's effective limits: its override, else the platform's.
create or replace function effective_limits(p_user text)
returns table (storage_bytes bigint, pages_per_month int, max_document_pages int)
language sql stable security definer set search_path = public, pg_temp as $body$
  select coalesce(l.storage_bytes, (s.value->>'storage_bytes')::bigint),
         coalesce(l.pages_per_month, (s.value->>'pages_per_month')::int),
         coalesce(l.max_document_pages, (s.value->>'max_document_pages')::int)
  from platform_settings s
  left join account_limits l on l.user_id = p_user
  where s.key = 'limits'
$body$;

-- Documents ------------------------------------------------------------------------------

create table if not exists documents (
  id                bigint generated always as identity primary key,
  -- Exactly one of: in the platform library, or owned by an account.
  library           boolean not null default false,
  owner_id          text references accounts(user_id),
  contributed_by    text references accounts(user_id) on delete set null default app_user(),
  -- Library review (REQUIREMENTS K-6); private documents stay 'approved'.
  review_status     text not null default 'submitted' check (review_status in ('submitted', 'approved', 'rejected')),
  kind              text not null default 'manual' check (kind in ('manual', 'book', 'other')),
  title             text not null check (title <> '' and title = btrim(title)),
  maker             text not null default '',
  model             text not null default '',
  -- The file.
  r2_key            text not null unique,
  filename          text not null,
  bytes             bigint not null check (bytes >= 0),
  sha256            text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  page_count        int check (page_count is null or page_count >= 0),
  -- Processing, in resumable batches.
  state             text not null default 'pending'
                    check (state in ('pending', 'processing', 'ready', 'needs_ocr', 'paused', 'failed')),
  pages_done        int not null default 0 check (pages_done >= 0),
  state_detail      text not null default '',
  embedding_model   text not null default 'voyage-4',
  embedding_dim     int not null default 1024,
  created_at        timestamptz not null default now(),
  approved_at       timestamptz,
  constraint documents_one_home check (library = (owner_id is null)),
  constraint documents_private_approved check (library or review_status = 'approved')
);
create unique index if not exists documents_library_sha on documents (sha256) where library;
create unique index if not exists documents_owner_sha on documents (owner_id, sha256) where not library;
create index if not exists documents_owner_idx on documents (owner_id);
create index if not exists documents_contributor_idx on documents (contributed_by);

-- Page text, the durable artifact: chunks can always be rebuilt from it.
create table if not exists pages (
  document_id  bigint not null references documents(id) on delete cascade,
  page_number  int not null check (page_number > 0),
  text         text not null,
  primary key (document_id, page_number)
);

create table if not exists chunks (
  id               bigint generated always as identity primary key,
  document_id      bigint not null references documents(id) on delete cascade,
  first_page       int not null,
  last_page        int not null,
  text             text not null,
  tsv              tsvector generated always as (to_tsvector('english', text)) stored,
  embedding        halfvec(1024),
  chunker_version  int not null default 1,
  check (last_page >= first_page)
);
create index if not exists chunks_document_idx on chunks (document_id, first_page);
create index if not exists chunks_tsv_idx on chunks using gin (tsv);
create index if not exists chunks_embedding_idx on chunks using hnsw (embedding halfvec_cosine_ops);

-- Manuals belong to models (REQUIREMENTS G-4): every unit of the model has them.
create table if not exists model_documents (
  model_id     bigint not null references gear_models(id) on delete cascade,
  document_id  bigint not null references documents(id) on delete cascade,
  added_by     text references accounts(user_id) on delete set null default app_user(),
  added_at     timestamptz not null default now(),
  primary key (model_id, document_id)
);

-- Further library documents a person has chosen for their own search (K-7).
create table if not exists library_picks (
  user_id      text not null references accounts(user_id) on delete cascade default app_user(),
  document_id  bigint not null references documents(id) on delete cascade,
  picked_at    timestamptz not null default now(),
  primary key (user_id, document_id)
);

-- Effective level on a document ----------------------------------------------------------

-- Library: the administrator 4; everyone active 1 once approved; the
-- contributor 3 until then (they can read, process and correct it, and
-- withdraw it). Private: as projects, owner 4, shares, administrator's view 1.
create or replace function document_rank(p_document_id bigint) returns int
language plpgsql stable security definer set search_path = public, pg_temp as $body$
declare
  me text := app_user();
  d documents;
  best int := 0;
begin
  if me is null or not app_active() then
    return 0;
  end if;
  select * into d from documents where id = p_document_id;
  if not found then
    return 0;
  end if;
  if d.library then
    if app_is_admin() then
      return 4;
    end if;
    if d.review_status = 'approved' then
      return 1;
    end if;
    if d.contributed_by = me and d.review_status = 'submitted' then
      return 3;
    end if;
    if d.contributed_by = me then
      return 1;   -- rejected: still readable by its contributor, nothing more
    end if;
    return 0;
  end if;
  if d.owner_id = me then
    return 4;
  end if;
  select coalesce(max(level_rank(level)), 0) into best from shares where document_id = p_document_id and grantee_id = me;
  if best < 1 and app_admin_viewing() then
    best := 1;
  end if;
  return best;
end;
$body$;

create or replace function document_level(p_document_id bigint) returns text
language sql stable as $body$
  select case document_rank(p_document_id) when 4 then 'owner' when 3 then 'edit'
         when 2 then 'contribute' when 1 then 'view' else null end
$body$;

-- Uploading the same manual twice. A contributor cannot see someone else's
-- submission, so this answers, by fingerprint only, whether the library holds
-- the file and in what state.
create or replace function find_library_document(p_sha256 text)
returns table (id bigint, review_status text)
language sql stable security definer set search_path = public, pg_temp as $body$
  select d.id, d.review_status from documents d
  where app_active() and d.library and d.sha256 = lower(p_sha256)
$body$;

-- Insert and review rules the policies cannot express on their own: a
-- library document arrives submitted and contributed by its uploader; a
-- private one belongs to its uploader; only the administrator reviews; and
-- who owns a document never changes.
create or replace function documents_guard() returns trigger
language plpgsql as $body$
begin
  if app_user() is null then
    return new;   -- the owner role (pipeline, bootstrap)
  end if;
  if tg_op = 'INSERT' then
    new.contributed_by := app_user();
    if new.library then
      new.owner_id := null;
      if not app_is_admin() then
        new.review_status := 'submitted';
      end if;
    else
      new.owner_id := app_user();
      new.review_status := 'approved';
    end if;
    if new.review_status = 'approved' then
      new.approved_at := now();
    end if;
    return new;
  end if;
  if new.library is distinct from old.library or new.owner_id is distinct from old.owner_id
     or new.contributed_by is distinct from old.contributed_by or new.sha256 is distinct from old.sha256
     or new.r2_key is distinct from old.r2_key then
    raise exception 'a document''s home, contributor and file cannot change';
  end if;
  if new.review_status is distinct from old.review_status then
    if not app_is_admin() then
      raise exception 'only the platform administrator reviews library documents';
    end if;
    if new.review_status = 'approved' then
      new.approved_at := now();
    end if;
  end if;
  return new;
end;
$body$;
drop trigger if exists documents_guard on documents;
create trigger documents_guard before insert or update on documents
  for each row execute function documents_guard();

-- Library reviews are written to the access log.
create or replace function documents_log() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
begin
  if new.library and old.review_status is distinct from new.review_status then
    perform log_access('document_reviewed', new.contributed_by, 'document', new.id,
      jsonb_build_object('review_status', old.review_status), jsonb_build_object('review_status', new.review_status), null);
  end if;
  return new;
end;
$body$;
drop trigger if exists documents_log on documents;
create trigger documents_log after update on documents
  for each row execute function documents_log();

-- Usage: the ledger behind the allowances ------------------------------------------------

create table if not exists processing_usage (
  id           bigint generated always as identity primary key,
  account_id   text not null references accounts(user_id),
  document_id  bigint references documents(id) on delete set null,
  pages        int not null check (pages >= 0),
  tokens       bigint not null default 0 check (tokens >= 0),
  at           timestamptz not null default now()
);
create index if not exists processing_usage_account_idx on processing_usage (account_id, at);
create index if not exists processing_usage_at_idx on processing_usage (at);

create or replace function pages_used_this_month(p_user text) returns int
language sql stable security definer set search_path = public, pg_temp as $body$
  select coalesce(sum(pages), 0)::int from processing_usage
  where account_id = p_user and at >= date_trunc('month', now())
$body$;

create or replace function platform_pages_this_month() returns int
language sql stable security definer set search_path = public, pg_temp as $body$
  select coalesce(sum(pages), 0)::int from processing_usage where at >= date_trunc('month', now())
$body$;

-- Bytes an account stores: its gear files, its private documents, its library
-- submissions not yet approved (approved ones are the platform's), and the
-- audio on its projects.
create or replace function storage_used(p_user text) returns bigint
language sql stable security definer set search_path = public, pg_temp as $body$
  select coalesce((select sum(f.bytes) from gear_files f join gear g on g.id = f.gear_id where g.owner_id = p_user), 0)
       + coalesce((select sum(d.bytes) from documents d
                   where d.owner_id = p_user or (d.library and d.contributed_by = p_user and d.review_status <> 'approved')), 0)
       + coalesce((select sum(a.bytes) from audio a join projects p on p.id = a.project_id where p.owner_id = p_user), 0)
$body$;

-- What the signed-in person may still use, for the app to check before it
-- signs an upload or claims pages. Nulls mean no limit (the administrator).
create or replace function my_allowance()
returns table (storage_bytes bigint, storage_used bigint, pages_per_month int, pages_used int,
               max_document_pages int, platform_pages_left int)
language plpgsql stable security definer set search_path = public, pg_temp as $body$
declare
  me text := app_user();
  lim record;
  platform_cap int;
begin
  if me is null or not app_active() then
    return;
  end if;
  select * into lim from effective_limits(me);
  select (value->>'platform_pages_per_month')::int into platform_cap from platform_settings where key = 'limits';
  if app_is_admin() then
    return query select null::bigint, storage_used(me), null::int, pages_used_this_month(me), null::int,
                        greatest(platform_cap - platform_pages_this_month(), 0);
  else
    return query select lim.storage_bytes, storage_used(me), lim.pages_per_month, pages_used_this_month(me),
                        lim.max_document_pages, greatest(platform_cap - platform_pages_this_month(), 0);
  end if;
end;
$body$;

-- Claim up to p_pages pages of the allowance for processing a document.
-- Returns the usage row and how many pages were granted (possibly fewer than
-- asked, possibly none). Serialized per account by an advisory lock, so two
-- batches cannot both spend the last of an allowance. The platform ceiling
-- applies to everyone, the administrator included: it is the circuit breaker.
create or replace function claim_pages(p_document_id bigint, p_pages int)
returns table (usage_id bigint, granted int)
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  me text := app_user();
  lim record;
  platform_cap int;
  left_account int;
  left_platform int;
  n int;
  uid bigint;
begin
  if me is null or not app_active() then
    raise exception 'claim_pages needs an active account';
  end if;
  if document_rank(p_document_id) < 3 then
    raise exception 'not allowed to process document %', p_document_id;
  end if;
  perform pg_advisory_xact_lock(hashtext('claim_pages'));
  select * into lim from effective_limits(me);
  select (value->>'platform_pages_per_month')::int into platform_cap from platform_settings where key = 'limits';
  left_platform := greatest(platform_cap - platform_pages_this_month(), 0);
  left_account := case when app_is_admin() then left_platform
                       else greatest(lim.pages_per_month - pages_used_this_month(me), 0) end;
  n := least(greatest(p_pages, 0), left_account, left_platform);
  insert into processing_usage (account_id, document_id, pages) values (me, p_document_id, n) returning id into uid;
  return query select uid, n;
end;
$body$;

-- Record the embedding tokens a claim used, once, on one's own claim.
create or replace function record_tokens(p_usage_id bigint, p_tokens bigint) returns void
language sql security definer set search_path = public, pg_temp as $body$
  update processing_usage set tokens = tokens + greatest(p_tokens, 0)
  where id = p_usage_id and account_id = app_user() and at > now() - interval '1 hour'
$body$;

-- The ledger is append-only, apart from record_tokens.
create or replace function processing_usage_guard() returns trigger
language plpgsql as $body$
begin
  if tg_op = 'DELETE' then
    raise exception 'processing_usage is append-only';
  end if;
  -- document_id may go to null: the document was deleted, the usage stands.
  if new.account_id is distinct from old.account_id or new.pages is distinct from old.pages
     or (new.document_id is distinct from old.document_id and new.document_id is not null)
     or new.at is distinct from old.at then
    raise exception 'processing_usage rows cannot change, apart from tokens';
  end if;
  return new;
end;
$body$;
drop trigger if exists processing_usage_guard on processing_usage;
create trigger processing_usage_guard before update or delete on processing_usage
  for each row execute function processing_usage_guard();

-- Shares widen to documents ------------------------------------------------------------

alter table shares add column if not exists document_id bigint references documents(id) on delete cascade;
alter table shares drop constraint if exists shares_one_item;
alter table shares add constraint shares_one_item check (num_nonnulls(project_id, gear_id, document_id) = 1);
create unique index if not exists shares_document_grantee on shares (document_id, grantee_id) where document_id is not null;

create or replace function share_item_rank(p_project_id bigint, p_gear_id bigint) returns int
language sql stable as $body$
  select case when p_project_id is not null then project_rank(p_project_id)
              when p_gear_id is not null then gear_rank(p_gear_id)
              else 0 end
$body$;

create or replace function share_item_rank(p_project_id bigint, p_gear_id bigint, p_document_id bigint) returns int
language sql stable as $body$
  select case when p_project_id is not null then project_rank(p_project_id)
              when p_gear_id is not null then gear_rank(p_gear_id)
              when p_document_id is not null then document_rank(p_document_id)
              else 0 end
$body$;

create or replace function shares_check_and_log() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  item_owner text;
  r shares;
  kind text;
  item bigint;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  if r.project_id is not null then
    kind := 'project';
    item := r.project_id;
    select owner_id into item_owner from projects where id = r.project_id;
  elsif r.gear_id is not null then
    kind := 'gear';
    item := r.gear_id;
    select owner_id into item_owner from gear where id = r.gear_id;
  else
    kind := 'document';
    item := r.document_id;
    select owner_id into item_owner from documents where id = r.document_id;
    if tg_op = 'INSERT' and item_owner is null then
      raise exception 'library documents are not shared; they are visible to everyone once approved';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if new.grantee_id = item_owner then
      raise exception 'an owner cannot share an item with themselves';
    end if;
    if not exists (select 1 from accounts where user_id = new.grantee_id and status = 'active') then
      raise exception 'account % is not active', new.grantee_id;
    end if;
  end if;

  if tg_op = 'INSERT' then
    perform log_access('share_granted', new.grantee_id, kind, item, null, jsonb_build_object('level', new.level), null);
    return new;
  elsif tg_op = 'UPDATE' then
    if old.level is distinct from new.level then
      perform log_access('share_changed', new.grantee_id, kind, item,
        jsonb_build_object('level', old.level), jsonb_build_object('level', new.level), null);
    end if;
    return new;
  else
    perform log_access('share_revoked', old.grantee_id, kind, item, jsonb_build_object('level', old.level), null, null);
    return old;
  end if;
end;
$body$;

drop policy if exists shares_read on shares;
create policy shares_read on shares for select
  using (app_active() and (grantee_id = app_user() or share_item_rank(project_id, gear_id, document_id) = 4));
drop policy if exists shares_insert on shares;
create policy shares_insert on shares for insert
  with check (share_item_rank(project_id, gear_id, document_id) = 4 and granted_by = app_user());
drop policy if exists shares_update on shares;
create policy shares_update on shares for update
  using (share_item_rank(project_id, gear_id, document_id) = 4)
  with check (share_item_rank(project_id, gear_id, document_id) = 4);
drop policy if exists shares_delete on shares;
create policy shares_delete on shares for delete
  using (share_item_rank(project_id, gear_id, document_id) = 4);

drop policy if exists access_log_read on access_log;
create policy access_log_read on access_log for select
  using (
    app_is_admin()
    or (app_active() and (
      actor = app_user() or subject_id = app_user()
      or (item_kind = 'project' and project_rank(item_id) = 4)
      or (item_kind = 'gear' and gear_rank(item_id) = 4)
      or (item_kind = 'document' and document_rank(item_id) = 4)
    ))
  );

-- Row-level security ----------------------------------------------------------------------

alter table platform_settings enable row level security;
alter table account_limits    enable row level security;
alter table documents         enable row level security;
alter table pages             enable row level security;
alter table chunks            enable row level security;
alter table model_documents   enable row level security;
alter table library_picks     enable row level security;
alter table processing_usage  enable row level security;

drop policy if exists platform_settings_read on platform_settings;
create policy platform_settings_read on platform_settings for select using (app_active());
drop policy if exists platform_settings_edit on platform_settings;
create policy platform_settings_edit on platform_settings for update using (app_is_admin()) with check (app_is_admin());

drop policy if exists account_limits_read on account_limits;
create policy account_limits_read on account_limits for select using (user_id = app_user() or app_is_admin());
drop policy if exists account_limits_write on account_limits;
create policy account_limits_write on account_limits for all using (app_is_admin()) with check (app_is_admin());

drop policy if exists documents_read on documents;
create policy documents_read on documents for select
  using ((owner_id = app_user() and app_active())
         or (library and contributed_by = app_user() and app_active())
         or document_rank(id) > 0);
drop policy if exists documents_insert on documents;
create policy documents_insert on documents for insert
  with check (app_active() and contributed_by = app_user() and (library or owner_id = app_user()));
drop policy if exists documents_update on documents;
create policy documents_update on documents for update
  using (document_rank(id) >= 3 and not app_admin_viewing())
  with check (document_rank(id) >= 3 or app_is_admin());
drop policy if exists documents_delete on documents;
create policy documents_delete on documents for delete
  using (document_rank(id) = 4
         or (library and contributed_by = app_user() and review_status <> 'approved' and app_active()));

drop policy if exists pages_read on pages;
create policy pages_read on pages for select using (document_rank(document_id) > 0);
drop policy if exists pages_write on pages;
create policy pages_write on pages for all
  using (document_rank(document_id) >= 3 and not app_admin_viewing())
  with check (document_rank(document_id) >= 3);

drop policy if exists chunks_read on chunks;
create policy chunks_read on chunks for select using (document_rank(document_id) > 0);
drop policy if exists chunks_write on chunks;
create policy chunks_write on chunks for all
  using (document_rank(document_id) >= 3 and not app_admin_viewing())
  with check (document_rank(document_id) >= 3);

-- Linking a manual to a model: whoever can see both; removing a link, the
-- administrator or whoever added it.
drop policy if exists model_documents_read on model_documents;
create policy model_documents_read on model_documents for select
  using (document_rank(document_id) > 0 and exists (select 1 from gear_models m where m.id = model_id));
drop policy if exists model_documents_insert on model_documents;
create policy model_documents_insert on model_documents for insert
  with check (added_by = app_user() and document_rank(document_id) > 0
              and exists (select 1 from documents d where d.id = document_id and d.library)
              and exists (select 1 from gear_models m where m.id = model_id));
drop policy if exists model_documents_delete on model_documents;
create policy model_documents_delete on model_documents for delete
  using (app_is_admin() or (added_by = app_user() and app_active()));

drop policy if exists library_picks_own on library_picks;
create policy library_picks_own on library_picks for all
  using (user_id = app_user() and app_active())
  with check (user_id = app_user() and app_active());

drop policy if exists processing_usage_read on processing_usage;
create policy processing_usage_read on processing_usage for select using (account_id = app_user() or app_is_admin());

-- Grants ----------------------------------------------------------------------------------

grant select on platform_settings, account_limits, documents, pages, chunks, model_documents,
  library_picks, processing_usage to bottega_app;
grant update (value) on platform_settings to bottega_app;
grant insert, update (storage_bytes, pages_per_month, max_document_pages, updated_at), delete on account_limits to bottega_app;
grant insert on documents, pages, chunks, model_documents, library_picks to bottega_app;
grant update (title, kind, maker, model, review_status, page_count, state, pages_done, state_detail) on documents to bottega_app;
grant delete on documents, pages, chunks, model_documents, library_picks to bottega_app;
grant usage on all sequences in schema public to bottega_app;

revoke execute on function claim_pages(bigint, int) from public;
revoke execute on function record_tokens(bigint, bigint) from public;
revoke execute on function my_allowance() from public;
revoke execute on function find_library_document(text) from public;
grant execute on function claim_pages(bigint, int) to bottega_app;
grant execute on function record_tokens(bigint, bigint) to bottega_app;
grant execute on function my_allowance() to bottega_app;
grant execute on function find_library_document(text) to bottega_app;

commit;
