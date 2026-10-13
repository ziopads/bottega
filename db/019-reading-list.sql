-- 019 — A study group's reading list (decided 12 October 2026).
--
-- study_group_documents (016) held private documents shared with a group. It
-- becomes the group's reading list: the documents its study draws on, which
-- Claude's searches for the group are limited to (lib/search.ts, the
-- connector's search with a group). It now takes library manuals too:
--
--   - a library manual (approved) is listed or unlisted by the group's
--     custodian, since the list shapes the syllabus; every active account
--     reads it already, so listing it shares nothing;
--   - a private document is listed or unlisted by its owner, a member of the
--     group, and listing it shares it with the group's members (view), as in
--     016.
--
-- Listing and unlisting are written to the access log. document_set_home
-- (018) now keeps a document on reading lists when it moves into the library,
-- and takes it off them when it moves out (it would otherwise be shared
-- without its new owner choosing).
--
-- Requires 016, 018. Safe to run twice.

begin;

create or replace function document_is_library(p_document bigint) returns boolean
language sql stable security definer set search_path = public, pg_temp as $body$
  select coalesce((select library and review_status = 'approved' from documents where id = p_document), false)
$body$;

create or replace function study_group_documents_log() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  g text;
  lib boolean;
  r study_group_documents;
begin
  if tg_op = 'INSERT' then r := new; else r := old; end if;
  select name into g from study_groups where id = r.group_id;
  select library into lib from documents where id = r.document_id;
  if tg_op = 'INSERT' then
    if lib and not document_is_library(r.document_id) then
      raise exception 'only an approved library manual goes on a reading list';
    end if;
    perform log_access(case when lib then 'document_listed_for_group' else 'document_shared_with_group' end,
      null, 'document', r.document_id, null,
      jsonb_build_object('group_id', r.group_id, 'group', g, 'level', 'view'), null);
    return new;
  end if;
  perform log_access(case when lib then 'document_unlisted_for_group' else 'document_unshared_from_group' end,
    null, 'document', r.document_id, jsonb_build_object('group_id', r.group_id, 'group', g), null, null);
  return old;
end;
$body$;

-- Who lists and unlists: a library manual, the custodian; a private document,
-- its owner, while a member of the group.
drop policy if exists study_group_documents_insert on study_group_documents;
create policy study_group_documents_insert on study_group_documents for insert
  with check (
    shared_by = app_user() and not app_admin_viewing() and study_member(group_id)
    and ((document_is_library(document_id) and study_custodian(group_id))
         or (not document_is_library(document_id) and document_rank(document_id) = 4))
  );
drop policy if exists study_group_documents_delete on study_group_documents;
create policy study_group_documents_delete on study_group_documents for delete
  using (
    not app_admin_viewing()
    and ((document_is_library(document_id) and study_custodian(group_id))
         or (not document_is_library(document_id) and document_rank(document_id) = 4))
  );

create or replace function document_set_home(p_document bigint, p_library boolean, p_kind text) returns void
language plpgsql security definer set search_path = public, pg_temp as $body$
declare
  d documents;
  new_owner text;
  new_kind text := btrim(coalesce(p_kind, ''));
  twin bigint;
  removed jsonb;
  n_picks int;
  n_links int;
  n_shares int;
  n_groups int;
begin
  if not app_is_admin() or app_admin_viewing() then
    raise exception 'only the platform administrator moves a document between the library and private documents';
  end if;
  select * into d from documents where id = p_document for update;
  if not found then
    raise exception 'no document %', p_document;
  end if;
  if d.library = p_library then
    raise exception 'that document is already %', case when p_library then 'in the library' else 'private' end;
  end if;
  if new_kind = '' then
    new_kind := d.kind;
  end if;
  if p_library and new_kind not in ('manual', 'service', 'firmware') then
    raise exception 'the library takes manuals, service manuals and firmware notes only';
  end if;
  if new_kind not in ('manual', 'service', 'firmware', 'reference', 'book', 'other') then
    raise exception 'no kind %', new_kind;
  end if;

  perform set_config('app.document_home', 'on', true);
  if p_library then
    select id into twin from documents where library and sha256 = d.sha256 and id <> d.id limit 1;
    if twin is not null then
      raise exception 'the library already holds this file as document %', twin;
    end if;
    delete from shares where document_id = d.id;
    get diagnostics n_shares = row_count;
    -- Its place on study groups' reading lists stays (019): a library manual
    -- may be listed by a group.
    update documents
       set library = true, owner_id = null, contributed_by = coalesce(d.contributed_by, d.owner_id),
           review_status = 'approved', kind = new_kind
     where id = d.id;
    removed := jsonb_build_object('shares', n_shares);
  else
    new_owner := coalesce(
      (select user_id from accounts where user_id = d.contributed_by),
      app_user()
    );
    select id into twin from documents where not library and owner_id = new_owner and sha256 = d.sha256 and id <> d.id limit 1;
    if twin is not null then
      raise exception 'that account already holds this file as private document %', twin;
    end if;
    delete from library_picks where document_id = d.id;
    get diagnostics n_picks = row_count;
    delete from model_documents where document_id = d.id;
    get diagnostics n_links = row_count;
    -- Groups listed it as a library manual; as a private document it would be
    -- shared with them without its new owner choosing to, so it leaves their
    -- reading lists.
    delete from study_group_documents where document_id = d.id;
    get diagnostics n_groups = row_count;
    update documents
       set library = false, owner_id = new_owner, contributed_by = coalesce(d.contributed_by, new_owner),
           review_status = 'approved', kind = new_kind
     where id = d.id;
    removed := jsonb_build_object('picks', n_picks, 'model_links', n_links, 'group_lists', n_groups);
  end if;
  perform set_config('app.document_home', '', true);

  perform log_access('document_moved', coalesce(new_owner, d.owner_id), 'document', d.id,
    jsonb_build_object('library', d.library, 'kind', d.kind),
    jsonb_build_object('library', p_library, 'kind', new_kind, 'removed', removed),
    null);
end;
$body$;

revoke execute on function document_set_home(bigint, boolean, text) from public;
grant execute on function document_set_home(bigint, boolean, text) to bottega_app;

commit;
