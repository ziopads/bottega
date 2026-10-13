-- 018 — The platform administrator moves a document between the library and
-- an account's private documents (decided 12 October 2026).
--
-- documents_guard (004) refuses any change of a document's home, contributor
-- or file, so that an approved manual can never be taken out of the library
-- by its contributor. Until now only the owner role could move one
-- (pipeline/document_home.py, library to private only). document_set_home()
-- lets the administrator do it from the app, both ways:
--
--   - library to private: the document becomes a private document of its
--     contributor (or of the administrator, when the contributor's account is
--     gone), approved; other accounts' picks of it and its links to catalogue
--     models are removed, since only library documents have those.
--   - private to library: the former owner is kept as its contributor, and it
--     is approved, since the administrator is the one moving it; its shares
--     with people and with study groups are removed, since every active
--     account reads an approved library document.
--
-- In both directions the kind is set (the library takes manuals, service
-- manuals and firmware notes only, 005's documents_library_kinds), the same
-- file is never held twice (K-8), and the move is written to the access log.
-- Pages and chunks stay as they are: nothing is processed again.
--
-- The guard lets the move through when app.document_home is set for the
-- transaction, which only this function does. Setting it by hand gains
-- nothing: the application role has no update grant on library, owner_id or
-- contributed_by.
--
-- Requires 004, 005, 016. Safe to run twice.

begin;

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
  if (new.library is distinct from old.library or new.owner_id is distinct from old.owner_id
      or new.contributed_by is distinct from old.contributed_by)
     and current_setting('app.document_home', true) = 'on' and app_is_admin() then
    -- document_set_home(): the file itself still never changes.
    if new.sha256 is distinct from old.sha256 or new.r2_key is distinct from old.r2_key then
      raise exception 'a document''s file cannot change';
    end if;
    if new.review_status = 'approved' and old.review_status is distinct from 'approved' then
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
    delete from study_group_documents where document_id = d.id;
    get diagnostics n_groups = row_count;
    update documents
       set library = true, owner_id = null, contributed_by = coalesce(d.contributed_by, d.owner_id),
           review_status = 'approved', kind = new_kind
     where id = d.id;
    removed := jsonb_build_object('shares', n_shares, 'group_shares', n_groups);
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
    update documents
       set library = false, owner_id = new_owner, contributed_by = coalesce(d.contributed_by, new_owner),
           review_status = 'approved', kind = new_kind
     where id = d.id;
    removed := jsonb_build_object('picks', n_picks, 'model_links', n_links);
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
