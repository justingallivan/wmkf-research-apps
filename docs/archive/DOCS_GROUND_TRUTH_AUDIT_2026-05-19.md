# Documentation Ground-Truth Audit — 2026-05-19

**Scope:** `docs/`, `.claude-memory/`, session carryover, planning docs, and selected source-code paths used to verify documentation claims.

**Constraint:** This audit did not intentionally edit code. It did run read-only checks and probes. Note: `npm run check:memory-drift` currently rewrites `docs/RECONCILIATION_REPORT.json` as part of normal execution, so running the audit dirtied that generated report.

## Executive Summary

The codebase appears more current than the documentation and memory layer. The highest risk is not that the app is obviously broken; it is that future planning sessions can still read stale "authoritative" prose and make wrong architectural or destructive decisions.

The most urgent issue is that canonical surfaces disagree with themselves. The Application State Atlas is supposed to be the ground-truth entry point, but `docs/atlas/postgres-grant-cycles.md` says `grant_cycles` is Dataverse-primary while later sections still claim Review Manager reads Postgres. Current code shows Review Manager and Reviewer Finder grant-cycle routes use `lib/services/grant-cycles-dataverse.js`.

This should be treated as a documentation reliability incident. The fix is not another appended note. The fix is to reconcile canonical docs, mark or archive superseded plans, clean memory summaries, and add targeted semantic drift gates where the current coverage gates are too shallow.

## Read-Only Checks Run

Sequential gates:

```bash
npm run check:atlas
npm run check:atlas:self-test
npm run check:api-routes
npm run check:doc-currency
npm run check:doc-currency:self-test
npm run check:memory-drift
```

Results:

- `check:atlas` passed when run alone: 28 Postgres tables, 28 Dataverse entity sets.
- `check:atlas:self-test` passed: 12/12 patterns.
- `check:api-routes` passed: 84 route files covered.
- `check:doc-currency` passed: no drift markers across 8 patterns.
- `check:doc-currency:self-test` passed: 12/12 fixtures.
- `check:memory-drift` failed as expected/advisory: 157 claims, 88 verified, 38 stale, 31 unknown, plus the known Field Set D label collision.

Live Dataverse probe completed and confirmed:

- `wmkf_appgrantcycles`: 10 rows
- `wmkf_appreviewersuggestions`: 336 rows
- `wmkf_appresearchers`: 334 rows
- `wmkf_ai_prompts`: 11 rows
- `wmkf_ai_runs`: 329 rows
- `akoya_request` sample includes `_wmkf_potentialreviewer1_value` through `_wmkf_potentialreviewer5_value`
- `akoya_request` sample includes populated `wmkf_ai_fitassessment` and `wmkf_ai_fitrationale`

A fresh live Postgres audit was not completed in this pass.

## Severity Scale

- **Critical:** Canonical docs contradict current code or themselves in a way that could drive destructive or architectural decisions.
- **High:** Active memories or plans are stale enough to mislead implementation, but source code or another canonical doc can disprove them.
- **Medium:** Old docs remain in live locations and create confusion, but are less likely to trigger destructive action.
- **Low:** Hygiene issue, stale count, stale path, or imprecise wording.

## Findings

### 1. Critical — Atlas Grant-Cycle Page Contradicts Current Code

`docs/atlas/postgres-grant-cycles.md` says at the top that `grant_cycles` is Dataverse-primary after W3 and that the Postgres table is drain-only. Later, the same page says:

- Review Manager reads `grant_cycles` from Postgres.
- `pages/api/reviewer-finder/grant-cycles.js` is a Postgres read/write path.
- Cutover still requires endpoint rewrite or dual-read.

Current code says otherwise:

- `pages/api/reviewer-finder/grant-cycles.js` is explicitly Dataverse-only and imports `lib/services/grant-cycles-dataverse.js`.
- `pages/api/review-manager/render-emails.js` imports `findCycleByShortCode` from `grant-cycles-dataverse`.
- `pages/api/review-manager/send-emails.js` imports `findCycleByShortCode` from `grant-cycles-dataverse`.

**Risk:** A future session may plan redundant migration work, delay legitimate cleanup, or preserve Postgres tables under a false load-bearing assumption.

**Action items:**

- Rewrite `docs/atlas/postgres-grant-cycles.md` into one consistent state.
- Remove stale read/write path claims.
- Re-run code grep after the edit and cite it in the page.
- Update any memory that still describes `grant_cycles` as Postgres-load-bearing.

### 2. Critical — Atlas Index Contains Stale Cross-System Rows

`docs/APPLICATION_STATE_ATLAS.md` still says `wmkf_appgrantcycle` is "deployed but empty" in the cross-system join section, but live Dataverse has 10 rows.

The same section still describes `proposal_searches.grant_cycle_id` as a load-bearing UI join. Current `grant-cycles.js` contains only a past-tense comment about the old `proposal_searches` count.

**Risk:** The Atlas index is the first-read document for live-state lookups. Stale summary rows are more damaging than stale historical plans.

**Action items:**

- Update the `grant_cycles` cross-system row to current Dataverse-primary state.
- Remove or relabel the `proposal_searches.grant_cycle_id` row as historical.
- Add a note that `proposal_searches` is no longer an application-code dependency.

### 3. Critical — Field Set D Label Collision Remains Unresolved

There is a real naming conflict:

- `docs/atlas/dataverse-akoya-request.md` labels `wmkf_ai_fitassessment` and `wmkf_ai_fitrationale` as **Field Set D**.
- `docs/DYNAMICS_AI_FIELDS_SPEC_v3_cn.md` says **Field Set D** is PD Assignment and writes to existing `wmkf_programdirector`, with no new `akoya_request` fields.
- Live Dataverse confirms the fit-assessment fields exist and are populated; the problem is the label, not deployment.

**Risk:** Any implementation or plan targeting "Field Set D" by label can hit the wrong fields.

**Action items:**

- Get owner decision on the label.
- Rename one concept everywhere.
- Until resolved, require all plans to name concrete fields, not "Field Set D."
- Keep `check:memory-drift` red/advisory until this is resolved rather than silencing the collision.

### 4. High — Memory Index Still Carries Stale Summary Claims

The memory index is not just a table of contents; agents read it as a compressed truth source.

Examples:

- `.claude-memory/MEMORY.md` says `requireAppAccess()` is on "~30 endpoints"; current grep count is higher.
- The 2026-05-13 intake decision memory remains presented as a normal current entry, even though 2026-05-14 schema docs superseded parts of it.
- Prior audit machinery already found 38 stale claims, but not all summaries have been reconciled.

**Risk:** Future sessions read the summary and stop before reading the body or newer docs.

**Action items:**

- Treat memory index descriptions as claims subject to audit.
- Update stale summaries or prefix them with `HISTORICAL` / `SUPERSEDED`.
- For each stale memory body, add a top correction block with date and canonical replacement.
- Do not preserve stale prose without a visible supersession marker.

### 5. High — Intake Portal / Item 6 Documentation Is Too Fragmented

The current truth appears to be:

- Slice-0 is still gated on P1-Update.
- Connor must validate the maker-portal path, or Justin must explicitly authorize a waiver.
- The waiver drafts are not authorized.

That truth is present, but it is surrounded by multiple drafts and versions:

- `INTAKE_PORTAL_ITEM_6_P1UPDATE_TEST_DRAFT*.md`
- `INTAKE_PORTAL_ITEM_6_MAKER_PORTAL_TESTS.md`
- `INTAKE_PORTAL_ITEM_6_DISCUSSION.md`
- `INTAKE_PORTAL_ITEM_6_QUICK_PROBE.md`
- Connor handout/email docs

**Risk:** A future agent reads an older draft or a partial probe and incorrectly treats the schema deploy as cleared.

**Action items:**

- Create one canonical Item 6 status/runbook page.
- Archive or top-banner all superseded P1-Update drafts.
- Make every remaining Item 6 doc link to the canonical status page.
- Preserve one explicit blocker statement: no `--execute` until Connor validation or signed waiver.

### 6. Medium — Retired Concept Evaluator Still Appears In Live Docs

Concept Evaluator is removed from the app registry except a deprecation comment, but live docs still reference it:

- `docs/SYSTEM_OVERVIEW.md`
- `docs/AI_PROMPTS_OVERVIEW.md`
- `docs/AI_PROMPTS_DETAILED.md`
- `docs/PDF_EXPORT.md`

**Risk:** New readers see a retired app as part of the current suite.

**Action items:**

- Remove Concept Evaluator from current overview docs, or mark the relevant sections historical.
- Add an archive note if the prompt text is retained only for reference.

### 7. Medium — Current Gates Prove Coverage, Not Truth

The project has useful gates, but they do not catch many semantic contradictions.

Examples:

- `check:atlas` confirms an entity/table appears somewhere in the Atlas corpus. It does not verify that the read/write path list is current.
- `check:doc-currency` currently scans only a small pattern set.
- `check:memory-drift` is advisory and writes a tracked JSON report during execution.
- Running `check:atlas` in parallel with `check:atlas:self-test` can produce a false red because the self-test temporarily creates synthetic entity files under `lib/services/atlas_selftest_tmp`.

**Risk:** Green gates can be misread as "docs are correct."

**Action items:**

- Document that atlas and atlas-self-test must run sequentially.
- Add semantic drift checks for known recurring patterns:
  - "Dataverse-primary" plus "reads Postgres" in the same entity page.
  - "deployed but empty" contradicted by live audit row count.
  - "not yet built" contradicted by matching route file.
  - memory index summaries contradicted by audit status.
- Add a `--no-write` mode to `check:memory-drift`.

## Recommended Correction Plan

### Phase 1 — Fix Canonical Truth First

Order:

1. `docs/atlas/postgres-grant-cycles.md`
2. `docs/APPLICATION_STATE_ATLAS.md`
3. `docs/atlas/dataverse-akoya-request.md`
4. Field Set D source docs after owner decision

Acceptance:

- Atlas pages no longer contain self-contradictory source-of-truth claims.
- Grant-cycle docs match current code imports and live Dataverse row count.
- Field Set D collision is either resolved or loudly blocked everywhere.

### Phase 2 — Clean Memory Layer — ✅ EFFECTIVELY COMPLETE (verified S166, 2026-05-19)

Use `docs/RECONCILIATION_REPORT.json` and `docs/AUDIT_S154_MEMORY_V2.md` as the worklist.

Order:

1. Update `.claude-memory/MEMORY.md` summaries.
2. Update stale memory bodies with visible correction banners.
3. Mark superseded intake and reviewer migration memories clearly.
4. Remove "future work" language for completed work.

Acceptance:

- No stale memory summary can be mistaken for current state.
- Historical memories are explicitly labeled historical.
- The 38 stale findings are either corrected or intentionally retained with a clear supersession marker.

**S166 verification outcome.** Re-audited the S154 worklist against *current* `.claude-memory/`
state rather than applying it blindly (the S154 audit is dated 2026-05-14; ~20+ commits
touched `.claude-memory/` between it and S166). Result: the substantive work was **already
done by intervening sessions** — every high-signal S154 finding checked in context was
already reconciled:

- `MEMORY.md` index "still load-bearing" line → corrected ("drain-only, deletion ≥ 2026-07-01").
- `project_reviewer_finder_dataverse_entry_path.md` central claim → fully rewritten ("SHIPPED").
- `project_app_access_control.md` counts → corrected. (S166-initial said "16 apps / ~48 endpoints"; **Codex follow-up caught two misses**: the `MEMORY.md` index line still said "~30 endpoints" — a denormalized restatement the body fix didn't reach — and 16/~48 were *themselves* now stale. Re-verified live 2026-05-19: **17 app definitions / ~52 endpoints**; index + body both reconciled to that single state.)
- `project_grant_lifecycle_states_confirmed.md` false "slots do NOT exist" → removed.
- `project_reviewer_accept_decline_links.md` "NOT yet built" → scoped to email-buttons; `respond.js` noted shipped.
- `project_codex_recurring_review.md` / `..._external_id_foundation.md` / `..._pilot_decisions_2026-05-06.md` archive paths → already `docs/archive/`-prefixed.
- `project_intake_portal_pilot_decisions_2026-05-13.md` `schema/intake/` → covered by an explicit top-of-file supersession banner.
- `project_backend_automation.md` field names → already v3 (`wmkf_ai_dataextract`, "formerly `wmkf_ai_structured_data`").

Residuals found and fixed S166 (initial pass + Codex follow-up):
- `project_reviewer_lifecycle.md:61` rotted `reviewer-finder.js:2802` "Add Researcher modal"
  ref → de-pinned. **Codex follow-up:** the first rewrite still asserted "manual reviewer
  entry exists in the UI" — unverified (current reviewer-finder modals only *edit* existing
  candidates; no add-from-scratch UI found). Reworded to not assert an unverified surface.
- `project_app_access_control.md` + `MEMORY.md` index counts (see bullet above) — Codex
  caught the index restatement the body fix missed; both reconciled to live 17/52.

**Process note:** the S166-initial "only one residual / already fully reconciled" framing
was itself slightly overstated — the *bodies* of the high-signal memories were reconciled by
intervening sessions, but a denormalized index restatement and two now-stale counts survived
and were only caught on Codex re-review. This is the same fan-out/no-fan-in failure the audit
exists to document; recorded here rather than papered over.

**Gate-design defect for Phase 5 (do NOT silence now):** `RECONCILIATION_REPORT.json`'s
`claim_audit` is a static re-parse of `AUDIT_S154_MEMORY_V2.md` (every claim's `source_file`
is that one doc). Its "38 stale" count therefore never decreases as memories are fixed — it
measures the frozen audit, not live memory. The live signals are the `drift_buckets`
(Dataverse/Postgres probes) only. Phase 5 should either re-derive `claim_audit` from current
memory state or stop counting it as "stale." Logged in the Action Item Register.

### Phase 3 — Collapse Intake Item 6 Docs — ✅ DONE (S166, 2026-05-19)

Create a single canonical status page, then demote older drafts.

Acceptance:

- ✅ One page answers: "Is slice-0 deploy cleared?" — `docs/INTAKE_PORTAL_ITEM_6_STATUS.md` created (§1 = NO; one open gate = P1-Update).
- ✅ Every draft points to that page — top-banner pointers added to `DISCUSSION` (status-entry-point; §0 still authoritative for the decision), `CONNOR_CORE_GATE` (also corrected stale "not yet sent" subtitle → SENT), `P1UPDATE_TEST_DRAFT{,_v2,_v3,_v4,_v5}`, `MAKER_PORTAL_TESTS`, `QUICK_PROBE`. Non-destructive (banners only; no doc deleted).
- ✅ Waiver status is unmistakable — STATUS §3(ii): waiver Artifact 1 DRAFTED, **UNAUTHORIZED**, not self-authorizable.
- ✅ Connor validation status is unmistakable — STATUS §3(i): test SENT S165, AWAITING Step 11 evidence + Step 12 verdict, gate still OPEN.
- ✅ Explicit blocker preserved — STATUS §2: no `--execute` until (i) or (ii); never autonomous.

### Phase 4 — Retire Or Mark Old App Docs — ✅ DONE (S166, 2026-05-19)

Start with Concept Evaluator references and older overview docs.

Acceptance:

- ✅ Current overview docs list only current apps — Concept Evaluator row removed from `SYSTEM_OVERVIEW.md` "Application Suite" and from the `PDF_EXPORT.md` enhancement backlog.
- ✅ Archived/retired app material is labeled historical — `SECURITY_ARCHITECTURE.md` inventory row marked retired (kept in place for numbered-row stability), PubMed-consumer line annotated, stale `Opus 4 (concept evaluator)` model note corrected (verified vs `baseConfig.js`: **no app uses opus**); `AI_PROMPTS_OVERVIEW.md` + `AI_PROMPTS_DETAILED.md` Concept Evaluator prompt sections given a "RETIRED — retained for reference only" banner (prompt text deliberately kept; cross-referenced by MPE stages) + TOC/table annotations.
- ✅ User-facing guides do not imply retired flows are available — `guides/GETTING_STARTED.md` already correct ("Concept Evaluator was retired 2026-04-25"); no change needed.

**Finding #6 undercounted.** The adjacent-context survey (ground-truth rule #3) found Concept Evaluator in **3 live docs Finding #6 did not name**: `SECURITY_ARCHITECTURE.md`, `PROMPT_STORAGE_DESIGN.md` (already correctly says "Deprecated/retired" — no change), and `guides/GETTING_STARTED.md` (already correct). The AUDIT_S154_* / `DOC_TRIAGE_2026-05-07.md` / this audit doc reference it as point-in-time history and were correctly left untouched. `appRegistry.js` verified: registry-removed, comment-only residual at lines 9–14 (S154 was right).

**Adjacent stale app counts (scope discipline + Codex follow-up):** `SYSTEM_OVERVIEW.md` and `SECURITY_ARCHITECTURE.md` carried independently-stale app counts (real suite is larger per `CLAUDE.md`). S166-initial de-specified the SYSTEM_OVERVIEW *table* count ("All 13 applications" → "All applications") but **Codex follow-up caught a missed restatement**: line 7's "suite of 13 web-based tools" — now also de-specified ("suite of web-based tools"), consistent with not asserting a new wrong number. Follow-up strengthened `check:fact-consistency` to catch those known-miss phrasings; before cleanup it failed on `SECURITY_ARCHITECTURE.md`'s "All 14 applications" plus two "30+ app endpoints" restatements, then those lines were de-specified because the exact counts were not locally operational.

### Phase 5 — Improve Gates — ✅ BOUNDED GATE STRENGTHENED (S166, 2026-05-19); normalization/semantic gate deferred

Add targeted semantic checks only after the docs are clean, so the fixtures encode the corrected state.

Acceptance:

- ✅ **New checks have self-test fixtures** — `check:fact-consistency` was built and then strengthened after review showed the first version was too narrow: it missed the exact stale phrasings "suite of 13 web-based tools," "All 14 applications," "30+ app endpoints," and "30 API endpoints." The current bounded gate derives registered `CANONICAL_FACTS` scalars from live code, uses named known-miss patterns, requires same-line fact-bound historical markers, scans root live docs plus docs/memory, and has a two-layer self-test (prose/exemption fixtures + independent derive cross-check). This is **still a bounded scalar backstop**, not the full structural normalization fix; the **general semantic checker stays correctly deferred** (NLP-hard ≈ automating the S154 audit — not half-built). Codified in `CLAUDE.md` as the mandatory fan-in before any registered fact-level doc/memory "DONE" claim.
- ✅ **`check:memory-drift --no-write` exists** — added to `scripts/check-memory-drift.js` + `npm run check:memory-drift:no-write` alias. Verified: read-only, evaluates the committed report, **does not regenerate/mutate `RECONCILIATION_REPORT.json`** (the default path does — that's the Phase-2 dirtying problem this fixes). Warns when the report is >24h old instead of silently regenerating.
- ✅ **Gate docs warn against parallel `check:atlas` / `:atlas:self-test`** — added at 3 surfaces with the concrete cause: the self-test writes synthetic fixtures into `lib/services/atlas_selftest_tmp/` (a path `check:atlas` scans), so a concurrent `check:atlas` false-fails on them and races the self-test's `cleanup()`. Warnings in both script headers + `CLAUDE.md` binding-self-test paragraph.

Binding self-tests green after the (comment-only) edits to `check-application-state-atlas.js` / `check-coverage-self-test.js`: `check:atlas:self-test` 12/12, `check:doc-currency:self-test` 12/12 (re-observed S166 during the Codex-fix follow-up, not on-faith).

**Logged for follow-up (not fixed — too big for a gate tweak):** `RECONCILIATION_REPORT.json`'s `claim_audit` re-parses the frozen `AUDIT_S154_MEMORY_V2.md` (every claim's `source_file` is that doc), so "stale: 38" never decreases as memories are fixed (Phase 2 proved it: the substantive S154 findings were already reconciled, count unchanged). The gate does **not** fail on this count — it fails only on `spec_without_entity`, large `stale_row_count` (>50%), `doc_label_collision`, or `probe_errors` (NOT on `postgres_table_mismatch`, and NOT on the `claim_audit` "stale" count) — so it is misleading-but-not-blocking. Re-deriving `claim_audit` from live memory state = automating the memory audit; tracked as a Register item.

## Action Item Register

| Priority | Item | Owner | Evidence / Target |
|---|---|---|---|
| P0 | Reconcile `postgres-grant-cycles.md` | Engineering docs | Current code imports `grant-cycles-dataverse` |
| P0 | Update Atlas index grant-cycle and proposal-search rows | Engineering docs | Live Dataverse: `wmkf_appgrantcycles` = 10 |
| P0 | Resolve Field Set D label collision | Justin / Connor | Atlas vs v3 spec conflict |
| P1 | ✅ DONE S166 — Clean `.claude-memory/` stale summaries | Engineering docs | S154 worklist bodies already reconciled by intervening sessions; Codex follow-up caught a denormalized index restatement + 2 now-stale counts (all fixed to live 17/52) + an unverified rewrite (corrected). See Phase 2. |
| P2 | Fix `RECONCILIATION_REPORT.json` `claim_audit` (DEFERRED — sized S166) | Engineering | Re-parses frozen `AUDIT_S154_MEMORY_V2.md`; "38 stale" never decreases. Non-blocking (gate fails on drift_buckets/probe_errors, not this count). Re-derive = automating the memory audit; not a gate tweak. |
| P1 | ✅ DONE S166 — Canonicalize Item 6 status page | Engineering docs | `docs/INTAKE_PORTAL_ITEM_6_STATUS.md` created (Phase 3) |
| P1 | ✅ DONE S166 — Mark/archive superseded P1-Update drafts | Engineering docs | Top-banner pointers on 8 Item 6 docs; no deletion |
| P2 | ✅ DONE S166 — Remove/label retired Concept Evaluator in live docs | Engineering docs | 5 docs edited; Finding #6 undercounted (3 more found, 2 already clean). See Phase 4. |
| P3 | ✅ DONE S166 — Refresh stale app counts in overview/security docs | Engineering docs | `SYSTEM_OVERVIEW` de-specified (table + line 7, latter via Codex follow-up). Strengthened `check:fact-consistency` then failed on `SECURITY_ARCHITECTURE` "All 14 applications" and two "30+ app endpoints" restatements; all three were de-specified because the exact counts were not locally operational. |
| P2 | ✅ PARTIAL S166 — bounded scalar-drift gate strengthened (`check:fact-consistency` + self-test); **normalization/general semantic gate still DEFERRED** | Engineering | Registered app-definition and requireAppAccess endpoint scalar class now has AST-backed derives, known-miss phrase fixtures, strict structured exemptions, expanded live-doc scope, and independent derive self-test. This is a bounded backstop, not the full normalization fix. |
| P2 | ✅ DONE S166 — Add `check:memory-drift --no-write` | Engineering | Read-only flag + `check:memory-drift:no-write` alias; verified non-mutating. Phase 5. |
| P2 | ✅ DONE S166 — Warn against parallel atlas gate runs | Engineering docs | 3 surfaces (both scripts + CLAUDE.md) w/ concrete cause. Phase 5. |

## Best Practices For Learning / Remediation

This project has a recurring pattern: a planning session corrects a stale belief, but the correction lands in one place while contradictory claims remain elsewhere. The remediation exercise should be deliberate, observable, and strict.

### 1. Treat Stale Documentation As A System Failure

Do not frame these as isolated typo fixes. A stale memory or Atlas claim can change future implementation behavior. Track each stale claim through root cause:

- Was the doc never updated after code changed?
- Was only the summary updated while the body stayed stale?
- Was a new note appended instead of reconciling the old claim?
- Did a gate prove only coverage, not correctness?

### 2. Use A Blameless But Uncompromising Review

The tone should be blameless because stale docs are expected in fast-moving systems. The standard should still be uncompromising because this repo uses docs and memory as operational inputs.

Good remediation language:

- "This claim is stale as of 2026-05-12; canonical state is X."
- "This document is historical and must not be used for implementation."
- "This plan is superseded by Y; retained for context only."

Avoid:

- Adding another "Update:" paragraph while leaving old text intact.
- Saying "mostly current" for a doc that contains a dangerous stale claim.
- Allowing ambiguous labels like "Field Set D" to persist across two meanings.

### 3. Practice Probe-Before-Plan As A Drill

For each corrected domain, run a small drill:

1. Pick one claim from docs.
2. Identify the code/probe that would verify it.
3. Run the verification.
4. Update the doc with the verification source.
5. Add a regression check if the same drift could recur.

This turns the remediation from cleanup into a reusable habit.

### 4. Separate Current State From History

Every long-lived doc should declare its status at the top:

- `CURRENT — implementation source`
- `CURRENT — planning source`
- `HISTORICAL — superseded`
- `DRAFT — do not execute`
- `BLOCKED — owner decision required`

Historical content is valuable, but only if future agents cannot mistake it for instructions.

### 5. Make Corrections In Whole Documents, Not Paragraphs

When changing a conclusion, grep the entire document for every old restatement. Fix all of them in the same pass. A document whose top says "Dataverse-primary" and tail says "Postgres reader remains" is worse than no document because it forces readers to guess which claim is newer.

### 6. Convert Repeated Failures Into Gates

Do not add broad, noisy gates. Add narrow checks for failures that have already happened:

- "not yet built" while route exists
- "deployed but empty" while audit shows rows
- "Dataverse-primary" plus active Postgres reader claims
- memory summary contradicting memory body
- stale app names in current overview docs

Each gate needs a positive and negative fixture.

### 7. Keep A Remediation Journal

For this cleanup, maintain a short running journal:

- claim fixed
- files touched
- verification command
- whether a gate was added
- unresolved owner question, if any

This prevents the remediation itself from becoming another pile of untraceable context.

### 8. Define Done Aggressively

The exercise is not done when the obvious typo is fixed. It is done when:

- Canonical docs no longer contradict code.
- Memory summaries no longer contradict memory bodies.
- Active plans link to current status pages.
- Superseded docs are visibly marked or archived.
- Existing gates pass.
- New targeted gates protect the specific drift classes found here.
- A fresh agent can answer "what is ground truth?" from one canonical page plus cited probes.

## Recommended First Commit

Make the first correction commit small and high-signal:

1. Fix `docs/atlas/postgres-grant-cycles.md`.
2. Fix the grant-cycle/proposal-search rows in `docs/APPLICATION_STATE_ATLAS.md`.
3. Add or update a visible Field Set D blocker note without resolving it prematurely.
4. Run sequential gates.

Do not combine this with broad memory cleanup. The Atlas is the root canonical layer; repair that first.
