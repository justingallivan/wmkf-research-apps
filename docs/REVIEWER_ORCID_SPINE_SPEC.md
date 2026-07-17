---
title: "Reviewer Finder — OpenAlex+ORCID Identity Spine (Track-A verifier) — SPEC"
domain: reviewer-identity
kind: spec
status: active
summary: "- [NEW] lib/services/openalex-service.js — author search only (presence + ORCID discovery + institution + topics). NEVER trusted for..."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - lib/services/discovery-service.js
  - lib/services/openalex-service.js
  - lib/services/orcid-service.js
  - lib/services/reviewer-identity-resolver.js
---

# Reviewer Finder — OpenAlex+ORCID Identity Spine (Track-A verifier) — SPEC

Status: **Implemented for the PubMed-skip slice**. Implements the "smallest valuable slice" of
the cross-field identity spine from `REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md`
§4.1/§4.3/§6, scoped to the **PubMed-off / non-biomedical Track-A path first**. Builds
on the shipped S232 provenance DTO (commit `9882eec`) and the §5.1 hardening fixes
(commit `53206b7`). `[VERIFIED]` = read from current source; `[PROPOSED]` = this spec.

## 1. Problem & goal
`[VERIFIED]` Track-A verification (`verifyClaudeSuggestions`, `lib/services/discovery-service.js`)
is PubMed-only. For non-biomedical proposals PubMed can't cover/verify the field, so the
§5.1 fix routes those suggestions to the read-only "unverified" bucket — correct (no more
laundering) but it leaves *every* physics/astro/chem reviewer unselectable even when they're
the right people (e.g. request 1002794: 12 correct attosecond physicists, 0 selectable).

**Goal:** add an ORCID-anchored, OpenAlex-discovered, **constrained-select-or-abstain**
identity verifier that runs on the PubMed-off / non-biomedical Track-A path, returning
`confirmed`/`probable`/`unresolved` so the right physics names become **selectable** and the
ambiguous/fabricated ones **abstain to needs-review** — never "closest plausible person."

## 2. Empirical basis (two shadow evals this session; analyze is stochastic so the
## suggestion sets differ slightly — figures attributed per run, NOT blended)
`[VERIFIED via probe]`
- **Naive name→top-1 is unsafe** (`eval-orcid-spine-sweep.mjs`, **82 names / 7 fields**):
  29% cross-source ORCID conflict (24/82); **47% affiliation mismatch** (36/77 where both
  present); OpenAlex's own #1 hit is frequently a namesake (Robert Sang→Florida State, not
  Griffith; Olga Smirnova→Technion, not Max-Born).
- **Constrained selection + abstain eliminates proxy-labeled confident-wrong in this run**
  (`eval-orcid-spine-constrained.mjs`, **84 names / 7 fields**): of **39** top-1 affiliation
  mismatches under the harness's proxy ground truth, **18** selected a rank>1 record that matched the
  claimed context, **21** abstained, and **0** still asserted the proxy-mismatching rank-1 record.
  This is evidence that constraint + abstention reduces risky assertion; it is **not** an independently
  labeled person-level finding that 39 real identities were wrong and zero remain wrong.
- **Resolution rate** (same 84-name run): CONFIRMED 39% (33/84) + PLAUSIBLE 27% (23/84) =
  **66% resolved**, **33% abstain** (28/84 → needs-review, includes correctly-rejected
  fabrications: count=0 for "Sigal Itzkovitz", misspelled "Alexandria Landsman", "Andres Bhatt").
- **ORCID coverage is high** (82-name sweep: 76/82 had an ORCID somewhere ≈ **93%**; only 6
  `NO_ORCID`, of which most were count=0 fabrications/wrong-names — the genuine
  real-person-without-ORCID cases were a small single-digit minority of this senior sample,
  not yet measured on the early-career tail (stratum 3)).
- **Lesson:** affiliation+topic match is the PRIMARY signal; **ORCID-employment corroboration is
  a noisy bonus, NOT a gate** (Keller@ETH, Dudovich@Weizmann are right but show no ORCID-employment
  corroboration because ORCID employment data is unevenly populated).

## 3. Architecture (reuse, don't rebuild)
```
suggestion(name, claimedInst, expertiseAreas, field)
   └─> [NEW] OpenAlexService.searchAuthors(name)  → top-N author records
   └─> [NEW] identity-evidence adapter: constrained-select-or-abstain  (§5)
                 │  selects the record matching affiliation/topic, or abstains
                 ├─> [EXISTING] ORCIDService  → corroborate selected record's ORCID (bonus)
                 └─> emits resolver-ready evidence/anchors  (§6)
   └─> [EXISTING] ReviewerIdentityResolver.classify(evidence) + NEW anchor rules (§6)
                 → confirmed | probable | ambiguous | unresolved
   └─> map to verificationStatus + provenance + UX disposition (§7)
```
- **`[NEW]` `lib/services/openalex-service.js`** — author search only (presence + ORCID
  discovery + institution + topics). NEVER trusted for works_count/citation metrics.
- **`[EXISTING]` `lib/services/orcid-service.js`** — `searchByName` (strict) + employments fetch.
- **`[NEW]` evidence adapter** (a hypothesis-builder per plan §4.3) — fetches/selects, builds
  clusters/anchors; **must not set persistence gates** (resolver owns that).
- **`[EXISTING]` `lib/services/reviewer-identity-resolver.js`** — pure classifier; extend its
  **input anchors** + add rules (§6), do not give it fetching responsibility.

## 4. `[PROPOSED]` OpenAlexService.searchAuthors(name, opts) contract
Returns up to N (default 10) author records, each:
```
{ openAlexId, displayName, orcid|null, lastKnownInstitution|null,
  topics: string[]   // x_concepts display_names, score>25, top ~8
  worksCount         // CARRIED FOR DEBUG ONLY — never used for ranking/selection
}
plus: { totalCount }  // OpenAlex meta.count — the collision signal
```
- Authenticate with server-only `OPENALEX_API_KEY`; optional
  `OPENALEX_POLITE_MAILTO` is contact metadata only and provides no quota.
  Honor `AbortSignal`, timeout, and rate-aware retry policy (§8).
  `api.openalex.org` is already in `lib/utils/safe-fetch.js` allowlist.

## 5. `[PROPOSED]` Constrained selection + abstain (the core)
Input: the N records + `claimedInstitution` (Claude's `suggestedInstitution`) + `fieldText`
(`proposalInfo.primaryResearchArea` + candidate `expertiseAreas`).
- For each record compute `affMatch` (token overlap of claimedInstitution vs record institution,
  stop-word stripped) and `topicMatch` (token overlap of fieldText vs record topics).
- **Select** the record maximizing `(affMatch?2:0) + (topicMatch?1:0)` among records with
  `affMatch || topicMatch`. **If none match → ABSTAIN.**
- Tie-break is deterministic and MUST NOT be works_count-dominant (collision names have a
  high-works namesake at rank 1 — that's the trap). Prefer affiliation, then topic, then a
  stable id order.
- **Hard rule: never select a record that matches neither affiliation nor topic.** Abstain is
  always preferred over "closest." (This is what drove confident-wrong to 0 in the eval.)

## 6. `[PROPOSED]` Resolver input adapter + new anchor rules
The adapter emits anchors for the SELECTED record (or none if abstain):
- `affiliation_match` (selected institution corroborates claimed/proposal context) — **strong**
  when ORCID-employment ALSO corroborates, otherwise **weak**.
- `topic_match` — **weak** anchor.
- `orcid_present` + `orcid_employment_corroborated` (independent ORCID `/employments` check) — the
  promoter to **strong**; **absence is NOT a demoter** (uneven ORCID data — eval lesson).
- `cross_source_orcid_agreement` (OpenAlex inline ORCID == ORCID-direct top ORCID for the SELECTED
  record's identity) — corroborator; disagreement → at most `ambiguous`, never "best match".
New resolver rules (consistent with current weak/strong model — 1 strong OR 2 weak → `probable`):
- `confirmed`: affiliation_match (strong, i.e. ORCID-employment-corroborated) **and** topic_match.
- `probable`: affiliation_match (weak) + topic_match; or affiliation_match strong alone.
- `ambiguous`: high collision count + cross-source ORCID disagreement on the selected record.
- `unresolved`: ABSTAIN (no record matched) **or** zero presence anywhere (fabrication).
`confirmed` must remain reachable (plan §3 notes it is currently unreachable on ORCID/Scholar-only
rules) — the affiliation+ORCID-employment anchor is what unlocks it.

## 7. `[PROPOSED]` Track-A integration, provenance, UX
Where it runs (sequencing — smallest slice): when `verifyClaudeSuggestions` would SKIP PubMed
because `pubMedVerificationContract.enabled === false` (today, `searchPubmed === false`), instead
of routing straight to unverified, run the ORCID-spine verifier per suggestion. Non-biomedical
auto-skip remains a TODO outside this slice.
- **Do NOT touch the PubMed (biomedical) path in this slice.** Keep §5.1 fix-10 (coarse namesake
  guard) as a backstop. (Biomedical ORCID-spine + cross-source corroboration is a later slice.)
Mapping → verificationStatus + provenance + UX:
| Resolver result | verificationStatus | provenance.sources | UX |
|---|---|---|---|
| `confirmed`/`probable` | `verified`/`probable` | += `openalex`,`orcid` (verificationSource `orcid`) | **selectable**; ORCID iD attached |
| `ambiguous` | `unresolved` | += `openalex` | needs-review (visible) |
| `unresolved` (abstain) | `unresolved` | unchanged | needs-review; if `proposal_named`/`applicant` → selectable-with-"identity-unverified"-flag (ties to the separate proposal_named-selectable change) |
Provenance `kind` stays the candidate's origin (`literature_retrieved`/`proposal_named`); only
`sources`/`verificationSource`/identity status change. Never infer identity from `isClaudeSuggestion`.

## 8. `[PROPOSED]` Fan-out / budget / rate limits
- Per suggestion: 1 OpenAlex search + (selected w/ ORCID) 1 ORCID `/employments` (+ optional 1
  ORCID-direct search for the agreement signal). Cap concurrency; honor the existing
  `reviewer.time_budget_seconds` + `AbortSignal` + per-source timeout/retry (plan §4.4). 1 retry on
  429/5xx, none on 4xx. Partial failure → `sourceStatus` ok/timeout/error; a source outage
  fails OPEN to abstain (needs-review), never to a wrong verify.
- OpenAlex API-key budget; ORCID public API. Only public names leave the system.

## 9. Out of scope (deferred — labeled TODOs)
- Biomedical/PubMed ORCID-spine + cross-source corroboration (later slice).
- Full publication-cluster anchor (forename/co-author/affiliation-history clustering) — §4.3 full.
- Richer PubMed XML (ORCID `Identifier`, MeSH, initials) — §8 prereq for the biomedical side.
- Removing §5.1 fix-10 (keep as backstop until shadow-run clears it).
- OpenAlex metrics/works_count for ranking (BARRED — fragmented per §2.3).

## 10. `[PROPOSED]` Shadow-run plan (before cutover)
Reuse/extend `eval-orcid-spine-constrained.mjs`:
- **Stratum 1/2 (done):** common-name collisions + no-ORCID — constrained selection drove
  confident-wrong to 0 on 84 senior names.
- **Stratum 3 (TODO before cutover):** early-career + genuinely-no-ORCID, via cited-reference
  authorship ground truth (resolve a sample of proposal DOIs/PMIDs → real bylines incl.
  first-author postdocs → measure right-person recall/abstain). This is the untested tail.
- Cutover gate: confident-wrong ≈ 0 maintained on stratum 3, abstain rate acceptable, latency
  within budget. Compare against PubMed-path control (biomedical) for regressions.

## 11. `[PROPOSED]` Test plan
Unit: OpenAlexService parse/abstain; constrained-selection (Robert-Sang-rank-4 recovery;
Smirnova abstain; fabrication count=0 → unresolved); resolver new-anchor rules
(confirmed reachable; ORCID-absence not a demoter; ORCID-disagreement → ambiguous);
Track-A integration (non-bio/PubMed-off → spine runs; biomedical → unchanged).
Gates: `npm run build` (Claude runs locally — NOT in the Codex sandbox), `npx jest reviewer
discovery analyze pubmed verification provenance contact orcid openalex`,
`check:api-routes`, `check:atlas` if any persistence shape changes.

## 12. Resolved decisions for implementation slice
1. **Trigger:** run this spine only when `pubMedVerificationContract.enabled === false`
   (today, `searchPubmed === false`). Do not change what causes PubMed to be skipped;
   non-biomedical auto-skip remains a labeled TODO outside this slice.
2. **Disposition tightening:** topic-only match resolves to `unresolved` / needs-review and is
   never selectable. `probable` requires an `affiliation_match`. `confirmed` requires strong
   affiliation/employment corroboration plus independent topic/publication evidence; affiliation
   alone can never confirm. ORCID absence is not a demoter, but no qualifying anchors fails closed
   to `unresolved`.
3. **Source fetching:** reuse `lib/services/orcid-service.js` for ORCID search/employments. Add
   `lib/services/openalex-service.js` for API-key-authenticated OpenAlex author search through
   `safeFetch`; optional mailto is contact metadata only. Fetch ORCID-direct/employments only for the selected record and
   tie/conflict cases, not every candidate.
4. **Abort and outages:** plumb the route deadline `AbortSignal` from `discover.js` through
   `DiscoveryService.discover`, `verifyClaudeSuggestions`, the evidence adapter, and OpenAlex/ORCID
   fetches. Use per-source timeout plus one retry on 429/5xx and no retry on 4xx. Source outage
   abstains to unresolved; partial topic evidence never verifies.
5. **Cutover scope:** keep the cutover criteria above; this slice is naturally gated because it only
   fires on the PubMed-skip branch. Keep §5.1 fix-10 untouched on the PubMed-on path.
