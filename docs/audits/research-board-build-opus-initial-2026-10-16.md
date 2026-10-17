# Initial Claude Opus build review — 2026-10-16

Historical first-pass review of an unfinished build; code was changing concurrently. Source-only; not deployment approval. Subscription OAuth CLI `--model opus --effort high`; no paid review product.

I found four blockers and six medium-severity defects. Most of them only show up when several layers interact. The review was read-only and I modified nothing. Bash was denied after the first command, so I ran no tests or gates. Everything below comes from reading source, not from running code.

## Blockers

**B1. One request leaving the roster freezes the cycle, and the admin can't fix it.**
- **Worker stops:** `earliestHandoff` throws `board_cycle_membership_changed` if any roster request stops being an ordinary Research request in that cycle (meeting date moved, test flag set) (`source.js:63`). The worker calls it before deliveries and notices, inside the same per-cycle try block (`worker.js:21-24`, caught at `:39`).
- **Why it loops:** until a first event is recorded, every hourly run stops there. Queued releases never deliver, so no first release is ever recorded and the window never opens.
- **Admin can't repair it:**
  - The save route rejects any roster ID that isn't a current candidate (`board-writeup-cycles.js:31-32`).
  - The UI only draws checkboxes for current candidates, so the stale ID can't be unchecked (`BoardWriteups.js:82`).
  - `saveCycle` refuses while any release is queued, failed or held (`config.js:101`), and nothing ever sets the `cancelled` state.
- This also contradicts the plan's "flagged for audited admin resolution, never silently removed": the admin is forced to remove the request just to save any other setting.

**B2. A refused settings save locks the whole cycle permanently.**
- `saveCycle` records a pending-save marker (`configIntent`) before calling `setSettingIfUnchanged` (`config.js:100-106`). That helper can refuse before writing anything: a revision conflict (`dataverse-settings-service.js:221`) or a non-412 patch error (`:237-239`).
- `reconcileConfig` then either fails with "conflict" forever (revision moved) or "outcome unknown" forever (revision unchanged) (`config.js:119-122`). Nothing ever clears the marker.
- While it's set, release queuing (`service.js:59`), delivery (`:84`) and archive start (`archive.js:80`) all refuse.

**B3. The email cutover uses two independent flags.**
- The old digest turns off on `RESEARCH_LEADERSHIP_DIGEST_MODE==='board-release'` (`leadership-digest-service.js:370`). The new worker, the CSO draft exception and the Graph writes use `BOARD_WRITEUPS_ENABLED` (`worker.js:12`, `config.js:58`, `graph/board-writeups.js:10`).
- So "both running" and "neither running" are both reachable. Plan §7 requires one mode, checked inside both handlers.
- The switch also turns off the digest for every Leadership-persona recipient (header line 15), not just Beth and Allison. Plan §2.10 says to inspect that list first and not drop anyone silently.

**B4. The file check can't handle normal folder use.**
- **Moved files count as missing:** only direct children of the cycle folder count as present (`archive.js:31`). A file staff moved into a subfolder shows as `missing`, with no separate `moved` status (plan §8). Reconnect only accepts files directly in the folder (`:50-51`), so the only remedy is to exclude it, and the archive loses that writeup.
- **Any extra file blocks archival:** that includes Word's `~$` lock files and anything Allison adds herself (`:37`, `:77`). The UI's only advice is to fix it in SharePoint (`BoardWriteups.js:75`), which conflicts with §11's exclusion of moving or deleting shared files.

## Medium

1. **Outstanding requests can't be identified.**
   - For a request with no document, `dashboard` keeps only `source` (null) and drops the request, so the row shows "Unavailable" with no institution (`service.js:32-33`, `BoardWriteups.js:71`).
   - Rows seen by non-CSO staff carry no number unless a receipt exists (`service.js:30`).
   - Beth's email falls back to raw request GUIDs for every never-queued request (`notifications.js:34`), so her first email could be 23 GUIDs.
   - This breaks owner decision §1 (Beth sees requests without a releasable document) and the rule that staff UI never shows internal IDs.
2. **A bad row hides earlier successes.** Field, GUID and duplicate checks run outside the per-row try (`service.js:49-51` vs `:53`). A malformed later row returns a 400 after earlier rows were already committed, so the client never gets per-row results.
3. **The 9 a.m. send can silently skip a day.** Notices run after all deliveries and archives in the same run (`worker.js:25-37`). `deliverNotice` re-checks `hour===9` against a fresh clock at four points (`notifications.js:49,56,80,93`). A slow run that crosses 10:00 drops that day's email, and by design there's no catch-up.
4. **Reconnect skips the plan's evidence requirement.** It binds any file in the folder on a matching eTag plus a confirm flag, with no identity or content proof (`archive.js:48-57`; plan §2.7). It also overwrites the release's original destination in place (`:63`); only the audit event keeps the old value.
5. **Draft links leak in two ways.** These are specific cases inside your pending privacy work.
   - **Grants Manager:** the dashboard payload includes `receipt.source.webUrl` (the working-draft link) and all events, even though the comment at `service.js:29` says otherwise.
   - **CSO:** the Board page shows the CSO early-draft links even when `BOARD_WRITEUPS_ENABLED` is off (`service.js:32-33`). In that state the Pre-Site/Final tabs hide the same file (`config.js:58`), so the two surfaces disagree.
6. **Archive registry lineage is mixed.** `wmkf_SourceDocument` points at the working writeup, but `wmkf_sourceversionid` and `wmkf_sourcecontenthash` describe the Board Materials copy (`archive.js:144,149`).

## Low
- The journal size cap counts JS string length (`store.js:28`), but the database limit counts bytes (`085:11`). With non-ASCII text, the database rejects the write as a raw 500 instead of the intended capacity error.
- Releases are delivered only by the hourly worker, so a release can sit "queued" for up to an hour. In the meantime the 9 a.m. reminder lists queued requests as outstanding.
- `assertBoardWriteEnvironment` hard-requires the production deployment and Dataverse host (`graph/board-writeups.js:10`). There's no registered test folder, so the §10.6 test-target rehearsal of both paths can only be done with mocks. The CSO draft preview is tied to the same write flag.
- Hot-path cost:
  - `resolveWriteupViewer` now makes about four remote calls for every non-superuser on the Workbench routes (`writeup-visibility.js:61-64`).
  - The Layout calls `boardActor` on every page load for anyone with reviewers access (`Layout.js:92-101`).

## Checked and fine (from source)
- Graph metadata includes `driveId`, `versionId` and `parentReference` (`graph/files.js:247-261`).
- The DOCX hash ignores SharePoint's repacking (`governed-docx-hash.js:234-245`).
- Email deduplication via `subcategory` is wired correctly.
- The request-folder filter matches the pattern used elsewhere.
- `proxy.js` has no `/api/admin` gate, so the Grants Manager can reach the admin route.
- The document projection includes `wmkf_leadershipreviewstartedat`.
- `requireAppAccess` enforces the Origin/CSRF check.

## Validation still needed
- Run `tests/unit/pre-site-writeup-visibility.test.js` and the consumer route tests. `writeup-visibility.js` now imports `board-writeups/config.js`, which pulls Postgres and Dataverse into a module that was pure before.
- Real-Postgres overlap and crash tests: concurrent `queueRelease` vs `startArchive`, a lease expiring mid-upload, and a crash between the upload marker and the PUT.
- [ASSUMED] Not provisioned: Dataverse option 100000014, the BOARD_WRITEUP schema readiness, and the maximum length of `wmkf_settingvalue`.
- Probe whether the Board Materials library returns `publication.versionId`. Release (`source.js:41`) and archive both require it.
- Check whether Graph reports a name conflict when the upload session is created or only at commit. That decides whether a conflict ends up as `failed` (retryable) or `held`.
- A dry run of the 9 a.m. gate across DST changes, and a cutover test proving exactly one digest path runs.

## Builder disposition (in progress)

B1: bootstrap failure no longer prevents other releases; pre-upload failures can be cancelled with an audit reason; retained stale roster rows are removable and existing stale membership does not prohibit unrelated setup saves. B2: definite rejections clear intent; conditional updates can resume the same ETag; ambiguous initial creates remain held for investigation. B3: one mode chooses legacy, Board or paused; disabling Board work does not restore old mail. Live recipient inventory remains a pre-activation check. B4: moved files will be identified separately and staff can restore them in SharePoint. Extra files intentionally block the approved manifest until staff resolve them; the app never moves or deletes files, so the cited scope exclusion is not violated.

M1: human request/institution/lead-PD labels added. M2: entire batch envelope validated before any commit. M3: bounded hourly schedule begins at the hour; daily notices are being prioritized before copy work. M4: reconnection validates current content/version and records the proof plus explicit human request-association attestation. M5: minimal audit projection and non-CSO receipt redaction; Board early-draft links follow the feature flag. M6: source lineage version/hash corrected to the related working document; exact edited Board provenance remains in the frozen archive journal. Size uses UTF-8 byte bounds below the DB cap.

Further tests, live DOCX rehearsal and final review are required. See Board-run Atlas for evidence limits.
