---
title: "Reviewer Finder — COI Chunk 2: institution COI + advisory retirement (Design / Pre-Impl)"
domain: reviewer-identity
kind: spec
status: active
summary: "Author: Claude (S240, 2026-06-10). Builds on Chunk 1 (shipped, b19b3b9)."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md
  - docs/REVIEWER_FINDER_PI_IDENTITY_WIREIN_PLAN.md
  - lib/utils/prompt-validators.js
  - shared/components/reviewers/ReviewerSearchSection.js
---

# Reviewer Finder — COI Chunk 2: institution COI + advisory retirement (Design / Pre-Impl)

> Status (updated S254, 2026-06-13): **SHIPPED (both chunks).** Change A — institution COI = HARD
> DROP on the PI-institution UNION (both tracks) + durable save-boundary re-reject
> (`rejectedInstitutionCOI`) — **SHIPPED as Chunk 2a (S240)**, owned by
> `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md` §5. The advisory (`POTENTIAL_CONCERNS`)
> retirement — **SHIPPED as Chunk 2b (S254)**: removed from the prompt template (both byte-parity
> files), parser, validator, repair prompt, both card renders, and the roster-prune persist. The
> parser keeps `POTENTIAL_CONCERNS` ONLY as a REASONING terminator so a lingering emission (e.g. a
> not-yet-reseeded prod row in the deploy→reseed window) is parse-and-discarded, never bled into the
> rendered reasoning. Prod Dataverse `analyze` row reseed is Justin's step
> (`seed-reviewer-finder-prompts.js --execute --only=analyze`). This whole doc is now historical
> design rationale.
> Author: Claude (S240, 2026-06-10). Builds on Chunk 1 (shipped, `b19b3b9`).
> Policy: [[project-reviewer-coi-rely-on-self-disclosure]] (Justin S240). Prior design +
> Chunk-1 context: `docs/REVIEWER_FINDER_PI_IDENTITY_WIREIN_PLAN.md` §9.

## 1. Goal & decided policy

Apply the S240 COI policy to the live pipeline. The foundation's rule (Justin S240): **hard-act
only on self-evident POLICY conflicts the PD needn't verify (proposal authors + CURRENT
same-institution); rely on reviewer self-disclosure for relationship/inferred conflicts; do NOT
emit PD-unverifiable soft flags.** Four changes:

- **A. Institution COI = HARD DROP (both tracks) against the UNION of known PI institutions.**
  Today the hard drop (Track B) + soft flag (Track A) run off the LLM-extracted `authorInstitution`,
  which is sometimes hallucinated (Chunk-1 §12.2 "Wayne State"). Replace with a hard drop on both
  tracks matched against the institution union of §2 (D1 + D2). Applicant-recommended path flags
  instead (D3).
- **B. REMOVE historical / former-shared institution COI** (the historical-COI behavior shipped
  S229) — neither drop nor flag. **Removal SHIPPED (Chunk 2a): `institutionCOIDetails.historical`
  is gone; `markInstitutionCOI` is current-affiliation only** (see ENFORCEMENT_CONTRACTS §5).
- **C. RETIRE the AI `POTENTIAL_CONCERNS` amber advisory** (the advisory itself shipped S229) — the
  canonical PD-unverifiable inferred flag. **Retirement = Chunk 2b, SHIPPED S254** — removed from the
  prompt (`shared/config/prompts/reviewer-finder{,-dynamics}.js`), parser, validator
  (`lib/utils/prompt-validators.js`), repair prompt, and UI (`pages/reviewer-finder.js` +
  `ReviewerSearchSection.js`); prod `analyze` row reseed is Justin's step.
- **D. Prefer ORCID-current affiliation** over OpenAlex stale `last_known_institutions[0]` for the
  PI institution.

**Co-author COI grading stays** (factual shared-paper counts — verifiable, Justin S240).

## 2. Decisions (Justin S240) — supersede the earlier framing

- **D1 — current same-institution is a HARD DROP on BOTH tracks** (Codex Q1; Justin; superseded
  only by the 2026-07-03 Phase-C read-only flag exception for single low-trust contradicted
  strings). Track B
  already hard-drops via `filterConflicts`; Track A (Claude-suggested) must too. The `markInstitutionCOI`
  *soft flag* therefore collapses for the normal search — replaced by a hard drop + a
  PD-facing excluded-count/names summary in the SSE progress. (Exception: the applicant-RECOMMENDED
  path — see D3.)
- **D2 — match against the UNION of all known PI institutions** (Justin), erring toward
  over-exclusion (acceptable: same-institution is a policy conflict). My earlier "ONE institution /
  prefer-structured / no union" simplification was **WRONG** (Codex HIGH): a PI with dual
  appointments can have more than one current institution. The union is built from every PI-institution
  signal we have: `[ORCID-current affiliation, OpenAlex last-known institution, LLM
  authorInstitution]`, deduped. So the Chunk-1 Codex #4 **one-pass multi-institution helper IS needed
  after all** (for the hard drop). `[VERIFIED]` `proposalInfo` carries only `authorInstitution` (the
  PI's), NOT co-investigator institutions (only co-PI *names* are extracted) — so **co-PI-institution
  COI is an accepted gap** this chunk (handled by reviewer self-disclosure; would need co-PI ORCID
  resolution, out of scope).
- **D3 — applicant-RECOMMENDED reviewers are FLAGGED, not dropped** (my judgment call, flag for
  Justin override). `enrich-recommended` enriches reviewers the *applicant explicitly named*; silently
  dropping the applicant's own pick would hide their input from the PD. So that path keeps a
  (current-only, union) institution **flag** — `markInstitutionCOI` survives there — rather than a
  hard drop. This is the one place the soft flag remains.

```
piInstitutions = dedupe([
  piIdentity?.resolved && piIdentity.currentAffiliation,
  piIdentity?.resolved && piIdentity.lastKnownInstitution,
  authorInstitution,
].filter(Boolean))   // empty → fall back to today's single-value LLM behavior
```

## 3. Current state `[VERIFIED via source 2026-06-10]`

- **Hard drop:** `DeduplicationService.filterConflicts(researchers, authorInstitution)`
  (`deduplication-service.js:351-375`) — current-affiliation match only, returns the kept array.
  Called inside `DiscoveryService.discover()` (`discovery-service.js:259`) with
  `proposalInfo.authorInstitution`. `discover(analysisResult, options)` destructures options at
  `discovery-service.js:102-110` (easy to extend).
- **Soft flag:** `markInstitutionCOI(researchers, authorInstitution)` (`deduplication-service.js:265-309`)
  — scans current affiliation (274-279) AND `affiliationHistory` (288-295), sets
  `institutionCOIDetails.historical` (305). **FOUR call sites** (Codex — I missed enrich-recommended):
  `discover.js:295` (verified/Track A) and `discover.js:413` (discovered/Track B) with
  `authorInstitution`; `enrich-contacts.js:143` with client-sent `authorInstitution` +
  `orig.affiliationHistory`; and `enrich-recommended.js:227` with `proposalInfo.authorInstitution`.
- **Historical badge:** `pages/reviewer-finder.js:246` and
  `shared/components/reviewers/ReviewerSearchSection.js:228` render "Former shared institution" vs
  "Same institution" off `institutionCOIDetails?.historical`. Persisted via
  `pruneCandidateForRoster` (`reviewer-search-logic.js:187`).
- **`affiliationHistory` producers:** `discovery-service.js:661,1662-1667` (PubMed
  `collectAffiliationHistory`), `:877` (ORCID spine), `deduplication-service.js:206` (merge). After
  B, the only COI *consumer* (the historical scan) is gone.
- **POTENTIAL_CONCERNS:** parse/normalize `parseAnalysisResponse` + `isNoConcernText`
  (`shared/config/prompts/reviewer-finder.js:232-258` + the parse block ~`:371-376` — Codex LOW:
  `pages/reviewer-finder.js:371-376` was a wrong citation); ALSO required by the validator
  (`lib/utils/prompt-validators.js:71`) + repair prompt (`claude-reviewer-service.js:88`);
  render `pages/reviewer-finder.js:183,257-259` +
  `ReviewerSearchSection.js:157-158,255`; persist `reviewer-search-logic.js:191`; prompt
  instruction `reviewer-finder.js:106` + `reviewer-finder-dynamics.js:115` (byte-parity test);
  live row reseeded via `scripts/seed-reviewer-finder-prompts.js --execute`. The S229 prompt also
  forces **REASONING = fitness-only, COI forbidden there** (COI routed to POTENTIAL_CONCERNS).
- **PI institution:** `resolveProposalPI` returns `institution: author.lastKnownInstitution`
  (`proposal-pi-identity.js:~212`). Chunk 1 ALREADY calls `ORCIDService.getProfile` in
  `fetchOrcidRegistryName`; `getProfile` returns `currentAffiliation` (`orcid-service.js:308`).
- **`enrich-contacts.js` has NO `requestId` and no Dynamics bypass** (`req.body = { candidates,
  options, authorInstitution }`, `:66`; `requireAppAccess` only). It cannot resolve the PI today.

## 4. Design (per the §2 decisions + Codex pre-impl fold)

### A. Institution hard drop (both tracks) against the union
- A **one-pass multi-institution helper** — `filterConflicts(researchers, institutions[])` (accept an
  array; keep the single-string form back-compatible) — hard-drops any candidate whose CURRENT
  affiliation matches ANY institution in `piInstitutions` (§2 D2).
- `discover.js` already resolves `piIdentity` (Chunk 1). Build `piInstitutions` once; then:
  - **Track B:** pass `{ ...options, piInstitutions }` to `DiscoveryService.discover()`; use it for
    the `filterConflicts` drop (`discovery-service.js:259`).
  - **Track A (NEW hard drop, D1):** apply the same `filterConflicts` to the verified candidates in
    `discover.js` (replacing the `markInstitutionCOI` soft flag at `:295`), and emit an
    excluded-count/names SSE summary for PD visibility.
  - Track B discover.js soft-flag call (`:413`) is likewise replaced by the hard drop.
- **`enrich-recommended.js` (Codex HIGH — missed call site `:227`):** the 4th `markInstitutionCOI`
  site. Per D3 this path **flags** (does not drop) — but must use the union institution + current-only
  (resolveProposalPI is already wired here for name augmentation; reuse its institutions).
- **`enrich-contacts.js` parity (Codex #8 + Q2=yes):** add optional `requestId` + a Dynamics bypass +
  `resolveProposalPI`; recompute against the union; same-institution found at enrich time produces an
  **exclusion** for the normal-search rows (D1), a **flag** for recommended rows (D3). Plumb
  `requestId` from the client call site. Fail-open: no requestId → today's behavior.

### B. Remove historical-institution COI
- `markInstitutionCOI` (now only the D3 recommended/enrich flag path): delete the `affiliationHistory`
  scan (288-295) + the `historical` field; match CURRENT affiliation only. `institutionCOIDetails`
  stays `{ piInstitution, reviewerInstitution }` (the object has other consumers — Q4).
- Both cards: drop the `historical` branch → badge reads "Same institution as PI" (one form).
- `enrich-contacts.js:144`: stop passing `affiliationHistory` into the recompute.
- **Orphaned tests (Codex MEDIUM):** `tests/unit/institution-coi-historical.test.js` and
  `tests/unit/reviewer-search-logic.test.js` assert the historical field/behavior — update/delete in
  the same pass.
- **Leave the `affiliationHistory` PRODUCERS in place** (collectAffiliationHistory `discovery-service.js:661,1662-1667`;
  ORCID spine `:877`; merge `deduplication-service.js:206`) — COI-inert after this; note as deferred
  dead-code review in [[project-deferred-code-cleanup]] and fix their now-stale comments.

### C. Retire POTENTIAL_CONCERNS — FULLY COUPLED (Codex HIGH)
Bigger than parse/render/persist: the field is **required by the prompt validator + repair prompt**,
so all of these change together or the validator rejects the new prompt:
- Remove parse (`shared/config/prompts/reviewer-finder.js` `parseAnalysisResponse` POTENTIAL_CONCERNS
  block + `isNoConcernText`), both card renders (`pages/reviewer-finder.js`,
  `ReviewerSearchSection.js`), the `pruneCandidateForRoster` persist (`reviewer-search-logic.js:191`).
- **Validator** `lib/utils/prompt-validators.js:71` (drop `'POTENTIAL_CONCERNS:'` from the required
  tokens) + its test `tests/unit/prompt-validators.test.js`.
- **Repair prompt** `lib/services/claude-reviewer-service.js:88` (drop the field from "every reviewer
  must include …") + `tests/unit/claude-reviewer-service.test.js`,
  `tests/unit/reviewer-finder-parse-analysis.test.js`.
- **Prompt templates** `reviewer-finder.js` + `reviewer-finder-dynamics.js` (byte-parity test): drop
  POTENTIAL_CONCERNS; also reword the `:89` "Must NOT be from the author's institution" line so the
  model does NOT pre-adjudicate COI (deterministic COI is server-side now — Codex MEDIUM); keep/add
  "REASONING = fitness only; do NOT discuss COI/relationship/eligibility anywhere" so dropping the
  field doesn't push COI back into REASONING (original S229 bug).
- **Operational:** reseed the live row via `seed-reviewer-finder-prompts.js --execute` (prod Dataverse
  — likely Justin runs it). Code retirement is decoupled from the reseed: once parse/render are gone,
  lingering model output is inert (safe), but the VALIDATOR change must ship with the template change
  or local validation/tests break.

### D. Prefer ORCID-current affiliation
- Refactor Chunk-1's `fetchOrcidRegistryName` → return `{ registryName, currentAffiliation }` (Codex
  MEDIUM — avoid the bare-string shape hazard), preserving abort/null behavior. `resolveProposalPI`
  then exposes both `currentAffiliation` (ORCID) and `lastKnownInstitution` (OpenAlex) so the §2 D2
  union can include both. One getProfile call serves the name guard + affiliation.

## 5. Open questions — RESOLVED
- **Q1 → HARD-DROP both tracks** (Justin). markInstitutionCOI soft flag collapses for the normal
  search; survives only on the applicant-recommended path (D3). Folded into §4.A/§2 D1.
- **Q2 → YES**, add `requestId` + bypass + `resolveProposalPI` to `enrich-contacts` (Codex rec). §4.A.
- **Institution breadth → UNION** all known PI institutions (Justin). §2 D2. Co-PI-institution COI is
  an accepted gap (only co-PI names are extracted).
- **Q3 → coupled change** (validator + repair + templates + tests + seed); reword REASONING scope.
  Reseed `--execute` ownership: Justin (prod). §4.C.
- **Q4 → drop the `.historical` field only**, keep the `institutionCOIDetails` object (other
  consumers). `[VERIFIED via grep]`.
- **Q5 → acceptable** (Justin): union hard drop over-excludes by design (policy conflict); removing
  historical + advisory is the intended advisory-recall reduction; co-author COI stays.

### Applicant-recommended exception (D3) — flagged for Justin override
The one place a current-same-institution reviewer is **flagged, not dropped**: the applicant
explicitly recommended them, so silently dropping hides the applicant's input from the PD. If you'd
rather hard-drop there too (uniform), say so and `markInstitutionCOI` disappears entirely.

## 6. Chunk split (Codex pre-impl fold made this too big for one reviewable pass)
Split into two independent chunks, each its own design→impl→Codex loop:

### Chunk 2a — Institution COI (decisions A + B + D; the hard-drop union)
- `lib/services/proposal-pi-identity.js` — D: `fetchOrcidRegistryName` → `{ registryName,
  currentAffiliation }`; `resolveProposalPI` exposes `currentAffiliation` + `lastKnownInstitution`;
  add a `piInstitutions(pi, authorInstitution)` union helper.
- `lib/services/deduplication-service.js` — `filterConflicts` accepts an institution ARRAY (one-pass
  multi-institution); `markInstitutionCOI` current-only (drop history), used only by the D3 path.
- `lib/services/discovery-service.js` — `discover()` accepts `options.piInstitutions` for the Track-B
  `filterConflicts` drop; fix stale former-institution comments.
- `pages/api/reviewer-finder/discover.js` — build the union; hard-drop BOTH tracks; PD excluded-summary SSE.
- `pages/api/reviewer-finder/enrich-contacts.js` (+ client) — requestId + bypass + resolveProposalPI;
  exclude (normal) / flag (recommended) on the union; stop passing `affiliationHistory`.
- `pages/api/workbench/enrich-recommended.js` — the missed 4th call site: union + current-only FLAG (D3).
- `pages/reviewer-finder.js`, `ReviewerSearchSection.js` — remove the historical badge branch.
- `shared/components/reviewers/reviewer-search-logic.js` — drop `historical` from prune.
- Tests: `filterConflicts` multi-institution + both-track drop; `markInstitutionCOI` current-only;
  update/delete `tests/unit/institution-coi-historical.test.js`, `tests/unit/reviewer-search-logic.test.js`.

### Chunk 2b — Retire POTENTIAL_CONCERNS (decision C; fully coupled) — ✅ SHIPPED S254
- `shared/config/prompts/reviewer-finder.js` (parse + `isNoConcernText` + template) +
  `reviewer-finder-dynamics.js` (byte-parity); reword the `:89` institution line.
- `lib/utils/prompt-validators.js:71` (drop required token) + `lib/services/claude-reviewer-service.js:88`
  (repair prompt).
- `pages/reviewer-finder.js`, `ReviewerSearchSection.js` — remove the advisory render;
  `reviewer-search-logic.js:191` — drop `potentialConcerns` from prune.
- Tests: `prompt-validators.test.js`, `claude-reviewer-service.test.js`,
  `reviewer-finder-parse-analysis.test.js`, roster DTO test.
- Operational: `scripts/seed-reviewer-finder-prompts.js --execute` (prod Dataverse — Justin).

## 7. Safety / rollback
- Institution preference is fail-open (unresolved PI → LLM institution = today).
- Removing historical COI + POTENTIAL_CONCERNS is a deliberate behavior reduction (per policy), not
  fail-open — it changes shipped S229 output. Verify-before-delete: grep consumers (done in §3);
  the producers of `affiliationHistory` stay (inert), so no upstream breakage.
- Prompt reseed is decoupled from the code retirement (code ignores the field regardless), so a
  not-yet-run reseed cannot break the UI — only leaves wasted tokens until done.

## 8. Out of scope
- Advisor/advisee + all-time-collaborator COI gates (net-new, §12.7 — separate work).
- Ripping out `affiliationHistory` producers (deferred dead-code review).
- Email-domain-based institution matching.
