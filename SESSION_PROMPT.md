# Session 201 Prompt: Dynamics Explorer soak-and-measure + BILL chunk-5 tail

## ⏰ Standing context / guardrails (carried from S197–S200)
- **Falsification hook is LIVE** (`.claude/hooks/scope-claim-reminder.js`). Run the *disconfirming* query before asserting scope/quantity words into docs/memory.
- **Codex stop-time review gate is ENABLED.** S200 ran the full loop repeatedly (design → Codex review → fold → build → Claude review → Codex stop-gate → fold). It earned its keep: caught a GUID-quoting inversion, the contact-role bug, and **three** separate `describe_table` restriction leaks. Keep using it.
- **Measure before building.** S200's pivot: instead of building Path A's A3/A4/A5 on a hunch, we ran `scripts/analyze-dynamics-explorer-failures.js` against prod and let the data redirect the work. Do this before the next Explorer build too.
- **Push deploys to prod.** `main` auto-deploys on Vercel. S200's 13 commits are pushed (deploy in flight).

## Session 200 Summary

Two threads, both shipped and pushed (origin/main @ `aa93d5a`).

### Thread 1 — BILL chunk-5: Stage 2a reviewer payment-address UI
The reviewer-facing honorarium payment-address card on the Stage 2a accept form (completing chunk-4's server path).
- `shared/config/countries.js` — **complete** ISO 3166-1 alpha-2 set (249, incl. territories) + `normalizeCountryToIso2` (coerces stored full-name/alpha-3 → alpha-2 for prefill). The completeness was a Codex catch (curated subset hard-blocked reviewers from omitted regions).
- `Stage2aView.js` — `AddressCard` with ISO-2 country picker, **required-when-taking-honorarium / hidden-on-opt-out**, prefilled from promoted `contact.address1_*`, inline error flagging + server 400-reason surfacing + `aria-describedby`.
- **Address collection is PROVISIONAL** — may be a relic of manual BILL onboarding. Justin is checking in-office whether BILL.com self-registration already captures remittance address; if so the fields come back out (server treats address as optional, so removal is cheap). See `.claude-memory/project-reviewer-address-collection-provisional.md`.

### Thread 2 — Dynamics Explorer: measure-first pivot → live ground truth + OData validator
Started as "Path A" (replace hand-transcribed schema/GUIDs with live discovery), pivoted mid-stream when the failure data showed the real problem.
- **Slice 1 (A1+A2) shipped** (`12f7a51`): A1 = live schema into `describe_table` (+ `full:true`) + softened the inline "you already know the fields" rule; A2 = `lib/services/dynamics-explorer-taxonomy.js` (6h-cached, fail-loud live resolution of program/grantprogram/type/request_type/status GUIDs+codes, replacing the hardcoded prompt block). **Three restriction-leak fixes followed** (`6fbe6eb` field-list gate, `b8913fe` prose redaction) — all Codex stop-gate catches; the live-field exposure reopened every metadata channel.
- **Measured** (`6d7c960`/`40b0950`): `scripts/analyze-dynamics-explorer-failures.js` over 1,467 prod tool calls → **392 errored calls**, dominated by *invalid OData* (hallucinated field/entity names like `akoya_name` vs `akoya_requestnum`, `akoya_proposal`; request-number-where-GUID-required; `year()/month()/day()`; `_formatted`-in-filter; `contains()`-on-lookup; fiscalyear format guessing). **No active restrictions in prod** (the restriction hardening was defensive). This reprioritized A3/A4/A5 → an OData validator.
- **OData pre-flight validator shipped** (`aa93d5a`): `lib/services/dynamics-odata-validator.js` — tolerant tokenizer (reject only high-confidence; unknown shapes pass through), field/entity validation against live `getEntityAttributes`, restricted-field enforcement in `filter`/`orderby` (closes the `checkRestriction` gap), request-number-as-GUID detection, unsupported-construct rejects with precise hints. **No auto-correct** (unquoted GUIDs are valid — Codex caught that quoting would be harmful). Validates the EFFECTIVE post-sanitize query; distinct `ODATA_VALIDATOR_REJECT` log marker for soak measurement; in-flight schema-cache coalescing. Design + 2 Codex reviews in `docs/DYNAMICS_EXPLORER_ODATA_VALIDATOR_DESIGN.md`.

### Commits (this session, oldest→newest)
- `96baeb2`, `b4c91f0` — BILL chunk-5 (UI + Codex folds)
- `1a20a3a` — (parallel Codex session) Fix Explorer contact grant retrieval
- `9fe1418`, `6d40c44` — Path A plan + Codex round-2 fold
- `12f7a51`, `6fbe6eb`, `b8913fe` — Explorer Slice 1 + 2 restriction-leak fixes
- `6d7c960`, `40b0950` — failure-analysis diagnostic
- `8aa6c63`, `af803da` — OData validator design + Codex fold
- `aa93d5a` — OData validator build (Codex) + review (Claude)

## Potential Next Steps

### 1. SOAK + MEASURE the Explorer work (gating step — do this first)
After production traffic accumulates (give it days, not hours), re-run `node scripts/analyze-dynamics-explorer-failures.js`. Expect: errored-call rate **down**, `ODATA_VALIDATOR_REJECT` markers appearing in `dynamics_query_log.denial_reason`. This measurement gates whether A3/A4/A5 — or anything else — is worth building. **Do not build more Explorer until measured.**
- **Watch-item:** the validator's unknown-table reject hard-rejects any table not in the 23 `TABLE_ANNOTATIONS` — a valid query to a non-annotated table would false-reject. It's logged, so the soak will surface it. If it bites, soften to fall through to live resolution.
- **Watch-item:** A2 taxonomy is fail-loud — a live-taxonomy fetch failure fails the whole chat request (no degrade). 6h cache makes it rare; watch for spikes.

### 2. BILL chunk-5 tail (non-coding / ops)
- **Office question:** does BILL.com self-registration capture the remittance address (making our form collection redundant)? If yes, remove the address fields.
- **Operational setup before `BILL_ENABLED=true`** (unchanged from S199): apply migration `017`, probe + set `HONORARIUM_*`/`BILLCOM_ACCOUNT_*` env vars, set `honorarium.default_amount` via `/admin`, Steph's BILL sandbox.
- **Chunk 7b + 8 (deferred):** `vendor.updated` webhook + e2e against BILL sandbox.

### 3. Parked pre-cycle must-do
Intake virus-scan **EICAR e2e through `/apply`** before the next cycle's Phase I intake goes live (the reviewer path was verified S193; the intake path was skipped). See `.claude-memory/project-intake-portal-virus-scan-e2e-deferred.md`.

### 4. Deferred Explorer Path A items (gated on #1)
A3 (robust counts — needs an OData→FetchXML shim), A4 (`constants.js` per-program PI/contact/donor guardrails by-reference), A5 (typed-error fail-loud). Only if the soak shows they're warranted.

## Key Files Reference
| File | Purpose |
|------|---------|
| `scripts/analyze-dynamics-explorer-failures.js` | Read-only failure diagnostic — **re-run for the soak** |
| `lib/services/dynamics-odata-validator.js` | OData pre-flight validator (tokenizer + checks) |
| `lib/services/dynamics-explorer-taxonomy.js` | A2 cached/fail-loud live taxonomy → resolved prompt block |
| `pages/api/dynamics-explorer/chat.js` | Explorer engine — `describeTable` (A1), `validateEffectiveODataCall` hook |
| `docs/DYNAMICS_EXPLORER_PATH_A_PLAN.md` | Slice 1 plan (A1+A2) + A3/A4/A5 |
| `docs/DYNAMICS_EXPLORER_ODATA_VALIDATOR_DESIGN.md` | Validator design + 2 Codex review folds |
| `shared/config/countries.js` | ISO-2 list + normalizer (BILL chunk-5) |
| `shared/components/external/Stage2aView.js` | Stage 2a accept form incl. AddressCard |

## Testing
```bash
npx jest                       # 1533 tests
npm run check:atlas && npm run check:atlas:self-test && npm run check:api-routes && npm run check:fact-consistency
node scripts/analyze-dynamics-explorer-failures.js   # soak measurement (reads prod via .env.local)
```
