---
agent_wiki: topic
status: active
last_verified: 2026-08-29
stale_after_days: 90
owner: product-strategy
source_files:
  - docs/CURRENT_WORK_QUEUE.md
  - docs/SYSTEM_MODEL.md
  - docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md
  - DEVELOPMENT_LOG.md
  - SESSION_PROMPT.md
  - docs/GROUP_B_WRITEUP_SPINE_DESIGN.md
  - docs/audits/AUDIT_REQUEST_WORKBENCH_TRUTH_2026-07-26.md
  - docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md
  - docs/ROR_REVIEWER_FINDING_STRATEGIC_RESET_BRIEF.md
  - outputs/institution-resolution-handoff-to-codex-2026-08-07.md
  - benchmarks/compact-ror-index/results/v2.11-2026-08-03.md
  - benchmarks/fuzzy-matching-falsification/versions/v2/results/2026-08-07-api-candidate-benchmark.md
  - benchmarks/fuzzy-matching-falsification/versions/v3/results/2026-08-07-api-decision-benchmark.md
  - lib/services/reviewer-identity-runtime.js
  - lib/services/pre-site-visit/distribution-service.js
  - lib/services/ror-institution-candidate-adapter.js
  - lib/services/ror-institution-decision.js
  - lib/services/ror-institution-identity-resolver.js
canonical_docs:
  - docs/CURRENT_WORK_QUEUE.md
  - docs/SYSTEM_MODEL.md
  - docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md
  - DEVELOPMENT_LOG.md
  - docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md
watch_paths:
  - docs/CURRENT_WORK_QUEUE.md
  - docs/SYSTEM_MODEL.md
  - DEVELOPMENT_LOG.md
  - SESSION_PROMPT.md
  - docs/**/*ROADMAP*.md
  - docs/GROUP_B_WRITEUP_SPINE_DESIGN.md
  - benchmarks/compact-ror-index/**
  - benchmarks/fuzzy-matching-falsification/versions/v2/**
  - benchmarks/fuzzy-matching-falsification/versions/v3/**
  - lib/services/reviewer-identity-runtime.js
  - lib/services/pre-site-visit/distribution-*.js
  - lib/services/ror-institution-*.js
update_triggers:
  - roadmap or phasing changes
  - cross-capability architecture changes
  - backend automation/post-award planning changes
---

# Strategy & Roadmap

Use this page for system model, roadmap, grant-cycle phasing, planned review
pipeline/proposal extracts, backend automation, interim reports, post-award work,
and broad AI capability planning.

Start with `docs/CURRENT_WORK_QUEUE.md` for ordered commitments. The catalog is a
document inventory, and individual implementation plans do not establish priority.

## Durable Memory

- **Reviewer matching sequencing (S403, 2026-08-06):** the Find-tab candidate-card
  redesign AND the containment-first institution comparison fix are both downstream of
  the fuzzy-matching model decision — the research's three-band decisions
  (auto/review/reject) map onto the proposed card status band, so building either first
  bakes in the wrong abstraction. Reconciliation DONE (S404, 2026-08-06): confirmed
  Claude×Codex consensus in `outputs/fuzzy-matching-consensus-recommendation-2026-08-06.md`
  — its six §4 owner questions were ANSWERED S405 (2026-08-06), owner-verbatim record in
  `outputs/fuzzy-matching-owner-answers-2026-08-06.md`: no near-zero precision floor
  (union-over-ambiguity COI with human adjudication instead of suppression); review
  volume tolerated not accepted (cut per-item cost; owner suggested a Google-search-link
  affordance, unbuilt); ROR namespace YES; falsification suite approved as next work /
  representative benchmark parked; all concurrent affiliations shown and COI-screened,
  recency-ranked; contact status is a dated evidence ledger, no binary verified flag.
  Falsification suite BUILT S405 and the incumbent baseline FROZEN the same session
  (owner authorized execution) — `benchmarks/fuzzy-matching-falsification/` (166
  cases: 120 sampled UC adversarial matrix, full 335 via `--full`, + 46 curated;
  jest-invisible). Baseline vs keyed OpenAlex (`baseline/incumbent-2026-08-06.md`):
  89 pass / 64 fail (60 real + 4 judge naming artifacts) / 12 skipped; incumbent is
  "safe but blind" — zero wrong-entity resolutions, 36/47 positive-resolution
  failures via blanket abstention; S400 byline false-mismatch class reproduces
  exactly (no drift); Zhou namesake-bleed demonstrated live (matched at 50%
  confidence where design says review). Hazards for the next run: load env with
  `set -a; . .env.local; set +a` (quoted-key extraction silently kills every
  OpenAlex call → uniform abstention masquerading as results); exact-string
  target-name judging. **COMPARATOR #1 DONE 2026-08-07 (S406,
  `baseline/ror-chosen-2026-08-07.md`): ROR affiliation `chosen:true` is the
  incumbent's MIRROR IMAGE** — 15% abstention vs 85%, institution recall 30/47
  vs 11/47, flips 8/11 of the S400 byline false mismatches (keeps the one genuine
  flag) — but produces **64 unsafe resolutions end-to-end / 44 attributable to
  the affiliation string, vs the incumbent's 0**, confidently resolving
  self-contradictory strings ("University of California, Berkeley (UCLA)" →
  Berkeley at score 1.0). NEITHER system passes the falsification bar; ROR is
  disqualified as a sole auto-resolver and is an **unvalidated candidate signal**
  for a scorer (nothing in the run put it inside one). Also established:
  out-of-band domain evidence must be a first-class scorer input, and
  self-contradiction detection is a distinct missing capability in both.
  **REPORT CORRECTED 2026-08-07 after Codex adversarial review** (verdict
  needs-attention): safety is now derived from result semantics, not exact-string
  VETO counts — the original "40" missed 6 UCSD resolutions to a comma-less name;
  three relationship cases (byline-013/014, hier-007) are excluded from the
  identity aggregate as predetermined by the same-ROR-id-only pair rule; the
  naming-artifact set was unadjudicated at v1's exact-name boundary (inst-uc-109
  is a distinct record — UCOP `00dmfq477` ≠ UC System `00pjdza24` — so the
  earlier "uc-parent 3/3" and "53/88" figures remain withdrawn from that frozen
  report). The separate v2 benchmark now adjudicates by canonical ROR id without
  rewriting v1. Evidence limit: the
  institution slice is 15 real / 126 synthetic and ALL 64 unsafe resolutions are
  synthetic — the mechanism transfers to production (the S400 shape), the
  magnitude does not. **Comparator #2 (S2AFF) IS ON THE QUEUE — the earlier
  "skip it" recommendation was WITHDRAWN in review.** S2AFF is parse →
  high-recall ROR retrieval → LightGBM rerank → margin-based abstention, the
  closest existing analogue to the scorer we intend to build, so it is the most
  informative remaining comparator, not the least. Needs a pinned Python
  3.10/3.11 venv (local is 3.14, no uv/pyenv) and its own session.
  **CODEX OWNS THE INSTITUTION-RESOLUTION MODEL from 2026-08-07 (owner
  decision).** Claude's runtime/deployment assessment was superseded by
  adversarial review (needs-attention, five findings accepted); the
  architecture of record is Codex's claim-oriented pipeline — parse
  organization spans + evidence → candidate-union retrieval from ROR's
  **server-side API** → non-overridable vetoes (multi-org, sibling, domain,
  country, type, granularity) → provenance-aware scoring → abstain. Governing
  principle: ROR `chosen:true`, search rank, and exact aliases are RETRIEVAL
  EVIDENCE, NOT DECISION AUTHORITY, and vetoes run before scoring. **Owner
  decision 2026-08-07: the live app uses API lookup and does not bundle a local
  ROR index.** The API adapter must send institution evidence only, retain
  out-of-band domain/country/type/hierarchy evidence for local vetoes, and fall
  back to no new resolution on provider failure or ambiguity. Production now
  carries a separate candidate-union interface rather than reusing the
  single-winner OpenAlex resolver [VERIFIED 2026-08-08 via source, focused tests,
  and deployment `dpl_8J167uKtsFi5ej5uS9pgmXTxLjKu`]. It returns candidate ROR records with
  no verdict, explicitly requests API v2 `single_search`, bounds
  concurrency/time/retries, and supports the optional `Client-Id` header. Only
  after a unique local resolution does the exact-ROR OpenAlex hydration bridge
  supply the OpenAlex id works-first needs; failure means review/no bind. Cache
  and single-flight state are request-scoped; no cross-request persistent cache
  was added.
  Owner volume is fewer than 1,000 review requests
  per cycle × about 15 default candidates plus user additions. Each unique
  affiliation needs one primary call and may need one selective query fallback;
  ROR's documented 2,000-request/five-minute limit therefore makes measured
  fallback and peak burst rates the operational metrics, not total cycle volume.
  **CANDIDATE BENCHMARK v2 COMPLETE 2026-08-07:** the manifest preserves v1
  runner/case bytes by hash; 141 institution cases now have canonical ROR ids
  and pinned relationship labels; the verdict-free adapter contract includes
  API/adapter/strategy/date/input-hash provenance plus actual attempts, retries,
  cache, and same-cancellation-scope single-flight. Both systems were rerun: ROR
  API v2 single-search passed 128/141 (116/124 resolve retrieval; 12/17 pair +
  relationship) versus the incumbent bridge's 84/141, with zero errors. ROR
  also returned a forbidden final-resolution candidate in 71/124 resolve cases,
  validating the candidate-source choice and the separate need for local
  vetoes—not a final resolver. Report:
  `benchmarks/fuzzy-matching-falsification/versions/v2/results/2026-08-07-api-candidate-benchmark.md`.
  **DECISION BENCHMARK v3 COMPLETE 2026-08-07:** the benchmark-only API
  candidate union now adds organization-span parsing, bounded query fallback and
  contradiction probes, non-overridable vetoes, provenance-aware scoring,
  abstention, and relationship-aware pair policy. Its accepted live run passes
  all 141 labeled institution cases with 0 failures, 0 provider errors, and 0
  wrong automatic resolutions; 160 candidate sets used 151 ROR requests after
  44 benchmark-process cache hits. This does not predict production request-
  scoped reuse. It clears the frozen falsification bar, not
  representative production calibration or rollout capacity. Production stays
  `legacy-default`, and no application module imports v3. Report:
  `benchmarks/fuzzy-matching-falsification/versions/v3/results/2026-08-07-api-decision-benchmark.md`.
  Corrected facts: pinned ROR v2.11 has **135,710 total /
  132,706 active records** [VERIFIED via the checksum-pinned 2026-08-03 dump].
  Its 304.9 MB raw JSON exceeds Vercel's 250 MB standard path. Vercel offers a
  Large Functions/Fluid Compute path up to 5 GB, but this project's eligibility
  and configuration are unverified. The completed compact-index experiment
  measured 80.4 MB plain / 24.7 MB Brotli and about 0.61 GB immediate post-parse
  process RSS with the input buffer still referenced; no request-path asset is
  authorized. Handoff (Codex's model
  + Claude's six refinements + frozen-harness constraints):
  `outputs/institution-resolution-handoff-to-codex-2026-08-07.md`; the
  superseded assessment is banner-marked and must not be built from. Codex's
  sequence: **resolver hoist + cancellation-safe single-flight + PII-free
  aggregate telemetry is BUILT in PR #113; production resolver authority was
  live-verified as `legacy-default` on 2026-08-07, so promotion does not enable
  `shadow` or `combined`**
  (measurement vehicle, not a performance claim) → **compact-index size
  experiment COMPLETE and retained offline-only**
  (`benchmarks/compact-ror-index/results/v2.11-2026-08-03.md`) → **pinned v2.11
  offline candidate benchmark COMPLETE** with canonical expected ROR ids,
  relationship-aware pair evaluation, and a frozen verdict-free contract →
  **claim-oriented API decision benchmark v3 COMPLETE** → **production
  request-scoped ROR API adapter + local decision + exact-ROR OpenAlex bridge
  BUILT, VERIFIED, and DEPLOYED; production authority remains
  `legacy-default`**. The subsequent PubMed-versus-Works-first diagnostic
  combined reviewer relevance, person identity, and institution normalization
  into one outcome vocabulary, so it does not establish a ROR promotion case.
  The Fable strategic reset (`docs/ROR_REVIEWER_FINDING_STRATEGIC_RESET_BRIEF.md`)
  is **COMPLETE as of 2026-08-09 (S409)** — do not re-run it as open work; S2AFF
  profiling and any further resolver implementation still require a new owner
  decision. **Two results supersede the ROR framing above.** (1) The frozen-40
  arm-2 run with `--institution-resolver ror` produced promotion gates and
  combined outcomes IDENTICAL to the arm-1 baseline (correctBindGain 8,
  falseBinds 0, misses 4, providerFailures 0; only two works-stage reason
  changes) — the headroom hypothesis is FALSIFIED on that benchmark, and the
  do-not-inject recommendation stands; re-opening needs an
  institution-resolution-bound benchmark (e.g. short-form affiliations), not
  another frozen-40 run. Artifact:
  `outputs/reviewer-holistic-m1/reviewer-identity-works-first-w2-v2-ror-arm2-2026-08-09.json`
  (untracked). (2) **The S400 byline false-mismatch class is FIXED in production
  without ROR** (2026-08-09, merge `c632a90f`): the enrichment seam now clears
  when either the legacy checker (one-hop associated-link corroboration) or the
  staged segment-comparison checker (exact segment match + decoration proof)
  clears. Any statement above that treats "flips 8/11 of the S400 byline false
  mismatches" as a live ROR advantage, or that class as open, is HISTORICAL as
  of that date. Measured on request 1002914's persisted Find roster: of 3 rows
  carrying a mismatch banner, 1 clears as a genuine false alarm and 2 correctly
  still surface as namesake binds; across 53 comparable pairs, 17 newly clear.
  Both the checker and the seam now carry owner-directed stop-rules — see
  `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md` Stage 1 and Wave 6. Both
  assumed labels SETTLED by owner 2026-08-07: Zhou fixture verified as `review`
  (correct regardless of biographical ground truth, which stays open); EKA-class
  provenance-less affiliations get QUARANTINE-FOR-REVIEW (never silent drop, never
  presented as fact; COI-widening only). Owner-approved agent builds BOTH MERGED
  2026-08-07 (push `5098aa7a`, full suite 7,075 green): the Q2 Google-search-link
  affordance (`lib/utils/google-search-url.js`; "Search Google ↗" in
  CandidateEditModal + Find-tab CandidateCard) and step-1 normalizer groundwork —
  `docs/NORMALIZER_CONSOLIDATION_INVENTORY.md` (authoritative counts: person 14
  defs confirmed; institution 9 defs, NOT the memo's 11 — discrepancy flagged in
  its §6) + 158 characterization tests in `tests/unit/normalizer-characterization/`
  pinning per-seam behavior, incl. the live UC-containment false-positive
  divergence across institutionsMatch implementations. Jest excludes
  `.claude/worktrees/` (agent-worktree haste-map collisions). Remaining order:
  Fable separates the three product contracts and proposes fixed reusable
  benchmarks plus go/no-go criteria → owner decides which capability, if any,
  advances → only then select an implementation increment. Normalizer
  consolidation, shared scoring, card redesign, coauthor verdict, and
  institution-COI sort/override remain parked behind that decision. Decisions
  and hazards in `project-reviewer-card-simplification-direction`; S395 scope-accretion
  caution applies; high-risk automation stays review-only until the representative
  benchmark exists.
- Current priorities: `docs/CURRENT_WORK_QUEUE.md`.
- **Immediate owner-directed work (S469 onward, 2026-08-30):** durable Executor
  budgets are Production-deployed and owner-viewed in the safe no-revision/code-
  fallback state; first publication remains an explicit administrator action.
  Initial Assessment superuser restore and exact byte-copy Board snapshots are
  source-built on `codex/initial-assessment-controls`; the relevant gates, full
  9,198-test suite, and webpack production build passed. Fresh adversarial
  review, deliberate Tier 1 promotion, and owner-authorized Production write
  proof remain. Final Writeup Review remains plan-only and owner-gated.
- **Staff Deliberations tab (S466, 2026-08-28, production):** the Pre Site
  Visit Writeup + Site Visit tabs are merged into one stage-aware workspace
  (`shared/components/workbench/StaffDeliberationsTab.js`, rail
  Draft → Share → Wrap Up; legacy `pre-site-visit`/`site-visit` tab keys
  alias in). Wrap Up derives from the server's per-source-document
  `currentSourceEverSent`; the in-app logistics editor and calendar UI were
  removed by owner decision (headless `useSiteVisitContext` +
  ActivityParty fallback keep the composer fed). The production-proof
  entries below describe the pre-merge two-tab UI; their document-lifecycle
  guarantees are unchanged. Design record: the Site Visit Workspace
  proposal artifact (link in `SESSION_PROMPT.md`).
- **Curated Site Visit recipient directory (S468, 2026-08-29, production):**
  superusers curate at most 50 active app-staff/existing-Contact references for
  the materials composer's Consultant/Board menu. The Dataverse setting stores
  references/categories only; names/email resolve live; search never writes a
  Contact. Configured people are choices, never automatic draft recipients.
  Name search performs one bounded 51-row probe, returns at most 50, and tells
  the UI when more matches exist. Owner verified the broad `smith` warning in
  Production after merge `c5efa770`.
- **Institutional Funding History filled from Dataverse (S467, 2026-08-28,
  production):** `lib/services/pre-site-visit/funding-history.js` renders the
  `AI:InstitutionalFundingHistory` placeholder sentence from the account rollups
  `wmkf_countofprogramgrants`/`wmkf_sumofprogramgrants`, fail-closed against
  the live rows matching the rollups' predicate (`wmkf_typeforrollup eq
  'Program' and akoya_grant gt 0`); the cited award is the newest
  **Research**-program grant by `akoya_decisiondate ?? wmkf_meetingdate`
  (owner decision). Snapshot schemaVersion 3; pre-S467 Ready rows carry a
  `funding_history_manual` warning. Proven on `1002379` (zero-count branch);
  the positive branch is probe/test-proven only. Hazard: `akoya_mostrecentgrant`
  is NOT type-filtered — never cite it. Request `1002379`'s writeup state was
  then fully cleaned (2026-08-29 UTC; `docs/audits/request-1002379-test-mutation-inventory-2026-08-28.md`).
- **Production-proved Site Visit handoff (2026-08-21):** after exact owner
  approval, signed-in Request `1002379` moved the current Pre-Site Word
  workspace Draft→Review, kept the same SharePoint Edit/Download identity,
  recorded the complete milestone under the service's post-write readback, and
  locked Pre-Site regeneration. The later Site Visit dossier/logistics and
  Final transaction remain separate.
- **Production-proved post-handoff receipt (2026-08-21):** commit `b3bb0ef6` first reached Production in Ready deployment
  `dpl_FkWu55fyBqSEo8q4DBcdcA3xvigi` and makes Pre-Site controls Draft-only.
  Review displays a read-only receipt with one Site Visit continuation action;
  later, unknown, and missing-link states fail closed. Signed-in Request
  `1002379` verified zero Pre-Site work controls, one continuation action, and
  the expected same-item Site Visit Edit/Download workspace and handoff time.
  No document or write action was invoked; the request showed no warning panel.
- Current Workbench truth and contradictions:
  `docs/audits/AUDIT_REQUEST_WORKBENCH_TRUTH_2026-07-26.md`.
- Historical Workbench execution details remain in
  `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md`; they do not override the
  current sequence in `docs/CURRENT_WORK_QUEUE.md`.
- Writeup artifact direction (owner-decided 2026-07-28): SharePoint Word is the
  canonical editable narrative; Dataverse is the typed document
  registry/workflow/structured-decision authority; Microsoft Search supplies
  body search; version recovery, retention, least-privilege editing, and frozen
  Board milestones are required parts of the design. Initial Assessment,
  Pre-Site, and Final are three distinct documents. The Pre-Site Word item
  remains the PD workspace during the Site Visit stage, with observations
  preserved through native SharePoint versions. Final is copied from the exact
  current Pre-Site row/version/hash at action time, with a rare explicit
  regeneration option that creates a new Final row/file and preserves prior
  Final content. The Initial Assessment registry
  and request pointer are live in Production, governed prompt v1 is
  provisioned, and the application is deployed as of 2026-07-30.
  The controlled Request `1002788` rehearsal proved generation, registry and
  pointer lineage, both consumers, native version creation, and exact-input
  retry. It exposed a recovery-hash mismatch and a null AI-run request lookup.
  Production commit `9c88a1fa` has normalized DOCX hashing and future-run
  request linkage. Request `1003109` production-proved the canonical proposal,
  exact-input reuse, and a new AI run with the correct request lookup.
  A controlled interrupted-finalization retry then restored the same
  row/run/SharePoint item and version without another model call or upload.
  An attributed substantive edit then advanced that same stable item to
  SharePoint version `2.0`, replaced the Foundation Opportunity marker, and
  remained reachable through both consumers. Response-only Graph-current
  refresh and display in both consumers are deployed and live-verified on
  Request `1003109` via deployment `dpl_HhiYXVFAtsGMwjU9UDcKz22AfvR2`;
  native previous-version inspection/restore and signed-in first-stage
  recycle recovery also passed in the production Request library.
  Administrator evidence closed version limits and second-stage recovery
  (2026-08-10 / 2026-08-20; Members hold Edit on a Public M365 group site);
  retention and the Edit level's Delete flags stay owner-accepted-open.
  **[SOURCE-VERIFIED 2026-08-30; not yet Production-proved]** Workbench history,
  superuser native-version restore, and immutable Board milestone snapshots are
  now built on `codex/initial-assessment-controls`. Board snapshots copy the
  exact canonical version bytes into a distinct Request Document / SharePoint
  item and never move the request's editable pointer. Relevant gates,
  adversarial review, deliberate promotion, and signed-in Production proof
  remain open. See `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` and the near-term
  plan.
- Pre-Site persistence schema (owner-approved and Production-live 2026-08-17):
  Wave 19 adds 12 `wmkf_requestdocument` fields and the optional
  `akoya_request.wmkf_CurrentPreSiteVisit` / `wmkf_CurrentFinalWriteup`
  lookups. Independent post-apply metadata readback reported 14 exact and zero
  divergent; the immediate post-apply row inventory remained three Initial
  Assessments and no Pre-Site artifact. **[VERIFIED IN PRODUCTION 2026-08-17]**
  commit `abfe5529` deployed the adapter/writer, registry-returning route, and
  stable Word-link UI. Request `1002379` then created Ready/Draft row
  `aeb223a2-849a-f111-b8db-70a8a59cded0`, governed v3 run
  `ba0f42b9-849a-f111-b8db-6045bd008868`, stable Word item
  `01G4GVMS3Q5BJ65S7DDZDKFTSQLIQAIPER`, and the then-current request pointer. Exact
  Ready retry reused the same identities; the dated 2026-08-17 inventory was
  four Request Documents, including one Pre Site Visit. The 2026-08-21
  signed-in handoff proves the current pointer is now Ready/Review; it did not
  refresh the aggregate count or expose the current row GUID.
- Pre-Site input direction (owner-decided 2026-08-17; source/test contract
  revised 2026-08-17): draft factual material from the exact AI Materials
  narrative only through governed `pre-site-visit.proposal-core.generate`;
  supply authoritative request metadata from Dataverse; use
  `review-synthesis.generate` over all currently submitted reviews; and allow
  distribution with zero reviews because the Site Visit date controls timing.
  Late reviews regenerate only the synthesis and mark the review-derived
  section stale; they do not silently replace staff-edited Word prose or
  regenerate the factual core. Use a versioned prompt/template pair based
  initially on the supplied examples. The guarded proposal-core service and
  version-1 template renderer are Production-live; Request `1002379` proved
  exact narrative resolution, governed generation, registry persistence,
  stable Word upload, current pointer activation, and no-duplicate Ready retry.
  The authenticated Workbench route returns a registry DTO; the tab exposes its
  stable Word link and retains stale-request cancellation. Prompt v4
  `74409f95-509b-f111-b8db-6045bd008868` (reviewed `claude-sonnet-4-6`,
  exact-readback verified 2026-08-18) was later re-published as sole-current
  v5 — unattributed, content-identical per the runtime exact-match preflight.
  The controlled signed-in generation proof PASSED 2026-08-27 (Request
  `1002852`: Ready-with-warning under v5 + exact no-duplicate retry;
  hard-failure smoke skipped by owner decision, test-proven; see
  `docs/PRE_SITE_VISIT_GENERATION_RESILIENCE_PLAN.md` §Status). The bibliography remains reserved
  for next-cycle Reviewer Finder. The latest audited Executor evidence is the
  completed governed v3 Request `1002379` run
  `ba0f42b9-849a-f111-b8db-6045bd008868`. A prior direct exact-v3 model/render QA
  correctly applied the revised personnel rules and roster-name underlining,
  but Methodology's final sentence spilled to page 4; the direct QA created no
  `wmkf_ai_run`. The Production render now fits Background and Methodology on
  page 3 and passes the agreed personnel layout. The initial long browser call
  displayed `Failed to fetch` after durable server completion; exact retry
  recovered the existing Ready link. **[DEPLOYED TO PRODUCTION 2026-08-17;
  SIGNED-IN FEATURE SMOKE OPEN]** read-only current/pending status loading plus bounded GET polling
  now recover a lost POST response without repeating POST. Production template
  v2 added Recommendation-cell padding and created a distinct Ready artifact,
  but Word Online exposed a width-sensitive Recommendation-label alignment
  defect. **[INFERRED FROM SCREENSHOT + OOXML WIDTH]** implicit wrapping was
  the remaining layout variable. **[DEPLOYED TO PRODUCTION 2026-08-17;
  SIGNED-IN FEATURE SMOKE OPEN]** template v3 makes that label explicitly
  non-wrapping under another generation identity. The public sign-in/auth
  boundary passed; signed-in current-status, compact actions/download, and Word
  Online v3 proof remain open. The older `phase-ii.summarize` row still drives no
  route, while the legacy retained PDF route still uses
  `createSummarizationPrompt()`.
- Frozen Pre-Site distribution (**owner-decided and Production-proved
  2026-08-24 on Request `1002379`**): the send is explicit and
  informational, never a handoff side effect. It first retains an exact Word
  snapshot, optionally derives PDF from that immutable item, and lets staff
  attach DOCX, PDF, or both. Recipients are known staff/consultants entered by
  staff, so syntax/dedupe/To-Cc conflict checks apply without a separate
  identity-confidence/directory gate. Postgres migration 034 supplies the
  exact-preview/recovery ledger; granular Dynamics activity/attachment/send-
  intent state and status readback prevent duplicate retry. PDF-only operation
  `85f52fc5-fb48-4ceb-84d6-0f246af0b6fb` retained exact Ready/Board Ready DOCX
  and PDF rows, persisted one `sent` ledger row, and produced a Dynamics Sent
  activity with actor attribution and one hash-matching attachment to
  `jgallivan@wmkeck.org`. Workbench history surfaced the receipt and a bounded
  Production error-log scan was clean. Dynamics appended its CRM tracking token
  after preview acceptance; inbox delivery remains unverified.
- Site Visit direction (owner-decided 2026-07-28): the tab is a dossier, not a
  fourth writeup. Its logistics are date, time/time zone, format,
  location/link, lead PD, WMKF staff, applicant participants, and
  Board/consultant participants; no separate visit-status field is needed.
  **[PRODUCTION-PROVED 2026-08-25]** the
  existing `wmkf_sitevisit` Activity now owns that schedule, IANA zone,
  format, location/link, organizer/attendee parties, and server-owned recipient
  reference map. Wave 21 is exact in sandbox and Production; migration 035
  extends the existing distribution ledger and roster email mapping; the
  readiness flag is literal `on` in Preview/Production. Reversible sandbox
  write/cleanup proof passed. Signed-in Request `1002379` created and
  round-tripped one active Site Visit with five ActivityParty rows; calendar/
  material operation `f497643a-2e9e-4032-a323-1e40874d16f1` reached `sent` with
  the saved visit, one governed material, and no final error. Calendar semantics
  remain informational `METHOD:PUBLISH`, not RSVP/update/cancellation
  scheduling; `sent` proves Dynamics transport acceptance rather than
  independent inbox/calendar-client delivery. Production UX follow-ups split
  date/time controls, hide the daylight-saving panel, force the organizer into
  `To`, fix false JSONB material-staleness, and add a time-zone dropdown that
  defaults new visits to US Pacific.
  Its file categories are applicant slides, other applicant materials,
  recording, transcript, and transcript summary. Staff observations are direct
  edits in the existing Pre-Site Word workspace; do not add a separate
  Dataverse notes area or Site Visit Writeup. Do not add a general material-revision
  workflow absent observed need, but the applicant surface explicitly supports
  recoverable delete/replace rather than inferring replacement from duplicate
  files. Pre-Site distributions and Final remain linked writeups, not material
  categories. A narrow expiring applicant-material upload link is in scope
  without reopening the parked general intake product; it accepts PDF/PPTX and
  additional uploads while active, capped at 1 GB per file and 20 current
  applicant files per request. Files land inside the request's governed
  SharePoint folder under `Site Visit/Applicant Materials/Slides` or `Other`.
  Successful uploads, replacements, and deletions are batched into a short
  automated digest to the lead PD plus the still-to-be-defined relevant staff
  audience. A program coordinator may be among the recipients, but the design
  must not hard-code that role as the only additional recipient. An authorized
  staff user manually triggers the
  request; a visit-date change never sends it automatically. Recipient choices
  are the Dataverse-linked liaison and PI—normally liaison in To, or PI in To
  with liaison optionally copied. Missing, invalid, or duplicate selected
  addresses block sending until staff corrects Dataverse; there is no free-form
  bypass. To and CC share one request-scoped link and may manage the same file
  list; without sign-in or personalized links, the audit does not promise
  PI-versus-liaison attribution. Applicants see current files and operation
  confirmations only. Staff sees action/file/category/size/time/request/link
  metadata and uses native SharePoint recovery; no custom applicant or
  Workbench restore control is required initially. Visits are scheduled
  promptly after advancement around reviewer invitations; once the date is
  recorded, staff may send without waiting for reviews, synthesis, or a
  Pre-Site Writeup. Expiration is automatically 60 days after successful send,
  requires no staff-entered date, and is unaffected by visit rescheduling.
  Resend preserves the active link and original expiry; Reissue/restart stages
  a replacement and revokes the old link only after the new invitation is
  accepted for sending, so a failed replacement does not destroy a still-active
  link. No standalone Revoke action is needed in the minimum product. Any
  staff member with Workbench Site Visit
  access may send, resend, or reissue. Exact sender/reply-to and lead-PD copy
  behavior remain open pending the owner's staff discussion; historically,
  non-PD staff sent these requests without PD involvement, but that is not yet
  the future contract. The large-file scanner contract and the additional
  notification audience/digest window remain open. SharePoint
  remains the byte store; a new
  resumable Graph upload-session path is required because the current buffered
  helper stops at 60 MB. Dataverse holds the artifact registry and Postgres only
  the expiring-link/resumable-session workflow state.
  Prefer an acceptable
  transcription-platform summary before a deliberate suite LLM fallback.
  Transcript provider, handoff, timing, and ownership details remain pending
  coordination with a program coordinator.
  Exact token, schema/read model, validation, folder, retention,
  summary-quality, and partial-failure contracts remain planned.
- Editor Dashboard direction (owner-confirmed 2026-07-28; pilot list implemented
  in source 2026-07-29): preserve Allison's
  former single-folder editing workflow with a staff-wide cycle list of
  governed writeups, direct Open in Word, and an explicit per-editor Reviewed
  tracker. The pilot cycle list/direct Word entry uses the existing `reviewers`
  app grant; live SharePoint permission verification remains pending. All PDs
  are expected eventually to evaluate the materials and designated staff
  proofreaders also need access. It reuses the typed registry and canonical
  SharePoint file; it is not a second editor. Marker granularity and coordinator
  view remain open.
- Calendar direction (owner-confirmed 2026-07-28): the first gate is a
  human-in-the-loop, end-to-end Initial Assessment pilot, originally targeted at
  2026-08-10, before proposals begin arriving around 2026-08-18. **The 2026-08-10
  date was a deliberately early internal buffer, not an external commitment
  (owner, 2026-08-10 / S412), and has passed unmet with the administrator evidence
  still outstanding — expected, not slippage. Do not treat it as a live deadline;
  the work-queue row 1 completion decision is the real gate.** The 2026-07-29 environment
  decision is a controlled production rehearsal using colleague-created
  representative dummy requests; building the existing Dataverse sandbox
  organization into an integrated application/file test environment is out of
  scope. Authorized staff inspect and edit the canonical SharePoint Word file
  and find/open the same registered artifact in both the Workbench and
  cycle-wide pilot locator. The pilot also exercises a safe failure/retry
  path. It is draft-functional proof, not broad production readiness, and does
  not require the later lifecycle tabs. Request `1002788` is the authorized
  mechanics pilot target; generation and exact retry passed, but its old
  Phase I source invalidated semantic proof. Request `1003109` then
  production-proved canonical input, exact-input reuse, new-run lineage, and
  interrupted-finalization recovery using the same row/run/item/version.
  Attributed substantive editing then passed on the same stable item through
  both consumers. Response-only current-version refresh is deployed and
  live-verified in both consumers on Request `1003109` via deployment
  `dpl_HhiYXVFAtsGMwjU9UDcKz22AfvR2`; native version restore and first-stage
  recycle recovery now pass, while administrator policy/access evidence and
  product history/milestone controls remain open. See the near-term plan.
- Strategy/system model: `project-system-model`, `project-strategy-direction`.
- Virtual Review Panel: `project-virtual-review-panel`.
- Roadmap snapshots: `project-app-roadmap-2026-04-25`, `project-phase-i-summary-app-winddown`.
- Phasing/cycle scoping: `project-grant-phasing-evolution`, `feedback-cycle-vs-executor-scope`, `feedback-concepts-vs-phase-i`.
- J27 document-capture & Proposal-tab evolution (document identity/metadata →
  typed Dataverse registry; file bytes and editable narrative remain in
  SharePoint; D26 filename-match is interim; near-term planning):
  `project-j27-doc-capture-evolution`.
- Historical Group B writeup proposal: `docs/GROUP_B_WRITEUP_SPINE_DESIGN.md`. Its proposed
  URL fields and `writeup.*` prompt rows are not live, and its D26 pilot timing is obsolete.
- Planned review/proposal work: `project-staged-review-pipeline`, `project-proposal-context-extraction`.
- Planned automation/reports/post-award/AI: `project-backend-automation`, `project-interim-report-automation`, `project-awardee-onboarding`, `project-new-ai-capabilities`.
- IRS verify-EIN: `project-irs-exempt-verification`.

## Standard Probe

```bash
rg -n "roadmap|phase|cycle|interim|post-award|proposal extract|review pipeline|EIN" docs .claude-memory SESSION_PROMPT.md DEVELOPMENT_LOG.md
```
