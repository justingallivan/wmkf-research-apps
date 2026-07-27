---
name: feedback-list-and-confirm-before-bulk-deletes
description: When a cleanup directive names a single artifact, never bulk-delete adjacent items in the same folder/scope without listing and confirming first. Recurring foot-gun in cleanup tasks.
metadata:
  type: feedback
  status: active
  scope: global
  last_verified: 2026-07-27 as a historical S193 authorization failure; owner clarified artifact context on 2026-07-26
---

## Recall Rule

Read this when: a cleanup/deletion directive names a single artifact (file, row, record) but the surrounding folder/table/scope contains other items that "look" cleanup-eligible.

Do:
- Scope the deletion to exactly the noun the user named; delete one when they said "the file."
- List multi-item destructive targets by name and get explicit go-ahead before looping a delete.

Do not:
- Treat "I'm pretty sure they're all test files" as authorization.
- Expand a narrow directive into a broader "clean up everything test-ish nearby" scope.

Ground truth: historical-only (lesson, not live state). Related: [[feedback-verify-before-destructive-carryover]].

[VERIFIED historically via the S193 deletion/recovery incident and the owner's
2026-07-26 artifact clarification.] The lesson concerns authorization at decision
time; it does not classify any current file or row.

When the user asks to clean up "the test file" or "the artifact" or names a single thing, do NOT assume that everything else in the same folder/scope is also cleanup-eligible. List the contents, surface them by name, ask which to delete.

**Why:** S193 EICAR test cleanup. User asked to clean up "Request 1002379, reviewer Justin Gallivan Test." I queried Dataverse, found one suggestion row, then listed SharePoint folder contents — four files. I wrote `for (const f of items) await deleteFile(...)` and deleted all four without surfacing them first. One was a real-looking review PDF ("Tim Newhouse WMKF Research Reviewer Form...June 2026.pdf"), uploaded 3.5 weeks earlier. Recovery via SharePoint Recycle Bin worked, but the user lost time and trust. The owner clarified on 2026-07-26 that this PDF was also a test artifact from the retired reviewer-PDF experiment, not a genuine submission. The lesson is unchanged: that classification was unknown at deletion time, and “test” still is not deletion authority.

The root error was treating a narrow directive ("clean up the test") as if it implicitly authorized a broader scope ("clean up everything that looks test-ish in the vicinity"). Even when post-hoc analysis shows the deletions were all defensible, the move was unauthorized at decision time.

**How to apply:**
- Before any multi-item destructive operation (folder of files, table of rows, batch of records), list contents, present by name, get explicit go-ahead.
- A user's deletion directive scopes to the noun they named. If they said "the file," delete one file. If they said "everything in folder X," then loop.
- "I'm pretty sure they're all test files" is not authorization. The cost of asking is one extra turn; the cost of being wrong is data loss + recovery work + erosion of trust.
- Related: [[feedback-verify-before-destructive-carryover]] (the same principle applied to stale plan items, not adjacent artifacts).
