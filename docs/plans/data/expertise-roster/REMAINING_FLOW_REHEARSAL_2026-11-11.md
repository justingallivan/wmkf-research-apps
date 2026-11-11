# Remaining roster flow rehearsal

[VERIFIED via actual browser/route execution and final private cleanup receipts]
Authorized live attachments passed save/reload, hash-exact download, consumed replay,
wrong-request refusal and delete. The second approved model submission succeeded as
batch route/service proof, persisted actor-owned results and rendered History; D99
was not tested through the picker. The first paid single call failed before result persistence; after its reviewed
normalized-text repair, the separately approved normal-UI rerun passed. Exact Graph/Blob cleanup, owned schema drop, unchanged public SQL/all 46 roster
profiles and temporary-file/server removal passed. The Superseded registry audit
row remains. See [final results](LIVE_ATTACHMENT_MATCHING_RESULTS_2026-11-11.md).
A separately authorized additional normal-UI single run subsequently passed with
actor-owned persistence, History and cleanup; see [rerun evidence](SINGLE_MATCH_RERUN_2026-11-11.md).
Batch picker, full-application and Production readiness are not claimed.

## Next planning direction

[PLANNED; owner decisions, November 11] The next expertise direction is
recommendations-only through the shared Executor/Power Automate backend, not staff
assignment. Future assignment requires a separate contract with Connor. No future
Phase I staff-version document is assumed. The authoritative source remains OPEN
pending shared source/cache work: Submission-Documents project narrative versus
AI Materials combined narrative–bibliography. Existing runtime callers and dated
rehearsals are preserved; this decision does not remove them.

The shared infrastructure owner confirmed clean baseline `0c4b8d39c` and retains
common source/cache contracts, PA authentication, typed storage/results, worker,
recovery and operations. The roster stream owns expertise semantics/validation and
recommendation presentation. Shared interface/typed-result admission, source/cache
selection, PA authorization/operations and deliberate roster cutover remain
integration dependencies, not built capability. See
[the new recommendations plan](POWER_AUTOMATE_RECOMMENDATIONS_PLAN_2026-11-11.md).

## Executed venue contract

The source-built minimal transport, staging, runner, model guard and logger passed
Opus review and bounded tests/build. User approval covered the named storage objects
and two model submissions; that bounded run is finished and cleaned up. The contract
below records its authorized execution, not reusable authorization for another run.
No new storage infrastructure or special Graph upload path was added.

## Verified boundaries

- [VERIFIED via `scripts/run-roster-browser-venue.cjs` and
  `lib/services/expertise-finder/roster-sql.cjs`] The signed-in browser venue
  can run the real roster editor in GUID-only preparation mode and uses a
  disposable SQL schema. At the preimplementation checkpoint, browser pooled
  transactions refuse and
  attachment staging still uses direct `@vercel/postgres`
  (`lib/services/portal-upload-staging.js`). Both are relevant for attachments.
- [VERIFIED via `lib/services/sharepoint-target-registry.js`] GraphService's
  only registered default SharePoint site is `akoyago-shared`. It is shared by
  Production and sandbox. Missing `SHAREPOINT_SITE_URL` selects that same site.
  The normal `UPLOADS_BLOB_RW_TOKEN` store `wmkf-uploads-private` is also shared.
  A sandbox Dataverse URL alone does not fence either shared write.
- [VERIFIED via `docs/plans/data/expertise-roster/CONSUMER_WRITE_REHEARSAL_2026-11-10.md`]
  Prior proof covers actual sandbox roster and SQL feedback service behavior.
  It does not establish authenticated browser attachment finalize/download/delete
  or the remaining linked editor cases. Current public import, allocator and
  rollback evidence stays dated and unchanged.

- [VERIFIED via `scripts/probe-roster-remaining-fixtures.cjs` and private
  `remaining-fixtures-20261111.json`] The bounded name probes returned 11
  test-named Contacts without a verified owned, harmless candidate and zero
  test-named Users. This name query does not establish absence of test Users
  elsewhere. The probe returned 32 marked test Requests and 46 roster profiles,
  and read-resolved the exact shared Graph site and Request drive. Private and
  public Blob, model and scanner credentials are configured. The scan setting
  is unset. Credential presence does not establish authorization or permission
  to write. No token values were emitted.

- [VERIFIED via `scripts/probe-roster-contact-triggers.cjs` and private
  `contact-triggers-20261111.json`] The sandbox has active Contact Create/Update
  registrations, including `AkoyaGo.Sync_BusinessCentral`. Their external
  effects are outside this rehearsal. No Contact was created. The approved
  revised walkthrough temporarily stores a reference to an existing eligible
  test-named Contact on the synthetic roster canary.

## Invariants

| Invariant | Enforcement and evidence |
|---|---|
| Target is explicit at each write boundary | Exact registered sandbox, disposable owned SQL schema, and real existing staff grants. For attachments, require separately approved exact Request, SharePoint drive/folder and Blob pathname prefix before mint or finalize. |
| Existing people and roster profiles stay intact | Mutate only the named synthetic roster canary. Temporarily reference one existing test-named Contact after exact identity and unclaimed-link checks. Compare the complete roster census and exact Contact readback before and after. No Contact/User writes, role assignments, messages or tenant accounts. |
| One attachment operation produces one binding | Real actor/request/scope staging lease, exact private object hash, one generation-key registry row, one Graph item and one SQL feedback ID. Same-stage replay returns those IDs. |
| Partial completion remains recoverable | Record staging/path/registry/item identities privately. Reuse the same staging identity after an uncertain response. Preserve cleanup evidence and the schema until exact residuals are handled. |
| Source fixture and shared storage neighbors remain untouched | Public SQL relation/row/FK/sequence/trigger fingerprints match. Only the approved synthetic storage objects are written or removed. No shared-folder recursive operations or Production Dataverse changes. |
| Evidence names the proof actually exercised | Real browser and storage observations are distinguished from synthetic SQL tests, controlled transport faults, read-only service consumers and unverified prerequisites. |

## Linked-person lifecycle — executed contract

[VERIFIED via `pages/expertise-finder.js`,
`shared/components/expertise-finder/RosterContactField.js`,
`pages/api/expertise-finder/contact-search.js`, `pages/api/expertise-finder/roster.js`
and `lib/services/expertise-finder/roster-service.js`] The editor searches and
hydrates Contact links through sandbox Dataverse under the existing
`expertise-finder` grant. Saves use the session's verified Dataverse actor and
an exact ETag. The roster service validates a newly chosen Contact's active
state and an enabled User when a staff link changes or is lead eligible. Category
changes clear incompatible links in the editor. Deactivation clears lead
eligibility and retains the historical User link. The Contact and User
alternate keys provide uniqueness at persistence. The Contact picker also
marks inactive, missing-email and missing-name results unavailable.

[VERIFIED via `roster-contract.cjs`, `roster-service.js` and the expertise
profile schema] `wmkf_contactguid` is text on the expertise profile. The editor
does a Contact read to validate the changed link, then PATCHes the expertise
profile with the GUID string. It makes no Contact mutation or Dataverse lookup
association request for this field. This source trace does not establish the
absence of unrelated platform automation. Verify the Contact independently.

1. [CONTRACT] Preflight the existing retained synthetic roster canary and its
   exact GUID/key/state, complete baseline census and authorized operator. Pick
   one existing active, unclaimed, test-named Contact using the read-only
   candidate inventory. A test name alone does not establish eligibility.
   Verify the exact GUID, display name, nonempty primary email, state and ETag
   by trusted sandbox read. Verify the editor's exact search returns the same
   eligible GUID and confirm no current roster profile, active or inactive,
   holds that GUID. Record the approved candidate identity and original row
   hashes in a private receipt. If any proof is ambiguous, stop before edits.
2. [CONTRACT] Immediately before the link save, repeat the complete roster census
   and verify that no active or inactive profile holds the selected Contact GUID.
   Stop if the Contact is claimed or the census is incomplete. In the real
   authenticated editor, select that Contact on the inactive Consultant canary,
   save, reload and verify the exact link and
   displayed primary email. Verify manual preferred email is unavailable
   while linked. Activate and deactivate only the canary and verify each
   state. Clear its Contact and restore its original managed values with the
   current ETag. Leave the Contact's original lifecycle, fields and email
   untouched. No Contact adapter writes or notification steps are permitted.
3. [CONTRACT] Prove inactive/missing Contact refusals, stale ETag, enabled-User
   link, lead eligibility, lead clearing on deactivation, retained historical
   User, reactivation and category changes in controlled tests. Do not change
   Contact or User lifecycle to manufacture unavailable cases. Numeric
   consumer and live User write proof remain separate.
4. [CONTRACT] Compare the complete before/after Dataverse roster census. All
   non-canary GUIDs, keys, values and ETags match. Canary managed values are
   restored, with intentional ETag/native audit history recorded. Verify the
   exact Contact's fields, active state, modified time and ETag match the
   before read, and no roster link to it remains. If the Contact ETag changed,
   read its modified-by identity and modified time to investigate unrelated activity
   before attributing the difference to this rehearsal. Never repair or mutate the
   Contact. Stop further mutations on uncertain restore and report the exact
   retained synthetic state.

## Attachment rehearsal and separate shared-resource approval

[EXECUTED CONTRACT] Candidate venue uses one existing synthetic Request in sandbox with
exactly one verified document location of any state, a known library/drive and an exact
synthetic child folder on registered shared `akoyago-shared`. Use
`wmkf-uploads-private` only with explicit owner approval for one exact
`portal-staging/consultant_feedback/<synthetic request GUID>/` prefix and the
named Vercel Blob usage, which may consume credits or money. Obtain explicit
authorization for the exact SharePoint Request folder, two PDF copies and the
`Consultant Feedback` child folder, plus exact cleanup on the shared site. No Graph or Blob mutation is authorized by this plan
before those approvals. Do not widen the store/site registry or use a real
Request. If existing authorized resources do not match, report the missing
fixture/approval and keep this proof pending.

[VERIFIED via source] The path is `ReviewsTab` → `ConsultantFeedbackSection`
→ authenticated `/api/workbench/consultant-feedback/upload-token` → actor/request/
scope-bound private Blob token and `portal_upload_staging` row → browser-direct
upload → authenticated `/finalize`. Finalize claims the lease, reads the exact
private bytes, hashes them, optionally scans, and uses
`consultant-feedback-attachment-service.js` to upload to SharePoint, record the
candidate, create or reuse one Ready/Draft `wmkf_requestdocument` under the
generation key, and bind it to `consultant_feedback.requestdocument_id`.
The staff `/attachment` route verifies the request/entry/registry relationship
before downloading the recorded Graph drive/item. The shared briefing member
also requires shared active feedback. Ordinary attachment deletion marks the
row deleting, supersedes the registry row and deletes SQL. It does not delete
the successful SharePoint item. The staff feedback GET can sweep unfinished
deletions, so even readback requires an isolated fixture.

1. [EXECUTED CONTRACT] After approval, pin the exact Request GUID/number and its active
   sandbox location with complete read-only queries. Require exactly one
   Request location across all states. Verify its resolved parent library and
   actual Graph site/drive/folder IDs. Prove the resolved bucket library drive equals
   the default `akoyago-shared` `akoya_request` drive used by the normal upload path. Verify the computed child folder equals
   the approved path before any Graph write, and no pre-existing run item. Verify both `expertise-finder` and `reviewers` app grants,
   sandbox registry create/read/update permissions and Graph exact write/read/
   cleanup permission. Verify the Blob token selects the approved private store,
   and the route uses only the approved prefix. A malformed or mismatched
   destination blocks before mint/finalize. No app grant or storage permission
   expansion is implied by an authorized write.
2. [IMPLEMENTED CONTRACT] Use the disposable SQL venue and migrations 031 and 049 for the
   staging ledger and Consultant Feedback scope, plus the existing 048 feedback
   table. Add only a scoped browser-mode staging SQL selector and verified
   `db.connect()` for the feedback transaction path, conditional on the approved
   rehearsal venue. Preserve normal-mode Vercel behavior and the existing browser
   defaults. Prove staging and feedback SQL use the same owned schema, and allow
   only the approved synthetic Request by operator procedure for this run.
   Use `browserSql` in staging; verify namespace before returning a pooled transaction
   client and discard it on verification failure. Apply migrations 031/049 only in
   the owned browser fixture; keep the background-schema-ready flag unset. Preserve
   non-browser Vercel delegation. Graph credentials already exist in the venue;
   selectively pass the approved private uploads token and application provider key
   only for an authorized run, without repurposing them for agent authentication.
3. [VERIFIED via `lib/utils/sharepoint-buckets.js`, the attachment service and
   focused tests] Attachment finalize now passes
   `{requireResolvedParents:true, requireCompleteResults:true}` at the governed
   attachment resolution call and maps resolver errors to `folder_unavailable` 503.
   Tests verify those flags and that
   unresolved or incomplete responses produce no Graph ensure/upload. Separately
   prove the resolved folder is exactly the approved synthetic target. The strict
   flags alone do not choose among multiple valid locations. Map any resolver
   failure to the existing retryable `folder_unavailable` 503. Other writers
   using non-strict location lookup remain outside this change.
4. [EXECUTED CONTRACT] In the real browser, use one harmless synthetic PDF and a one-off
   consultant name to exercise attachment-only create without depending on
   roster-binding setup. Capture staged lease scope, actual byte hash, private
   object behavior, Graph drive/item, registry ID/status, and feedback ID.
   Reload and download through the authenticated staff attachment endpoint,
   compare SHA-256 and content type, and confirm wrong-request refusal. Replay
   the same successful staging ID once to verify unchanged feedback/registry
   IDs and exactly one Graph object. This is consumed-staging replay evidence,
   not proof of intermediate recovery paths. No replacement or additional file is
   necessary for this bounded proof. Shared briefing is outside this run.
5. [EXECUTED CONTRACT] Delete through the UI and confirm absent feedback row, Superseded
   registry record, and refused staff attachment read. Remove only the
   separately approved exact Graph item and any exact persisted staged Blob
   path still present. Confirm both missing. Retain the superseded audit row as
   agreed evidence. On incomplete cleanup keep the disposable schema and exact
   stage/item receipts for recovery. No recursive folder deletion, broad
   maintenance sweep or guess at an untracked item. After verified cleanup,
   fingerprint public SQL and end the disposable venue. Confirm automatic staged
   Blob deletion with an exact persisted-path HEAD 404. Remove the approved child
   folder by exact ID only after verifying it empty, or retain it explicitly in the
   receipt. Dump staging and feedback rows privately before cleanup; refuse schema
   removal while any staging row exists, feedback differs from its seeded baseline,
   or the retention query fails. Keep that SQL evidence for partial-success recovery.

[EXECUTED CONTRACT] Use synthetic bytes with the optional Cloudmersive scan off in this
venue, unless that named metered product is separately authorized. This proves
the attachment pipeline under that configuration. Existing controlled tests
cover scanner and intermediate transport failures. Real storage proof requires
the named approvals above and does not follow from green tests alone.

## Live venue preflight

[EXECUTED CONTRACT] Before any approved write or paid call, load the synthetic Request workbench
with zero writes and inspect its actual dependencies. A 500 blocks continuation.
The route import scan alone does not establish all Reviews-tab service compatibility.
Keep scanning off; no Cloudmersive usage is authorized. Use the existing Graph path,
not a special rehearsal upload implementation.

## Matching handoff

[VERIFIED via fresh read-only resolver, Anthropic model-list GET and prompt
composition] The sandbox v2 row is version 1 with model alias `sonnet`.
The credential-free static fallback was `claude-sonnet-5`. The warmed live
model list currently resolves `claude-sonnet-5-5` with max output 4,096.
The snapshot contained 40 active profiles and three eligible leads. The
synthetic prompt pair was 57,470 UTF-8 bytes. Treat a one-byte-per-token
estimate only as a sizing heuristic. The probe made no inference call.

[EXECUTED CONTRACT] Continue controlled transport and persistence checks without paid
calls. Any new live single/batch run requires explicit named Anthropic
`claude-sonnet-5-5` authorization after disclosure that it may cost money.
The implemented pre-inference guard pins `claude-sonnet-5-5` and maxTokens 4096 in browser mode inside
`assertRosterPrompt`, covering single and batch before inference; refuse any mismatch.
The implemented usage logger contains synchronous initial and synchronous/asynchronous
fallback SQL failures, with tests, so logging cannot turn a saved result into false
failure. A missing usage row must still be recorded honestly.

For the historical executed batch rehearsal, the second approved PDF copy used
the Phase I staff-version filename pattern directly in the synthetic Request
folder because the existing batch listing is non-recursive. It was uploaded with
conflict behavior `fail` and removed by exact item ID and ETag. This fixture does
not select the future automation source. The
batch picker covers 2020 through next year and excludes this D99 fixture: label any
same-origin batch POST as route/service proof, not picker proof. Private/public Blob
use is limited to the approved synthetic scope. Each model submission can make up
to four attempts on 429/529 plus one corrective deprecated-parameter retry. Timeouts
are not retried but may still be billed; no fallback model is configured. Keep
matching receipts separate from attachment and linked-person evidence.

[EXECUTED CONTRACT] After exact approval, temporarily serve the private inert
`roster-batch-rehearsal.html` locally. Its ordinary HTML form POSTs once to the
same-origin `/api/expertise-finder/batch-match` with the exact Request 1000339.
Use the real signed-in browser and normal URL-encoded route parsing; no injected
cookies, developer-console fetch, test auth, new API or picker change. The temporary route form was submitted during the authorized run and has been removed. This is route/service proof, not picker proof.
