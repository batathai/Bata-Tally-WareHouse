# Security & performance audit reference

This is read-only reconnaissance: inspect code, config shape, and observed
behavior. Never attempt to actually exploit a finding (no real SQL
injection payloads against the live MySQL/Supabase, no attempts to reach
`api-server.js` from outside the LAN/VPN to "prove" it's exposed, no
credential brute-forcing). Describe the risk and how you'd verify it
safely if a deeper check needs user approval or a controlled environment.

## Architecture facts that shape the threat model (from CLAUDE.md — verify current, don't assume stale)

- **`api-server.js` has no auth of its own by design** — it's meant to be
  reachable only from the office LAN or over the company VPN. It is **not**
  supposed to be reachable from the public internet, ever. Verify:
  - No `CNAME`/public-deployment artifact has reappeared (one existed
    historically for the old GitHub Pages setup at `tms.batathai.com` and
    was deliberately removed — check it hasn't been re-added without the
    user's sign-off, since CLAUDE.md explicitly says to check with the
    user before re-adding one).
  - No code path forwards `/api/*` responses to a public static host, and
    nothing in the repo suggests machine B's port 3001 is reverse-proxied
    to the public internet.
  - This is a **Critical** finding class if ever found true — a LAN-only,
    no-auth API exposed publicly would let anyone query the live
    `reporting` MySQL database through it.
- **The MySQL credential (`talend`) has `ALL PRIVILEGES` on `reporting`**
  even though this app only reads. Confirm every query built in
  `api-server.js` (and `shipment-status.js`, `article-trace.js`,
  `wh-trace.js`, `regroup-check.js`) is a `SELECT` — any `INSERT`/`UPDATE`/
  `DELETE`/DDL statement anywhere in this codebase against MySQL is a
  Critical finding regardless of whether it's reachable today, since the
  credential *can* do it.
- **Supabase keys**: `Index/index.html` is public-facing (committed to a
  public repo) and must only ever embed the new-format **publishable**
  key (`sb_publishable_...`) or legacy `anon` key — never `service_role`/
  `sb_secret_...`. Grep for `sb_secret_` and `service_role` as literal
  key-shaped strings (a JWT or `sb_secret_` prefix followed by random
  characters) — a plain code *comment* warning not to do this (as exists
  today, "never put the service_role key here") is not itself a finding.
  Also check `.env.example` contains only placeholders — a real secret was
  accidentally committed there once before (CHANGELOG, 2026-09-17/18) and
  the exposure is permanent in git history even though it was rotated;
  confirm it hasn't happened again.
- **Supabase RLS**: for any view that reads Supabase directly from the
  client (most of the app except live Dispatch/Transfer/Return), confirm
  row-level-security policies actually scope data by role rather than
  relying on the UI to hide things — a hidden menu item is not access
  control.

## Query-construction safety (SQL injection surface)

`api-server.js`'s `buildQuery`/`buildWhere`/`buildCountQuery`/
`buildDailyQuery` and the sibling modules construct MySQL queries from
`req.query` input (e.g. `invoice`, date range, filters). For each such
function:
- Confirm parameterized queries (`?` placeholders + a `params` array
  passed to `mysql2`, not string concatenation of raw `req.query` values
  into SQL text).
- Confirm any value used to build a column/table name dynamically (if
  any) is drawn from a fixed allowlist, never directly from user input.
- Test with a deliberately malformed but non-destructive input (e.g. an
  `invoice` value containing a quote or SQL metacharacter) and confirm it
  either errors safely or is treated as a literal string — never attempt
  a payload designed to actually alter or exfiltrate unintended data.

## Row-limit / data-integrity-as-security check

Supabase/PostgREST's default 1000-row cap (see `functional-testing.md`)
is also a security-adjacent finding when it causes a view to silently
under-report inventory or shipment totals — flag any query over
`dispatch`/`receiving` lacking an explicit `.limit()` well above daily
volume or a separate `{ count: 'exact' }` as Medium/High depending on
which view it affects (a KPI dashboard undercounting is more severe than
a detail list).

## Dependency and config hygiene

- `package.json` dependencies (`@supabase/supabase-js`, `dotenv`,
  `express`, `mssql`, `mysql2`, `node-cron`, `xlsx`): check pinned
  versions against known advisories for those packages/versions (without
  running an actual exploit) — report version numbers found and whether
  they're current, not a guess.
- `.env`/`.env.example` hygiene per repo convention: `.env` must stay
  git-ignored (`.gitignore` should list it — verify), `.env.example` must
  only contain placeholders.
- Error handling: confirm API error responses don't leak stack traces,
  file paths, or credential fragments to the client — check
  `api-server.js`'s error-handling middleware/catch blocks.
- Logging: NSSM service logs live in `D:\Project\Bata-WMS\logs\` on
  machine B (not reachable from this session) — note in the report that
  log-content review is out of scope/inaccessible unless the user attaches
  machine B.

## Performance

- **MySQL query scoping**: `dispatch` (~1.5M rows) and `receiving`
  (~4.9M rows) grow daily; every query against them must filter by
  `documentDate`/`document_date`. Grep for any query path that could run
  unfiltered (e.g. a missing default date range, a filter that's
  optional and silently dropped when absent) and flag as a performance/
  availability risk — an accidental full scan against a live, shared
  MySQL server affects other systems too, not just this app.
- **3D bundle load cost**: see `3d-visualization-audit.md`'s performance
  section — both 3D bundles load unconditionally on every page load
  regardless of whether the user opens any menu that uses them; measure
  and report actual load/parse time, not just file size.
- **Sync cadence**: `sync.js`'s `SCHEDULE` (`['0 8 * * *', '0 12 * * *']`)
  is tuned to the Talend load window (07:00–07:45) — this is a confirmed-
  correct, intentional schedule, not a performance bug; don't flag it
  without first checking whether the Talend schedule itself has changed
  (CLAUDE.md notes a request to IT is pending).
- **Frontend polling**: check whether any live view polls on an interval
  and, if so, whether the interval is reasonable given MySQL is queried
  directly on every request (no caching layer in front of it for live
  views) — an aggressive poll interval directly increases load on a
  shared, LAN-only MySQL server.

## Severity guidance specific to this app

- **Critical**: public exposure of `api-server.js`, any MySQL write
  statement in app code, a leaked real secret (not a comment), RLS
  missing/misconfigured on a role-sensitive Supabase table.
- **High**: SQL injection-shaped query construction (even if not
  currently exploitable), an unfiltered full-table-scan query path against
  live MySQL, a 1000-row cap silently truncating a financial/stock KPI.
- **Medium**: outdated dependency with a known but hard-to-reach
  advisory, verbose error responses leaking internal paths, unconditional
  heavy asset loading with a measurable but non-blocking cost.
- **Low**: cosmetic inconsistency, a documented/intentional tradeoff worth
  re-confirming with the user, missing-but-low-risk hardening.
