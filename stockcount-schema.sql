-- ══════════════════════════════════════════════════════════════════
-- Bata WMS — ตรวจนับสต็อก (Stock count) schema
--
-- Backs the "ตรวจนับสต็อก" dashboard (Index/stockcount-dashboard.js) and,
-- later, the operator mobile count page. Supabase-only (no MySQL).
--
-- Run this ONCE in Supabase → SQL Editor. Requires `profiles` from
-- auth-and-roles.sql. Safe to re-run.
--
-- Master data (sc_locations, sc_articles) is NOT in this file and must
-- never be committed to this public repo — import it privately as CSV
-- through Supabase → Table Editor → Import.
--
-- Rules implemented (confirmed by the warehouse manager):
--   • Round 1 and round 2 must be EXACTLY equal to match.
--   • If they differ, a supervisor picks individual items to recount in
--     round 3 (sc_recounts); if round 3 matches neither, round 4. Max 4.
--   • Size position 1–13 (`pos`) → UK size via the Article's size group
--     (A–F; group E = single position 1, counted in pieces).
-- ════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ─── sc_cycles: one row per stock-count campaign ─────────────────
create table if not exists sc_cycles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  started_on  date not null,
  total_days  integer not null default 4,
  status      text not null default 'open' check (status in ('open', 'closed')),
  created_at  timestamptz not null default now()
);

-- ─── sc_locations: master list of Locations (private import) ──────
-- code e.g. "A-01-01-1"; rack = first segment.
create table if not exists sc_locations (
  code  text primary key,
  rack  text generated always as (split_part(code, '-', 1)) stored,
  note  text
);
create index if not exists idx_sc_locations_rack on sc_locations (rack);

-- ─── sc_articles: Article master with size group (private import) ──
create table if not exists sc_articles (
  article7    text primary key check (article7 ~ '^[0-9]{7}$'),
  name        text,
  size_group  text check (size_group in ('A','B','C','D','E','F')),
  brand       text,
  price       numeric(12,2)
);

-- ─── sc_counts: one row per Location × Article × size position × round
-- `client_record_id` is generated on the phone so the offline queue can
-- re-send safely; the unique key means re-keying a cell in the same
-- round replaces it (upsert) instead of double counting.
create table if not exists sc_counts (
  id                bigserial primary key,
  client_record_id  uuid not null unique,
  cycle_id          uuid not null references sc_cycles(id) on delete cascade,
  round             smallint not null check (round between 1 and 4),
  location_code     text not null,
  article7          text not null,
  pos               smallint not null check (pos between 1 and 13),
  qty               integer not null check (qty >= 0),
  operator_id       uuid references auth.users(id),
  operator_name     text,
  counted_at        timestamptz not null,       -- time on the phone
  received_at       timestamptz not null default now(),
  unique (cycle_id, round, location_code, article7, pos)
);
create index if not exists idx_sc_counts_loc on sc_counts (cycle_id, location_code);
create index if not exists idx_sc_counts_recent on sc_counts (cycle_id, received_at desc);

-- ─── sc_location_rounds: a Location closed for a round ────────────
create table if not exists sc_location_rounds (
  cycle_id       uuid not null references sc_cycles(id) on delete cascade,
  location_code  text not null,
  round          smallint not null check (round between 1 and 4),
  closed_by      uuid references auth.users(id),
  closed_by_name text,
  closed_at      timestamptz not null default now(),
  primary key (cycle_id, location_code, round)
);

-- ─── sc_recounts: items a supervisor ordered to recount ───────────
create table if not exists sc_recounts (
  id             bigserial primary key,
  cycle_id       uuid not null references sc_cycles(id) on delete cascade,
  round          smallint not null check (round in (3, 4)),
  location_code  text not null,
  article7       text not null,
  pos            smallint not null check (pos between 1 and 13),
  requested_by   uuid references auth.users(id),
  requested_at   timestamptz not null default now(),
  unique (cycle_id, round, location_code, article7, pos)
);

-- ─── Views (security_invoker → RLS of the caller applies) ─────────
-- Status per item: g = done, b = counting, a = waiting recount,
-- r = difference found (no recount ordered yet).
create or replace view sc_item_status with (security_invoker = true) as
with c as (
  select cycle_id, location_code, article7, pos,
         max(qty) filter (where round = 1) as r1,
         max(qty) filter (where round = 2) as r2,
         max(qty) filter (where round = 3) as r3,
         max(qty) filter (where round = 4) as r4
  from sc_counts
  group by cycle_id, location_code, article7, pos
)
select c.*,
       split_part(c.location_code, '-', 1) as rack,
       a.name, a.size_group, a.price,
       coalesce(c.r4, c.r3, c.r2, c.r1) as final_qty,
       case
         when c.r4 is not null then 'g'
         when c.r3 is not null and c.r3 in (c.r1, c.r2) then 'g'
         when c.r3 is not null then
           case when exists (select 1 from sc_recounts x where x.cycle_id = c.cycle_id and x.location_code = c.location_code and x.article7 = c.article7 and x.pos = c.pos and x.round = 4) then 'a' else 'r' end
         when c.r1 is not null and c.r2 is not null then
           case when c.r1 = c.r2 then 'g'
                when exists (select 1 from sc_recounts x where x.cycle_id = c.cycle_id and x.location_code = c.location_code and x.article7 = c.article7 and x.pos = c.pos and x.round = 3) then 'a'
                else 'r' end
         else 'b'
       end as st
from c
left join sc_articles a on a.article7 = c.article7;

-- Status per Location (n = not started).
create or replace view sc_location_status with (security_invoker = true) as
select cy.id as cycle_id, l.code as location_code, l.rack,
       case
         when coalesce(s.has_r, false) then 'r'
         when coalesce(s.has_a, false) then 'a'
         when s.items is null then 'n'
         when s.items = s.items_g and coalesce(lr.max_round, 0) >= 2 then 'g'
         else 'b'
       end as st,
       coalesce(s.pairs, 0) as pairs,
       coalesce(lr.l1, false) as l1, coalesce(lr.l2, false) as l2,
       coalesce(lr.l3, false) as l3, coalesce(lr.l4, false) as l4
from sc_cycles cy
cross join sc_locations l
left join (
  select cycle_id, location_code, count(*) as items,
         count(*) filter (where st = 'g') as items_g,
         bool_or(st = 'r') as has_r, bool_or(st = 'a') as has_a,
         sum(final_qty) as pairs
  from sc_item_status group by cycle_id, location_code
) s on s.cycle_id = cy.id and s.location_code = l.code
left join (
  select cycle_id, location_code, max(round) as max_round,
         bool_or(round = 1) as l1, bool_or(round = 2) as l2,
         bool_or(round = 3) as l3, bool_or(round = 4) as l4
  from sc_location_rounds group by cycle_id, location_code
) lr on lr.cycle_id = cy.id and lr.location_code = l.code;

-- One row per Rack (what the dashboard's Rack map reads).
create or replace view sc_rack_summary with (security_invoker = true) as
select cycle_id, rack,
       count(*)                      as total,
       count(*) filter (where st = 'g') as g,
       count(*) filter (where st = 'b') as b,
       count(*) filter (where st = 'a') as a,
       count(*) filter (where st = 'r') as r,
       count(*) filter (where st = 'n') as n,
       sum(pairs)                    as pairs,
       count(*) filter (where l1)    as l1,
       count(*) filter (where l2)    as l2,
       count(*) filter (where l3)    as l3,
       count(*) filter (where l4)    as l4
from sc_location_status
group by cycle_id, rack;

-- Locations closed per day and round (Asia/Bangkok).
create or replace view sc_daily with (security_invoker = true) as
select cycle_id,
       (closed_at at time zone 'Asia/Bangkok')::date as day,
       round, count(*) as locations
from sc_location_rounds
group by 1, 2, 3;

-- Operator output per day (Asia/Bangkok).
create or replace view sc_operator_daily with (security_invoker = true) as
select cycle_id,
       (received_at at time zone 'Asia/Bangkok')::date as day,
       coalesce(operator_name, 'ไม่ระบุ') as operator_name,
       count(*) as records, sum(qty) as pieces,
       count(distinct location_code) as locations
from sc_counts
group by 1, 2, 3;

-- ─── Row Level Security ──────────────────────────────────────────
-- Same gate as the rest of the app: any signed-in user reads,
-- admin / warehouse_staff write. (Count rows and location rounds are
-- written by the operators' phones, who must be warehouse_staff.)
alter table sc_cycles          enable row level security;
alter table sc_locations       enable row level security;
alter table sc_articles        enable row level security;
alter table sc_counts          enable row level security;
alter table sc_location_rounds enable row level security;
alter table sc_recounts        enable row level security;

do $$
declare t text;
begin
  foreach t in array array['sc_cycles','sc_locations','sc_articles','sc_counts','sc_location_rounds','sc_recounts']
  loop
    execute format('drop policy if exists "%s read" on %I', t, t);
    execute format('create policy "%s read" on %I for select using (auth.role() = ''authenticated'')', t, t);
    execute format('drop policy if exists "%s write" on %I', t, t);
    execute format('create policy "%s write" on %I for all using (public.my_role() in (''admin'',''warehouse_staff'')) with check (public.my_role() in (''admin'',''warehouse_staff''))', t, t);
  end loop;
end $$;

-- ─── Start a cycle (example) ─────────────────────────────────────
-- insert into sc_cycles (name, started_on) values ('ตรวจนับประจำปี 2026', '2026-11-16');
