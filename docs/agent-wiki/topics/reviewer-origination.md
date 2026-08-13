---
agent_wiki: topic
status: active
last_verified: 2026-07-08
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

## Production Signal & Current Posture

**The tool worked in production (J26).** Claude proposes a candidate pool → staff
curate against priorities, using the surfaced papers to drop the occasional bad one
→ reviewer *declines* yield referral suggestions. That human-in-the-loop,
recall-oriented workflow produced usable panels. This lived-success signal is the
strongest evidence we have. The origination plan's §1 "stop mining J26" caveat was
right for the narrow *causal* question, but the workflow success remains a separate
valid signal.

**S231 validation split two concerns.** The verify path needed fixes for hallucinated
forenames laundering into real near-namesakes (for example, a fabricated "Dr. Alfred
Laederach" verifying against the real Alain Laederach at 100% confidence). Those fixes
shipped: forename/exact-existence gate, field-aware verification, and recency ranking.
The separate theory critique — "LLM-as-generator is stale / senior-biased /
hallucination-prone" — led to a proposed retrieval-first inversion that needed direct
measurement against grounded retrieval.

**S246 measured the inversion: keep Claude as the origination spine**
(`project-reviewer-origination-experiment-result`). The off-organism noise came from
the *grounded* arm, not Claude (origination probe, 1002878: every plant-virologist
candidate was grounded-arm only). The pipeline's weak link is downstream identity
resolution (see the namesake-collision worked example in `reviewer-identity.md`), not
origination.

**Owner-stated sourcing constraints (2026-07-08, S349 — see
`.claude-memory/project-reviewer-sourcing-constraints.md`):** applicant-suggested
reviewers capped ~1/panel (recent anti-stacking policy — could evolve); reviewer
reuse is per-PD practice (none currently; a departed colleague reused repeatedly —
STRATEGY.md:81 reflects his practice); referral is a MULTIPLIER on the engine
(never-contacted experts can't refer). So the Claude-assisted engine fills nearly
every panel seat and its slate quality compounds through referral; deprioritize
roster-reuse/applicant-recs-first designs.
Holistic-review analysis: `docs/audits/reviewer-holistic-review-fable-2026-07-08.md`.

**Current posture:**
- Keep Claude as the origination engine — recall-oriented, human-curated.
- Keep the edge hardening the retrieval-first work produced: exact-existence/forename gate,
  field-aware + (next) ORCID-anchored resolution, recency ranking, recall-over-precision
  (review is a floor, not a ranker), referral capture, and §12/multilane as a TARGETED
  tool for the genuinely-sparse tail ONLY.
- Park retrieval-first inversion as the *primary engine* (deferred by S246; §12/multilane
  remains valid + unrefuted as a sparse-tail tool, just not the engine).
- Keep targeted hardening for Claude's senior-bias and the
  niche/pivot/sparse tail are REAL (the S231 probe found 2/10 analyze under-deliveries).
  Treat that tail as a sparse-case toolkit, not an engine replacement.
- Model: origination now runs on **Opus 4.8** by default, not Sonnet (S286,
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

## Direction (Validated Sparse-Tail Toolkit; Mostly Not Built)

- **Multi-lane origination is the validated direction (S239), not yet built.**
  Lanes: cited-DOI, PI-trail (ORCID works list), peer-groups, topic→author
  aggregation. **Coverage = union of lanes; confidence = convergence ON IDENTITY,
  not on name.** The issue was unanchored keyword→author mechanism, not keywords per se.
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

## Track B — Archived Dormant Code

**Status: OFF, archived in code (S248).** `DiscoveryService.TRACK_B_ENABLED = false`
(`lib/services/discovery-service.js`) gates the four Track-B DB-search blocks. The code
is **intact and dormant**, kept for future repurposing — flip the one constant to
re-enable. This is a code-level switch by design, **NOT** an admin/user toggle and **NOT**
`searchPubmed` (that flag also routes Track-A verification via `suggestionVerifierRouting`,
so flipping it would change Track A through coupled behavior).

**What Track B was:** the second origination lane — Claude's `analyze` step *used to* emit
`searchQueries` (keyword queries per source); Track B runs them against **PubMed / arXiv /
bioRxiv / chemRxiv** (`searchPubMed`/`searchArXiv`/`searchBioRxiv`/`searchChemRxiv`) and
turns the **authors of matching papers** into new candidate reviewers, then resolves the top
`TRACK_B_IDENTITY_RESOLUTION_LIMIT` (=25) through the OpenAlex/ORCID spine and dedups against
the Track-A verified set. The `discovery-service` search machinery is preserved, but the
**prompt-side query generation (analyze PART 3) was removed S253** — `analyze` now emits an
empty `searchQueries` shape (Track-B-only output, dead while the lane is off). Re-enabling the
lane therefore needs the queries regenerated too (see "To re-enable" below).

**Archive evidence:**
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
  `shared/config/reviewerFinderPreferences.js`) — plus **shipped referral capture**
  (manual referral and decline-referral one-click add), not a grounded keyword lane.

**To re-enable / repurpose:** flipping `TRACK_B_ENABLED = true` is **no longer sufficient on its
own** — the analyze prompt's PART 3 query generation was removed S253, so the lane would run
against empty `searchQueries`. A re-enable also needs query generation restored (re-add PART 3 to
both `createAnalysisPrompt` and `ANALYZE_USER_PROMPT_TEMPLATE`, plus the parser + the
`prompt-validators` required labels). If grounded origination is revisited, build the
**ORCID-works-anchored multilane** (§12) with
organism/field-scoped facets + the trainee/deceased filter, judged on real accept/decline. The
bare keyword→author lane is what underperformed.

## Operating Notes

- **Route→Service layout (Stage 7, 2026-07-05): the reviewer-finder routes are
  thin shells; origination business logic lives in `lib/services/reviewer-finder/`
  (plus the flat discovery/dedup services).** Routes may not import
  `lib/dataverse/adapters/*` or `lib/services/dynamics-service` — enforced by
  `check:route-service-boundary` (law mode) `[VERIFIED via the gate run at
  census 0, 2026-07-05; docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md]`. Edit the
  service, not the route, when changing lane/ranking behavior.
- **Web-discovery via an ungrounded LLM was EVALUATED and ABANDONED (S230).**
  The Perplexity reviewer-agent produced ungrounded reviewers and affiliations.
  Keep reviewer web discovery grounded before using it. Memory
  `project-reviewer-web-discovery-abandoned`.
- **Ranking: recency must outweigh citations / h-index.** A high-citation but
  inactive author is the wrong pick. Memory `project-reviewer-ranking-recency-over-citations`.
- **Coverage is a union; surface removals.** When a lane or filter removes a
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
- **The find "notes" field (`additionalNotes`) is NOT a name-inclusion guarantee (S318).**
  It IS injected into the analyze prompt as `ADDITIONAL CONTEXT FROM USER`
  (`shared/config/prompts/reviewer-finder.js`, `reviewer-prompt-composer.js`), but three
  code-owned mechanisms downstream defeat a prompt-only "use these names" instruction:
  the fixed target count (`DEFAULT_REVIEWER_COUNT`), the appended anti-fabrication
  `ANALYZE_INTEGRITY_BLOCK` (return FEWER rather than include an unresolvable name), and
  discover-stage verification/ranking. A PD pasting a known-names list into notes will get
  only *some* back — expected, not a bug. Guaranteeing referred/PD-recommended names is now
  a **code-owned seed path**, not prompt wording: seed-only, folded-in; two labels on
  existing kinds — `referred` → "Externally-Referred", `applicant_suggested` →
  "Applicant-Referred", no new enum. S320 also preserves referred provenance/referrer on
  same-normalized-name seed⇄discovery collisions before display and roster persistence:
  `docs/REVIEWER_REFERRAL_SEEDING_DESIGN.md`.
- **HAZARD — the referrer has no Dataverse field; it lives in the match-reason text
  (S249 D1), and the clause owns LINE 1 (S424).** A period cannot terminate the name,
  because titles and middle initials carry one — the original space-joined encoding
  truncated "Dr. Abby Doyle" to "Dr" on reload. The newline is the terminator, so the
  downstream annotations `save-candidates-service.js:1034`/`:1037` append onto a later
  line and can never re-enter the name. Encode/decode is the canonical trio
  `formatReferredByReason` / `splitReferredByReason` / `parseReferredByReason`
  (`lib/utils/reviewer-provenance.js`); route new producers through it rather than
  hand-rolling `Referred by …`, and change both directions together. Display surfaces
  take the referrer AND the rationale remainder from `splitReferredByReason`, so the
  labeled attribution on the Invite card (`ReviewerInvitePanel.js` `CandidateRationale`)
  does not repeat it in the "Why" prose. Rows written before S424 are genuinely
  ambiguous and keep the lossy legacy parse.
- **Results list has a Rank⇄A–Z sort toggle (S318, shipped).** Default is
  confidence/relevance rank; A–Z sorts by name *within* each provenance group (grouping
  preserved). `ReviewerSearchSection.js` `sortMode`.
- **Analyze request metadata now comes from Dataverse; `requestId` is required (S319).**
  Title/PI/Co-PIs/institution/abstract are authoritative on `akoya_request`, so the analyze
  route loads them via `reviewer-request-context.js`, the prompt is slimmed to scientific
  context + reviewer suggestions, and parsed `proposalInfo` is overlaid with trusted
  metadata before consumers see it. Program area remains app-owned Dataverse metadata for
  downstream save compatibility, but is omitted from the prompt entirely. The old
  `PROGRAM_AREA` crash class is also closed at the write boundary:
  `normalizeSuggestionProgramArea()` preserves short labels and drops overlong/placeholder
  values instead of truncating them. Full context:
  `docs/REVIEWER_ANALYZE_PROMPT_METADATA_ISSUE.md`.
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
  `my-candidates.js`, `ReviewerInvitePanel.js`) plus the `enr.website` render fallback in `mergeEnrichment`.
  **Fan-out note:** `facultyPageUrl` is also persisted to Dataverse and rendered as a clickable
  link, so the guard must reach the persist + read + render surfaces too.
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
