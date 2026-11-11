# Remaining roster flow rehearsal

Linked-Contact lifecycle passed; consultant-feedback attachments remain planned using
the existing local real-Entra browser venue, the registered Dataverse sandbox
and disposable Postgres. Keep prior public fixture and historical import receipts
unchanged. Obtain an Opus 5.5 plan review before code or venue changes and a build
review after verification. Opus 5.5 returned READY WITH NAMED CHANGES for the
strict destination repair and linked-Contact rehearsal. Both now passed their
bounded source/browser verification; see [evidence](LINKED_CONTACT_REHEARSAL_2026-11-11.md). Live attachments still
require the venue changes and shared-resource approvals below. This plan proposes
no new storage infrastructure.

## Verified boundaries

- [VERIFIED via `scripts/run-roster-browser-venue.cjs` and
  `lib/services/expertise-finder/roster-sql.cjs`] The signed-in browser venue
  can run the real roster editor in GUID-only preparation mode and uses a
  disposable SQL schema. Browser pooled transactions currently refuse and
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

[PLANNED] Candidate venue uses one existing synthetic Request in sandbox with
exactly one verified document location of any state, a known library/drive and an exact
synthetic child folder on registered shared `akoyago-shared`. Use
`wmkf-uploads-private` only with explicit owner approval for one exact
`portal-staging/consultant_feedback/<synthetic request GUID>/` prefix and the
named Vercel Blob usage, which may consume credits or money. Obtain explicit
authorization for the exact SharePoint synthetic folder, one new item and exact
cleanup on the shared site. No Graph or Blob mutation is authorized by this plan
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

1. [PLANNED] After approval, pin the exact Request GUID/number and its active
   sandbox location with complete read-only queries. Require exactly one
   Request location across all states. Verify its resolved parent library and
   actual Graph site/drive/folder IDs. Verify the computed child folder equals
   the approved path before any Graph write, and no pre-existing run item. Verify reviewer app grant,
   sandbox registry create/read/update permissions and Graph exact write/read/
   cleanup permission. Verify the Blob token selects the approved private store,
   and the route uses only the approved prefix. A malformed or mismatched
   destination blocks before mint/finalize. No app grant or storage permission
   expansion is implied by an authorized write.
2. [PLANNED] Use the disposable SQL venue and migrations 031 and 049 for the
   staging ledger and Consultant Feedback scope, plus the existing 048 feedback
   table. Add only a scoped browser-mode staging SQL selector and verified
   `db.connect()` for the feedback transaction path, conditional on the approved
   rehearsal venue. Preserve normal-mode Vercel behavior and the existing browser
   defaults. Prove staging and feedback SQL use the same owned schema, and allow
   only the approved synthetic Request for the browser attachment run.
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
4. [PLANNED] In the real browser, use one harmless synthetic PDF and a one-off
   consultant name to exercise attachment-only create without depending on
   roster-binding setup. Capture staged lease scope, actual byte hash, private
   object behavior, Graph drive/item, registry ID/status, and feedback ID.
   Reload and download through the authenticated staff attachment endpoint,
   compare SHA-256 and content type, and confirm wrong-request refusal. Replay
   the same successful staging ID once to verify unchanged feedback/registry
   IDs and exactly one Graph object. No replacement or additional file is
   necessary for this bounded proof. Shared briefing is outside this run.
5. [PLANNED] Delete through the UI and confirm absent feedback row, Superseded
   registry record, and refused staff attachment read. Remove only the
   separately approved exact Graph item and any exact persisted staged Blob
   path still present. Confirm both missing. Retain the superseded audit row as
   agreed evidence. On incomplete cleanup keep the disposable schema and exact
   stage/item receipts for recovery. No recursive folder deletion, broad
   maintenance sweep or guess at an untracked item. After verified cleanup,
   fingerprint public SQL and end the disposable venue.

[PLANNED] Use synthetic bytes with the optional Cloudmersive scan off in this
venue, unless that named metered product is separately authorized. This proves
the attachment pipeline under that configuration. Existing controlled tests
cover scanner and intermediate transport failures. Real storage proof requires
the named approvals above and does not follow from green tests alone.

## Matching handoff

[VERIFIED via fresh read-only resolver, Anthropic model-list GET and prompt
composition] The sandbox v2 row is version 1 with model alias `sonnet`.
The credential-free static fallback was `claude-sonnet-5`. The warmed live
model list currently resolves `claude-sonnet-5-5` with max output 4,096.
The snapshot contained 40 active profiles and three eligible leads. The
synthetic prompt pair was 57,470 UTF-8 bytes. Treat a one-byte-per-token
estimate only as a sizing heuristic. The probe made no inference call.

[PLANNED] Continue controlled transport and persistence checks without paid
calls. A live single/batch run requires explicit named Anthropic
`claude-sonnet-5-5` authorization after disclosure that it may cost money.
Only if approved, pin that exact model and refuse if actual runtime resolution
differs. Detailed fixture, cost and live proof remain pending. Keep those
receipts separate from attachment and linked-person evidence.
