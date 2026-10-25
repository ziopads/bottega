-- 031: element colours are Live's. Run on a database built to 31.
\set ON_ERROR_STOP 1
do $t$
declare
  pal text[] := live_palette();
  n int;
  v text;
begin
  if array_length(pal, 1) <> 70 then raise exception 'Live has 70 colours, got %', array_length(pal, 1); end if;
  raise notice 'ok: 70 colours';
  if color_live_hex(pal[24]) <> pal[24] or color_live_hex(upper(pal[1])) <> pal[1] then raise exception 'a Live colour should pass through'; end if;
  raise notice 'ok: a Live colour passes through';
  -- The seeded and slot colours take the suggested Live colours by element.
  if color_live_hex('#b5543c') <> pal[24] or color_live_hex('#e34948') <> pal[24] then raise exception 'TACTUS should take Live 23'; end if;
  if color_live_hex('#3d5a80') <> pal[15] or color_live_hex('#c46a8a') <> pal[29] then raise exception 'BASS and VOX should take Live 14 and 28'; end if;
  raise notice 'ok: seeded and slot colours take the suggested ones';
  select count(distinct color_live_hex(c)) into n
    from unnest(array['#b5543c', '#3d5a80', '#6b8f71', '#c49a1f', '#8a6fa8', '#c46a8a', '#4f8a8b', '#a0522d']) c;
  if n <> 8 then raise exception 'the eight seeded and spare colours should stay eight, got %', n; end if;
  raise notice 'ok: eight stay eight';
  -- Others go to the nearest colour that is not a grey.
  v := color_live_hex('#7c7c7c');
  if v = any(array[pal[14], pal[28], pal[42], pal[56], pal[70]]) then raise exception 'a grey should not be chosen, got %', v; end if;
  raise notice 'ok: greys are left out of nearest';
  if color_live_hex(null) is not null then raise exception 'null stays null'; end if;
  raise notice 'ok: none stays none';
  select count(*) into n from structure_elements where color is not null and color <> all(pal);
  if n <> 0 then raise exception '% template colours are not Live colours', n; end if;
  raise notice 'ok: template colours are Live colours';
  update structure_elements set color = '#123456' where id = (select min(id) from structure_elements where color is not null);
  select color into v from structure_elements where id = (select min(id) from structure_elements where color is not null);
  if not (v = any(pal)) then raise exception 'a colour written later should become a Live colour, got %', v; end if;
  raise notice 'ok: the trigger moves a colour written later';
end;
$t$;
