# Session 407 Prompt: Codex leads institution resolution; comparator #1 done and corrected

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
- The naming-artifact set is **unadjudicated** pending canonical ROR ids;
  inst-uc-109 is a *distinct record* (UCOP `00dmfq477` ≠ UC System `00pjdza24`).
  "uc-parent 3/3" and "53/88" withdrawn. The incumbent baseline got a matching
  addendum — its own 4 artifacts carry the same caveat (±2 on its "60 real").
- "Viable as a signal inside a scorer" → **unvalidated candidate signal**, and
  the S2AFF skip recommendation **withdrawn**.

**Architecture: Codex now leads.** My tiered design made exact-alias lookup
*decisive*, which reproduces the exact failure comparator #1 had just proved
disqualifying, and it could not observe domain evidence at all — contradicting
that same report's own finding. Architecture of record is Codex's
**claim-oriented pipeline**: parse organization spans + evidence →
candidate-union retrieval from a **compact** ROR index → **non-overridable
vetoes** (multi-org, sibling, domain, country, type, granularity) →
provenance-aware scoring → abstain. Governing principle: **exact aliases are
retrieval evidence, not decision authority; vetoes run before scoring.**

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
   constraints, evidence trail). Codex's sequence: **(a)** hoist the resolver +
   bounded single-flight + telemetry as the first reversible increment — a
   *measurement vehicle*, not a perf fix; **(b)** compact-ROR-index size
   experiment; **(c)** pinned ROR dump for benchmarking, **NOT** yet as
   production substrate; **(d)** run and resource-profile S2AFF before choosing
   between reimplementation and a batch/warm service.
   Now on the critical path (both were review findings): **canonical expected ROR
   ids in the cases** and a **relationship-aware pair adapter**.
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
9. **Vercel CLI is outdated** — local `58.5.1`, current `58.7.1+` [VERIFIED by
   running `vercel --version`]. Flagged in both Codex reviews; matters only for
   accurate Large-Functions behavior. Trivial: `npm i -g vercel@latest`.

### Owner Decision Needed

_None gating the roadmap._ The S2AFF env-build cost (pinned 3.10/3.11 venv,
multi-GB S3 artifacts, sdist-only kenlm C++ build) is a real cost decision, but
it now arrives via Codex's step (d) rather than as a standalone ask.

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
   for comparability** — changing the judge (e.g. to ROR-id comparison) resets
   the comparison and requires re-running every prior system; `run-comparator.js`
   **refuses to overwrite a frozen slug**; the suite must stay jest-invisible
   (`npx jest --listTests`). Artifact counts are **unadjudicated** in both runs
   (ROR 7, incumbent 4) — the old "4 known artifact fails" phrasing is stale.
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

> NOT here on purpose: **"S2AFF never deploys" is REOPENED** — profile it before
> deciding between reimplementation and a batch/warm service (Codex step (d)).

## Key Files Reference

| File | Purpose |
|------|---------|
| `outputs/institution-resolution-handoff-to-codex-2026-08-07.md` | **START HERE for matching work** — Codex's model, Claude's six refinements, harness constraints |
| `benchmarks/fuzzy-matching-falsification/baseline/ror-chosen-2026-08-07.md` | Comparator #1 — read the CORRECTION banner before quoting any figure |
| `benchmarks/fuzzy-matching-falsification/baseline/incumbent-2026-08-06.md` | Frozen incumbent baseline + 2026-08-07 artifact addendum |
| `benchmarks/fuzzy-matching-falsification/README.md` | Suite contract, denominators, execution hazards, what remains queued |
| `benchmarks/fuzzy-matching-falsification/run-comparator.js` | Generic comparator driver (refuses to overwrite a frozen slug) |
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
npx jest                                                          # full suite, 7,081
node benchmarks/fuzzy-matching-falsification/validate-cases.js    # suite schema lint
npx jest --listTests | grep -c fuzzy-matching                     # must be 0
```
