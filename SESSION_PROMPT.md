# Session 406 Prompt: Matching roadmap unblocked — comparator runs / consolidation next; invite-panel UX shipped

> **Handoff, 2026-08-07 (Session 405).** The fuzzy-matching track moved from
> "waiting on owner" to "benchmarked with a frozen baseline" in one session:
> the owner answered all six consensus questions, the 166-case falsification
> suite was built AND executed (incumbent baseline frozen), both follow-up
> adjudications were settled, and two owner-approved agent builds merged
> (Google-search-link affordance; normalizer characterization groundwork).
> Separately, an owner discoverability report led to an invite-panel UX fix
> (always-visible release button, no internal scrollbar). SEVEN pushes to
> main, all deployed. Full suite 7,079 green at handoff. Run `/start` first.

## Session 405 Summary

All 57 `/start` gates were green at start; suite grew 6,910 → 7,079.

### What Was Completed

1. **Six owner answers recorded (`e323ee5f`)** —
   `outputs/fuzzy-matching-owner-answers-2026-08-06.md` (owner-verbatim +
   labeled operationalizations). Headlines: no near-zero precision floor
   (checkpoints self-correct; ambiguity must WIDEN checks — union-over-
   ambiguity COI with human adjudication); review volume tolerated not
   accepted (cut per-item cost); ROR namespace YES (registry ≠ decision
   authority); falsification suite approved / 1–2k benchmark parked
   (high-risk automation stays review-only); all concurrent affiliations
   shown + COI-screened, recency-ranked; contact = dated evidence ledger,
   no binary "verified" flag.
2. **Falsification suite built (`108db648`)** —
   `benchmarks/fuzzy-matching-falsification/`: 166 cases (120 sampled UC
   adversarial matrix, full 335 via `--full`; 46 curated from documented
   failures — S400 operands, Tsai/Nakano, Noe/Clementi, Laederach, Zhou,
   Kwong, Smirnova/Chen, Shih shapes, EKA). PII lint enforces
   placeholder-only emails; jest-invisible.
3. **Incumbent baseline frozen (`21264463`)** — owner authorized execution
   ("use sonnet to execute the suite"). Keyed OpenAlex; two invalid runs
   discarded (keyless throttling; a quoted-key env bug that made the
   resolver look like it abstained on everything). Result: 89 pass / 64
   fail (60 real + 4 judge naming artifacts) / 12 skipped. **Incumbent is
   "safe but blind": zero wrong-entity resolutions anywhere, but 36/47
   positive institution resolutions abstain.** No S400 drift; Zhou
   namesake-bleed demonstrated live. Full analysis:
   `benchmarks/fuzzy-matching-falsification/baseline/incumbent-2026-08-06.md`.
4. **Adjudications settled (`ac716891`)** — Zhou fixture = `review`
   regardless of biographical truth; EKA-class provenance-less affiliations
   = quarantine-for-review (owner decisions 2026-08-07, recorded in the
   owner-answers addendum). Zero `assumed` labels remain.
5. **Agent builds merged (`5098aa7a`)** — (a) "Search Google ↗" (quoted
   name + institution) in `CandidateEditModal` + Find-tab `CandidateCard`
   (`lib/utils/google-search-url.js`); (b)
   `docs/NORMALIZER_CONSOLIDATION_INVENTORY.md` + 158 characterization
   tests (`tests/unit/normalizer-characterization/`) — **the research
   memo's institution count was falsified: 9 definitions, not 11, no
   byte-identical pair** (inventory §6); person 14 confirmed; pins the live
   UC-containment false positive across `institutionsMatch`
   implementations. Jest now excludes `.claude/worktrees/` (`6f962063`).
6. **Invite-panel UX fix (`787e973f`)** — owner report (request 1002959
   quota email): the "Review & release N as no longer needed" link only
   appeared after selecting a pending invitee and was unfindable. Now
   always visible, disabled with tooltip until a still-pending invitee is
   checked; invite list's internal `max-h` scrollbar removed (card grows,
   page scrolls). Pinned by
   `tests/unit/reviewer-invite-panel-release-button.test.js`.

### Commits (chronological)
`e323ee5f` owner answers · `108db648` suite build · `21264463` baseline
freeze · `ac716891` adjudications · `27d2aaa1`/`99af1d1a` search link +
merge · `6f962063` jest worktree fix · `1b66366e`/`5098aa7a`
characterization + merge · `cf01b235` doc reconcile · `787e973f`
invite-panel UX.

## Next Items

### Verified Open

1. **Comparator runs on the frozen suite** (consensus step 0 completion):
   ROR affiliation API `chosen:true`-only and S2AFF against the same 166
   cases, recorded next to the incumbent baseline. Evidence: baseline
   report "What a successor must beat"; comparator list in
   `docs/REVIEWER_IDENTITY_AND_INSTITUTION_RESOLUTION_RESEARCH.md`.
   S2AFF may need a Python env — scope that before promising it.
2. **Normalizer consolidation, seam by seam** (consensus step 1 proper) —
   now unblocked by the characterization tests. Start with the two
   byte-identical `normalizeName` copies (lowest risk), then the
   diverged-docstring `ContactParser.normalizeNameForMatch`. Evidence:
   `docs/NORMALIZER_CONSOLIDATION_INVENTORY.md` equivalence classes.
3. **Token-lifecycle redesign** (per-suggestion lease/generation OR
   multiple concurrently-valid tokens). Founding requirement = S404 final
   Codex finding (mint→dispatch non-atomicity), owner accepted shipping
   with residual. Evidence:
   `outputs/plan-manage-panel-preview-retry-2026-08-06.md` final
   adjudication. Unscheduled — needs its own plan + review.
4. **S399 finding 4 — silent no-op invite button.** [Carried; was VERIFIED
   open at `docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md:404` as of
   S403; not touched S404/S405.]
5. **Repair-request reason code ambiguity** (`conflictRecordUnavailable`
   files under `address_conflict_pending`). [Carried from S403; small.]
6. **EKA contaminant root cause** — the *handling* is decided
   (quarantine-for-review) but how it got into `resolvedInstitutions` is
   untraced. [Carried.]
7. **postcss moderate advisory** (Dependabot 62; likely needs a `next`
   upgrade). [Carried; still flagged on every push.]
8. **Increment E — ProfileProvider double-fetch**
   (`shared/context/ProfileContext.js:456-489`). [ASSUMED ~0.5–1s tail;
   carried.]

### Owner Decision Needed

_None gating the roadmap._ Optional curiosities: Zhou biographical ground
truth (gates nothing — fixture settled); S404 invite-panel split copy +
S402 optional hardening (carried, non-blocking).

### Verify Before Acting

1. **Owner's next real usage should validate three fresh UI changes:**
   (a) the always-visible release button + no-scrollbar invite list
   (deployed `787e973f` — owner was about to release 2 pending invitees on
   request 1002959; ask how it went); (b) the Search Google ↗ link during
   adjudication; (c) still unreported from S401: post-send rows show
   Invited with no reload, and re-found engaged person collapses into
   "Already handled".
2. **Before ANY suite re-run or comparator run**: read
   `benchmarks/fuzzy-matching-falsification/baseline/incumbent-2026-08-06.md`
   environment section — load env with `set -a; . .env.local; set +a`
   (grep/cut gluing quotes onto `OPENALEX_API_KEY` silently breaks every
   call → uniform abstention masquerading as results); judge target-name
   comparison is exact-string (4 known artifact fails).
3. **Any matching/normalizer work**: the inventory
   (`docs/NORMALIZER_CONSOLIDATION_INVENTORY.md`) is now the authoritative
   count (institution 9, NOT the research memo's 11); read
   `feedback-latency-plan-scope-accretion-postmortem` before expanding
   scope; consolidation must keep the 158 characterization tests green or
   change them deliberately with the caller named.
4. **The S404 invite pipeline notes still apply** if invites misbehave:
   `outputs/plan-manage-panel-preview-retry-2026-08-06.md`
   (deploy-transition re-preview; adjudicated latest-link-wins residual).

### Parked

1. **Representative 1–2k benchmark** — owner-parked; consequence accepted:
   high-risk automation stays review-only until it exists.
2. **Card redesign build** — follows the scorer
   (`project-reviewer-card-simplification-direction`).
3. **Excluded-reviewers intake Phases A/B** — awaiting Justin×Connor
   reconciliation. [Carried.]
4. **Candidate B (exclusion-parse cache)** — largely obsoleted if
   structured intake ships. [Carried.]

### Do Not Reopen Without New Decision

1. **Mint→dispatch non-atomicity** — owner adjudicated 2026-08-06: fix
   belongs to the token-lifecycle redesign (Verified Open #3).
2. **Research-only manual-copy link** — degraded fail-closed by owner
   decision.
3. **Merging the modal's two attestation checkboxes / two URL fields** —
   separate by design; reinforced by owner's Q6 (no binary verified flag).
4. **Zhou fixture label** and **EKA handling** — settled 2026-08-07 (see
   owner-answers addendum); only new owner input reopens them.
5. Reverted warm-reconciliation range `5b6757df..7072d52a`; reverted
   byline-core fallback (`e2342f92`); request `1002903` mutation work; S400
   onSent/SSE race (disproven); client-side institution-COI verdicts.
   [All carried.]

## Key Files Reference

| File | Purpose |
|------|---------|
| `outputs/fuzzy-matching-owner-answers-2026-08-06.md` | Six owner answers + 2026-08-07 addendum (adjudications, build approvals) |
| `benchmarks/fuzzy-matching-falsification/README.md` | Suite contract, schema, denominators, execution hazards |
| `benchmarks/fuzzy-matching-falsification/baseline/incumbent-2026-08-06.md` | Frozen incumbent baseline + "what a successor must beat" |
| `docs/NORMALIZER_CONSOLIDATION_INVENTORY.md` | AUTHORITATIVE normalizer counts, callers, equivalence classes |
| `tests/unit/normalizer-characterization/` | 158 behavior-pinning tests (consolidation prerequisite) |
| `lib/utils/google-search-url.js` | Search-link helper (CandidateEditModal + CandidateCard) |
| `shared/components/reviewers/ReviewerInvitePanel.js` | Always-visible release button; no internal scroll |
| `outputs/fuzzy-matching-consensus-recommendation-2026-08-06.md` | The governing consensus (questions preserved verbatim, §4 annotated) |

## Testing

```bash
npm run check:types
npx jest --testPathPatterns "google-search-url|reviewer-invite-panel|normalizer-characterization"
npx jest                                # full suite, 7,079
node benchmarks/fuzzy-matching-falsification/validate-cases.js   # suite schema lint
```
