# Session 407 Prompt: Codex leads institution resolution; ROR API selected for live retrieval

> **Handoff, 2026-08-07 (Session 406).** One owner-reported UI bug fixed, the
> first comparator executed against the frozen falsification suite, and the
> institution-resolution architecture handed to **Codex** after two adversarial
> reviews. Both reviews returned `needs-attention`; **all nine findings were
> verified against source and accepted**, and two of them corrected numbers I had
> already published. Eight pushes to main, all deployed. Suite 7,081 green.
> Run `/start` first.

## Session 406 Summary

Started with one red gate (`check:drain-table-mentions`), fixed it first.
Suite 7,079 → 7,081.

### What Was Completed

1. **Red gate cleared (`6547ecbe`)** — S405's normalizer inventory mentioned the
   drained `researchers.normalized_name` without a same-line annotation.
   Reflowed; no factual change.
2. **Reviewer rollup: ended engagements no longer read as pending (`28ba935f`)** —
   owner report on request 1002959 (released one invitee, card still said "2
   pending"). Root cause: neither release path archives the row.
   `withdraw-sufficient-service.js:265` writes only
   `responseType: 'withdrawn_sufficient'`, so the row fell through the exclusive
   bucket chain into `pending`; `terminal-transition-service.js:106` writes a
   terminal `reviewStatus` on an **accepted** row, inflating `accepted` the same
   way. Added one exclusive `released` bucket ordered before `accepted`. Display
   buckets ONLY — the selected-only counts feeding `deriveWorkRemaining` are
   unchanged and pinned by assertion. Also **registered the pair in
   `check:status-enum-parity`**, which previously covered only
   `deriveWorkRemaining ⇔ WORK_REMAINING_LABEL` and so passed vacuously here;
   falsified it (6 → 7 live invariants).
3. **Comparator #1 executed — ROR affiliation `chosen:true` (`dcd516f1`)** —
   new `adapters-ror.js` + a parameterized `run-comparator.js`. `run.js`,
   `judge()`, and `cases/` byte-identical to the baseline run. 141 institution
   cases judged, 25 skipped (ROR is an org registry only), 0 errors, 40s.
4. **Doc fan-out (`32a6f8c2`)** — reconciled the roadmap wiki's "comparator runs
   NOT done"; the research memo's bare-`UCSD` probe was **confirmed and widened
   n=1 → n=7** (all seven bare UC acronyms abstain).
5. **Codex review #1 → published corrections (`95016e11`, `cda32868`)** — see
   below; the interpretation layer was wrong in four places.
6. **Runtime/deployment assessment (`5e34ce08`)** — answered "can S2AFF run on
   Vercel" and "how does this work per candidate/search/cycle".
7. **Codex review #2 → handoff, Codex takes the lead (`165efdc0`)** — the
   assessment was superseded; Codex owns the model.
8. **Measurement increment promoted, then compact-index sizing completed** —
   PR #113 merged as `18533dac` with transition docs in `3ccd60be`; production
   remained `legacy-default`. The next branch pinned ROR v2.11 by immutable
   Zenodo record/checksum and reproducibly built a retrieval-only index. Full
   results are in
   `benchmarks/compact-ror-index/results/v2.11-2026-08-03.md`: 80.4 MB plain /
   24.7 MB Brotli, but about 0.61 GB immediate post-parse process RSS with the
   input buffer retained, so no request-path asset is authorized.

### The two review outcomes (read these before quoting any figure)

**Comparator #1 result, as corrected.** ROR is the incumbent's mirror image:
15% abstention vs 85%, institution recall 30/47 vs 11/47, flips 8/11 of the S400
byline false mismatches (keeps the one genuine flag) — but produces **64 unsafe
resolutions end-to-end / 44 matcher-attributable, vs the incumbent's 0**.
**Neither system passes the falsification bar.** ROR is disqualified as a sole
auto-resolver; it is an *unvalidated candidate signal* only.

What review #1 corrected in my analysis:
- Safety was **understated** — I counted exact-string VETO messages, which
  missed 6 unsafe UCSD resolutions (a comma). Root cause worth remembering: I
  documented that exact-string weakness for *positive* cases and applied it only
  in the direction that helped recall, never the direction that exposed danger.
- Three relationship cases (byline-013/014, hier-007) are **predetermined** by
  the same-ROR-id-only pair rule and are out of the identity aggregate.
  Documenting circularity in prose did not make the aggregate like-for-like.
- At that run's v1 exact-name boundary, the naming-artifact set was
  **unadjudicated**; inst-uc-109 is a *distinct record* (UCOP `00dmfq477` ≠ UC
  System `00pjdza24`). "uc-parent 3/3" and "53/88" remain withdrawn from the
  frozen v1 report. The deliberately versioned v2 benchmark now supplies the
  canonical ROR-id adjudication without rewriting those historical artifacts.
- "Viable as a signal inside a scorer" → **unvalidated candidate signal**, and
  the S2AFF skip recommendation **withdrawn**.

**Architecture: Codex now leads.** My tiered design made exact-alias lookup
*decisive*, which reproduces the exact failure comparator #1 had just proved
disqualifying, and it could not observe domain evidence at all — contradicting
that same report's own finding. Architecture of record is Codex's
**claim-oriented pipeline**: parse organization spans + evidence →
candidate-union retrieval from the **server-side ROR API** → **non-overridable
vetoes** (multi-org, sibling, domain, country, type, granularity) →
provenance-aware scoring → abstain. Governing principle: **ROR `chosen:true`,
search rank, and exact aliases are retrieval evidence, not decision authority;
vetoes run before scoring.** Owner decision 2026-08-07: do not ship a local ROR
index in the live app. Keep the pinned dump and compact-index output strictly
offline for reproducible benchmark labels, relationship checks, and experiments.

### Commits
- `6547ecbe` drain-gate annotation
- `28ba935f` released-bucket fix + status-enum-parity pair registered
- `dcd516f1` ROR comparator executed and frozen
- `32a6f8c2` comparator status fan-out
- `95016e11` ROR report corrected after review #1
- `cda32868` incumbent baseline artifact addendum
- `5e34ce08` runtime/deployment assessment
- `165efdc0` handoff — Codex takes the lead

## Next Items

### Verified Open

1. **Institution-resolution model — CODEX OWNS THIS. Claude is off the surface.**
   Evidence: `outputs/institution-resolution-handoff-to-codex-2026-08-07.md`
   (read first — Codex's model, Claude's six refinements, frozen-harness
   constraints, evidence trail). **Step (a) is implemented in PR #113:** the
   W2 batch owns one request-bounded resolver, identical same-abort-scope calls
   single-flight, settled results reuse across candidates, and one PII-free
   aggregate metric record reports provider calls/cache reuse. It remains a
   *measurement vehicle*, not a perf claim. Production resolver authority was
   live-verified as `legacy-default` on 2026-08-07; merging/deploying this slice
   does not enable `shadow` or `combined`. **Step (b) is complete:** pinned ROR
   v2.11 contains 135,710 records (132,706 active); the full retrieval-only
   index is 80.4 MB plain / 24.7 MB Brotli and reaches about 0.61 GB immediate
   post-parse process RSS with its input buffer retained. No production asset is
   wired or authorized.
   **Step (c) is owner-decided and implemented on the current branch:** use
   ROR's official API for live candidate retrieval through a server-only
   adapter; do not bundle the dump or
   compact index. The existing single-identity OpenAlex resolver cannot serve as
   that candidate adapter, so its W1 callers remain unchanged while the v3
   candidate-set and decision contracts are shared from
   `lib/services/institution-resolution/`. The adapter sends only institution
   affiliation evidence, respects provider timeout/rate-limit/retry behavior,
   and treats provider failure, ambiguity, or a safety veto as no new resolution
   so legacy/review behavior remains authoritative. ROR `chosen:true` and rank
   are candidates only; out-of-band domain/country/type/hierarchy evidence must
   still reach the veto/scoring layer. At the owner-provided volume of fewer
   than 1,000 review requests per cycle and about 15 default candidates per
   search plus user-recommended reviewers, cycle volume is under roughly 15,000
   primary affiliation lookups before user additions, selective query fallbacks,
   retries, and request-local reuse. Peak five-minute traffic, not cycle total,
   is the operational limit to measure. ROR's official policy was re-verified
   2026-08-07: the overall API ceiling remains 2,000 requests/5 minutes per IP;
   new client-id registration is temporarily paused, no current rate limit
   differs by client-id presence, and the planned post-pause unidentified limit
   is 50/5 minutes. The adapter supports the optional non-secret `Client-Id`
   header. No cross-request database cache is planned initially. **Step (d) is complete:**
   `versions/v2/` pins the v1 runner and case bytes by hash, adds canonical ROR ids and
   pinned relationship labels, freezes a verdict-free candidate-set contract,
   and reruns both prior systems under the new claim. ROR API v2 single-search
   passed 128/141 institution cases (116/124 resolve retrieval; 12/17 pair +
   relationship) versus the incumbent bridge's 84/141, with zero provider
   errors. A forbidden final-resolution ROR id was nevertheless present in
   71/124 ROR resolve candidate sets, proving that retrieval cannot be decision
   authority. **Step (e) first completed in the v3 benchmark overlay:**
   organization-span parsing, bounded ordinary-query and contradiction probes,
   non-overridable vetoes, provenance-aware scoring, and relationship-aware pair
   policy pass all 141 labeled institution cases with 0 failures, 0 provider
   errors, and 0 wrong automatic resolutions. The accepted live run used 151
   ROR requests for 160 candidate sets after 44 benchmark-process cache hits;
   this does not predict production request-scoped reuse. See
   `benchmarks/fuzzy-matching-falsification/versions/v3/results/2026-08-07-api-decision-benchmark.md`.
   This clears the frozen falsification bar but does not establish production
   thresholds, peak-burst capacity, or deployment readiness. **Step (f) is
   implemented on `codex/ror-api-production-shadow`, not yet merged or
   deployed:** the v3 contracts are shared with a production request-scoped ROR
   adapter. The current `codex/institution-resolution-evaluation-plan` branch is
   stacked on that slice and has begun the owner-approved offline harness plan.
   Phase 0 runtime prerequisites are implemented: discovery, Workbench
   applicant-recommended verification, and contact enrichment have independent
   legacy-default modes; discovery and Workbench forward parent signals and
   deadline timestamps; W2 skips when its full allocation plus reserve does not
   fit; observer work shares that allocation; and all works/ROR/author OpenAlex
   calls consume one 16-request per-resolution budget, including retries and
   redirects. Focused runtime/caller tests
   and type checking are green. The 2026-08-07 redacted Production probe covered
   only the former global mode and is not evidence for the new scoped variables.
   **Phase 1 public slice is implemented on the current branch:** versioned
   case/cassette/manifest/result contracts, a fail-closed publication validator,
   a private-path-parameterized tracked-file guard, five institution-only
   synthetic/public-registry cases, a byte-pinned manifest, and network-free
   adversarial Jest coverage now live under
   `benchmarks/institution-resolution-readiness/` and
   `tests/unit/benchmarks/`. No completed-cycle input, cassette, distribution,
   or per-case result was added. **Next (g):** the owner must select private
   storage/access/backup/retention and primary/tie-breaking adjudication owners;
   only then probe completed-cycle source fields/counts without writing an
   extract. Deterministic production-path replay follows in Phase 3. S2AFF
   remains a later challenger.
2. **Normalizer consolidation, seam by seam** (consensus step 1 proper).
   Evidence: `docs/NORMALIZER_CONSOLIDATION_INVENTORY.md` equivalence classes;
   158 characterization tests already green. Start with the two byte-identical
   `normalizeName` copies, then `ContactParser.normalizeNameForMatch`.
3. **Token-lifecycle redesign** (per-suggestion lease/generation OR multiple
   concurrently-valid tokens). Evidence:
   `outputs/plan-manage-panel-preview-retry-2026-08-06.md` final adjudication.
   Unscheduled — needs its own plan + review.
4. **S399 finding 4 — silent no-op invite button.** [VERIFIED still OPEN this
   session: `docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md:404` reads
   "Finding 4 (silent no-op button): OPEN — not addressed on this branch."]
5. **Repair-request reason code ambiguity** (`conflictRecordUnavailable` files
   under `address_conflict_pending`). [Carried from S403; small.]
6. **EKA contaminant root cause** — handling decided (quarantine-for-review),
   provenance into `resolvedInstitutions` untraced. [Carried.]
7. **postcss moderate advisory** (Dependabot 62; likely needs a `next` upgrade).
   [Carried; still flagged on every push.]
8. **Increment E — ProfileProvider double-fetch.** [ASSUMED ~0.5–1s tail;
   anchor VERIFIED present this session at `shared/context/ProfileContext.js:456`.]
### Owner Decision Needed

_None gating the roadmap._ The S2AFF env-build cost (pinned 3.10/3.11 venv,
multi-GB S3 artifacts, sdist-only kenlm C++ build) is a real cost decision, but
it now arrives via Codex's step (g) rather than as a standalone ask.

### Verify Before Acting

1. **Owner UI validation — one item resolved, three still unreported.**
   RESOLVED: the always-visible release button was used on request 1002959; it
   worked, and surfaced the pending-count bug now fixed in `28ba935f`.
   STILL UNVALIDATED: (a) the corrected card counts (a released reviewer should
   now read `4 accepted · 1 pending · 1 released`; **"6 found" deliberately stays
   6** — `total` counts everyone ever engaged and sets the bar width, and the
   workRemaining hint still says "awaiting" by design); (b) the Search Google ↗
   link during adjudication; (c) from S401 — post-send rows showing Invited with
   no reload, and a re-found engaged person collapsing into "Already handled".
2. **Before ANY suite re-run or comparator run** — read
   `benchmarks/fuzzy-matching-falsification/README.md` "Executing" first.
   Hazards: load env with `set -a; . .env.local; set +a` (quote-glued
   `OPENALEX_API_KEY` silently kills every call → **uniform abstention is a
   broken credential, not a result**); `run.js`/`judge()`/`cases/` are **frozen
   for v1 comparability**. The ROR-id reset happened in the separate
   `versions/v2/` overlay, whose manifest pins v1 and whose comparator reran
   both ROR and incumbent. Both versioned drivers refuse to overwrite frozen
   slugs; the benchmark artifact directory must stay jest-invisible (unit tests
   under `tests/unit/benchmarks/` are legitimate). Do not move v2's
   candidate-recall counts back into v1's
   final-outcome claim.
3. **Any matching/normalizer work** — `docs/NORMALIZER_CONSOLIDATION_INVENTORY.md`
   is authoritative (institution 9, NOT the memo's 11); read
   `feedback-latency-plan-scope-accretion-postmortem` before expanding scope;
   consolidation must keep the 158 characterization tests green or change them
   deliberately with the caller named.
4. **The S404 invite pipeline notes still apply** if invites misbehave:
   `outputs/plan-manage-panel-preview-retry-2026-08-06.md`.

### Parked

1. **Representative 1–2k benchmark** — owner-parked; consequence accepted:
   high-risk automation stays review-only until it exists. Nothing in the new
   model changes this — abstention is a product requirement, not a fallback.
2. **Card redesign build** — follows the scorer
   (`project-reviewer-card-simplification-direction`).
3. **Excluded-reviewers intake Phases A/B** — awaiting Justin×Connor. [Carried.]
4. **Candidate B (exclusion-parse cache)** — largely obsoleted if structured
   intake ships. [Carried.]
5. **Six stale agent worktrees** exist (`git worktree list`), incl.
   `.claude/worktrees/claude-sonnet-doc-audit`. Prune when convenient.

### Do Not Reopen Without New Decision

1. **Claude's tiered institution-resolution design** — superseded 2026-08-07;
   the assessment is banner-marked. Exact-alias-as-decision is the specific
   defect. Do not build from it.
2. **"Resolve-at-save-time may dominate the design"** — withdrawn: resolution
   already happens at discovery (`discover.js:292`) *and* the save-time COI gate
   (`save-candidates-service.js:681`).
3. **Mint→dispatch non-atomicity** — belongs to the token-lifecycle redesign
   (Verified Open #3).
4. **Research-only manual-copy link** — degraded fail-closed by owner decision.
5. **Merging the modal's two attestation checkboxes / two URL fields** —
   separate by design (owner Q6: no binary verified flag).
6. **Zhou fixture label** and **EKA handling** — settled 2026-08-07.
7. Reverted warm-reconciliation range `5b6757df..7072d52a`; reverted byline-core
   fallback (`e2342f92`); request `1002903` mutation work; S400 onSent/SSE race
   (disproven); client-side institution-COI verdicts. [All carried.]

> NOT here on purpose: **"S2AFF never deploys" is REOPENED** — profile it as a
> challenger after the API-backed resolver is benchmarkable (Codex step (f)).

## Key Files Reference

| File | Purpose |
|------|---------|
| `outputs/institution-resolution-handoff-to-codex-2026-08-07.md` | **START HERE for matching work** — Codex's model, Claude's six refinements, harness constraints |
| `benchmarks/fuzzy-matching-falsification/baseline/ror-chosen-2026-08-07.md` | Comparator #1 — read the CORRECTION banner before quoting any figure |
| `benchmarks/fuzzy-matching-falsification/baseline/incumbent-2026-08-06.md` | Frozen incumbent baseline + 2026-08-07 artifact addendum |
| `benchmarks/fuzzy-matching-falsification/README.md` | Suite contract, denominators, execution hazards, what remains queued |
| `benchmarks/fuzzy-matching-falsification/run-comparator.js` | Generic comparator driver (refuses to overwrite a frozen slug) |
| `benchmarks/compact-ror-index/results/v2.11-2026-08-03.md` | Completed v2.11 size/load measurement; offline evidence only after the owner selected ROR API lookup for live retrieval |
| `benchmarks/fuzzy-matching-falsification/versions/v2/results/2026-08-07-api-candidate-benchmark.md` | Canonical-ID candidate/relationship comparator, both rerun systems, misses, and next veto/scorer gate |
| `lib/services/institution-resolution/ror-institution-identity-resolver.js` | Request-scoped production ROR decision → verified OpenAlex identity bridge; shadow/combined only |
| `outputs/institution-resolution-runtime-architecture-2026-08-07.md` | **SUPERSEDED** — retained for the reasoning trail only |
| `lib/services/reviewer-rollup.js` | Progress buckets incl. the new `released`; `deriveWorkRemaining` |
| `shared/components/workbench/ReviewerStatusIndicator.js` | Sole consumer of `progress` (parity-gated) |
| `docs/NORMALIZER_CONSOLIDATION_INVENTORY.md` | AUTHORITATIVE normalizer counts, callers, equivalence classes |
| `outputs/fuzzy-matching-owner-answers-2026-08-06.md` | The six owner answers this all serves |

## Testing

```bash
npm run check:types
npm run check:status-enum-parity && npm run check:status-enum-parity:self-test
npx jest --testPathPatterns "reviewer-rollup|ReviewerStatus|normalizer-characterization"
npx jest                                                          # full suite, 7,098
node benchmarks/fuzzy-matching-falsification/validate-cases.js    # suite schema lint
npx jest --listTests | grep -c 'benchmarks/fuzzy-matching-falsification' # must be 0
```
