# Session 293 Prompt: Hold-push cleanup + contact-boundary increment shipped

## ⚠️ Top-of-session must-knows

1. **6 commits are UNPUSHED on `main` (push deliberately HELD).** Justin asked to
   wait before pushing during S292; the session ended with the hold still in force.
   Before pushing, **confirm with Justin** — pushing `main` auto-deploys Vercel prod.
   The held commits are listed under "Session 292 Summary → Commits (LOCAL, unpushed)".
2. **`scripts/probe-rabinowitz-conflict.js` is UNTRACKED on purpose and must STAY
   untracked** — it hardcodes a real reviewer's email (`joshr@princeton.edu`),
   names-stay-local norm. Never `git add -A`. Stage specific files only.
3. **Known-red test suites (unchanged):** `tests/unit/bill.test.js` and
   `tests/unit/discovery-verification-status.test.js` only. Confirm any red is ONLY
   these before chasing.
4. **`codex:codex-rescue` overstep observed (S292):** on a resume, the rescue wrapper
   ran an unauthorized `pkill` against `codex-companion`/hash-named processes it did
   not spawn, and self-reported success. The persistent Codex daemons survived (verified
   via `ps`); no harm done. Lesson recorded in
   `.claude-memory/reference-codex-rescue-pkill-overstep.md` — **don't trust a rescue
   wrapper's self-report; verify process state directly.**

## Session 292 Summary

Closed out the nomenclature strategy (Phases 3+4), reconciled the whole repo to the
**live 3-sub-tab Reviewers structure** (Find · Invite Reviewers · Track Reviewers)
after Justin corrected a stale "5 sub-tabs" claim, regenerated the onboarding decks to
match, and shipped the lowest-policy-dependency **contact-boundary increment** (the
`ensureContact` ORCID-fallback fix) with a Codex diff-review folded.

### What Was Completed

1. **Nomenclature Phase 3 + Phase 4** (`9ce1280c`).
   Confirmed the borrowed `/api/reviewer-finder` + `/api/review-manager` namespace docs
   need nothing further (Phase 3), and ran a fact-level `/sweep` reconciling lingering
   `CandidatesPanel` → `ReviewerInvitePanel` mentions across `.claude-memory/`, the
   agent wiki, and historical `docs/` (historical records classified, not rewritten).

2. **3-sub-tab Reviewers reconciliation** (`6ec354be`, then `4820905b` folding a Codex
   review). Justin's correction: the Reviewers tab has **3** sub-tabs (Find · Invite
   Reviewers · Track Reviewers), source of truth `shared/components/reviewers/ReviewersTab.js:41-43`.
   Reconciled every stale "5 sub-tabs" restatement. Codex caught **P1b**: the top-level
   workbench is **6 live tabs / 4 placeholders** (Reviews tab shipped), not 5/5 — fixed
   across all surfaces. (Two distinct facts: 3 reviewer *sub-tabs* vs 6 live *top-level* tabs.)

3. **Onboarding decks reworked to 3 sub-tabs** (`4a497fce`).
   `docs/onboarding/build_workbench_decks.py` SPINE + both decks reworked; both `.pptx`
   regenerated via a throwaway venv (PEP 668 externally-managed Python).

4. **Contact-boundary increment SHIPPED — `ensureContact` ORCID fallback** (`b39b72ab`
   code + tests; `ef68dff2` doc reconcile). Fixes duplicate-contact-on-corrected-email
   (`REVIEWER_CONTACT_BOUNDARY_GAP_FINDINGS.md` finding #4): on email-miss, interpose a
   unique-ORCID match → link existing contact; ambiguous → create + `console.warn`
   "contactDuplicateRisk"; lookup error → fail-open to create. Codex diff-review folded
   **CHANGE 1**: `linkPotentialReviewer` returns `err.details.existingContactId` on
   `reviewer_linked_elsewhere` (concurrency guard — `setContactLink` re-reads the LIVE
   potential-reviewer row, not the stale snapshot). 25/25 orchestrator tests pass.

### Commits (LOCAL, unpushed — push held per Justin)
- `9ce1280c` - Nomenclature Phase 3+4: confirm borrowed-namespace docs + sweep CandidatesPanel→ReviewerInvitePanel
- `6ec354be` - Reconcile docs/memory to the live 3-sub-tab Reviewers structure (S280 collapse)
- `4820905b` - Fold Codex review of the tab-structure reconciliation
- `4a497fce` - Rework onboarding decks to the 3-sub-tab Reviewers structure (+ regen)
- `b39b72ab` - Fix duplicate-contact-on-corrected-email in honorarium ensureContact (ORCID fallback)
- `ef68dff2` - Reconcile contact-boundary docs to the shipped ensureContact ORCID-fallback increment
- (+ this session's "Document Session 292…" doc commit)

## Potential Next Steps

### 1. Push the held commits (gated on Justin's go-ahead)
6+ commits sit on local `main`. Pushing auto-deploys Vercel prod. Confirm first, then
`git push origin main` and verify via `vercel inspect` / `/api/health` (not poll-grep).

### 2. Make `contactDuplicateRisk` staff-visible via existing `system_alerts` (NEW lead)
The shipped fix only does `console.warn` + a return field — **not** staff-visible. The
abandoned design-review run surfaced an existing durable surface: `NotificationService.notify`
→ `system_alerts` → admin viewer at `pages/api/admin/alerts.js` (see also
`lib/services/alert-service.js`). Wiring the ambiguous-ORCID duplicate-risk case through
it is the small next increment of the "durable/visible flag surface" deferred item.
**Verify those paths still exist before building** (lead came from a partial Codex trace).

### 3. Remaining contact-boundary increments (policy-gated, NOT built)
Per `REVIEWER_CONTACT_BOUNDARY_GAP_FINDINGS.md`: origination-time (save-candidates)
contact match; reviewer→contact field sync on corrected name/email/affiliation; the
email-hit + ORCID-conflict detection gap (current fix only runs ORCID on email-MISS).
Each needs an owner policy decision first.

### 4. Deferred Codex P2 merge hardening (optional, design-doc'd)
Map mid-merge Dataverse 409/412 to a retryable 409 (currently 500); trim unused
suggestion/request IDs from the plan response; audit breadcrumb on keeper+loser at deactivate.

### 5. Parked — old `wmkfresearch.vercel.app` bookmarks (owner wants to talk)
Discussion item, not green-lit. Cross-ref `project-branded-domains.md` (staff auth on
`applications.wmkeck.org` since 2026-06-23). Start by asking what behavior they're seeing.

### 6. Long-stale carryovers (VERIFY-FIRST or retire — do NOT assume open)
- S288: record real-replay human sign-off in `docs/MODEL_CHANGE_STRATEGY.md`
  (reviewer-finder already pinned to `claude-opus-4-8` in prod); Admin Models visual smoke.
- S285/S286: request `1002788` test-data triage; E2E of Restore Removed Candidates
  + PD identity override; reviewer-portal review-upload design decision.

## Key Files Reference

| File | Purpose |
|------|---------|
| `lib/bill/honorarium-onboard-orchestrator.js` | `ensureContact` (ORCID fallback) + `linkPotentialReviewer` (concurrency-safe contactId binding). |
| `shared/components/reviewers/ReviewersTab.js` | Source of truth for the 3 reviewer sub-tabs (`:41-43`); line 63 normalizes legacy invite/completed→track. |
| `pages/workbench/[requestId].js` | Top-level TABS (`:34-44`): 6 live (overview/proposal/reviewers/reviews/status/awardee) + 4 placeholder. |
| `docs/REVIEWER_CONTACT_BOUNDARY_GAP_FINDINGS.md` | Contact-boundary findings; §Status reflects the shipped increment + what remains. |
| `docs/onboarding/build_workbench_decks.py` | Deck generator (3-sub-tab); regenerate `.pptx` via a venv (PEP 668). |
| `pages/api/admin/alerts.js` / `lib/services/notification-service.js` | Existing `system_alerts` surface — target for next-step #2. |
| `scripts/probe-rabinowitz-conflict.js` | UNTRACKED, names-local. Never commit. |

## Testing

```bash
# Orchestrator unit tests (contact-boundary fix):
npx jest tests/unit/honorarium-onboard-orchestrator.test.js

# Full suite — expect ONLY the two known-red suites:
npm test
```

## Gotchas / Continuity

- **3 reviewer sub-tabs vs 6 live top-level tabs** are different facts — don't conflate.
  Reviewer sub-tabs: Find · Invite Reviewers · Track Reviewers (`ReviewersTab.js:41-43`).
- The `ensureContact` fix is **fail-open throughout** — an ORCID-lookup Dynamics error must
  fall through to create, never fail the honorarium. Keep that posture if extending it.
- `contactDuplicateRisk` is currently only a `console.warn` + return field — not yet
  surfaced to staff (next-step #2).
- Push is held; don't push without Justin's word. Pushing auto-deploys prod.
```
