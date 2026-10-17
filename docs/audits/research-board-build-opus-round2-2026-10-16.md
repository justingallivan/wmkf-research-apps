# Second Claude Opus build review — 2026-10-16

Historical review of 2cc02a95e; read-only subscription OAuth. The fixes below postdate its verdict.

# Final Opus build review: 2cc02a95e vs 94dbed5e9

This was a read-only review using Read, Grep and Glob. I modified no files, ran nothing, and used no metered product.

**Verdict: BUILD NEEDS FIXES.** Two concrete blockers remain. The first fires every time a cycle setup save succeeds. The second fires whenever the single upload attempt fails. Both lock the whole cycle, and staff have no way to fix it in the app. The build is otherwise close: most of the initial findings are fixed. The activation prerequisites you listed are separate gates and are not counted as defects below.

## New blockers

**N1. Every successful cycle setup save leaves the cycle permanently locked.**
- **The save:** `saveCycle` stores the new settings (`intent.value`) in the Postgres cycle record, a JSONB column (`config.js:103` → `store.js:27-29`).
- **The check:** after a successful save, `reconcileConfig` compares the settings read back from Dataverse (`config.js:124`, still in form field order via `model.js:44`) with that stored copy, as JSON text (`config.js:128`). `resumeConfig` does the same at `:165`.
- **Why they never match:** JSONB re-sorts object keys (shorter keys first). The code reads `state` back as a parsed object (`store.js:23`; the integration test at `:21` does too), so the stored copy comes back in a different key order. The text comparison then fails.
  - [ASSUMED, not probed here] The key ordering is documented PostgreSQL behavior; I did not observe it in a live database.
- **What happens:** the Dataverse revision has moved, so line 135 throws `board_config_conflict` inside `mutateCycle`. The transaction rolls back and the pending-save marker (`configIntent`) stays set.
  - This includes the very first save, where the revision goes from `null` to a new ETag.
  - After that, every release is refused (`service.js:69`), delivery skips (`:94`) and archival is blocked (`archive.js:93`).
  - Retrying ends in "outcome unknown" or a conflict (`config.js:102`, `:166`).
- **Why tests missed it:** the unit test copies state with `structuredClone`, which keeps key order (`test:17`, `:160-175`). The real-Postgres tests never exercise config reconciliation.
- **Fix:** compare in a key-order-independent way, for example re-validate both sides and compare with sorted keys, or store the serialized string.
- **Test the fix:** a real-Postgres test that writes a pending save whose keys are in non-sorted order through `mutateCycle`, then calls `reconcileConfig` with Dataverse returning the same content in form order.

**N2. One failed upload freezes the cycle, and nothing in the app can fix it.**
- **When it happens:** the upload-started marker is set before the single upload PUT (`service.js:110-116`). Any error after that, including a definite Graph 4xx such as a name conflict, a timeout, or a 5xx, leaves the release `held` with no destination (`:143`).
- **Every remedy is refused:**
  - Cancel is refused once upload has started (`recovery.js:23`).
  - Retry demands that a copy be identified first (`:38`).
  - Binding needs a file whose content matches the approved copy (`:25-31`).
  - The CSO selecting it again just returns `held` (`service.js:72`).
  - Test 58 confirms this dead end.
- **Effect on the cycle:** setup saves are refused, including deactivation (`config.js:101`). Archival can never start (`archive.js:93`). Beth's reminders never stop.
- **Misleading screen text:** when no copy is found, the UI says the CSO must select it again, which is impossible (`BoardWriteups.js:94`).
- **Plan requirement not met:** plan §4 says retry is allowed after a proven refusal or no-upload outcome, but `:143` stores only `e.code` and drops the HTTP status. So no recovery path can tell a definite refusal from a timeout.
- **Minimum fix:** record the status when the release is held, and allow an audited cancel when a held release has no destination and the status was a definite refusal. Optionally, `cancelBrowserUploadSession` (`upload-session.js:110-124`) returning `cancelled` while the session URL is still in memory also proves nothing was uploaded.
- **Archive has the same pattern** (`archive.js:138-145`), but it only blocks completion, so I rate that part medium.
- **Activation gate:** whether Graph reports a `fail` name conflict when the upload session is created or only at the final PUT changes how often this happens. It doesn't change whether the dead end exists.

## Medium and low

- **N3 (medium): a pending save that can't be confirmed has no audited way to abandon it.**
  - If the first-ever save gets an unclear result (5xx or timeout), the cycle stays at "outcome unknown" or "create unknown" forever (`config.js:132-134`, `:168`).
  - If someone edits the setting directly in Dataverse, the cycle is stuck on a conflict (`:135`, `:166`).
  - Either way the cycle is locked; only a database edit fixes it.
- **N4 (medium): one roster request leaving the cycle (meeting date moved, test flag) stops every email for that cycle.**
  - That covers Beth's reminder, the admin confirmation, failure alerts and the completion email (`notifications.js:54-57`).
  - It shows up only as a generic alert that doesn't name the request.
  - Before archival starts, an admin can fix it with an audited roster change. After it starts, `archiveOne` holds the entry (`archive.js:127`), exclusion is refused (`:72`) and setup saves are refused, so completion can never happen.
- **N5 (low):** if creating an email activity fails outright, the one-time notices (failure, missing, complete) are stuck at `create_uncertain` permanently (`notifications.js:81-84`). The completion email is lost; an alert is raised.
- **N6 (low):** the CSO early-draft exception checks only `BOARD_WRITEUPS_ENABLED` (`config.js:58`, `service.js:37`), not the full mode check (`boardWorkEnabled`). The preview can therefore show in legacy or paused mode, when release is impossible.

## Prior findings, checked against current code

| ID | Disposition | Evidence |
|---|---|---|
| B1 | Fixed as cited; new related gaps are N2 and N4 | Startup check now has its own try/catch (`worker.js:24-32`); the route keeps old roster IDs (`board-writeup-cycles.js:35`); the UI shows a stale-ID checkbox (`BoardWriteups.js:102`); cancel works before upload (`recovery.js:23,45`) |
| B2 | Refuted for its original mechanism, replaced by N1 and N3 | A definite rejection clears the marker (`config.js:110-116`); `settingConflict` sets `.status=409` (`dataverse-settings-service.js:52`), and patch errors carry the status (`:238`) |
| B3 | Fixed | One mode setting (`mode.js:2-8`); the old digest runs only in `legacy` (`leadership-digest-service.js:371`); the worker and Graph writes require board mode (`worker.js:14`, `graph/board-writeups.js:11`). Recipient inventory stays an activation gate |
| B4 | Moved files fixed (`archive.js:34`); extra files blocking archival accepted | Plan §2.6 says pause until reviewed; §11 excludes the *app* moving files, not staff |
| M1 | Fixed | Human labels on the dashboard (`service.js:28-29`) and in emails (`notifications.js:53-57`) |
| M2 | Fixed | The whole batch is validated before any commit (`service.js:55-60`) |
| M3 | Mostly fixed | Notices now run first (`worker.js:33-37`); the hour is still re-checked inside sends (low) |
| M4 | Accepted | Reconnect records a content hash plus explicit confirmation (`archive.js:67-69`) |
| M5 | Fixed | Draft link removed for non-CSO viewers (`service.js:32`); audit events trimmed (`:43-45`) |
| M6 | Fixed | Source version and hash now point at the working document (`archive.js:164`) |
| Low: byte size | Fixed | UTF-8 byte cap below the database limit (`store.js:28`) |

Checked and fine:
- **Concurrency:** release delivery vs archive start, both serialized on the cycle row lock.
- **Overlapping workers:** a worker whose lease expired mid-upload can't record a destination, and the second worker holds the row instead of uploading again.
- **Auth:** identity comes from the session; the CSO is re-checked when the worker delivers; the Grants Manager can't save settings or roles.
- **Archive registry:** creation is recoverable by generation key.
- **Email recipients:** they are checked again before sending.

## Activation gates (not defects)

These are your listed prerequisites, plus two from this review:
- Registered test target
- Synthetic DOCX round-trip proving the content hash survives SharePoint
- Option `100000014` and migration 085 applied and read back
- Roles, dates and the confirmed roster of 23
- Hosted credentials and staff rehearsal
- Draining the old digest and re-checking recipients
- From this review: when Graph reports a `fail` name conflict, and whether ~$ lock files appear in the D26 folder

**To pass:** fix N1 and N2, with a real-Postgres test for N1 and a definite-refusal test for N2. N3 and N4 should at least get an operator runbook entry before activation.

## Builder disposition

N1 fixed with the shared order-independent canonical JSON comparator; real PostgreSQL test writes/reconciles the actual configuration intent after JSONB key reordering. N2 fixed by persisting only definite HTTP refusals from the single upload PUT; an admin can cancel a release or retry an archive with that proof. Missing responses, 404/410, timeouts and 5xx remain held and cannot replay bytes. Regression tests exercise both definite refusal and unknown outcome. N3 and N5 remain documented operator exceptions in the Board-run Atlas; no blind reset/resend is provided. N4 now permits audited exclusion before a committed or unknown archive upload and keeps admin notices running with unsafe request labels redacted. Tests cover exclusion and refuse it for unknown uploads. N6 now uses the shared mode for early-draft reads.

Broader regression tests also found and fixed an undefined status reference in the existing Pre-Site generation route. Board history reads now require schema readiness. Additional hardening preserves removed-roster receipts in the dashboard, constrains pagination to one folder, bounds archive filenames, rejects unknown source lifecycles, and limits legacy-digest suppression to Research. A focused Opus verification of the complete patch is required before review closure.
