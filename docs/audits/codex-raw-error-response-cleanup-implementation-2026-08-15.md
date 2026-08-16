---
title: Raw Error Response Cleanup Implementation Record
domain: security-auth
kind: audit
status: active
summary: "Implementation and verification record for removing unexpected exception text from literal API 500/502 responses."
canonical: false
cataloged: 2026-08-15
owner: product-engineering
related:
  - docs/SECURITY_OPERATING_PLAN.md
  - docs/audits/claude-auth-side-effect-security-audit-2026-08-15.md
  - pages/api/
  - tests/unit/api-error-response-hygiene.test.js
---

# Raw Error Response Cleanup — Implementation Record

Date: 2026-08-15  
Branch: `codex/raw-error-message-cleanup`  
Base: `fb735651`  
Status: implemented and adversarially self-reviewed; not merged or deployed

## Scope and authoritative inventory

This closes finding 6 from the dated auth/side-effect audit. A Babel AST scan over every
`pages/api/**/*.js` file established the starting inventory from source, rather than copying the
audit count: 28 literal `res.status(500|502).json(...)` responses exposed `.message` or the
historical `msg` alias without a development-only guard.

| Audience | Starting sites | Result |
|---|---:|---|
| Superuser/admin | 7 | Generic unexpected-failure response |
| Cron | 17 | Generic unexpected-failure response |
| Staff app-auth | 3 | Generic unexpected-failure response |
| Internal HMAC | 1 | Generic unexpected-failure response |
| **Total** | **28** | **0 unguarded disclosures after edit** |

The same scan identified 45 `.message` values already protected by an explicit
`NODE_ENV === 'development'` conditional. Those are intentionally unchanged. Dynamic-status
structured service errors are also unchanged: known validation/service error bodies remain part of
their established client contract and are not reclassified as unexpected failures.

## Whole-flow contract reconciliation (Mode B)

Persistence is N/A for the response sanitization itself. Existing server logs, maintenance-run
records, and the BILL operator alert remain the diagnostic consumers of the real exception.

| Invariant | Evidence on the changed tree | Result |
|---|---|---|
| Unexpected literal 500/502 bodies expose no exception text | Whole-API AST regression scan | Held |
| Status codes and response envelope keys remain stable | Route diffs; focused route tests | Held |
| Known structured service/validation errors remain unchanged | Dynamic-status calls excluded and source-inspected | Held |
| Development-only diagnostics remain available | 45 guarded source occurrences; positive allow fixture | Held |
| Operators retain the underlying exception | Existing logs/records/alerts preserved; missing `summarize-v2` log added and tested | Held |
| Authentication, authorization, and persistence behavior do not change | Only terminal catch responses changed | Held |

Complement/fall-through checks:

- A direct `.message`, optional `.message`, a multiline `msg` alias, stringified exception, and
  template interpolation each make the guard self-test fail.
- A structurally guarded development detail remains allowed.
- A dynamic `ServiceHttpError` status/body remains allowed and unchanged.
- Internal diagnostic uses of `.message` outside response bodies remain untouched.
- Non-500 validation/auth responses remain untouched.

## Additional source-hygiene correction

`pages/api/cron/pricing-refresh.js` contained three literal NUL bytes in a composite-key comment,
construction, and split delimiter. They are now written as escaped `\u0000` source sequences.
JavaScript evaluates the escape to the same NUL delimiter at runtime, preserving composite-key
semantics while restoring ordinary text diffs and searches. A printable delimiter was not used,
so no new collision class is introduced.

## Durable-surface sweep (Mode A)

Claim: the 28-site disclosure inventory changed from live/open to implemented on this branch.

Authoritative evidence is the changed route source plus the parser-backed whole-API test. Durable
surfaces searched: `docs/**`, `.claude-memory/**`, `docs/agent-wiki/**`, `CLAUDE.md`,
`SESSION_PROMPT.md`, rules/skills, route sources, and tests. The dated Claude audit remains a
historical record of the pre-fix state. `docs/SECURITY_ARCHITECTURE.md` and archived security
reports are historical snapshots. Current operating guidance and the session handoff are updated.
The API security matrix is unchanged because caller classes, guards, data boundaries, methods,
statuses, and persistence effects did not change. No wiki, memory, instruction, or Atlas contract
changed.

Sweep result:

- Mode: A — changed fact.
- Claims: 4 VERIFIED (starting inventory, zero post-edit disclosures, preserved operator
  diagnostics, preserved guarded/structured responses); 0 PARTIAL, PLANNED, ASSUMED,
  STALE-CONFLICT, or UNKNOWN.
- Targeted durable-restatement hits: 14 → 11 AGREE, 0 STALE, 3 HISTORICAL, 0 UNRELATED. The three
  historical hits are the dated source audit's pre-fix finding. Broader semantic searches found
  only unrelated uses of “error message” and explicitly historical/archive security reports.
- Structural fixes: added one current-state operating-plan section and reconciled the session
  handoff; retained the dated source audit unchanged as historical evidence.
- Semantic omission found and fixed: current operating guidance previously had no disposition for
  the dated 28-site finding.
- Disconfirming checks: re-searched ordinary, optional, aliased, interpolated, and stringified
  exception forms in route responses; remaining optional-message hits are server logs or an
  explicit development-only response.
- Remaining live STALE: 0. Remaining UNKNOWN/ASSUMED: 0.
- Verdict: RECONCILED for this changed fact and the named durable surfaces.

## Verification

- Focused changed-response/security suites: 9 suites, 63/63 tests passed before the final scanner
  hardening; the final scanner suite independently passed after optional-member and stringification
  self-tests were added. The BILL 500/alert test passed separately (1/1).
- Full `tests/unit` + `tests/integration`: 8,232/8,234 tests passed. The only two failures are the
  repository's documented main baselines (`reconcile-probe-entity-set-count` stale expected count
  and `notification-trust-model-pushup` reviewer-reminder fixture), previously recorded in the
  Stage 1 and Stage 2 Workbench implementation records. The changed BILL test passes when selected.
- `check:api-routes` + self-test: passed; all 157 route files covered.
- `check:types`: passed.
- `check:secret-scan`, `check:doc-currency`, `check:fact-consistency`,
  `check:canonical-pointers`, `check:doc-symbol-refs`, and `check:build-claim-freshness`, each
  followed sequentially by its self-test: passed. `check:docs-catalog`: passed.
- Lint: 0 errors, 65 pre-existing warnings.
- Standard `npm run build`: TypeScript passed, then Turbopack was blocked twice by the execution
  environment from binding its local worker port (`EPERM`), including the approved retry. The
  equivalent `npm run build -- --webpack` production build compiled, generated all pages, and
  completed successfully. This is an environment/tool-backend limitation, not claimed as a green
  Turbopack gate.
- Source inspection: zero literal NUL bytes remain in `pricing-refresh.js`; the final whole-API
  scanner has zero unguarded 500/502 disclosures and continues to recognize 45 guarded
  development-only details.
- `git diff --check`: passed; full text diff reviewed.

Adversarial residue found and fixed during review: the first scanner revision recognized ordinary
member access but not Babel's `OptionalMemberExpression`, so `err?.message` could bypass the guard.
Optional members and `String(error|err|rawErr|e)` are now rejected and fixture-proven.

## Promotion posture

This is campaign-sensitive runtime hardening, so it stays on its release branch until the owner's
deliberate merge decision. No deployment or Production mutation is part of this implementation
record.
