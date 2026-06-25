---
agent_wiki: topic
status: active
last_verified: 2026-06-24
stale_after_days: 60
owner: reviewer-finder
source_files:
  - pages/api/reviewer-finder/discover.js
  - pages/api/reviewer-finder/analyze.js
  - lib/services/discovery-service.js
  - lib/services/openalex-service.js
  - lib/services/orcid-service.js
  - lib/services/pubmed-service.js
  - lib/services/deduplication-service.js
  - lib/utils/reviewer-provenance.js
canonical_docs:
  - docs/REVIEWER_FINDER_SPARSE_PROPOSAL_ANCHOR_STRATEGY.md
  - docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md
  - docs/REVIEWER_FINDER.md
  - docs/APPLICATION_STATE_ATLAS.md
watch_paths:
  - pages/api/reviewer-finder/discover.js
  - pages/api/reviewer-finder/analyze.js
  - lib/services/discovery-service.js
  - lib/services/openalex-service.js
  - lib/services/orcid-service.js
  - lib/services/pubmed-service.js
  - lib/services/deduplication-service.js
  - lib/utils/reviewer-provenance.js
update_triggers:
  - reviewer origination / retrieval lane changes
  - ranking signal weight changes
  - provenance model changes
  - dedup / union-coverage behavior changes
---

# Reviewer Origination & Retrieval

Use this page before work on how reviewer candidates are *generated* — retrieval
lanes, provenance, ranking, and the recall-vs-precision posture. For who a
candidate *is* (identity, contact, COI, PI identity), use the
[Reviewer Identity](reviewer-identity.md) page instead.

## Genesis & corrected posture (READ FIRST)

**The tool worked in production (J26).** Claude proposes a candidate pool → staff
curate against priorities, using the surfaced papers to drop the occasional bad one
→ reviewer *declines* yield referral suggestions. That human-in-the-loop,
recall-oriented workflow produced usable panels. This lived-success signal is the
strongest evidence we have, and it was systematically under-weighted during the
redesign (the origination plan's §1 "stop mining J26" caveat was right about the
narrow *causal* question but had the side effect of discounting the *workflow*
success — a different, valid signal).

**Why the retrieval-first detour happened (S231).** A validation pass became a
bug-hunt that found two different things and conflated them: (a) a REAL verify-path
bug — hallucinated forenames laundering into real near-namesakes (a fabricated "Dr.
Alfred Laederach" verified against the real Alain Laederach at 100% confidence),
which justified a proportionate verify/identity fix; and (b) a theory critique —
"LLM-as-generator is stale / senior-biased / hallucination-prone." (a) got the right
fix (forename/exact-existence gate, field-aware verification, recency ranking —
shipped). (b) got OVER-extrapolated into "demote Claude from candidate generator to a
non-naming retrieval-first engine" — an inference from Claude's failure modes that was
NEVER measured against whether grounded retrieval *originates* better.

**S246 measured it: Claude wins** (`project-reviewer-origination-experiment-result`).
The extrapolation was wrong — the off-organism noise came from the *grounded* arm, not
Claude (origination probe, 1002878: every plant-virologist candidate was grounded-arm
only). The pipeline's weak link is DOWNSTREAM identity resolution (see the
namesake-collision worked example in `reviewer-identity.md`), not origination.

**Corrected posture:**
- KEEP Claude as the origination engine — recall-oriented, human-curated.
- KEEP the edge-hardening the detour produced: exact-existence/forename gate,
  field-aware + (next) ORCID-anchored resolution, recency ranking, recall-over-precision
  (review is a floor, not a ranker), referral capture, and §12/multilane as a TARGETED
  tool for the genuinely-sparse tail ONLY.
- PARK retrieval-first inversion as the *primary engine* (deferred by S246; §12/multilane
  remains valid + unrefuted as a sparse-tail tool, just not the engine).
- CAUTION — don't over-correct the over-correction: Claude's senior-bias and the
  niche/pivot/sparse tail are REAL (the S231 probe found 2/10 analyze under-deliveries).
  Keep *targeted* hardening for that tail; just don't mistake it for an engine problem.
- MODEL — origination now runs on **Opus 4.8** by default, not Sonnet (S286,
  baseConfig `reviewer-finder`: `{ model: 'opus', fallback: 'sonnet' }`). On a niche
  out-of-mainstream proposal (synthetic torpor; req 1002821) Sonnet 4.6 fell into a
  token-repetition/hallucination loop: it could confidently name only the ~6 reviewers
  the applicant already cited in the proposal prose, then padded the fixed 15-quota with
  an invented, repeated name ("Dr. Bhanu Bhanu") until truncation — intermittently
  hard-failing the whole search (`analysis_invalid`). Opus 4.8 handled the same proposal
  cleanly on the first attempt and added real *independent* names. Two code guardrails
  shipped with it: (1) a code-owned anti-fabrication block (`ANALYZE_INTEGRITY_BLOCK`,
  appended by `composeAnalyzePrompt` so it survives a Dataverse prompt override) telling
  the model to return FEWER real reviewers rather than pad; (2) first-attempt token budget
  raised 4096→8192 (`ClaudeReviewerService.MAX_TOKENS`). **Caveat:** live model resolution
  is governed by the `model_override:reviewer-finder:model` admin setting in Dataverse
  `wmkf_appsystemsettings` (loaded via `loadModelOverrides()`), which takes precedence
  over baseConfig — switching prod to Opus requires clearing/updating that override in
  `/admin` (and confirming no `CLAUDE_MODEL_REVIEWER_FINDER` env var pins it in Vercel). Opus 4.8 also deprecates the `temperature` API param (`llm-client`
  omits it for that model); the reviewer-finder had no temperature UI control and the dead
  route-level plumbing was removed.

Read the `## Direction` bullets below as the lane mechanics under this posture — a
sparse-tail toolkit, not a mandate to replace Claude.

## Direction (validated, mostly NOT BUILT)

- **Multi-lane origination is the validated direction (S239), not yet built.**
  Lanes: cited-DOI, PI-trail (ORCID works list), peer-groups, topic→author
  aggregation. **Coverage = union of lanes; confidence = convergence ON IDENTITY,
  not on name.** The keyword *mechanism* was the disease, not keywords per se.
  Canonical: `docs/REVIEWER_FINDER_SPARSE_PROPOSAL_ANCHOR_STRATEGY.md` §12; memory
  `project-reviewer-origination-multilane`.
- **Retrieval-redesign framing (S231):** demote the Claude generator to a
  field-routed retrieval/fan-out over an OpenAlex+ORCID spine, reusing the existing
  resolver + ranker. Canonical: `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md`;
  memory `project-reviewer-finder-retrieval-redesign`.
- **Recall-over-precision reframe (S238):** review is a floor/gate, not a ranker.
  Optimize coverage/spread, surface-don't-silently-drop, grade COI rather than hard
  hide where policy doesn't require it. Canonical: redesign plan Part C; memory
  `project-reviewer-recall-over-precision`.
- **Forward sniff-test experiment RESULT (S246):** a pilot of the plan's forward
  decision experiment ran on 10 D26 Phase-I proposals (PD sniff test substituting
  for accept/decline). **Claude-assisted origination beat the *minimal* grounded arm**
  (OpenAlex topic→author aggregation + cited-refs) — 65% vs 35% pick-rate where
  quantified; grounded full of wrong-field/deceased/trainee candidates; it re-found
  the applicant's own recommended reviewers 1/50 vs Claude's 11/50. **Keep Claude as
  the origination spine; defer retrieval-first cutover.** Crucial precision (avoid
  overclaim): the arm that lost was a **bare** topic→author aggregation (no ORCID-works
  anchoring, no field-routed expansion), NOT the ORCID-works-anchored multilane design.
  §12 itself treats topic→author aggregation as a *valid* lane, and the OpenAlex-merge
  hazard below is specifically about an author *cluster as a named-person/PI corpus* —
  so this does NOT refute the multilane direction or that lane. Canonical:
  `docs/REVIEWER_FINDER_ORIGINATION_EXPERIMENT_2026-06-12.md`; memory
  `project-reviewer-origination-experiment-result`.

## Track B — archived working code (storage shed)

**Status: OFF, archived in code (S248).** `DiscoveryService.TRACK_B_ENABLED = false`
(`lib/services/discovery-service.js`) gates the four Track-B DB-search blocks. The code
is **intact and dormant**, kept for future repurposing — flip the one constant to
re-enable. This is a code-level switch by design, **NOT** an admin/user toggle and **NOT**
`searchPubmed` (that flag also routes Track-A verification via `suggestionVerifierRouting`,
so flipping it would change Track A — the coupling trap).

**What Track B was:** the second origination lane — Claude's `analyze` step *used to* emit
`searchQueries` (keyword queries per source); Track B runs them against **PubMed / arXiv /
bioRxiv / chemRxiv** (`searchPubMed`/`searchArXiv`/`searchBioRxiv`/`searchChemRxiv`) and
turns the **authors of matching papers** into new candidate reviewers, then resolves the top
`TRACK_B_IDENTITY_RESOLUTION_LIMIT` (=25) through the OpenAlex/ORCID spine and dedups against
the Track-A verified set. The `discovery-service` search machinery is preserved, but the
**prompt-side query generation (analyze PART 3) was removed S253** — `analyze` now emits an
empty `searchQueries` shape (Track-B-only output, dead while the lane is off). Re-enabling the
lane therefore needs the queries regenerated too (see "To re-enable" below).

**Why archived (the evidence):**
- **~0 contribution to saved panels** last cycle — `scholarly-only-saved ≈ 0` by
  construction (pre-resolution dedup + the 25-cap identity budget + the save-gate reject
  unresolved system-discovered rows). See `REVIEWER_FINDER_ORIGINATION_PLAN.md` §1.
- **Noise on thin Phase-I signal** — attribution on 1002878 (S248): every plant-virologist
  candidate was Track-B/grounded-only (organism-blind topic→author aggregation); it also
  surfaces trainees (PI-vs-trainee indistinguishable) and deceased figures.
- **Latency** — A/B isolation (`scripts/profile-trackb-ab.mjs`) measured Track B at ~27s
  (≈3× a Track-A-only run; one example local run). Archiving reclaims it.
- Recall is now served by **Claude recall-sampling** — the default candidate count was
  raised **12→15 (SHIPPED S249**, single deeper draw; `DEFAULT_REVIEWER_COUNT` in
  `shared/config/reviewerFinderPreferences.js`) — plus **referral capture (still pending)**,
  not a grounded keyword lane.

**To re-enable / repurpose:** flipping `TRACK_B_ENABLED = true` is **no longer sufficient on its
own** — the analyze prompt's PART 3 query generation was removed S253, so the lane would run
against empty `searchQueries`. A re-enable also needs query generation restored (re-add PART 3 to
both `createAnalysisPrompt` and `ANALYZE_USER_PROMPT_TEMPLATE`, plus the parser + the
`prompt-validators` required labels). But if grounded origination is ever revisited properly, do
NOT just re-enable bare Track B — build the **ORCID-works-anchored multilane** (§12) with
organism/field-scoped facets + the trainee/deceased filter, judged on real accept/decline. The
bare keyword→author lane is what underperformed.

## Recurring Hazards

- **Web-discovery via an ungrounded LLM was EVALUATED and ABANDONED (S230).**
  The Perplexity reviewer-agent verifiably hallucinated reviewers and affiliations.
  Do NOT re-attempt ungrounded web discovery. Memory
  `project-reviewer-web-discovery-abandoned`.
- **Ranking: recency must outweigh citations / h-index.** A high-citation but
  inactive author is the wrong pick. Memory `project-reviewer-ranking-recency-over-citations`.
- **Coverage is a union; don't silently drop.** When a lane or filter removes a
  candidate the PD might expect, surface it (excluded-summary) rather than hiding it.
  Count invariants live in memory `project-reviewer-count-invariant`.
- **Proposal-doc context is thin in Phase I (no bibliography).** Phase I under-delivers
  on signal; the next cycle combines Phase I+II with a bibliography assembled by a
  Power Automate flow. Memory `project-reviewer-finder-proposal-doc-context`.
- **OpenAlex MERGES same-name authors.** Use the ORCID works list as the corpus, not
  a name lookup. Memory `project-openalex-merge-use-orcid-works`.
- **Applicant exclusion breadth is an open policy decision** — one vague
  overlapping-program line can over-prune the peer set. Memory
  `project-applicant-exclusion-policy-pending`.
- **Suggestion data is cleaned at ONE chokepoint — `DiscoveryService.normalizeSuggestionSource` (S266).**
  An unverified honorific is stripped from the display name (`stripHonorifics`) and a
  non-page website (e.g. a co-author's paper PDF) is nulled (`sanitizeWebsiteForCandidate`),
  across all three source branches, before verify/display. We never verify titles, so a
  persisted "Prof./Dr." is a fabricated-credential risk — **persisted Dataverse labels lose
  the title (intentional).** Document-file URLs are rejected by the shared
  `ContactParser.isDocumentUrl` at EVERY website/faculty-page surface: the website gate
  (`isUsefulWebsiteUrl`), the faculty-page gate (`SerpContactService.isFacultyPageUrl`), the email
  tier's fetch chokepoint (`_orderCandidateUrls`), and — after a Codex post-impl review caught the
  display/persist fan-out — the `facultyPageUrl` capture/persist/read/render path
  (`contact-enrichment-service.js` Claude-tier capture + side-save, `save-candidates.js`,
  `my-candidates.js`, `CandidatesPanel.js`) plus the `enr.website` render fallback in `mergeEnrichment`.
  **Lesson: a chokepoint/merge guard is NOT enough — `facultyPageUrl` is also persisted to Dataverse
  and rendered as a clickable link, so the guard must reach the persist + read + render surfaces too.**
  Design: `docs/REVIEWER_GENERATION_DATA_QUALITY_DESIGN.md`.

## Durable Memory

- Origination direction and redesign: `project-reviewer-origination-multilane`, `project-reviewer-finder-retrieval-redesign`, `project-reviewer-origination-experiment-result`.
- Recall/ranking/web-discovery: `project-reviewer-recall-over-precision`, `project-reviewer-web-discovery-abandoned`, `project-reviewer-ranking-recency-over-citations`.
- Shipped/next topics and proposal-doc context: `project-reviewer-finder-next-topics`, `project-reviewer-finder-proposal-doc-context`.
- Applicant exclusion policy: `project-applicant-exclusion-policy-pending`.

## Standard Probe

```bash
rg -n "provenanceKind|coverage|union|recencyScore|h_index|citationCount|lane" lib/services lib/utils pages/api/reviewer-finder docs
```

Then read `discovery-service.js` and `discover.js` in full enough to trace lane →
dedup → ranking → provenance before changing origination behavior.
