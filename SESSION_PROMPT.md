# Session Prompt: Reviewer Find stabilization — implementation (Codex)

> **Owner-directed handoff, 2026-08-01.** The Fable assessment session is
> closed. Its findings were independently reviewed by Codex, corrected, and
> **accepted by the owner**. This session implements. Run `/start` first.

## Read First (in this order)

1. `CLAUDE.md` and the normal `/start` output.
2. `outputs/reviewer-workflow-stabilization-fable-assessment.md` — **read §0
   before anything else.** §0 records corrections that supersede the body; where
   they conflict, §0 wins.
3. `outputs/reviewer-workflow-codex-adversarial-review-2026-08-01.md` — the
   verbatim review that produced those corrections.
4. `docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md` — the standing
   stabilization contract, now amended by the assessment's §4.

## Ownership and Safety Boundary

- **Active owner:** Codex.
- **Owned surface:** reviewer Find runtime — enrichment service, roster route,
  promotion service, manual-reviewer service, the reviewer suggestion adapter,
  and the Find client components, plus their tests.
- **Tier:** this is Tier 1–3 runtime work. Create a fresh branch off `main`;
  do not commit directly to `main`.
- **Not authorized:** data repair, Production writes, deploys, sending email,
  merging to `main`. Bring those back to the owner.
- Read-only Production probes are allowed and two are already committed:
  `scripts/probe-referral-path-exposure.mjs` and
  `scripts/probe-exclusion-enforcement-exposure.mjs` (both read-only, both
  filter AkoyaGO test records, both print denominators).

## What Is Settled (do not re-litigate)

- **The defect.** Find decides "is this reviewer handled?" from Postgres roster
  keys alone. Dataverse engagement (`selected`/`invited`/`accepted`/`declined`/
  response/review/completed) never reaches the projection — **even though
  `findApplicantRecommendedByRequest`'s `$select` already fetches every one of
  those fields and `enrichRecommended` then discards them.** The fix needs no
  new query.
- **Two causes, not one.** Sorek-shaped rows (`selected=false, invited=true`)
  resurface because `ad8e0299` replaced a `selectedOnly:true` read with a
  disposition-only one. Isberg-shaped rows (`selected=true, invited=true`)
  resurface because a legacy non-canonical `saved` roster twin cannot
  terminalize the canonical active row. **Engagement projection fixes both;
  restoring `selectedOnly` would fix only the first and would break the S264
  design that applicant rows stay unselected until promoted.**
- **Owner decision (2026-08-01):** engagement monotonicity applies to **every
  roster row carrying a suggestion anchor**, not applicant-origin rows only.
- **Live baseline**, Request `1002912`, probe 2026-08-01: 3 of 5 applicant
  recommendations correctly actionable; Isberg and Sorek wrongly actionable;
  Sorek renders twice via an orphan row whose suggestion 404s.

## What Is NOT Settled (establish before relying on it)

- **Door A's production occurrence.** 5 rows carry
  `disposition=recommended + selected=true + staff_manual/referred`, but that
  final state has at least two causal paths (§0 C2). Treat as candidates.
  Dataverse audit history would resolve it. **Do not cite "5 occurrences" as
  justification without establishing mutation order.**
- **Finding C's specific causation.** The mechanism is confirmed from source;
  whether person `0ae2bbf4` came through our button or direct Dynamics entry is
  not determinable from metadata.
- Whether Request `1002912`'s applicant cache is currently valid (§2 hop 9).

## Slice A — correctness core (this session)

Write the baseline-failing tests first; each must fail against current `main`.

1. **Engagement projection.** In `enrichRecommended`, partition
   `recommendedRows` with an `isHandled(row)` predicate (selected ∨ invited ∨
   accepted ∨ declined ∨ responseReceivedAt ∨ reviewReceivedAt ∨ completedAt).
   Do not enrich handled rows; emit them as compact
   `{suggestionId, candidateKey, name, stage}` entries. Project the same
   engagement tuple from `ingestApplicantReviewers` (not just `selected` — Sorek
   is `selected=false` and still handled).
2. **`candidateKey` on every applicant DTO.** Canonicalize **once over the whole
   outgoing array** — preserved, hydration-failure, needs-review, resolved,
   handled. `hydrationFailureCandidate` is the third branch that currently omits
   it (§0 C4). Two branch-local assertions are not sufficient; test the contract
   over the complete payload.
3. **W6 guard — the delicate one (§0 C3).** No path may write `selected=true`
   onto a row carrying live engagement except the explicit Restore. Required
   shape: validate engagement **before any person/contact mutation** in
   `promoteApplicantReviewer`, then re-check atomically at the final selection
   write bound to the suggestion ETag. `restore()` keeps its own ETag-bound
   reset and must continue to work unchanged. **"Reset fields present" cannot be
   the authority signal** — door A and Restore both carry
   `ENGAGEMENT_STAMP_RESET`. Note `ensureStaffManualCandidate` calls
   `updateRecord` directly and bypasses `updateLifecycle`, so an adapter-level
   `updateLifecycle` guard alone misses it.
4. **Manual-add contract (§0 C5).** Re-adding an applicant-recommended person
   via referral/manual add must union provenance **without** selecting the row
   and **without** resetting engagement — and must return a typed
   `promotion_required` / `restore_required` response that the referral UI
   renders as a remedy. Never return "Added" for a row that will not appear in
   Invite.
5. **Widen to all anchored rows (owner decision).** `displayRosterActive`
   currently restores every non-applicant active roster row with no Dataverse
   check, and `save-candidates` treats roster finalization as non-fatal after a
   successful Dataverse write — so an engaged search-origin row can stay
   actionable. Cover roster rows carrying a suggestion anchor, not just
   applicant-origin ones.

**Golden workflows to assert:** W2 engagement monotonic (incl.
`selected=false, declined=true` and `selected=true, invited=true`); W3
confirmation persists on a fresh-enrichment candidate without reload and across
an overlapping enrichment run; W6 both doors refused and Restore still working;
plus a concurrent-decline race test.

## Slice B — robustness (separate session, do not fold in)

Enrichment partial-success contract (§0 C7 — return recorded / skipped / failed
suggestion IDs; render only authoritative rows actionable); restrict orphan
restore to the current expected suggestion set. **Branch-only follow-up,
2026-08-01:** `codex/reviewer-proposal-binding-refresh` implements the
reload-stable proposal override as validated `?proposalFile=` navigation state;
the route still re-lists the request's server-owned SharePoint files before
accepting that opaque key, and same-key Blob refresh remains cache-stable.
The same branch now also implements the automatic two-path default: exact
`Reviewer Materials/Proposal_{Request#}.pdf` first, then exact active
current-cycle `Phase I/ProjectDescription.pdf`; only neither/ambiguity requires
the picker. Owner correction 2026-08-01: `Project Narrative.pdf` was named
earlier in error. **This resolver change was merged and deployed through PR
#107 on 2026-08-01.**

## Follow-up now implemented on a review branch

- Decline-referral structured rows (Name · Institution · Email, one row
  expanding to four) now replace the two prose textareas on
  `codex/structured-decline-referrals`. The server validates the structured
  rows and stores a versioned envelope in the existing memo; legacy free-text
  referrals remain readable. This branch is not yet merged or deployed.
- The reviewer-facing wording asks for the name as published and explicitly
  says not to include degrees or titles.
- Data repair for legacy twins/orphans — hygiene **after** the runtime fix, not
  a correctness gate, and requires explicit Production-write authorization.

## Gates and Definition of Done

Run the gates for every surface touched, each gate and its `:self-test`
sequentially. `check:status-enum-parity`, `check:route-service-boundary`,
`check:dataverse-access-layer`, `check:trust-boundary-guid`, and `check:types`
are the likely-relevant ones for this slice; run the full `check:*` set before
declaring done. A red gate blocks completion.

Done = the golden workflows pass, no path can move a reviewer backward without
an explicit reset, handled reviewers are legible but not actionable, and the
owner has an implementation summary. **Do not deploy or merge.**

## Handoff Expected From Codex

```text
Owner: Codex
Branch: <implementation branch off main>
Status: complete | blocked
Changed surfaces: <files>
Commits: <hashes>
Tests: <baseline-failing → passing, named>
Gates: <run, all green>
Dirty worktree: clean | listed
Next owner/action: owner review, then independent review pass before deploy
```
