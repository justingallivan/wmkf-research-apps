# Session 423 Prompt: send the Connor briefs, then pick up the merge durability gap

## Session 422 Summary

A decision-and-reconcile session that ended in a production fix. Three carried
owner questions were resolved, two documentation surfaces were found drifted from
code and corrected, and a PD-blocking bug in the reviewer invitation modal was
diagnosed, fixed, adversarially reviewed, and shipped.

### What Was Completed

1. **Closed two of the three carried owner decisions.**
   - **Reviewer activity history is operational convenience, not evidence**
     (owner, 2026-08-12). It must not feed reviewer-reliability or payment
     decisions, so imperfect labels are acceptable where the underlying lifecycle
     stamps are ambiguous. Recorded in
     `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`.
   - **The disputed receipt-evidence question was already closed** in `19bd000a`,
     hours before the S422 prompt was written. The S421 prompt listed it as open in
     error. `isSyntheticReceipt` is now the same-instant test alone;
     `reviewFilename`, `answers`, and `reviewUploadedByStaff` no longer strengthen
     provenance; the label is the neutral "Review receipt recorded".

2. **Corrected two drifted durable surfaces.** The wiki topic page still described
   `isSyntheticReceipt` as consulting `reviewFilename`/`answers` plus a
   staff-attestation path — all removed in `19bd000a`, whose only wiki edit was a
   trailing-whitespace fix. Its header also claimed an unmerged feature branch when
   the work was production-live. No gate caught either.

3. **Re-verified the `merge-candidates` gap and corrected its record.** Still
   unaddressed. Two fixes to the memory file: the `hardDelete`/`deactivate`
   citations had drifted (`428-437`/`499-500` → `432`/`501`), and the headline
   overstated the reach — the block predicate refuses promoted, engaged, and
   confirmed-identity losers, so the reachable set is pre-engagement, non-promoted,
   non-confirmed-identity duplicates.

4. **Proposed and adversarially reviewed a decision on that gap.** Codex returned
   `needs-attention` on three findings; all three were verified and dispositioned in
   `outputs/merge-candidates-authorization-decision-2026-08-12.md`. Net: decline the
   authorization check (owner confirms the legacy-grant population is empty), keep
   and repair `computeCanManage` rather than delete it, and promote the state-
   corruption risks to the top item.

5. **Fixed and shipped the late-invite blocking bug (PRODUCTION).** Inviting
   reviewers late in a cycle disabled Send with no visible reason. Merged to `main`
   and deployed; Vercel production Ready in 27s.

### Commits

- `00f44641` - Record the activity-history convenience decision and reconcile the drift
- `35672d1f` - Correct the activity-history drawer to production-live and smoke-verified
- `56b03a6c` - Re-verify the merge-candidates gap and correct its drifted citations
- `6f7046f7` - Propose closing the merge-candidates gap without an authorization check
- `e63ddd8b` - Revise the merge decision after adversarial review
- `baa93c12` - Stop blocking late invitations, and surface the reason when one is blocked
- `ba89aabc` - Warn instead of blocking when reviews fall due before the response deadline
- `63d35e7f` - Point the timeline warning at the extension, not at editing the due date
- `4dd4a31d` - Merge: stop blocking late reviewer invitations

### The Invitation Timeline Contract (new, production-live)

| Condition | Behavior |
|---|---|
| Reviews due on/before proposal release | **Blocks** — two fixed dates, genuinely misconfigured |
| Reviews due on/before response deadline | **Warns**, Send stays enabled |
| Response deadline after proposal release | Not checked at all |

**The organizing rule, now written into the source: never block on a condition
involving `respondBy`.** It is computed from TODAY, so any rule reading it starts
failing on its own as the calendar moves, with nothing having changed. Blocking
rules compare fixed dates; drifting conditions warn.

Grounding facts `[VERIFIED via source]`: proposal release is never automatic
(`wmkf_materialssentat` has exactly one writer, in `send-emails-service.js`'s
materials branch, reachable only through the staff-guarded
`/api/review-manager/send-emails` route; no cron sends materials);
`proposalSendDate` is email-only copy, rendering as a template token in
`email-generator.js:496`; there is no server-side mirror of this validation.

### Gotchas Worth Carrying

- **Request campaign config is seeded "set only if unset"**
  (`send-emails-service.js`: `if (dueDate != null && reqRec.wmkf_reviewduedate ==
  null)`), and seeding is skipped entirely for `allowResend`. So on any wave after
  the first, editing the due date in the invite modal changes THAT email's copy
  while the request, portal, reminder sweep, and token math keep the original date.
  The per-reviewer override (`wmkf_reviewduedateoverride`) is the only authoritative
  remedy — it is what `resolveEffectiveReviewDueDate` reads everywhere. Codex caught
  the warning copy walking a PD straight into this mismatch.
- **The invite modal interpolates timeline tokens client-side by design** (module
  docblock), substituting one campaign date for the whole batch, while
  `render-emails-service.js:272-274` resolves the effective per-reviewer due date
  server-side. A reviewer carrying an override can therefore receive an invitation
  stating a different date than the portal and reminders use. Found, not fixed.
- **`requireAppAccess` is any-of** (`lib/utils/auth.js:344`, `appKeys.some(...)`).
  A route naming two app keys admits holders of either. `reviewer-finder` is a
  retired app whose old grants are still honored (`appRegistry.js:170-177, 337`).
- **A brief is a dated snapshot; `DEVELOPMENT_LOG.md` is ship state.** This session
  twice repeated the S418 brief's "not verified: the rendered layout" — already
  overtaken by an S419 production smoke recorded in the dev log. Check ship state
  before calling anything an open risk.

## Next Items

### Verified Open

1. **[VERIFIED OPEN] Connor owns the phantom co-PI root cause.** The akoyaGO import
   attaches a placeholder contact to emailless co-PIs. Until that changes, new
   requests keep acquiring the phantom and any future backfill/sync copies it
   forward. Also ask whether a Power Automate flow currently syncs
   `wmkf_copi1..5` → junction on create/update — that determines whether clearing a
   slot cascades on its own. Evidence: `outputs/phantom-copi-incident-2026-08-12.md`.
   Shareable brief written and ready to send.

2. **[VERIFIED OPEN] Run the read-only PnP.PowerShell SharePoint audit with Connor.**
   Independent of the above; the two can go to Connor together. Evidence:
   `outputs/sharepoint-permission-audit-primer-for-connor-2026-08-12.md`. Still gated
   on a tenant-consented Entra app client ID and on whether Connor is a Site
   Collection Administrator.

3. **[VERIFIED OPEN] SharePoint durability evidence — Purview/holds.** Belongs with
   the M365 compliance administrator, not Connor; §11 of the S415 brief has the
   message ready and has no dependency on the Connor thread.

4. **[VERIFIED OPEN] Board milestone snapshot producer.** Copy-the-bytes selected
   2026-08-10. Explicitly not blocked by any SharePoint question.

5. **[VERIFIED OPEN, now the top merge item] `merge-candidates` state corruption.**
   Two defects, neither introduced by this session's proposal, both confirmed against
   source and ranked above the authorization question by adversarial review:
   - `executeMerge` enumerates loser suggestions and slots once via `planMerge`
     (`reviewer-merge.js:333`) and never re-scans before deactivating at `:501`,
     which uses the *loser person* ETag — unchanged by a newly-created suggestion
     row. A reference created mid-merge survives, pointing at an inactive reviewer.
   - The cascade is not transactional; a failure after the hard delete leaves a
     half-merged state with no compensation.
   Suggested minimum: re-enumerate immediately before deactivation, plus a
   regression test where a new loser reference appears after planning. Evidence:
   `outputs/merge-candidates-authorization-decision-2026-08-12.md` §E.

6. **[VERIFIED OPEN] Repair `computeCanManage` rather than delete it**
   (`shared/components/reviewers/reviewer-modes.js:95-97`). It returns
   `Boolean(isSuperuser || !pdId || !myUserId || myUserId === pdId)` — it gates real
   affordances (invite actions, due-date editing, manual reviewer creation,
   candidate-card remedies, all fed from `ReviewersTab`) when identities resolve, and
   shows everything when they don't. Make the unresolved branch fail closed and stop
   calling it cosmetic in its docblock; that wording is what let the S414 scope
   document cite this route's `requireAppAccess` as evidence of safe authorization.
   **Do not delete it** — adversarial review confirmed deletion would strip gating
   from many unrelated write controls.

### Owner Decision Needed

1. **Execute the phantom co-PI remediation?** Deliberately not run — the owner chose
   not to delete data. Evidence: `outputs/phantom-copi-incident-2026-08-12.md`;
   `docs/CURRENT_WORK_QUEUE.md` audit follow-ups; `scripts/remediate-placeholder-copi.js`.
   Trade-off to settle first: deleting removes a demonstrably wrong name but does
   **not** recover the right one. The `copi2`/`copi4` occupancies imply genuine co-PIs
   hold the earlier slots on two requests, so program staff may want to check the
   seven proposals against source documents first.

2. **Should `merge-candidates` remain organization-open?** The only survivor of the
   three S420 questions. Evidence:
   `.claude-memory/project-merge-candidates-authorization-gap.md`;
   `outputs/merge-candidates-authorization-decision-2026-08-12.md`.
   S422 proposes **declining** an authorization check: every Reviewer Finder user
   already has equivalent direct Dataverse access, the app connects as a service
   principal (`client_credentials`), and the owner confirms nobody holds the retired
   `reviewer-finder` grant without `reviewers` `[OWNER-REPORTED, not probed]`. The
   proposal is written and reviewed but not formally accepted.

### Verify Before Acting

1. **The seven-request count is a floor, not a ceiling.**
   `[VERIFIED for email exactly `_@_._`; other placeholder shapes UNTESTED]` The
   sweep matched that one literal. `x@x.com`, blank, or `noemail@…` variants would
   not have appeared. Widen the pattern (`--email` on the script, or a broader query)
   before anyone calls this cleanup complete.

2. **Re-run the dry-run before acting on the seven rows.** The recorded slot and
   junction ids are a 2026-08-12 snapshot. `deleteRecord` does **not** tolerate 404
   (unlike `disassociate`, `write-core.js:327`) — cascaded deletes would surface as
   404 "failures" that are actually successes.

3. **Request `1002788` "To Explore the Universe" looks like test data in production.**
   Byline "Paige Kelley and UC SB and CU SD and A B and alex dragos and ray meyer",
   emails `abc@uc.com` / `alex@alex.com` / malformed `river@uc.com.`; marked Submitted
   with an invite recorded 2026-08-10. Confirm it is a sandbox record before assuming
   so — it is also cited as pilot evidence in `docs/CURRENT_WORK_QUEUE.md` order 1.

4. **SharePoint policy branch disposition.** `[RE-VERIFIED 2026-08-12, S422]`
   `origin/codex/sharepoint-storage-policy-questions` is still unmerged: 4 commits
   ahead, `main` now **62** ahead (was 52 at S421). It strands a documented
   correction — `main` still contradicts itself on the version limit
   (`docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md:616` says 500 major versions, but
   `docs/INITIAL_ASSESSMENT_CONTROLLED_PILOT_2026-07-30.md:209` still says "Version
   limits — still open" and `docs/CURRENT_WORK_QUEUE.md:37` still says "the configured
   limit unanswered"). No gate catches it. Only the *version-limit* phrasing is stale.

5. **`codex/initial-assessment-pilot` disposition.** `[RE-VERIFIED 2026-08-12, S422]`
   Still exactly 2 commits not in `main` (`main` now 514 ahead). Sibling branches with
   similar names *are* merged — do not let a substring match report this one as merged.

6. **No browser verification of the invite-modal change.** The relocated error and
   the new warning are two `<p>` elements in a panel that already renders text, and
   the full unit suite plus a production build pass — but nothing rendered them in a
   browser. Low risk, explicitly unmeasured.

### Parked

1. **Invite-tab surfacing of needs-merge alerts.** Re-open only if a new alert probes
   `STILL_BLOCKED`.

2. **Exact activity ledger and deferred-load API (Phase 2).** The reason is now
   settled rather than pending: the scope decision came back **convenience**, so there
   is no evidentiary requirement to justify a persisted ledger. Re-open only if that
   scope decision changes.

3. **Staff review step before the grantee portal shows co-PIs.** A product question,
   not a bug — re-open only on an owner decision.

4. **Bespoke per-invitation review due date.** Considered and declined 2026-08-12:
   not worth the effort for a rescue-mode condition that disappears next cycle, when
   materials are in hand at invitation time. Would have needed per-reviewer override
   writes at send time — a partial-success surface requiring `/contract-reconcile`.

5. **The invite modal's "request-level campaign settings when saved" note.**
   Inaccurate for any wave after the first (set-only-if-unset), but in the zone where
   it misleads you are in rescue mode and should not be relying on campaign settings
   at all. Owner: not worth correcting for one cycle.

### Do Not Reopen Without New Decision

1. Launching a merge from a stored alert (`initialMerge`).
2. Changing the accepted-reviewer 90-day token policy for ordinary extensions.
3. Materializing a derived reviewer-history backfill.
4. Modifying load-bearing reviewer write paths merely to improve drawer labels.
5. **Changing application code for the phantom co-PI.** The app read and rendered
   correctly at every step; this is data remediation plus an upstream import fix.
6. **Deleting `computeCanManage`.** Adversarially confirmed to gate many unrelated
   write controls. Repair the fail-open branch instead (Verified Open #6).
7. **Reinstating a block on any `respondBy` condition in the invitation timeline.**
   Adversarial review recommended it; deliberately not adopted, because `respondBy`
   drifts with today and a block recreates the exact bug S422 shipped a fix for. The
   reasoning is in `63d35e7f` and in the source comment above
   `invitationTimelineWarning`.
8. **Reviewer activity history scope.** Decided: operational convenience. Re-opens
   only if someone proposes feeding it into a reliability or payment decision.

## Key Files Reference

| File | Purpose |
|------|---------|
| `shared/components/reviewers/InviteEmailModal.js` | `validateInvitationTimeline` (blocking, fixed dates only) and `invitationTimelineWarning` (advisory); the never-block-on-`respondBy` rule is documented above them |
| `lib/services/review-manager/send-emails-service.js` | Sole writer of `wmkf_materialssentat`; also the set-only-if-unset campaign-config seeding that makes late-wave due-date edits non-authoritative |
| `lib/external/reviewer-due-date.js` | `resolveEffectiveReviewDueDate` — the per-reviewer override is the authoritative deadline everywhere |
| `outputs/merge-candidates-authorization-decision-2026-08-12.md` | Merge decision + Codex revision log; §E is the top open item |
| `.claude-memory/project-merge-candidates-authorization-gap.md` | The gap itself, re-verified S422 with corrected citations and correctly scoped reach |
| `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` | Activity-history behavior, the convenience scope decision, and the receipt-provenance hazards |
| `outputs/phantom-copi-incident-2026-08-12.md` | Incident record: contact GUIDs, all 7 requests with slot + junction row ids |

## Testing

```bash
npx jest tests/unit/invite-email-modal-capture.test.js   # invitation timeline contract
npx jest tests/unit                                      # 581 suites / 7372 tests
npm run check:types
npm run check:agent-wiki && npm run check:agent-wiki:self-test

# Read-only; requires the prod-read flag. Expect a 7-slot / 7-junction plan
# until the owner decides to execute.
DATAVERSE_ALLOW_PROD_READS=yes node scripts/remediate-placeholder-copi.js --dry-run
```
