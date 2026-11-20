# BATA AI-SQA Audit Report

> Fill in every section. Leave none blank — if something wasn't checked,
> say so explicitly in "Inaccessible / Untested" rather than omitting it.
> Do not mark anything ✅ Passed unless it was actually run this session.

## Metadata

| Field | Value |
|---|---|
| Date | |
| Mode | Audit Only / Audit & Fix |
| Branch audited | |
| Branch for fixes (Audit & Fix only) | |
| Scope requested | full / area: ___ |
| Tools actually available this session | (browser/preview tool used, or "none — static code review only") |

## Executive summary

2–5 sentences: overall health, the most severe findings, and the biggest
gap in coverage (what couldn't be tested and why it matters).

## Scope & routes covered

| Menu / route (`data-view`) | Backed by | Tested? | Notes |
|---|---|---|---|
| home / dashboard | `bata-warehouse-3d.bundle.js` | | |
| receive | (placeholder) | | |
| dispatch | `/api/receiving` (excl. `receiver=57702`) | | |
| transfer | `/api/dispatch` | | |
| return | `/api/receiving-return` (`receiver=57702` only) | | |
| shipment | `shipment-status.js` | | |
| transport | | | |
| stockcount | (placeholder) | | |
| stockaudit | (placeholder) | | |
| bulklocation | (placeholder) | | |
| stockonhand | (no live source) | | |
| recheckscan | | | |
| ocrdoc / returnocr | | | |
| outboundplan | | | |
| issue | | | |
| stockmovement | | | |
| reports / history / alerts | | | |
| master / users / permissions | | | |
| reconcile (กระทบยอด) | Supabase-only | | |
| regroup-check.html (standalone, no login) | `regroup-check.js` | | |

(Add/remove rows to match what's actually in `Index/index.html` at audit
time — this table is a starting point, not a fixed list.)

## Methodology

What was actually done: code read, app launched (how — `run` skill,
manual `npm run start:api`, etc.), browser tool used for navigation/
screenshots, specific test inputs used (dates, invoices, roles), and what
was explicitly *not* attempted and why (e.g. "no LAN/VPN access to
`192.1.36.59` from this session").

## Findings

One row per finding, most severe first. `Repro` must be concrete steps
someone else could follow. `Evidence` must point at a screenshot, console
log excerpt, or exact file:line — not a general impression.

| # | Severity | Area | File:Line | Summary | Evidence | Repro steps | Recommended fix |
|---|---|---|---|---|---|---|---|
| 1 | Critical/High/Medium/Low | UI / 3D / Functional / Responsive / Security / Performance | | | | | |

### Finding detail (expand each numbered finding if the table cell is too short)

#### Finding #1 — <title>
- **Severity**: 
- **Area**: 
- **Location**: `path/to/file:line`
- **What's wrong**: 
- **Evidence**: (screenshot filename/path, console output, measured number)
- **Reproduction steps**:
  1. 
- **Impact**: 
- **Recommended fix**: 
- **Status**: Open (Audit Only) / Approved for fix / Fixed — commit `<sha>` on `<branch>` / Declined by user

## 3D visualization results

- Confirmed tech/version: three.js `0.128.0` + OrbitControls (re-verify
  still true — this is pinned deliberately, see `docs/3d/README.md`)
- Scenes tested: (list `data-scene` values actually exercised)
- Real-vs-simulated labeling check: Pass/Fail/Not checked, with evidence
- Camera/scale/position notes: 
- Lighting notes (shadow quality, color accuracy vs. design reference): 
- WebGL fallback actually tested: Yes/No — result
- Performance: load time measured = ___, memory behavior after repeated
  menu switching = ___

## Responsive results

| Viewport | Page layout OK? | 3D HUD OK? | Notes |
|---|---|---|---|
| 1920×1080 | | | |
| 1366×768 | | | |
| 1024×768 (tablet landscape) | | | |
| 768×1024 (tablet portrait) | | | |
| 390×844 (phone portrait) | | | |
| 844×390 (phone landscape) | | | |

Resize/orientation-change behavior (not just fresh load): 

## Security findings summary

(Cross-reference the Findings table above; this section is a quick-read
rollup, not a duplicate of full detail.)

- Public exposure check (api-server.js reachability): 
- MySQL write-statement check (should be zero): 
- Secret-leak check (`.env.example`, `Index/index.html`, git history): 
- RLS/role-gating check: 
- SQL injection-shaped query check: 

## Performance findings summary

- MySQL query date-filtering check: 
- 3D bundle load cost (measured): 
- Supabase 1000-row cap check: 
- Sync cadence sanity check: 

## Inaccessible / Untested

List every page, role, or check that could not be run this session, with
the specific reason (missing credential, no LAN/VPN, no browser tool, no
current-month Regroup workbook, etc.). This section must never be empty
unless every single check in every reference file was actually completed
— state that explicitly if true.

## Appendix

- Screenshots taken (filenames/paths and what each shows)
- Console errors/warnings observed (verbatim, with the view they occurred
  in)
- Any commands run for evidence-gathering (e.g. devtools performance
  trace steps) and their raw output
