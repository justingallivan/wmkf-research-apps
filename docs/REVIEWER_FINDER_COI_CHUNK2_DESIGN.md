# Reviewer Finder — COI Chunk 2: institution COI + advisory retirement (Design / Pre-Impl)

> Status: **DESIGN — pre-impl, for Codex review. NOT BUILT.**
> Author: Claude (S240, 2026-06-10). Builds on Chunk 1 (shipped, `b19b3b9`).
> Policy: [[project-reviewer-coi-rely-on-self-disclosure]] (Justin S240). Prior design +
> Chunk-1 context: `docs/REVIEWER_FINDER_PI_IDENTITY_WIREIN_PLAN.md` §9.

## 1. Goal & decided policy

Apply the S240 COI policy to the live pipeline. The foundation's rule (Justin S240): **hard-act
only on self-evident POLICY conflicts the PD needn't verify (proposal authors + CURRENT
same-institution); rely on reviewer self-disclosure for relationship/inferred conflicts; do NOT
emit PD-unverifiable soft flags.** Four changes:

- **A. Institution COI uses the accurate (structured) PI institution.** Today the hard drop +
  soft flag run off the LLM-extracted `authorInstitution`, which is sometimes hallucinated
  (Chunk-1 §12.2 "Wayne State"). Prefer the Chunk-1-resolved structured PI institution.
- **B. REMOVE historical / former-shared institution COI** (shipped S229) — neither drop nor flag.
- **C. RETIRE the AI `POTENTIAL_CONCERNS` amber advisory** (shipped S229) — the canonical
  PD-unverifiable inferred flag.
- **D. Prefer ORCID-current affiliation** over OpenAlex stale `last_known_institutions[0]` for the
  PI institution.

**Co-author COI grading stays** (factual shared-paper counts — verifiable, Justin S240).

## 2. Key simplification vs. the earlier framing

The Chunk-1 doc (Codex #4) assumed a *one-pass multi-institution helper* (union of LLM +
structured institutions) and worried about `markInstitutionCOI` overwriting. **That is no longer
needed.** Institution COI is about ONE institution — the PI's. The structured value and the LLM
value are two estimates of the *same* institution; the structured one is authoritative. So the
design is **prefer-structured-else-LLM (a single value)**, not a union. This obviates the
multi-institution helper and the overwrite bug entirely.

```
piInstitution = (piIdentity?.resolved && piIdentity.institution) || authorInstitution || null
```

## 3. Current state `[VERIFIED via source 2026-06-10]`

- **Hard drop:** `DeduplicationService.filterConflicts(researchers, authorInstitution)`
  (`deduplication-service.js:351-375`) — current-affiliation match only, returns the kept array.
  Called inside `DiscoveryService.discover()` (`discovery-service.js:259`) with
  `proposalInfo.authorInstitution`. `discover(analysisResult, options)` destructures options at
  `discovery-service.js:102-110` (easy to extend).
- **Soft flag:** `markInstitutionCOI(researchers, authorInstitution)` (`deduplication-service.js:265-309`)
  — scans current affiliation (274-279) AND `affiliationHistory` (288-295), sets
  `institutionCOIDetails.historical` (305). Called at `discover.js:295` (verified/Track A) and
  `discover.js:413` (discovered/Track B) with `authorInstitution`, and `enrich-contacts.js:143`
  with the client-sent `authorInstitution` + `orig.affiliationHistory`.
- **Historical badge:** `pages/reviewer-finder.js:246` and
  `shared/components/reviewers/ReviewerSearchSection.js:228` render "Former shared institution" vs
  "Same institution" off `institutionCOIDetails?.historical`. Persisted via
  `pruneCandidateForRoster` (`reviewer-search-logic.js:187`).
- **`affiliationHistory` producers:** `discovery-service.js:661,1662-1667` (PubMed
  `collectAffiliationHistory`), `:877` (ORCID spine), `deduplication-service.js:206` (merge). After
  B, the only COI *consumer* (the historical scan) is gone.
- **POTENTIAL_CONCERNS:** parse/normalize `parseAnalysisResponse` + `isNoConcernText`
  (`reviewer-finder.js:232-258,371-376`); render `pages/reviewer-finder.js:183,257-259` +
  `ReviewerSearchSection.js:157-158,255`; persist `reviewer-search-logic.js:191`; prompt
  instruction `reviewer-finder.js:106` + `reviewer-finder-dynamics.js:115` (byte-parity test);
  live row reseeded via `scripts/seed-reviewer-finder-prompts.js --execute`. The S229 prompt also
  forces **REASONING = fitness-only, COI forbidden there** (COI routed to POTENTIAL_CONCERNS).
- **PI institution:** `resolveProposalPI` returns `institution: author.lastKnownInstitution`
  (`proposal-pi-identity.js:~212`). Chunk 1 ALREADY calls `ORCIDService.getProfile` in
  `fetchOrcidRegistryName`; `getProfile` returns `currentAffiliation` (`orcid-service.js:308`).
- **`enrich-contacts.js` has NO `requestId` and no Dynamics bypass** (`req.body = { candidates,
  options, authorInstitution }`, `:66`; `requireAppAccess` only). It cannot resolve the PI today.

## 4. Design

### A. Structured institution into the hard drop + soft flag
- `discover.js` already resolves `piIdentity` (Chunk 1). Compute `piInstitution` (prefer-structured)
  once and:
  - pass it to `DiscoveryService.discover(analysisResult, { ...options, piInstitution })`; inside
    `discover()` use `piInstitution || proposalInfo.authorInstitution` for the `filterConflicts`
    hard drop (`discovery-service.js:259`).
  - pass it to the two `markInstitutionCOI` calls (`discover.js:295,413`).
- **`enrich-contacts.js` parity (Codex #8):** add optional `requestId` to its body + a Dynamics
  bypass + `resolveProposalPI`, and use `piInstitution || authorInstitution` in its recompute
  (`:143`). Plumb `requestId` from the client call site. Fail-open: no requestId → today's
  behavior. Without this, the enrich recompute would clobber a structured-institution flag set in
  discover (the Codex #8 clobber).

### B. Remove historical-institution COI
- `markInstitutionCOI`: delete the `affiliationHistory` scan (288-295) + the `historical` field;
  match CURRENT affiliation only. `institutionCOIDetails` becomes `{ piInstitution,
  reviewerInstitution }`.
- Both cards: drop the `historical` branch → badge reads "Same institution as PI" (one form).
- `enrich-contacts.js:144`: stop passing `affiliationHistory` into the recompute.
- **Leave the `affiliationHistory` PRODUCERS in place** (collectAffiliationHistory, ORCID spine,
  merge) — out of scope and lower-risk; they become COI-inert. Note as deferred dead-code review in
  [[project-deferred-code-cleanup]] (don't rip producers out in this chunk).

### C. Retire POTENTIAL_CONCERNS
- **Code (load-bearing retirement):** remove the parse (`parseAnalysisResponse` POTENTIAL_CONCERNS
  block + `isNoConcernText`), both card renders, and the `pruneCandidateForRoster` persist. Once
  parse/render are gone, any lingering model output is inert — so the code retirement does NOT
  depend on the prompt reseed.
- **Prompt (coupled operational step):** reseed `reviewer-finder.analyze` to drop the
  POTENTIAL_CONCERNS field AND keep/strengthen "REASONING = fitness only; do NOT discuss COI
  anywhere" so removing the field doesn't push COI back into REASONING (the original S229 bug).
  Update both `reviewer-finder.js` + `reviewer-finder-dynamics.js` (byte-parity test) and run
  `seed-reviewer-finder-prompts.js --execute` against prod Dataverse. **Operational: needs prod
  creds — likely Justin runs the reseed** (the analyze prompt is Dataverse-resolved at runtime;
  editing source alone is inert in prod — [[project-reviewer-coi-concern-surfacing]]).

### D. Prefer ORCID-current affiliation
- Extend Chunk-1's `fetchOrcidRegistryName` (already calls `getProfile`) to also return
  `currentAffiliation`; `resolveProposalPI` returns
  `institution: profile.currentAffiliation || author.lastKnownInstitution`. One getProfile call
  serves both the name guard and the affiliation (no extra round trip).

## 5. Open questions

- **Q1 (the real one) — Track A current-same-institution: hard drop or keep the soft flag?** Today
  Track B (discovered) is HARD-DROPPED by `filterConflicts`; Track A (Claude-suggested, verified)
  is only soft-FLAGGED by `markInstitutionCOI`. The decided policy says "current same-institution
  is a correct hard drop." Strict consistency → hard-drop Track A too (apply `filterConflicts` to
  verified candidates), and `markInstitutionCOI` collapses away. BUT a current-same-institution
  flag is *verifiable* (not the unverifiable kind Justin nixed), so keeping it on Track A for PD
  visibility is also defensible. **Recommend: Justin decides.** Default if unspecified: keep the
  Track A soft flag (current-only), minimal behavior change.
- **Q2 — enrich-contacts plumbing:** OK to add `requestId` + a bypass to `enrich-contacts` and its
  client call site (the parity fix), or keep it client-institution-only this chunk and accept the
  clobber risk until then?
- **Q3 — prompt reseed ownership/safety:** confirm the reseed wording (drop POTENTIAL_CONCERNS,
  keep COI out of REASONING) and who runs `--execute` against prod. Until reseeded, the live prompt
  still emits POTENTIAL_CONCERNS but the code ignores it (safe, just wasted tokens).
- **Q4 — `institutionCOIDetails` shape:** `[VERIFIED via grep]` the `institutionCOIDetails`
  OBJECT has several consumers (`coiRecomputed` merges `reviewer-finder.js:1077,1134` +
  `reviewer-search-logic.js:48`; markdown export `reviewer-finder.js:1325`; `enrich-recommended.js:449,477`;
  `pruneCandidateForRoster:187`) — KEEP it as `{ piInstitution, reviewerInstitution }`. But the
  `.historical` FIELD is read ONLY by the two badges (`reviewer-finder.js:246`,
  `ReviewerSearchSection.js:228`) + a now-stale comment (`enrich-contacts.js:128`). Safe to drop
  the `.historical` field only; the object stays.
- **Q5 — recall:** removing the historical flag is a strict reduction in flags (good per policy);
  switching the hard drop to the structured institution can drop MORE real same-institution people
  (correct per policy) and FEWER wrong-institution people (recall gain). Confirm acceptable.

## 6. Files touched
- `lib/services/deduplication-service.js` — `markInstitutionCOI` current-only (remove history);
  (Q1) maybe nothing else.
- `lib/services/discovery-service.js` — `discover()` accepts `options.piInstitution` for the
  `filterConflicts` drop.
- `lib/services/proposal-pi-identity.js` — D: return ORCID-current affiliation (extend
  `fetchOrcidRegistryName`).
- `pages/api/reviewer-finder/discover.js` — compute `piInstitution`, thread to discover() +
  markInstitutionCOI.
- `pages/api/reviewer-finder/enrich-contacts.js` (+ client) — Q2 parity: requestId + structured.
- `shared/config/prompts/reviewer-finder.js` + `reviewer-finder-dynamics.js` — C: drop
  POTENTIAL_CONCERNS, harden REASONING-no-COI; `scripts/seed-reviewer-finder-prompts.js --execute`.
- `pages/reviewer-finder.js`, `shared/components/reviewers/ReviewerSearchSection.js` — remove
  historical badge + POTENTIAL_CONCERNS render.
- `shared/components/reviewers/reviewer-search-logic.js` — drop `potentialConcerns` +
  `historical` from `pruneCandidateForRoster`.
- Tests: `markInstitutionCOI` current-only; discover/enrich institution preference; parse no longer
  emits POTENTIAL_CONCERNS; byte-parity test updated.

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
