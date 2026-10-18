# Research writeup revised plan — Opus review

Date: 2026-10-16. Historical review of the initial draft; the linked plan has since been revised. Read-only Claude CLI review through subscription OAuth, requested model opus; runtime reported claude-opus-5-5 (with auxiliary claude-fable-5-1). No runtime edits or external writes performed.

## Disposition

[Revised plan](../plans/RESEARCH_WRITEUP_RELEASE_AND_BOARD_ARCHIVE_PLAN_2026-10-16.md). Technical recommendations incorporated; owner choices remain pending. No second independent review of the revised draft.

1. Accepted: dedicated admin-only revision-fenced settings; no grant-cycle customFields. Verified settings helper If-Match and email consumer iteration in source.
2. Accepted: meeting-date cycle code + verified Research program GUID, explicit mismatch handling. Live program/roster probe remains a prerequisite.
3. Accepted: separate authority key, no staffing schema mutation.
4. Accepted: hourly/local-hour gating and local-date receipt; UTC scheduling independently checked against official Vercel cron docs. No configurable time/zone UI.
5. Accepted with stronger safety: admin reconcile, but a lost response cannot be reset to failed merely to permit retry. Proof of no upload or exact ownership/content is required.
6. Accepted for the new flow: deployment-by-target gate on both Graph paths. Reviewer only examined the target registry; this is not evidence that every existing write path is unguarded.
7. Partially refuted: `boardCopiesEnabled` in `lib/services/final-writeup/board-copy-service.js:33` already requires production, explicit feature flag and registered production Dataverse hostname. The claim that old cron work has no feature flag is false. Accepted fresh-branch implementation and no porting of the old trigger; migration 084 remains an incompatible schema, with applied state unknown. No destructive revert authorized or performed.
8. Accepted defensively: persist first handoff and bootstrap all historical Final rows with validated cycle attribution. Successor checkpoint-copy semantics were not proven by review, so no claim that every regeneration loses the timestamp.

Graph helper restrictions, explicit archive fail-on-conflict, no byte staging, recipient preflight, rollback mail-off, route grants and Board end-date clarifications incorporated. Draft privacy and remaining product choices are explicit owner checkpoints.

Verification: source inspection, not implementation tests. Disconfirming checks found the old service feature gate and existing strict settings writer; revised claims account for both. No production schema, roster, recipient, DOCX or end-to-end archive proof is claimed.

## Original review (verbatim; findings qualified above)

**Verdict: READY WITH NAMED CHANGES.** The plan's structure is sound: create-only copies, request-keyed receipts, an independent roster, and a separate Board registry type. But four of the reuse claims it relies on don't hold up against the code, and three liveness and safety gaps need a sentence each. All are bounded plan edits, so none of them requires a redesign.

Scope: Mode A review per `/contract-reconcile`. Read-only; nothing was edited, run, or sent. The plan is entirely **[PLANNED]**, so I checked the existing code it proposes to reuse and did not ask for implementation evidence.

## Blocking technical findings (fix in the plan before approval)

**1. Cycle `customFields` can't safely hold Board config.** §5 makes this conditional ("if that cannot be proved"); the code already shows it can't be proved.
- **No ETag:** `updateCycleById` PATCHes the whole `wmkf_customfields` JSON with no If-Match (`grant-cycles-dataverse.js:237,262-271`). Unparseable JSON is silently read as `null` (`:61-68`), so the next write would overwrite it.
- **Who can write it:** the PATCH route passes `req.body` straight through, and access only requires a `reviewer-finder`/`reviewers` app grant, not admin (`pages/api/reviewer-finder/grant-cycles.js:63,164-170`).
- **It leaks into reviewer email:** `email-generator.js:455-480` iterates every key (date-formatting `*date*`/`*deadline*` keys) into template data. `draft-fingerprint.js:94` hashes `custom_fields`, so Board config edits would change reviewer-email draft fingerprints.
- **Fix:** Drop the `customFields` option. State that cycle config, roster and recipients use a dedicated additive contract, with revision-fenced writes under an admin-only route.

**2. "Canonical cycle ID" is undefined.** There are two cycle notions in source:
- `wmkf_appgrantcycle` rows: keyed by shortCode, `programName` is free text, and they join to requests by the `akoya_fiscalyear` string (`grant-cycles-dataverse.js:76-91,180-190`).
- The meeting-date code (`J26`/`D26`) that the Final dashboard uses (`cycle-code.js:24-33`, `dashboard-service.js:155-157`).

No verified join exists between them.
- **Fix:** Key every ledger, roster and receipt on the meeting-date cycle code plus the Research Grant Program GUID.
- Name the program-ID source. Don't silently reuse `FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS`, or the Board flow widens whenever that list does.
- Say what happens when a request's `wmkf_meetingdate` moves it out of the cycle after it's on the roster: an audited flag, never automatic removal.

**3. CSO binding inside the staffing setting has a large blast radius.** The v2 validator rejects unknown keys (`matrix-audience-service.js:31,171-176`), and stored values are re-validated on every read (`:222`).
- Adding a key to v2 makes every read fail with a 503.
- Bumping to v3 empties personas for every v2-only reader (`:377-384`). That includes draft visibility (`writeup-visibility.js:50-53`), the PD audience and the digest, and it also breaks any code rollback.
- **Fix:** Use a separate versioned setting key for release authority, written with the existing revision-guarded settings write.

**4. "9 a.m. Los Angeles" can't be a single Vercel cron.** Crons run in UTC, and the existing digest deliberately accepted drift by firing at 07:00 UTC (`leadership-digest-service.js:118-126`).
- **Fix:** Specify either an hourly cron gated on local hour plus a local-date receipt, or accept an 8/9 a.m. shift.
- Drop the admin-configurable "reminder time/zone" in §4: nobody asked for it, and the project rules say simplest first.
- The single cutover mode must be checked inside both route handlers, because `vercel.json` schedules are fixed per deployment.

**5. Rows that can never finish.** Reminders stop only at "all released", but two row states have no way to resolve:
- A create-only name conflict, which by design is never replaced, renamed or adopted.
- A "needs-investigation" row (lost upload response); §4 withholds ordinary Retry from these.

As written, a single such row keeps the daily email going forever.
- **Fix:** Add an admin reconcile action. It should bind an existing item by ID only after proving it's the app's own upload (receipt sentinel, size and hash or semantic check), or mark the row failed so it can be retried.

**6. Nothing stops Preview or local builds writing to the real Board folder.** `RESEARCH_BOARD_MATERIALS_TARGET` is one production folder with no deployment gate. The akoyaGO site is shared by the production and sandbox Dataverse environments (`sharepoint-target-registry.js:1-8,68-73`), and the prior probe already wrote there from local credentials (plan §3).
- **Fix:** Add a deployment-by-target gate for Board Materials writes and request-folder archive writes, failing closed outside Production unless the target is an explicitly registered test folder.
- Admin target binding should only accept registered IDs.

**7. Old build on this branch.** The `final-writeup-board-copies` cron runs every 15 minutes with no feature flag (`vercel.json`, `pages/api/cron/final-writeup-board-copies.js`). It hardcodes Allison and Beth (`board-copy-config.js`). Migration 084 can't be reused as-is: it has a `cycle_code='D26'` CHECK, a two-sign-off CHECK, and a `request_id`-only primary key. Main's manifest ends at 083.
- **Fix:** Build the new work fresh from main, or revert `2a38dba86`/`b7c0e2074` first.
- Say that "leave old cron inert" (§10.2) means removing the schedule and the code path, not just leaving it unused.
- Say 084 is superseded whatever its applied state turns out to be.

**8. Window start can be lost.** The digest finds leadership timestamps only through the current-Final pointer (`leadership-digest-service.js:181,199-217`). `prepareRegeneratedFinalSuccessor` (`transition-service.js:197-239`) creates a new row, so a regenerated Final leaves the first-handoff row non-current.
- **Fix:** Bootstrap by scanning every Final-Writeup row with a `wmkf_leadershipreviewstartedat` for the cycle's requests, including superseded rows. Alternatively, record the timestamp at the moment of handoff.

## Named technical changes (non-blocking, but write them in)
- **Graph seams.** `createBoardMaterialsUploadSession` hardcodes the root folder ID (`graph/board-materials.js:13`); cycle subfolders need a verified subfolder-ID parameter and create-only folder provisioning. `uploadFile` defaults to `conflictBehavior='replace'` (`writes.js:132`), so the archive path must pass `'fail'`. `downloadFileVersion` can't fetch the current version (`downloads.js:150-153`).
  - Since §5 already says a changed version means re-selection, a worker that downloads the current file with an ETag and hash check needs no byte staging.
  - Either drop private staging or name its store and token. The project has store-specific Blob token rules.
- **Allison removal vs rollback.** Digest recipients are every Leadership persona member (`leadership-digest-service.js:387-389`), with no per-person exclusion. Allison stops getting mail only because the digest is turned off, so rollback has to mean "no leadership digest". Re-enabling the old digest would email her again.
- **Precedent for the Board registry type.** The Initial Assessment Board snapshot uses a producer discriminator (`requestDocument.js:86-96`), and every reader has to exclude it (`artifact-reader.js:179,208,255,356`). That supports the plan's separate `BOARD_WRITEUP` type; cite it, and consider reusing its `Board Milestones` request subfolder.
- **Small clarifications:**
  - Board meeting: single date or range? §2.5 says "final day".
  - Name the app grant and routes for Beth's dashboard and the Admin section, and add them to the route security matrix.
  - Filename sanitizing can reuse `boardWriteupFilename` (`board-copy-service.js:56-60`).

## Owner decisions (not flaws)
1. **Draft privacy vs release.** The §2.2 fallback to the working writeup would let Beth preview and copy a Pre-Site draft (DRAFT or REVIEW lifecycle). The 2026-10-06 owner rule hides that file from everyone except the lead PD, coordinators and superusers (`writeup-visibility.js:1-25`). Either the owner explicitly overrides that for release, or the fallback is limited to post-group-review sources. Any override has to be listed in `tests/unit/pre-site-writeup-visibility.test.js`.
2. **Recovering a deleted released copy before the meeting.** There is no in-app re-release, so recovery is a manual re-upload plus binding it at archival. Confirm that's acceptable.
3. **Where Beth's approval is recorded.** The plan puts it only in a Postgres receipt, while existing sign-offs live in Dataverse, so future Dynamics readers won't see it.
4. **Who else loses the digest.** Turning off the digest cuts every Leadership persona member's Research digest, not only Beth's and Allison's. Run a preflight listing current Leadership recipients before cutover.
5. Plus the §2 proposed defaults, as the plan already frames them.

## Recommendation evidence
| Recommendation | Evidence | Status |
|---|---|---|
| Don't use `customFields` | `grant-cycles-dataverse.js:237,266`; `grant-cycles.js:63,164-170`; `email-generator.js:455-480`; `draft-fingerprint.js:94` | VERIFIED |
| Separate CSO setting key | `matrix-audience-service.js:31,171-176,222,377-384` | VERIFIED |
| Cycle code as the key | `cycle-code.js:24-33`; `dashboard-service.js:155-157` | VERIFIED; whether any appgrantcycle GUID join exists is NOT TESTED |
| Hourly gated cron | `vercel.json` digest `0 7 * * *`; `leadership-digest-service.js:118-126` | VERIFIED; Vercel's UTC-only scheduling is outside knowledge, not checked live |
| Bootstrap from all Final rows | `transition-service.js:197-239,347-356`; `leadership-digest-service.js:181-217` | VERIFIED; whether successor rows copy or clear the checkpoint is NOT TESTED |
| Preview/local write gate | `sharepoint-target-registry.js:1-8,68-73` | VERIFIED that no gate exists in that file; other write paths not fully enumerated |

**Limitations:** I didn't re-check the request-folder resolver, the readers that would need to handle a new artifact type, the test-request email guards, or the route security matrix; §9 already lists these as audits to do. Production state is unknown: whether 084 was applied anywhere, who's in the live Leadership persona, the expected-roster query, and how SharePoint handles a real DOCX round-trip. I didn't read `acknowledgement-service.js` (the branch's self-signoff change) or the old store and tests beyond their schema and headers.
