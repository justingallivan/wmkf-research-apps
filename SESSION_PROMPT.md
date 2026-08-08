# Session 408 Prompt: Continue institution evaluation; repair parked Dynamics branch

> **Handoff, 2026-08-08 (Session 407).** Codex implemented the production ROR
> shadow slice and the first two phases of its offline readiness harness on the
> stacked `codex/institution-resolution-evaluation-plan` branch. Nothing from
> that branch is merged or deployed. A separate nine-commit Claude branch was
> reviewed but deliberately **not merged** after three source-verified defects
> and an unresolved destructive-retention decision were found. Run `/start`
> first and preserve both worktrees.

## Session 407 Summary

### What Was Completed

1. **Shared ROR decision core and production shadow integration** — promoted the
   v3 decision contracts into `lib/services/institution-resolution/`, then wired
   a request-scoped ROR API resolver behind legacy-default shadow/combined
   modes. Legacy results remain authoritative unless an owner later enables a
   scoped mode deliberately.
2. **Offline evaluation plan and runtime prerequisites** — documented the
   completed-cycle evaluation boundary and added independent legacy-default
   observer modes, deadline propagation, provider-call budgeting, and fail-closed
   skip behavior.
3. **Phase 1 public evaluation contracts** — added versioned public cases,
   cassette/manifest/result schemas, byte-pinned assets, publication-boundary
   validation, and network-free adversarial tests. No completed-cycle extract or
   private production data was created.
4. **Claude project-issues branch reviewed and parked** —
   `claude/project-issues-20260807` remains unchanged in its separate worktree.
   Its extended-thinking diagnosis is sound, but it is not merge-ready; the
   verified defects and retention decision are recorded under Verified Open #2
   and Owner Decision Needed #2.

### Commits

- `3229626a` — Promote ROR decision core to shared services
- `a847b730` — Wire ROR resolver into reviewer shadow mode
- `6f1f14c7` — Add institution resolution offline evaluation plan
- `de5fcee7` — Implement institution resolver evaluation prerequisites
- `2e3dc4cc` — Build institution resolver evaluation contracts

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
2. **Repair and re-review `claude/project-issues-20260807` — PARKED FOR THE
   NEXT CODEX SESSION; DO NOT MERGE AS-IS.**
   Evidence: read-only review on 2026-08-08 inspected all nine commits
   (`a107ad74..ef67fc8b`), verified the branch was directly atop then-current
   `origin/main`, and found no textual merge conflict. Focused Codex verification
   passed 90/90 tests across six suites; an independent adversarial run passed
   84/84 across five suites. Neither run was the required full gate/full Jest
   promotion evidence. The extended-thinking/signature reconstruction, complete
   same-model thinking-block echo, index-aligned `tool_use_id`, classified
   request-reference errors, and enumerated `deriveRecordCount` precedence are
   sound. Fix before re-review:
   - `pages/admin.js`: an explicitly empty status/type filter must override the
     current state. Today selecting **All statuses** after the new `status=new`
     default still requests `status=new`; add a UI regression test.
   - `pages/dynamics-explorer.js`: clear pending file-export and document-link
     refs on `error`, clean EOF, and catch as well as `complete`; otherwise a
     failed turn can leak downloads into the next answer. Add terminal-path tests.
   - `pages/api/qa.js`: normalize empty and whitespace-only string history to
     the non-empty placeholder, not only block/malformed inputs; add a test.
   - Reconcile `record_count` wording: search intentionally records
     `totalCount`, while the current comment describes rows actually returned.
   Also add the existing 529 fallback-model/thinking replay gap to the release
   limits and verify live primary/fallback equality without printing model or
   secret values. Treat the combined release as **Tier 2**. Do not rewrite or
   squash its history, do not add the worktree-local untracked
   `CLAUDE_PROJECT_ISSUES_PROMPT.md`, and stop rather than preference-resolving a
   conflict in `lib/services/llm-client.js` or
   `pages/api/dynamics-explorer/chat.js`.
3. **Normalizer consolidation, seam by seam** (consensus step 1 proper).
   Evidence: `docs/NORMALIZER_CONSOLIDATION_INVENTORY.md` equivalence classes;
   158 characterization tests already green. Start with the two byte-identical
   `normalizeName` copies, then `ContactParser.normalizeNameForMatch`.
4. **Token-lifecycle redesign** (per-suggestion lease/generation OR multiple
   concurrently-valid tokens). Evidence:
   `outputs/plan-manage-panel-preview-retry-2026-08-06.md` final adjudication.
   Unscheduled — needs its own plan + review.
5. **S399 finding 4 — silent no-op invite button.** [VERIFIED still OPEN this
   session: `docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md:404` reads
   "Finding 4 (silent no-op button): OPEN — not addressed on this branch."]
6. **Repair-request reason code ambiguity** (`conflictRecordUnavailable` files
   under `address_conflict_pending`). [Carried from S403; small.]
7. **EKA contaminant root cause** — handling decided (quarantine-for-review),
   provenance into `resolvedInstitutions` untraced. [Carried.]
8. **postcss moderate advisory** (Dependabot 62; likely needs a `next` upgrade).
   [Carried; still flagged on every push.]
9. **Increment E — ProfileProvider double-fetch.** [ASSUMED ~0.5–1s tail;
   anchor VERIFIED present this session at `shared/context/ProfileContext.js:456`.]
### Owner Decision Needed

1. **Private completed-cycle evaluation corpus governance.** Select the storage
   location, access boundary, backup/retention policy, and primary/tie-breaking
   adjudication owners before any production-data extract is created. Evidence:
   `docs/INSTITUTION_RESOLUTION_OFFLINE_EVALUATION_PLAN.md` and Verified Open #1.
2. **Dynamics feedback retention semantics and irreversible first cleanup.**
   Commit `9298e482` on the parked Claude branch changes resolved-feedback
   retention from 180 to 20 days, and the SQL measures age from `created_at`, not
   from `reviewed_at` or resolution time. The first production cron could
   immediately delete resolved rows created 21–180 days earlier; a code rollback
   cannot recover them. Before merging, choose whether retention means 20 days
   after creation or after resolution, obtain a read-only affected-row count,
   and decide whether to export/back up those rows or split the retention commit
   from the incident fix.

The S2AFF environment-build cost (pinned 3.10/3.11 venv, multi-GB S3 artifacts,
sdist-only kenlm C++ build) remains a later challenger decision rather than a
standalone gate.

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
   (Verified Open #4).
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
| `docs/INSTITUTION_RESOLUTION_OFFLINE_EVALUATION_PLAN.md` | Current phased plan, private-data boundary, owner decisions, and replay promotion gates |
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
npx jest                                                          # full suite required before either Tier 2 promotion
node benchmarks/fuzzy-matching-falsification/validate-cases.js    # suite schema lint
npx jest --listTests | grep -c 'benchmarks/fuzzy-matching-falsification' # must be 0
```
