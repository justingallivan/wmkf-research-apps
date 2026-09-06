# Session 490 Prompt: Owner Review of the Overnight Lifecycle Campaign

## Session 489 Summary

Under the owner's evening autonomy grant ("keep working on the next items in the queue
(2-5, then 7)… I'll check on your progress in the morning"), the architect ran the
plan → Sonnet build → Opus review → Codex adversarial (≤2 rounds) cycle on every remaining
reviewer-lifecycle stage. Eighteen PRs merged to `main` overnight (seventeen lifecycle stages plus one gate-fix follow-up) (2026-09-06 PT); every
elective and boundary stage of the lifecycle plan is now shipped. Production deployment
of the final docs push is Ready (built 37s). **No browser smoke ran on any of tonight's
merges**; 6D is the only user-visible contract change. This checkout is on `main`.

### What Was Completed

1. **Reviewer follow-up refetch fix (PR #152 → `e9909e91`)** — host keeps last-known-good
   proposals on a refetch failure and shows Retry.
2. **Stage 6C (PR #153 → `3b2b34d5`)** — pure extraction of `ReleaseMaterialsModal.js`,
   `TokenActionsMenu.js`, `ReviewReminderAction.js`, `reviewer-draft-keys.js` out of
   `ReviewerManagePanel.js`; re-exports preserved and pinned.
3. **Stage 6D (PR #159 → `6606cc30`)** — server-side draft fingerprint: render-emails
   returns `draftFingerprint`; send-emails recomputes and skips `draft_stale` /
   `draft_fingerprint_missing` per reviewer (new skip-reason VALUES, no new SSE event).
   Uniform across all four template types (architect decision under the grant; both
   reviewers recommended it). Select-honoring mocks + projection-divergence test added.
4. **Stage 2 (PR #155 → `716bc558`)** — narrow shared engagement policy module.
5. **Stage 3, all eleven slices** — commands extracted to `lib/services/reviewer-engagement/`
   with delegation pins on every legacy caller: 3A closeout (#154 `b7a04cd6`), 3B terminal
   transition (#156 `4e7c378c`), 3C status correction (#158 `1c24e56f`), 3D response
   correction + neutral `errors.js` (#160 `081d558b`), 3E invitation expiry + post-send
   bookkeeping + `lib/utils/etag.js` (#161 `01072571`), 3G reminder claim (#162 `ec74c0d4`),
   3H deadline override (#163 `81fdac43`), 3I pending-invitation withdrawal (#164 `d47b07be`),
   3F three invitation-record passthroughs (#165 `68198b2f`), 3J narrow
   `deselectLegacyDeclinedSuggestion` op (#166 `3b8dca2b`), 3K whitelisted
   `setRequestMetadata` replaces the picker's `bulkUpdateByRequest` (#167 `19955148`).
6. **Stage 5 (PR #157 → `21cc221b`)** — narrow document-pointer and thank-you adapter ops.
7. **Stage 7 (PR #168 → `790ba3a1`)** — new LAW-mode CI gate
   `check:reviewer-engagement-boundary` (+ self-test, workflow step, CI reference rows,
   `/start` list): generic writers `updateLifecycle`/`patchFields`/`patchReviewReceipt` from
   the reviewer-suggestion adapter allowed only under `lib/services/reviewer-engagement/`,
   the adapter itself, or a tracked `RECORDED_IMPORTERS` set (two receipt sinks) whose growth
   is pinned by `tests/unit/reviewer-engagement-boundary-recorded-set.test.js`; AST fixpoint
   resolves aliases, barrels, class-held adapters and dynamic imports; computed members fail
   closed. `bulkUpdateByRequest` deleted (zero-reference pin). Named op
   `expireInvitationResponse` added. Live census: 14 exempt bindings / 0 violations / 0 stale.
8. **Docs reconciled after each merge** — Stage 3/5/6D/7 plans marked historical; readiness
   audit rows 2, 3, 5, 6C, 6D, 7 COMPLETE; catalog entries for every new module; wiki topic
   pages; security matrix rows for render/send-emails. All 33 gate/self-test pairs green on
   final `main` (`e287a174`).

### Review-protocol deviation (read this)

Stage 7's final correction (`4e471c94`: class-held, renamed CJS re-export and direct
dynamic-import shapes) landed after the two-round Codex cap on the architect's own
verification (gate + self-test green, scratch `--root` fixture tree with all three shapes
reported as violations, five real-file false positives from the builder's first catch-all
removed by narrowing rather than exemptions). A post-merge read-only Opus review of that
commit ran at close and found one fail-open and one CI false-positive risk; both were fixed
the same night with pinned fixtures (see the "Opus post-merge verdict" line at the end of this
file and the Stage 7 plan). Stage 3K also hit the cap (round-2 masking finding resolved by
the Stage 7B zero-reference pin instead of a third round).

### Commits (all on `main`)
Merges: `e9909e91` #152, `3b2b34d5` #153, `b7a04cd6` #154, `716bc558` #155, `4e7c378c` #156,
`21cc221b` #157, `1c24e56f` #158, `6606cc30` #159, `081d558b` #160, `01072571` #161,
`ec74c0d4` #162, `81fdac43` #163, `d47b07be` #164, `68198b2f` #165, `3b8dca2b` #166,
`19955148` #167, `790ba3a1` #168, `4d777aad` #169 (gate fixes after the post-merge Opus review). Docs: `e287a174` (Stage 7 promotion record) and the
per-stage "Record the … promotion" commits between merges. Session handoff commit: `git log`.

## Next Items

### Owner Decision Needed (the morning ask)

Every tightening below was found during the campaign and deliberately NOT taken: each
changes what staff see or what a failure does. Current behavior is preserved
behavior-for-behavior. Evidence for D1–D5: `docs/REVIEWER_LIFECYCLE_STAGE7_BUILD_PLAN.md`
decisions table; D0: Stage 2 plan build record; 6D items: Stage 6D plan.

| # | Where | Current behavior | Tightening available | Staff-visible effect if tightened |
|---|---|---|---|---|
| D0 | `reviewer-suggestion.js` `softDelete` | **TAKEN S490 (branch `claude/reviewer-lifecycle-d0-d3-tightenings`)**: selects `wmkf_completedat`, gates with `isClosedEngagementRow` | — | Remove refuses completion-stamped rows (legacy/hand-edited data only) |
| D1 | send-emails post-send invitation stamp | **PRESERVE (decided S490)**: unconditional write, no `ifMatch`; failure → `inviteRecorded:false` | — | n/a |
| D2 | generate-emails draft generation mark | **RETIRED S490 (route + service + `email-reviewer.js` prompt + `markInvitationGenerated` + `patchFields` alias deleted; branch `claude/retire-generate-emails-and-proposal-wide-patch`, stacked on the D0/D3 branch).** Only client ever was deleted 2026-06-21; runtime zero-hit unverified (no CLI request log). | — | none in-app |
| D3 | respond-service legacy-decline repair (not the acceptance write) | **TAKEN S490 (same branch)**: `deselectLegacyDeclinedSuggestion` requires a concrete ETag; `missing_version` → 412 `concurrent_modification` | — | only if Dataverse ever returns a row without an ETag |
| D4 | picker `setRequestMetadata` (former `bulkUpdateByRequest`) | sequential unconditional per-row writes, no try/catch. **Owner chose (a) S490, but pre-build check found NO client sends the proposal-wide PATCH** (`ReviewerSearchSection` uses `save-candidates`; every other my-candidates caller sends `suggestionId`) | (a) per-row results — build anyway / park / verify-then-remove the orphaned branch | none today; no UI reads this response |
| D5 | ten operational scripts writing `wmkf_appreviewersuggestions` raw (three via own `fetch`, outside the target interlock) | not gated; Stage 7 closes APPLICATION bypasses only | (a) route through adapter named ops, (b) scripts gate with recorded set, (c) archive executed one-off repair scripts | none at runtime; operator workflow changes |
| 6D-1 | send-emails fingerprint enforcement | uniform across all four template types (taken under the grant) | exempt `invitation` | none today; confirms or reverses the architect's call |
| 6D-2 | 6D accepted limits | batch-start hydration and Admin template drift are not covered by the fingerprint | extend the fingerprint to cover them | tighter stale-draft refusal |

**Expected first-morning behavior:** any PD whose preview was rendered before the 6D deploy
sees `draft_fingerprint_missing` on send and must re-render. By design; say so before a
colleague reports it.

### Verified Open

1. **Four inline concrete-ETag regexes remain** alongside `lib/utils/etag.js`
   `isConcreteEtag`: the adapter (imports the util but keeps one literal), `correct-response.js`,
   `expire-invitation.js`, `record-email-outcome.js`. Consolidation is mechanical; not done to
   keep slices behavior-preserving. Evidence: `grep -rln 'W\\/)?"\[' lib/ pages/ shared/`.
2. **Small leftovers flagged by reviewers:** `isPastCutoff` lives in a command module
   (`expire-invitation.js`) rather than a util; `[my-candidates]` log prefix is emitted from
   `reviewer-engagement/`; `SUGGESTION_SET` exported but unused in the reminder sweep; stale
   line refs at `reviewer-activity-history.js:15` and `grant-request.js:169` (A6). Evidence:
   Stage 3/7 plan review records.
3. **Reviewer-follow-up cycles-load failure** (pre-existing, out of #152's scope): sets
   `error` while `cycleCode` is empty, so the banner has no Try again and the proposals
   effect never runs. Evidence: `docs/plans/REVIEWER_FOLLOW_UP_REFETCH_RESILIENCE_2026-09-05.md`.
4. **Wiki coverage of Codex's UI changes (PR #151)** — still unchecked. Evidence:
   `git diff --stat 600cc972..3fc0a936`.
5. **Production smoke** of 6B release-materials modal (needs an accepted reviewer) and of
   any 6D send. Not run.

### Parked

- Stage 4 of the lifecycle plan (readiness audit: optional, benefit not established).
- Progress-pill alignment/chronology, Ops eligibility view, automatic reviewer reminders
  (gate-protected hold), one-click PDF conversion. Not re-probed.
- Five stale one-off Preview callbacks in the Entra app registration. Owner cleanup.

### Verify Before Acting

1. **Four idle worktrees exist**, all detached and clean: `../WMKF_Apps-6c` (`790ba3a1`),
   `-s2` (`19955148`), `-s3` (`68198b2f`), `-s4` (`d47b07be`; created tonight with its own
   `npm ci`, `.env.local` and `.agents/skills` symlinks). Left for the owner; remove with
   `git worktree remove <path>` when convenient. All feature branches are deleted locally and
   on origin.
2. **Two stashes** (`stash@{0}` on main, `stash@{1}` on
   `codex/reviewer-promotion-remediation`, July 2026 reports) predate this work; untouched.
3. **`gh pr merge` worked from this session** for all 17 PRs (the classifier that blocked
   it in S488 did not fire). Merges still require all checks green.
4. **Codex adversarial review from a worktree:** always instruct the three-dot diff
   `main...HEAD` and rebase first, or Codex reviews a two-dot artifact. Codex's sandbox never
   ran Jest or created fixtures; all test evidence tonight is builder/Opus/architect.
5. **Local browser smoke:** Claude-in-Chrome could not reach localhost from this machine
   (S488); unchanged.

### Do Not Reopen Without New Decision

Automatic Complete from thank-you; writing the Operations/Finance final remit flag from
this application; BILL API reviewer onboarding. No new schema, live lifecycle mutation,
email send, cron invocation or backfill is authorized. Accepted-awaiting-materials is
transient (no dashboard change; release-modal smoke deferred to first real acceptance).
D26 hide of Initial Assessments is intended. Stage 4 skipped per audit. The owner chose to
promote 6B without a browser smoke.

## Preserve These Contracts

- Shipped status ownership: synchronous per-reviewer mutex within one mounted panel,
  permanent invalidation, matching-token cleanup, 6A outcome parsing.
- Materials modal session identity = isOpen + requestId + `membershipKeyFor` +
  signature/reviewDueDate + `proposalKeyFor`, by VALUE (now in `reviewer-draft-keys.js`).
- `ReviewersTab` passes `degraded={Boolean(error)}`; `reviewers-tab-stale-request.test.js` pins it.
- Send transmits the previewed body verbatim; the server recomputes only the draft
  fingerprint and the destination address (6D). `draft_stale` / `draft_fingerprint_missing`
  are skip-reason values, not new SSE events.
- Every extracted command is invoked by its legacy caller with the same args and every
  outcome mapped; the delegation-pin suites make an inline reimplementation red.
- `check:reviewer-engagement-boundary` is LAW: a new importer of a generic writer outside
  `lib/services/reviewer-engagement/` fails CI; growing `RECORDED_IMPORTERS` requires editing
  the tracked recorded-set pin test in the same PR.

## Orchestration Lessons (one line each)

- Census-table rows in a shared plan conflict on every rebase; append at the end and keep
  all rows when resolving.
- Add the delegation-pin rule to the plan before slice one, not after a reviewer asks (3E).
- A "gate turns red when X grows" claim needs a tracked pin test, not a script constant.
- Builder catch-alls false-positive on real code (`adapter.CONST[key]`, `.findById().catch`);
  narrow the rule, never add exemptions.
- Sequence worktrees so parallel builders never share a file; rebase stacked branches after
  each merge and relaunch CI watchers after every force-push.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_LIFECYCLE_STAGE7_BUILD_PLAN.md` | 18-site census, D0–D5 decisions, gate shape, all review records |
| `docs/REVIEWER_LIFECYCLE_STAGE3_BUILD_PLAN.md` | 3A–3K records; delegation-pin rule |
| `docs/REVIEWER_LIFECYCLE_STAGE6D_BUILD_PLAN.md` | fingerprint contract, uniform-enforcement decision, accepted limits |
| `docs/audits/REVIEWER_LIFECYCLE_REMAINING_READINESS_2026-09-05.md` | every row COMPLETE except optional Stage 4 |
| `lib/services/reviewer-engagement/` | extracted commands (close-review, terminal-transition, correct-status, correct-response, expire-invitation, record-email-outcome, claim-reminder, change-review-deadline, withdraw-pending-invitation, record-invitation, errors) |
| `scripts/check-reviewer-engagement-boundary.js` | Stage 7 LAW gate; `RECORDED_IMPORTERS` |
| `tests/unit/reviewer-engagement-boundary-recorded-set.test.js` | tracked pin on the recorded set |
| `lib/dataverse/adapters/reviewer-suggestion.js` | named ops incl. `setRequestMetadata`, `deselectLegacyDeclinedSuggestion`, `expireInvitationResponse` |
| `shared/components/reviewers/ReleaseMaterialsModal.js` | 6C-extracted modal carrying the 6D `draftFingerprint` |
| `.claude-memory/project-reviewer-lifecycle-autonomy-directive-2026-09-05.md` | the grant and its completion |

## Testing

```sh
# Stage 7 gate pair (sequential)
npm run check:reviewer-engagement-boundary && npm run check:reviewer-engagement-boundary:self-test
node scripts/check-reviewer-engagement-boundary.js --report
# Delegation pins + boundary pins
npm test -- --runInBand --watch=false --testPathPattern 'reviewer-engagement|reviewer-suggestion-(bulk-update|receipt)|draft-fingerprint|send-emails-fingerprint'
# Slice exit
npm test -- --runInBand --watch=false && npm run check:types && npm run lint && npm run build -- --webpack && git diff --check
```

## Handoff and Milestone Determination

Production cutover shipped: the full reviewer-lifecycle elective and boundary program
(Stages 2, 3, 5, 6C, 6D, 7) is live with a new CI gate and a deleted adapter export.
**A DEVELOPMENT_LOG.md entry was added (Session 489).** A new `check:*` gate was added to
CI, the `/start` list and `docs/CI_GATES_REFERENCE.md`; no CLAUDE.md, schema or environment
change. The claim-evidence pilot report recorded one eligible advisory (count shape on the
Stage 7 plan) and one observation row was added to the pilot directive.

**Opus post-merge verdict on `4e471c94`:** DEFECT + 4 advisories, none affecting the real
tree (gate green, 0 false positives on the 75 live adapter usages, 0.6s). Fixed the same night
in PR #169 (`4d777aad`, all checks green), recorded in the Stage 7 plan's "Post-merge Opus review" section: (D1
fail-open) `const a = this.adapter; a.updateLifecycle()` and `helper(this.adapter).writer()`
bypassed the class-field handling; (A1, CI false-positive risk) `(await import(p)).anything`
hard-failed the gate on unrelated code; (A2) inline `require('<adapter>').findById` was a
violation while its `import()` twin was green; (A3) `this.<field>` key is file-scoped, now
documented as a closed over-approximation; CI reference rows had not been updated for the
second correction round. Each fix has a self-test fixture; the old gate fails the new
self-test.
