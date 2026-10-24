-- 030 — Themes, and element colours drawn from eight slots (decided 25 October
-- 2026, after the "Bottega themes" mockups).
--
--   - account_preferences.theme (minimal, console, riso, gallery, rack) and
--     .mode (light, dark, system): the site's look for that person, read by
--     the layout with the account.
--   - Element colours (structure_elements.color, elements.color, 025) become
--     one of eight slots. A slot is stored as its light-mode hex, so every
--     function that copies colours keeps working; each theme draws the slot
--     in its own light or dark step (globals.css --el-1 to --el-8). A trigger
--     moves any other colour to its slot: the colours 025 seeded by hand, the
--     nearest by RGB for the rest. Existing rows are moved now.
--
-- Requires 025. Safe to run twice.

begin;

alter table account_preferences add column if not exists theme text not null default 'minimal';
alter table account_preferences add column if not exists mode text not null default 'system';
alter table account_preferences drop constraint if exists account_preferences_theme_check;
alter table account_preferences add constraint account_preferences_theme_check
  check (theme in ('minimal', 'console', 'riso', 'gallery', 'rack'));
alter table account_preferences drop constraint if exists account_preferences_mode_check;
alter table account_preferences add constraint account_preferences_mode_check
  check (mode in ('light', 'dark', 'system'));
grant update (theme, mode) on account_preferences to bottega_app;

-- The eight slots, in order: blue, orange, aqua, yellow, magenta, green,
-- violet, red (lib/elementColors.ts holds the same list).
create or replace function color_slot_hex(p_color text) returns text
language plpgsql immutable set search_path = public, pg_temp as $body$
declare
  slots text[] := array['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
  c text := lower(p_color);
  best text;
  best_d int;
  d int;
  s text;
begin
  if c is null or c = any(slots) then
    return c;
  end if;
  -- The colours 025 seeded and the State tab's spare list, each to its own slot.
  case c
    when '#3d5a80' then return '#2a78d6';
    when '#a0522d' then return '#eb6834';
    when '#4f8a8b' then return '#1baf7a';
    when '#c49a1f' then return '#eda100';
    when '#c46a8a' then return '#e87ba4';
    when '#6b8f71' then return '#008300';
    when '#8a6fa8' then return '#6250d6';
    when '#b5543c' then return '#e34948';
    else null;
  end case;
  if c !~ '^#[0-9a-f]{6}$' then
    return null;
  end if;
  foreach s in array slots loop
    d := (('x' || substr(c, 2, 2))::bit(8)::int - ('x' || substr(s, 2, 2))::bit(8)::int) ^ 2
       + (('x' || substr(c, 4, 2))::bit(8)::int - ('x' || substr(s, 4, 2))::bit(8)::int) ^ 2
       + (('x' || substr(c, 6, 2))::bit(8)::int - ('x' || substr(s, 6, 2))::bit(8)::int) ^ 2;
    if best_d is null or d < best_d then
      best_d := d;
      best := s;
    end if;
  end loop;
  return best;
end;
$body$;

create or replace function color_slot_normalise() returns trigger
language plpgsql set search_path = public, pg_temp as $body$
begin
  new.color := color_slot_hex(new.color);
  return new;
end;
$body$;

drop trigger if exists structure_elements_color_slot on structure_elements;
create trigger structure_elements_color_slot before insert or update of color on structure_elements
  for each row execute function color_slot_normalise();
drop trigger if exists elements_color_slot on elements;
create trigger elements_color_slot before insert or update of color on elements
  for each row execute function color_slot_normalise();

update structure_elements set color = color_slot_hex(color) where color is distinct from color_slot_hex(color);
update elements set color = color_slot_hex(color) where color is distinct from color_slot_hex(color);

commit;
