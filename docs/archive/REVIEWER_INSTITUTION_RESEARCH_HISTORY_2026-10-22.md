---
title: "Historical Reviewer Institution Research and Decision Record"
domain: "reviewer-identity"
kind: "historical-record"
status: "historical"
summary: "Verbatim dated benchmark, research, and owner-decision history moved from the strategy roadmap on 2026-10-22."
archived_from: "docs/agent-wiki/topics/strategy-roadmap.md#dated-reviewer-matching-research-and-decision-history"
extraction_sha256: "07cf6ee93a16e09abe6eec0f1060cbfae0b5cee7f8992b0c9871747bcaa0de69"
extraction_bytes: 13302
---

# Historical reviewer-matching research and decision record

> Historical record moved verbatim on 2026-10-22 from [Strategy & Roadmap](../agent-wiki/topics/strategy-roadmap.md#dated-reviewer-matching-research-and-decision-history). The body between the markers is preserved byte-for-byte. It records past benchmark results and owner decisions; it is not current implementation guidance. For current priorities and contracts, use the retained roadmap heading, [Reviewer Identity](../agent-wiki/topics/reviewer-identity.md), [Reviewer Origination & Retrieval](../agent-wiki/topics/reviewer-origination.md), and docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md.

<!-- BEGIN VERBATIM EXTRACTED BODY -->

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
  affordance, built in the 2026-08-07 merge below); ROR namespace YES; falsification suite approved as next work /
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
  magnitude does not. **Comparator #2 (S2AFF) remained a candidate after the earlier
  "skip it" recommendation was withdrawn; it is not an approved active queue item.** S2AFF is parse →
  high-recall ROR retrieval → LightGBM rerank → margin-based abstention, the
  closest existing analogue to the scorer we intend to build, so it is the most
  informative remaining comparator, not the least. Any run requires an owner decision,
  a pinned Python 3.10/3.11 environment, and a separate bounded session; the dated local
  environment note below is not a current setup assertion.
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

<!-- END VERBATIM EXTRACTED BODY -->
