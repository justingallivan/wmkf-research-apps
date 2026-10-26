---
title: Deliberation-distribution defaults — release verification
domain: workbench
kind: audit
status: active
summary: "PR #529 released reviewed runtime 1215cfd7d as 7f2a6e9c8; full CI, Production READY and signed-in read-only composer smoke passed. No live preference writes, sends or database work."
owner: product-engineering
related:
  - docs/audits/DISTRIBUTION_DEFAULTS_BUILD_2026-10-25.md
  - docs/plans/PERSONAL_EMAIL_DISTRIBUTION_DEFAULTS_PLAN_2026-10-25.md
---

# Release verification — 2026-10-25

[VERIFIED via GitHub PR/checks, Vercel CLI deployment metadata and signed-in
Chrome production UI.] The owner explicitly authorized release after independent
Claude review. [PR #529](https://github.com/justingallivan/wmkf-research-apps/pull/529)
merged at 2026-10-26T00:25:53Z as
`7f2a6e9c8bfa3332cb1d8f4ae662779f4e606764` (October 25 Pacific).
The reviewed feature runtime remains identical to `1215cfd7d4151f5df628e0795b16c178b8a6af37`.

## Integration and checks

Integrated main `e16eba2f9`; GitHub merge also preserved Claude's subsequently
committed `23feaf53d` request-file-corpus work. The only post-review feature change
was test-only commit `a048d0cc8`, naming a mocked React component to satisfy full
ESLint. Full lint passed with zero errors. No runtime review findings remain open.

GitHub Tests run **40248557117** passed: **1471 suites / 25390 tests**, with
22 suites / 276 tests skipped; isolated Postgres tests **10 suites / 130 tests**
passed. Build and repository gates passed. Playwright run **40248557248**, security
checks, ordinary automated Claude review and Vercel preview all passed.
Local integrated checks also passed (13 suites / 465 tests, types and scoped gates).

## Production evidence

| Claim | Authoritative evidence | Status |
| --- | --- | --- |
| Exact released source | PR merge plus runtime-path comparison with reviewed 1215cfd7d | VERIFIED |
| Deployment | `dpl_DXRRXp44Q7HZBRGL5B2PefBT1eoD`, commit 7f2a6e9c8, target Production, READY | VERIFIED |
| Canonical alias | `https://applications.wmkeck.org` assigned to the released deployment | VERIFIED |
| Signed-in consumer | Reloaded Staff Deliberations on an existing TEST request after READY; own-default editor loaded shared fallback with enabled Save and disabled Clear | VERIFIED |
| Discard/reopen | Local draft edit → Close warning → Keep editing retained edit; explicit discard closed; reopen restored fresh shared defaults and recipient suggestions; clean Close needed no warning | VERIFIED |
| Unauthenticated guard | GET preference route redirected 307 to sign-in, `Cache-Control: no-store, max-age=0` | VERIFIED; proxy interception, not a route 401 claim |
| Runtime errors | Deployment-scoped `level:error` scan, 00:25:53Z–00:30:27.034Z: zero entries, no excluded intervals or further pages | VERIFIED for this bounded window |

Immutable deployment URL:
`https://wmkfresearchapps-ht60llvl5-justin-gallivans-projects.vercel.app`.
No production Save/Clear, preview preparation, send, shared-setting write, migration,
seed, environment edit or database probe was performed. Live mutation acceptance
and inbox delivery are not claimed. Recovery limits remain in the build audit.

## Rollback and scope

Last known good immediately before release: `23feaf53dc4986e263fa405e0df8b21b2c227187`,
READY deployment `dpl_FgBWdfvJgV6gRa1pa2oKG2bF2Etj`, URL
`https://wmkfresearchapps-ikn1ny1og-justin-gallivans-projects.vercel.app`.
If required, promote that deployment using the existing Vercel project
`wmkf_research_apps`, scope `justin-gallivans-projects`; no data rollback is needed.
Rollback was not executed. Claude's separate checkout and database work were untouched.

## Bounded sweep (Mode A)

Changed fact: slice 7 is released and Production verified. The existing build audit
traces caller → existing Dataverse preferences → composer; this receipt adds Git,
deployment and live consumer evidence. Seven current restatement files (build,
plan, TODO, inventory, route matrix, Atlas and service catalog) were structurally
updated. Four implementation/plan review search hits remain HISTORICAL verbatim
receipts; unrelated email/database statuses remain UNRELATED and unchanged.
September inventory counts and original plan baseline remain historical.
The disconfirming check was comparison of deployed commit/runtime paths against the
reviewed fingerprint, plus fresh signed-in reopen; neither showed drift.
Remaining live stale release claims in this bounded surface: zero. Live mutation
acceptance remains UNKNOWN; it was deliberately excluded from this read-only smoke.
Relevant documentation gates and paired self-tests are required before this receipt
lands. This is a bounded release reconciliation, not a whole-repository audit.
