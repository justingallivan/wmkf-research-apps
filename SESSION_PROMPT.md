# Session 339 Prompt: DynamicsService decomposition — Stage 0 DONE, start Checkpoint A

## Session 338 Summary

Executed **Stage 0** of the DynamicsService decomposition (the first real code motion) and,
as a side-thread, discovered + partially closed a live DAL enforcement gap and landed its
remediation plan. Two independent Codex adversarial reviews ran; **three distinct security-gate
bypasses were found and closed** before any further extraction.

### What Was Completed

1. **DynamicsService decomposition plan landed + hardened** (`0c2029f`, `609ac6e`). Recovered the
   full S337 Fable-authored plan from the transcript; a `/codex:adversarial-review` returned
   SOUND-WITH-FIXES (C1 static-property gap + named-import bypass), both folded in pre-build.

2. **Stage 0 EXECUTED — behavior-freeze** (`f65966f` + follow-ups). `constants.js` (48 L) + `http.js`
   (42 L) extracted verbatim from `dynamics-service.js` into `lib/services/dynamics/`; facade −56 L
   (static `buildHeaders` delegate + `fetchWithTimeout` import; `tokenCache`/`schemaCache` left in
   place). Both LAW gates extended **fail-closed** on `lib/services/dynamics/*`. Three bypasses closed
   under review: (a) named-import (alias-gated), (b) relative-import (raw-substring → resolution-based
   `isDynamicsSubmoduleTarget`), (c) computed/template-literal source (`matchesDynamicSource`). Second
   DEDICATED `/codex:adversarial-review` returned the (c) BLOCKER; fixed (`2240ec4`). Full suite
   4945/4945, unchanged from baseline.

3. **Plan DAG table corrected mechanically** (`cb007cf`). Ran the deferred per-method call-graph scan
   (`scratchpad/dag-scan.js`, `@babel/parser`) now, not at Checkpoint C. Graph is ACYCLIC; hand-built
   table was wrong — `auth` is NOT a leaf (`getAccessToken` → `fetchWithTimeout`, `auth → http`), and
   `→ http` edges on `schema`/`read-ops`/`email` were omitted. Extraction order unaffected (http
   already out). Confirmed zero `this` in nested non-arrow functions (C1 svc-dispatch is safe).

4. **Live DAL gap found + warn-mode guard shipped** (`5a16f36`). `lib/dataverse/client.js` is a
   parallel **unguarded** Dataverse write transport; `wmkf_appuserpreferences` (prefs) +
   `wmkf_appuserappaccesses` (app-access) write through it, are in **no** DAL-migration wave, and a
   census found **all 8 write entry points run with no trusted context today** — including
   `grantDefaultApps` on every new staff sign-in. Shipped a `DATAVERSE_DAL_UNIVERSAL` (`off|warn|on`,
   **default off**) `assertDataverseAccess()` guard on the 5 prefs/app-access write functions —
   observability only, zero live behavior change.

5. **DAL migration plan Stage 9 capstone** (`842c66a`). Folded the reconciled universal-guard design
   in as the migration's capstone (not a competing plan). Converged design (after Lead pushback on the
   Fable draft): the **DynamicsService Dataverse-fetch guard is the permanent keystone** (18/18
   adapters route through DynamicsService, 0 through client.js — VERIFIED); `client.js` is
   tail-coverage. Q1–Q9 open for owner.

6. **Doc reconciliations** (`426463c`, `92dbe0c`): corrected the stale agent-wiki
   `assertTrustedDalContext` count 5→8 (5 entity-write + 3 email-write; +1 in `core/changeset.js:97`
   = 9 system-wide) and the decomposition plan's Checkpoint F note that referenced it.

### Commits (13 this session, `f3ab803`…`92dbe0c`, all on `main`)
`f3ab803` `0c2029f` `609ac6e` `f65966f` `71f9d02` `793ea52` `2240ec4` `cb007cf` `5a16f36` `556811d`
`842c66a` `426463c` `92dbe0c`.

## Next Items

### Verified Open

1. **DynamicsService decomposition — Checkpoint A (auth/restrictions/annotations, BATCHED review).**
   Evidence: `lib/services/dynamics/` contains only `constants.js` + `http.js` (Stage 0); Checkpoints
   A–F pending per `docs/DYNAMICS_SERVICE_DECOMPOSITION_PLAN.md` status header. This is the main
   thread. Three leaf extractions, each behavior-freeze (characterize → extract verbatim under C1
   svc-dispatch → gates + suite → commit): Stage 1 `auth.js` (`getAccessToken`+`tokenCache`+
   `resetTokenCache`; uses corrected DAG edge `auth → http`; C4/C14), Stage 2 `restrictions.js` (C3),
   Stage 3 `annotations.js`. Then one fresh-context adversarial review over the batch. Gates:
   `check:dataverse-access-layer`, `check:dynamics-context-boundary`, semgrep token-audit.

2. **DAL Stage 9 — enforcement (warn → wrap → enforce).** Evidence:
   `docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md` Stage 9. Step 1 (warn) DONE (`5a16f36`). Remaining:
   set `DATAVERSE_DAL_UNIVERSAL=warn` in an environment to observe real traffic, then **wrap the 8
   prefs/app-access write entry points in `withDalContext`** (delicate: the sign-in `grantDefaultApps`
   path; `lib/utils/auth.js` `requireAppAccess` establishes no context), then flip to `on`. The
   DynamicsService-side keystone (Dataverse-fetch guard in `dynamics/http.js`) runs strictly AFTER
   decomposition Checkpoint F.

### Owner Decision Needed

1. **DAL Stage 9 owner questions Q1–Q9** (`docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md` Stage 9).
   Most load-bearing: **Q9** — migrate prefs/app-access into a DAL wave (adapters → DynamicsService,
   thus guarded) vs. leave them on `client.js` behind the standing transport guard. Default recommended:
   leave them (tiny app-config; adapter churn for no coverage gain once the transport guard exists).

### Do Not Reopen Without New Decision

1. **Stage 0: COMPLETE (S338).** `constants.js`+`http.js` extracted; both LAW gates fail-closed with
   3 bypasses closed; doubly adversarially reviewed. Do not re-extract these two; extend in place.
   Evidence: plan Stage-0 EXECUTED note + commits `f65966f`…`2240ec4`.
2. **DynamicsService plan decisions Q1–Q4 stand** (12 modules / full-surface facade / co-locate cache
   seam / resolution-based gate matchers). Do not re-litigate without a new owner decision.
3. **Universal-guard design converged (S338):** DynamicsService transport = permanent keystone;
   `client.js` = tail-coverage (interim for wave-tracked entities, standing for untracked
   prefs/app-access). Do not re-open the "guard client.js as the universal transport" framing — it was
   refuted (adapters route through DynamicsService, client.js is being retired per-entity).

### Verify Before Acting

1. **Warn-mode guard is default-OFF (dormant).** `DATAVERSE_DAL_UNIVERSAL` unset = no-op. It does NOT
   currently protect the prefs/app-access writes — it only makes the guard available. Enabling `on`
   before wrapping the 8 entry points WILL throw on new-user sign-in + prefs/app-access routes (census
   confirmed all 8 are context-less). Wrap first, enforce second.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/services/dynamics-service.js` | The facade (post-Stage-0, ~1,672 L). Next: Checkpoint A extracts auth/restrictions/annotations. |
| `lib/services/dynamics/constants.js`, `http.js` | The two Stage-0 leaf modules (extracted verbatim). |
| `scripts/check-dataverse-access-layer.js` | LAW gate; `auditDynamicsSubmoduleImports` + `isDynamicsSubmoduleTarget` + `matchesDynamicSource` are the S338 fail-closed pass. |
| `lib/services/dynamics-context.js` | `assertTrustedDalContext` (8 write asserts) + the new `assertDataverseAccess` (`DATAVERSE_DAL_UNIVERSAL`). |
| `lib/services/dataverse-prefs-service.js`, `dataverse-app-access-service.js` | The warn-guarded client.js write services (prefs/app-access). |
| `docs/DYNAMICS_SERVICE_DECOMPOSITION_PLAN.md` | The decomposition plan (Stage 0 EXECUTED; A–F pending; corrected DAG). |
| `docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md` | DAL migration; **Stage 9** = universal-guard capstone + Q1–Q9. |
| `scratchpad/dag-scan.js` | Re-runnable per-method call-graph verifier (re-run before Checkpoint C/D). |

## Testing

```bash
# Decomposition covering suites (baseline before/after each Checkpoint-A stage) + the LAW gates
npx jest tests/unit/dal-enforcement.test.js tests/unit/dynamics-service-count.test.js \
  tests/unit/dynamics-service-caller-id.test.js tests/unit/adapters-caller-id.test.js \
  tests/unit/reviewer-adapters-writeback.test.js
npm run check:dataverse-access-layer && npm run check:dataverse-access-layer:self-test \
  && npm run check:route-service-boundary && npm run check:dynamics-context-boundary

# DAL-universal warn-guard
npx jest tests/unit/dal-universal-guard.test.js

# Full suite
npm test
```
