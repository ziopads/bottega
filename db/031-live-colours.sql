-- 031 — Element colours are Ableton Live's (decided 25 October 2026): one of
-- Live's 70 colours, so a zone looks the same in Bottega and in the Live
-- template. Replaces 030's eight slots.
--
--   - color_live_hex() moves any colour to a Live colour. 030's slots and the
--     colours 025 seeded go to eight suggested Live colours, in the order that
--     keeps neighbours apart for colour-blind readers (lib/liveColors.ts
--     SUGGESTED): TACTUS, BASS, BACKGROUND, LEADS, TEXTURE, VOX take the first
--     six. Any other colour goes to the nearest Live colour by RGB, greys
--     left out.
--   - The trigger from 030 now uses it; existing rows are moved.
--
-- Requires 030. Safe to run twice.

begin;

-- Live's palette, in its grid order (row by row, 14 to a row): index n is
-- element n + 1. Colour-picked values; lib/liveColors.ts holds the same list.
create or replace function live_palette() returns text[]
language sql immutable as $body$
  select array['#fd95a7', '#fda43a', '#cb9834', '#f7f384', '#c0f932', '#32fd42', '#39fdaa', '#65fee8', '#8dc6fd', '#5682e1', '#93a9fc', '#d670e2', '#e3569f', '#ffffff', '#fc393d', '#f46c20', '#98714e', '#feee4a', '#8bfd70', '#44c121', '#1ebeaf', '#31e9fd', '#22a5eb', '#127ebe', '#8870e1', '#b579c4', '#fd42d2', '#d0d0d0', '#e0685d', '#fda378', '#d2ac75', '#edfeb2', '#d2e39c', '#bacf79', '#9cc38f', '#d5fde2', '#cef1f8', '#b9c2e2', '#cdbce3', '#ae9ae3', '#e5dce1', '#a9a9a9', '#c5928c', '#b68259', '#98836b', '#bfb96e', '#a6bc25', '#7eaf52', '#8ac2ba', '#9cb3c3', '#86a5c1', '#8494ca', '#a596b4', '#bea0bd', '#bb7296', '#7b7b7b', '#ad3436', '#a75135', '#714f42', '#dac229', '#85952b', '#559e38', '#1b9b8e', '#266383', '#1b3393', '#3154a0', '#624eab', '#a24eab', '#ca326e', '#3c3c3c']
$body$;

create or replace function color_live_hex(p_color text) returns text
language plpgsql immutable set search_path = public, pg_temp as $body$
declare
  pal text[] := live_palette();
  c text := lower(p_color);
  best text;
  best_d int;
  d int;
  i int;
begin
  if c is null or c = any(pal) then
    return c;
  end if;
  case c
    -- 030's slots and 025's seeds, by the element they were made for.
    when '#e34948' then return pal[24]; when '#b5543c' then return pal[24];  -- TACTUS: Live 23
    when '#2a78d6' then return pal[15]; when '#3d5a80' then return pal[15];  -- BASS: Live 14
    when '#008300' then return pal[55]; when '#6b8f71' then return pal[55];  -- BACKGROUND: Live 54
    when '#eda100' then return pal[61]; when '#c49a1f' then return pal[61];  -- LEADS: Live 60
    when '#6250d6' then return pal[10]; when '#8a6fa8' then return pal[10];  -- TEXTURE: Live 9
    when '#e87ba4' then return pal[29]; when '#c46a8a' then return pal[29];  -- VOX: Live 28
    when '#1baf7a' then return pal[26]; when '#4f8a8b' then return pal[26];  -- Live 25
    when '#eb6834' then return pal[58]; when '#a0522d' then return pal[58];  -- Live 57
    else null;
  end case;
  if c !~ '^#[0-9a-f]{6}$' then
    return null;
  end if;
  for i in 1 .. array_length(pal, 1) loop
    continue when i % 14 = 0;  -- the grey column
    d := (('x' || substr(c, 2, 2))::bit(8)::int - ('x' || substr(pal[i], 2, 2))::bit(8)::int) ^ 2
       + (('x' || substr(c, 4, 2))::bit(8)::int - ('x' || substr(pal[i], 4, 2))::bit(8)::int) ^ 2
       + (('x' || substr(c, 6, 2))::bit(8)::int - ('x' || substr(pal[i], 6, 2))::bit(8)::int) ^ 2;
    if best_d is null or d < best_d then
      best_d := d;
      best := pal[i];
    end if;
  end loop;
  return best;
end;
$body$;

create or replace function color_slot_normalise() returns trigger
language plpgsql set search_path = public, pg_temp as $body$
begin
  new.color := color_live_hex(new.color);
  return new;
end;
$body$;

update structure_elements set color = color_live_hex(color) where color is distinct from color_live_hex(color);
update elements set color = color_live_hex(color) where color is distinct from color_live_hex(color);

commit;
