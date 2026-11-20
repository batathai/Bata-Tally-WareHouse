---
name: bata-ai-sqa
description: Software quality audit for Bata WMS — enumerates routes/menus, audits the 3D warehouse visualization, functional behavior, responsive layout, security and performance, and writes a findings report with file paths, severity and evidence. Defaults to read-only "Audit Only"; a separate "Audit & Fix" mode exists but requires explicit user approval and a dedicated git branch before touching any source file. Use when the user types /bata-ai-sqa or asks for a QA audit, SQA review, or quality check of the Bata WMS app.
---

# BATA AI-SQA

A reusable, project-level QA skill for **Bata WMS** (this repository). It audits
the real application — `Index/index.html` and the live-view backend
(`api-server.js` + its registered modules) — against what `CLAUDE.md` and
`DEPLOYMENT.md` say the system is supposed to do, and reports concrete,
evidenced findings. It does not guess at generic web-app best practice in a
vacuum; every reference file below is written against this repo's actual
routes, 3D tech, data quirks and deployment constraints.

Invoke as **`/bata-ai-sqa`**. Optional arguments:

- `/bata-ai-sqa` — full Audit Only pass over everything in scope.
- `/bata-ai-sqa <area>` — scope to one area: `ui`, `3d`, `functional`,
  `responsive`, `security`, `performance`, or a menu name (e.g. `transfer`,
  `regroup-check`, `reconcile`).
- `/bata-ai-sqa fix` — enter **Audit & Fix** mode (see below). Still requires
  explicit approval before any edit; this flag only signals intent to move
  past reporting if the user confirms.

## Hard rules (apply in every mode, no exceptions)

1. **Audit Only is the default and the safe mode.** Unless the user has
   explicitly approved Audit & Fix for a specific finding in this session,
   do not edit any file under `Index/`, `docs/3d/src/`, `api-server.js`,
   `sync.js`, `*.js` modules, `*.sql` schema files, `.env`, or any config.
   Producing/updating the audit report in a new file under this skill's own
   output location (see Reporting) is not a source change and is always
   allowed.
2. **Never write to MySQL.** The `reporting` MySQL database is LAN-only,
   shared with other systems, and the credential in `.env` (`talend`) has
   `ALL PRIVILEGES` even though the app only ever reads. Functional tests
   must be read-only queries/UI navigation only — never `INSERT`/`UPDATE`/
   `DELETE`, never schema changes, never via Navicat or any ad-hoc client.
3. **Never write production data in Supabase either**, including for
   "safe" write tests. `reconcile_batches`/`reconcile_items`/`reconcile_scans`/
   `reconcile_history` are real operational data (กระทบยอด), not a sandbox.
   If a write path genuinely needs exercising, that requires Audit & Fix
   approval, a dedicated obviously-fake record (e.g. `batch_code` prefixed
   `SQA-TEST-`), and the user's explicit sign-off that it's acceptable to
   leave a trace — default to not doing it at all and reporting it as
   **untested, by design**.
4. **Never deploy.** Nothing here copies files to machine B, restarts
   `BataWMS`/`BataSync`, or touches the server at `192.1.36.59`. This skill
   has no deploy step in either mode.
5. **Never install MCP servers, plugins, packages, or run `npm install`
   with new dependencies** as part of this skill, now or when it runs later,
   unless the user asks for that separately and outside of an audit.
6. **Never commit or push.** Audit Only never touches git state at all.
   Audit & Fix creates a branch and commits to it only after the user has
   approved both the fix and the branch (see below) — it still never pushes
   or opens a PR unless the user separately asks for that.
7. **Don't claim a test passed unless you actually ran it.** If a page
   couldn't be reached (needs a login you don't have, needs the LAN/VPN,
   needs machine B, needs a browser tool that isn't available in this
   session), say so explicitly under "Inaccessible / Untested" — never mark
   it ✅ by inference from reading the code.
8. **This repo is public.** Never print, log, or write real credentials
   (MySQL password, Supabase `service_role`/`sb_secret_...` key, VPN
   details, SQL Server/`IS_Warehouse` credentials) into the audit report or
   anywhere else. If you find one accidentally committed, report the
   *location* and severity (Critical) without repeating the secret value.

## Workflow (Audit Only)

1. **Inspect before auditing.** `git status`, confirm current branch, and
   skim `CLAUDE.md`/`DEPLOYMENT.md` for anything that changed since this
   file was written (deployment model, menu→table mapping, open items).
2. **Enumerate routes and menus.** Walk `Index/index.html`'s `data-view`
   sections (as of this writing: `home`/`dashboard`, `receive`, `dispatch`,
   `transfer`, `return`, `shipment`, `transport`, `stockcount`,
   `stockaudit`, `bulklocation`, `stockonhand`, `recheckscan`, `ocrdoc`,
   `returnocr`, `outboundplan`, `issue`, `stockmovement`, `reports`,
   `history`, `alerts`, `master`, `users`, `permissions`, `reconcile`) plus
   the standalone `Index/regroup-check.html`. Note role gating
   (`data-roles`) per item. Cross-check against `api-server.js`'s `VIEWS`
   map and registered modules (`shipment-status.js`, `article-trace.js`,
   `wh-trace.js`, `regroup-check.js`) for which menus are actually
   backed by something vs. placeholder (`empty-note`, "ยังไม่ได้สร้าง UI").
3. **3D visualization audit** — see `references/3d-visualization-audit.md`.
4. **Functional testing** — see `references/functional-testing.md`.
5. **Responsive audit** — see `references/responsive-audit.md`.
6. **UI/UX audit** — see `references/ui-ux-audit.md`.
7. **Security & performance** — see `references/security-performance.md`.
8. **Write the report** using `templates/audit-report.md` as the exact
   structure. Save it as a new file (don't overwrite a prior audit) —
   suggested path: `docs/qa/bata-ai-sqa-<YYYY-MM-DD>.md` (create the `docs/qa/`
   directory if absent; this is documentation, not application code, so it
   is allowed in Audit Only mode). Tell the user where it was written.

Use whatever browser/app-preview tooling is actually available in this
session (built-in browser, Chrome extension, Playwright, or a `run` skill
that can start the app) to get real visual evidence — screenshots, console
output, network responses. If no such tool is available for a given check,
say so and mark that check as untested rather than describing an assumed
screenshot.

## Audit & Fix mode

Audit & Fix is **not** the default and must never be entered implicitly —
only when the user explicitly says so after seeing the Audit Only findings
(e.g. "fix finding #3", "go ahead and fix the critical ones"). Even then:

1. **Approval is per-finding (or an explicit named batch), not blanket.**
   Restate exactly which finding(s) you're about to fix and the planned
   change before touching anything; wait for confirmation if it wasn't
   already given in the same message.
2. **A dedicated branch is required before any edit**, created off the
   current branch (`claude/quirky-tesla-wai98v` per this repo's working
   conventions) — never commit fixes directly on the branch the audit ran
   from. Name it descriptively, e.g. `claude/sqa-fix-<short-topic>`, and
   tell the user the branch name before making changes.
3. **One finding at a time, then re-verify.** Apply the fix, re-run the
   specific audit check that found the issue (not the whole suite), and
   record the before/after in the report before moving to the next
   approved finding.
4. All the Hard Rules above still apply inside Audit & Fix — in particular,
   still no MySQL/Supabase writes, no deploy, no commit/push beyond what
   was just approved, no new dependencies.
5. Fixes stay scoped to the approved finding — no incidental refactoring,
   no drive-by cleanup, consistent with this repo's working conventions
   (don't widen scope without asking, e.g. don't touch `sync.js`/
   `api-server.js` beyond what's needed, don't touch `sync-state.json`).
6. After fixes, update the audit report's findings table status (e.g.
   `Fixed — see commit <sha> on <branch>`) rather than deleting the
   original finding — keep the audit trail.

## Reference files

| File | Covers |
|---|---|
| `references/ui-ux-audit.md` | Thai-language UI conventions, layout/consistency, accessibility, the `class="num"` convention, empty/placeholder states |
| `references/3d-visualization-audit.md` | three.js r0.128.0 scenes (`bata-warehouse-3d.bundle.js`, `bata-menus-3d.bundle.js`), camera/lighting/scale, per-scene mount points, real-vs-simulated data, WebGL fallback |
| `references/functional-testing.md` | Per-menu functional checks, `LIVE_TABLE` remap, `receiver=57702` split, regroup-check, reconcile, safe read-only test method |
| `references/responsive-audit.md` | Actual breakpoints in the codebase, devices/viewports to check, 3D canvas resize behavior |
| `references/security-performance.md` | LAN-only no-auth API, secrets handling, MySQL query safety, Supabase 1000-row cap, bundle size/load performance |
| `templates/audit-report.md` | Exact report structure to fill in and save under `docs/qa/` |

## Verifying the skill is loaded

See the final message after creation for how to confirm `/bata-ai-sqa` is
recognized in Claude Code Desktop.
