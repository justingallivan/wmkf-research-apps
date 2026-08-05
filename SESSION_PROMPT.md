# Session 402 Prompt: Remaining reviewer product fixes (post-S401 queue)

> **Handoff, 2026-08-05 (Session 401).** Production is healthy and carries TWO
> S401 merges, both smoke-relevant to the owner's next real usage: the
> post-send roster repaint (merge `fb8e0f0a`) and the re-discovery engagement
> collapse (merge `f36731f0`, deployed + verified Ready). Both went through
> Codex adversarial review; every finding was remediated with pinned
> regression tests. Run `/start` first.

## Session 401 Summary

Owner-prioritized findings 2 and 1 from the S400 evening-usage triage were
built, adversarially reviewed, remediated, merged, and deployed. All 57
`/start` gates were green at session start; full suite grew 6,820 → 6,842.

### What Was Completed

1. **Post-send refresh bug (S400 finding 2) SHIPPED (merge `fb8e0f0a`).**
   Investigation FIRST disproved the suspected "onSent fires before SSE/stamps
   complete" race — every hop is awaited end-to-end (stamp PATCH →
   `email_sent` → `result` → `res.end()` → client stream close → `onSent`);
   the production mechanism remains unattributed. Shipped defense-in-depth:
   InviteEmailModal.onSent passes `{ invitedSuggestionIds, sentAt }` (only
   rows the stream confirmed dispatched AND stamped, `inviteRecorded !==
   false`); ReviewersTab paints those rows invited on top of the refetch;
   same-request newest-wins generation guards on all three loaders. Two Codex
   adversarial rounds found real flaws in the hardening itself, both fixed:
   (a) overlay could resurrect a concurrent remove→restore reset → 4s
   reconciling refetch; (b) reconcile clock started at schedule-time and
   could cancel a >4s overlay fetch → clock now starts at PAINT-time (fix
   authored by Codex via rescue, reviewed by Claude).
2. **Re-discovery engagement collapse (S400 finding 1) SHIPPED (merge
   `f36731f0`).** New `shared/utils/reviewer-rediscovery.js`: index the saved
   pool's ENGAGED rows (stage beyond 'selected') by every identity key
   (person GUID, ORCID incl. from orcidUrl, Scholar, OpenAlex,
   diacritic-folded name); ReviewerSearchSection partitions the display merge
   — matches collapse into "Already handled" as "Re-found by search" entries
   instead of invitable cards. Codex adversarial pass found two gaps, both
   fixed (Codex-authored, Claude-reviewed): name-key matches now REJECT on a
   conflicting shared anchor (same-name different-ORCID stays separate), and
   declined people reach the pool (declines archive to `selected=false` —
   `projectRemovedCandidates` now emits person/ORCID/Scholar anchors and
   ReviewersTab's `findSavedPool` = active + declined removed rows;
   staff-removed-not-declined stay out deliberately). Also corrected: an
   invited-stage "Already handled" entry navigates to Invite, not Track (the
   Track GET is accepted-only, `reviewers-service.js:191`); pinned test
   updated with rationale.
3. **Prop contract change:** ReviewersTab → ReviewerFindPanel →
   ReviewerSearchSection now passes `savedPool` (full candidate rows);
   `savedPoolNames` derives inside the section for the exclusion union.
4. **Claim-evidence pilot:** the S400 "local state could not be read" issue
   did NOT recur — the `--current` report ran cleanly (no eligible edit, no
   row added, per its own instruction).
5. **New memory:** `feedback-codex-delegation-review-vs-rescue-routing.md`
   (review-shaped work must use `/codex:adversarial-review` user-invoked;
   rescue prompts referencing review findings need the CODEX RESCUE HANDOFF +
   `[INTENTIONAL-RESCUE]` preface).

### Commits (session, chronological)
- `66038fe3` fix: post-send confirmed-invite overlay + newest-wins guards
- `c0e82410` fix: time-bound the overlay (Codex finding 1)
- `9738ab2c` fix: paint-time reconcile clock (Codex finding 2, Codex-authored)
- `f816ad4a` docs: wiki paint-time anchoring
- `fb8e0f0a` MERGE fix/post-send-refresh → production
- `7ea67e9a` feat: re-discovery engagement collapse
- `d9578f41` fix: anchor-conflict rejection + declined pool (Codex-authored)
- `f36731f0` MERGE fix/rediscovery-engagement-reconciliation → production
- (this handoff commit) docs + memory

## Next Items

### Verified Open (owner-prioritized, carried from S400 triage)

1. **Unverified-suggestion cards have no rescue affordance.** Evidence:
   request 1003046, Yamuna Krishnan; the "Unverified suggestions" section
   renders `CandidateCard readOnly` with no handlers
   (`ReviewerSearchSection.js:2964-2967` post-S401 lines), while the
   identity-review section wires confirm-identity (`:2820-2852`,
   `canConfirmForPromotion`). Fix: plumb the same confirm + exclude
   affordances into the unverified render site (modal + server path exist;
   keep bibliometrics dropped server-side on manual confirm). Tier 1–2.
   Recommended next.
2. **Comparison fix (containment-first) + structured verdict DTO.** Evidence:
   directive §S399 addendum; acceptance tests pinned in
   `tests/unit/enrich-recommended-institution-evidence.test.js`. Candidate 1:
   word-boundary containment; fallback: conservative segment-whole extractor.
   Ships WITH the structured verdict `{status, source}` through
   DTO→roster→card. NEVER reuse a lossy aggregation-key extractor at this
   seam (S400 HIGH). Deserves a fresh session — fail-closed constraints.
3. **Invite-panel split copy (residual of the Kwong confusion).** Evidence:
   `ReviewerInvitePanel.js` splits a mixed selection into "Send invitation
   (N)" + "release M" with no explanation. The S401 collapse mostly prevents
   mixed selections arising from re-discovery, but the copy is still
   unexplained when it does occur. Small UX polish, optional.

### Verified Open (carried)

1. **S399 finding 4 — silent no-op invite button** (directive addendum:
   OPEN). Untouched by both S401 branches.
2. **Blob-cache hazard watch (passive).**

### Owner Decision Needed (carried)

1. **postcss moderate advisory** (Dependabot 62) — likely needs a `next`
   upgrade; tier deliberately if approved.
2. **Increment E — ProfileProvider double-fetch**
   (`shared/context/ProfileContext.js:456-489`). [ASSUMED ~0.5–1s tail].
3. **Latency secondary candidates from D0** (only if owner wants more).
4. **Columbia enrichment contaminant**: S400 capture showed "EKA University
   of Applied Sciences" in Konofagou's resolvedInstitutions — unexplained.

### Parked (carried)

1. **Candidate B (exclusion-parse cache)** — largely obsoleted if structured
   intake ships.
2. **Excluded-reviewers intake Phases A/B** — awaiting Justin×Connor
   reconciliation (`docs/EXCLUDED_REVIEWERS_STRUCTURED_INTAKE_PLAN.md` §6).

### Verify Before Acting

1. **Any comparison-fix work**: read the directive §S399 addendum status
   block + the wiki workbench topic hazard first; fail-closed posture is
   deliberate (`project-reviewer-verify-fail-dangerous`); false negatives
   tolerable at this seam, false positives are not (Dataverse write gate).
2. **Owner's next real usage is the behavioral validation** for both S401
   ships: (a) after an invite send, sent rows must immediately show Invited
   with no reload — pre-reload vs post-reload divergence means the overlay
   painted something Dataverse doesn't hold (report immediately); (b) a
   fresh search re-finding an engaged person must collapse into "Already
   handled"; a genuine namesake must stay selectable.

### Do Not Reopen Without New Decision

1. Reverted warm-reconciliation range `5b6757df..7072d52a` — never
   merge/cherry-pick.
2. The reverted byline-core fallback (`e2342f92`, reverted `b5b5fe08`) — the
   containment-first follow-up supersedes it.
3. Request `1002903` mutation work — read-only absent new exact owner
   authorization (S397–401 protocol).
4. The S400-suspected onSent/SSE post-send race — investigated S401, does not
   exist in code (every hop awaited; see wiki workbench topic). Do not
   re-chase; the shipped overlay covers the symptom class.

## Key Files Reference

| File | Purpose |
|------|---------|
| `shared/utils/reviewer-rediscovery.js` | Engaged-saved index + anchor-conflict partition (S401) |
| `shared/components/reviewers/ReviewerSearchSection.js` | Display-merge partition, Already-handled render, unverified dead end (`:2964`) |
| `shared/components/reviewers/ReviewersTab.js` | findSavedPool, loader generation guards, overlay reconcile timer |
| `shared/components/reviewers/InviteEmailModal.js` | onSent `{invitedSuggestionIds, sentAt}` contract |
| `lib/services/reviewer-finder/my-candidates-service.js:426` | Removed projection now carries identity anchors |
| `docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md` §S399 addendum | Comparison follow-up spec + per-finding status |
| `tests/unit/reviewer-rediscovery.test.js` + `reviewer-search-rediscovery.test.js` | S401 collapse contract |
| `tests/unit/reviewers-tab-post-send-refresh.test.js` | Post-send overlay/timer/pool-wiring contract |

## Testing

```bash
npm run check:types
npx jest --testPathPatterns "reviewer-rediscovery|reviewer-search|reviewers-tab|invite-email"
npx jest                                # full suite, 6,842
```
