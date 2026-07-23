# Session 370 Prompt: Complete the reviewer terminal-status rework

## Why this session changed direction

The first S369 branch combined three distinct concerns: terminal reviewer status,
deadline/reliability evidence, and recovery after a sent email whose engagement-row stamp failed.
Repeated adversarial reviews found new ordering and identity holes in the short-lived HMAC repair
protocol. The owner asked for a step back rather than another local repair.

The current decision is to split the work:

1. **Active:** ship only post-accept terminal statuses (`withdrew` and `released`).
2. **Deferred:** design deadline evidence from durable, ordered materials dispatches.
3. **Separate:** completed-review payability disposition.

`docs/CURRENT_WORK_QUEUE.md` remains the priority authority.

## Active implementation boundary

The feature branch `feat/reviewer-terminal-status-due-date` contains the terminal-status work.
Despite the historical branch name, the reworked slice adds no due-date column or repair endpoint.

The terminal contract is:

- only accepted, unsubmitted, nonterminal rows can transition;
- terminal values never stamp `wmkf_reviewreceivedat` or `wmkf_completedat`;
- status plus external-token revocation is one ETag-guarded write;
- ordinary lifecycle and soft-delete paths cannot reopen or erase a terminal row;
- external submit, staff manual entry, mark-without-file, and upload all lose safely to a terminal
  transition;
- every upload 412 loser leaves its unique SharePoint attempt orphaned and never deletes it;
- terminal rows leave outstanding/reminder/thank-you work without counting as completed reviews.

The only Dataverse provisioning in this slice is the owner-gated extension of the existing
`wmkf_reviewstatus` picklist through
`scripts/extend-reviewstatus-picklist-terminal.mjs`.

## Deferred deadline-evidence design

`DynamicsService.createAndSendEmail()` creates a durable Dynamics email activity and returns its
`emailId`. Before adding deadline schema, probe whether that activity can carry or expose reviewer
suggestion identity, engagement generation, communicated due date, and ordered sent state. Prefer
that existing append-only evidence; otherwise design a small dispatch entity keyed to the email
activity. Do not restore the expiring HMAC receipt or mutable first/last due-date fields.

## Work remaining before handoff

1. Finish source and durable-document reconciliation.
2. Run focused terminal/race/send tests.
3. Run all relevant gate/self-test pairs and the production build.
4. Perform one bounded final invariant review against
   `docs/REVIEWER_TERMINAL_STATUS_AND_DUE_DATE_PLAN.md`.
5. Commit the working branch without staging unrelated
   `docs/RECONCILIATION_REPORT.json` drift.

## Release boundary

This is Tier 2 runtime work. Do not merge or deploy automatically. Provision the terminal picklist
values before deliberately promoting code that can write them, then rehearse the approved
UI → route → service → Dataverse path and verify that the row has no received/completed stamp and
no longer appears as outstanding.

## Key files

| File | Purpose |
| --- | --- |
| `docs/REVIEWER_TERMINAL_STATUS_AND_DUE_DATE_PLAN.md` | Current contract and explicit deferrals |
| `.claude-memory/project-reviewer-reliability-data.md` | Durable owner goal and design boundary |
| `lib/services/review-manager/terminal-transition-service.js` | Terminal transition predicate/write |
| `lib/services/review-receipt-guard.js` | Shared receipt-writer terminal/race guard |
| `lib/services/review-upload.js` | Unique attempts and always-orphan-on-412 policy |
| `lib/dataverse/adapters/reviewer-suggestion.js` | Lifecycle irreversibility |
| `docs/atlas/dataverse-wmkf-appreviewersuggestion.md` | Reviewer-suggestion state Atlas |
