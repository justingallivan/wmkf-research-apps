---
title: Post-research-presentation materials and Board presentation link
domain: meeting-tracker
kind: plan
status: proposed
summary: "Plan for Meeting Tracker to capture a Zoom recording link or SharePoint-hosted MP4 plus the latest transcript, surface them to program directors, and mint a 60-day materials-only Board link."
owner: product-engineering
related:
  - docs/PC_MEETING_TRACKER_PLAN.md
  - docs/DELIBERATION_BRIEFING_PAGE_PLAN.md
  - docs/plans/MEETING_TRACKER_MATERIALS_STATUS_PLAN_2026-09-21.md
  - docs/atlas/dataverse-wmkf-sitevisit.md
---

# Post-research-presentation materials and Board presentation link

## 1. Outcome and locked decisions

After a Site Visit / Research Presentation, support staff use Meeting Tracker to record the
presentation follow-up in either of two forms:

1. paste the share URL for a Zoom-hosted cloud recording; or
2. upload a locally stored MP4, which is written to the request's governed SharePoint folder.

Staff can also upload the meeting transcript. Program directors see the current recording and
transcript in Staff Deliberations. Meeting Tracker can mint and copy a separate external link for
Board members. That link shows presentation materials only; it does not expose the proposal,
reviews, consultant feedback, or staff brief.

Locked product decisions from 2026-09-21 plus review resolutions accepted 2026-09-22:

| Decision | Contract |
|---|---|
| Producer | Meeting Tracker is the staff authoring surface. |
| Internal consumer | Staff Deliberations is read-only and shows the current recording/transcript. |
| External consumer | A distinct presentation-materials link is available for Board members. It is not the existing full deliberation briefing link. |
| Link lifecycle | 60 days from issuance; ensure reuses the readable live link; reissue revokes the old link immediately. |
| External content | Presentation materials only. |
| Version display | Recording, transcript, and transcript summary are latest-only. Superseded rows remain retained internally. |
| SharePoint video delivery | Offer Watch and Download without proxying the complete file through the application. |
| First-slice MP4 cap | 2,000,000,000 bytes (about 1.86 GiB), so the exact byte count fits the existing Dataverse `wmkf_FileSize` integer. Raising the cap requires a reviewed larger-size schema field. |
| Existing full briefing | Rows produced by this post-presentation feature do not automatically appear in the existing full briefing. In the first slice, the new materials-only link is their Board-facing surface. |
| Transport proof | A deployed-Preview browser spike must prove direct upload, playback, seeking, download, and resolver-hit behavior before durable schema or full UI work starts. |
| Distribution | No email composer or automatic distribution. Meeting Tracker provides Copy link. |

## 2. Verified current state

- **[VERIFIED 2026-09-21 via `shared/config/requestDocument.js:10-31` and
  `lib/dataverse/schema/wave16-request-document-registry/wmkf_requestdocument.json:20-31`]**
  Request Document already defines Recording, Transcript, and Transcript Summary artifact types.
- **[VERIFIED 2026-09-21 via `lib/services/site-visit/logistics-service.js:43-51,340-359`]**
  the Site Visit logistics reader already recognizes those artifact types, but its current
  projection requires `wmkf_sharepointweburl`; it cannot represent a Zoom recording URL.
- **[VERIFIED 2026-09-21 via `docs/PC_MEETING_TRACKER_PLAN.md` sections 3 and 8]** those
  artifact types have no producer today; recording/transcript production was explicitly out of
  scope for the shipped Meeting Tracker.
- **[VERIFIED 2026-09-21 via `shared/components/meeting-tracker/SiteVisitEditor.js:297`]** the
  visit editor already mounts the applicant-materials card after an active Site Visit exists. A
  sibling post-presentation card is the narrowest staff-facing addition.
- **[VERIFIED 2026-09-21 via `lib/services/deliberation-briefing/briefing-page-service.js:82-92,
  221-249`]** the full briefing page already reads presentation-material Request Documents, but
  it lists known files over 50 MB without serving them.
- **[VERIFIED 2026-09-22 via
  `lib/dataverse/schema/wave16-request-document-registry/wmkf_requestdocument.json:187-194`]**
  `wmkf_FileSize` is a Dataverse integer capped at 2,147,483,647. A 5 GB first-slice cap is not
  representable without a new larger-size field.
- **[VERIFIED 2026-09-22 via `lib/dataverse/adapters/request-document.js:81-120`]** additive
  Request Document select fields are readiness-gated so a deploy before its Dataverse wave does
  not make every `$select` fail. `wmkf_externalurl` must follow that pattern.
- **[VERIFIED 2026-09-22 via `lib/services/portal-upload-staging.js:549-572,632-637` and
  `lib/db/migrations/043_portal_upload_staging_document_scope.sql:5-9`]** a new private-staging
  scope needs both a database constraint change and a scope-specific candidate reconciler; an
  unknown scope with a candidate is deliberately retained rather than deleted.
- **[VERIFIED 2026-09-21 via `lib/services/graph/upload-session.js:21-103`]** the current Graph
  upload-session helper still accepts the complete file as a Node `Buffer`; it chunks transport
  to Graph but does not remove application memory/body limits.
- **[VERIFIED 2026-09-21 via `lib/services/deliberation-briefing/briefing-link-service.js` and
  `shared/components/workbench/PreSiteDistributionPanel.js::BriefingLinkCard`]** the app has a
  proven pattern for one live, revocable, encrypted-at-rest, 60-day external link and a Copy link
  / Issue new link UI. The presentation link can reuse the pattern, not the briefing audience or
  row.
- **[VERIFIED 2026-09-21 via Zoom documentation]** Zoom computer and cloud recordings can
  produce MP4 video, M4A audio, TXT chat, and VTT/CC.VTT transcript or caption files. TXT chat is
  not the audio transcript. See
  <https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0064394> and
  <https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0064927>.
- **[VERIFIED 2026-09-21 via Microsoft Graph documentation]** Graph upload sessions accept
  sequential resumable byte ranges, and DriveItem content can resolve to a short-lived,
  preauthenticated download URL. See
  <https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0>
  and <https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0>.

## 3. Invariant table

This table is the implementation guardrail. A build is not complete when only the happy-path UI
works.

| Invariant | Files likely touched | Verification |
|---|---|---|
| The presentation token cannot open the full briefing page or any briefing-only member. | external-token verifier, presentation routes/page | Cross-audience and cross-route tests in both directions; presentation token against briefing routes returns fail-closed. |
| An external request never chooses a request ID, SharePoint path, drive ID, item ID, or redirect target. | presentation external routes/service | Route accepts token plus bounded `member`; service re-resolves request membership before every redirect. |
| Zoom URLs are not stored in `wmkf_sharepointweburl`. | Request Document schema/adapter, post-presentation service | Writer test proves `wmkf_externalurl` is used and SharePoint identity fields are empty. |
| A Request Document material has exactly one backing mode: validated external Zoom URL, or stable SharePoint drive/item identity. | projector + writer/finalizer | Table tests cover external-only, file-only, both, and neither; both/neither fail closed. |
| Recording, Transcript, and Transcript Summary have one deterministic visible winner per type. | post-presentation service/read model | Duplicate fixture chooses newest Ready non-Superseded row, emits a staff reconciliation warning, and external context exposes only that winner. |
| Replacement becomes visible only after the new source is valid. | link writer, upload finalizer | Failure before new-row confirmation leaves the old material visible; retry converges on the same generation key. |
| Superseded material is retained but cannot be served externally or shown as current internally. | registry writer + both readers | Positive fixture includes the superseded row and proves it is excluded. |
| The app never buffers a complete uploaded or downloaded MP4. | Graph upload-session client, media resolver | Large synthetic/browser test proves chunked browser upload and Microsoft-served range/download bytes; the application resolution response contains no media bytes. |
| Every persisted MP4 byte count fits `wmkf_FileSize`. | upload metadata validator, Request Document writer | Boundary tests accept 2,000,000,000 bytes and reject 2,000,000,001; final Graph size must match declared size before registry create. |
| Deploying code before the Dataverse wave cannot add `wmkf_externalurl` to a live `$select`. | Request Document adapter, readiness helper | Readiness-off test proves the field is absent; readiness-on test proves it is present; invalid/unset readiness fails closed. |
| A completed SharePoint upload is recoverable if Dataverse registration fails. | upload-intent store/finalizer | Inject failure after candidate persistence; retry registers the exact same drive item and does not upload a second file. |
| An incomplete or abandoned upload cannot become a Board-visible material. | upload-intent store/finalizer/reader | Only a Ready Request Document is externally eligible; expired intent cleanup never promotes an item. |
| Zoom save, transcript finalize, and MP4 finalize cannot replace the same artifact type concurrently. | presentation-material slot-lease store + all three producers | A Zoom PATCH racing an MP4 finalize yields one lease holder; the loser remains retryable and no valid prior winner is superseded. |
| Expired transcript staging cannot strand a SharePoint candidate. | portal-upload staging migration/reconciler | Positive cleanup fixture contains an unbound transcript candidate and proves exact-identity discard; unknown shapes remain retained. |
| A stale Meeting Tracker request cannot update the newly selected request after an await. | new card/hooks | Request-generation or AbortController tests cover load, save, upload, finalize, copy, and error paths. |
| Reissuing the presentation link revokes only the prior presentation link. | presentation-link store/service | Compare-and-swap tests; the deliberation briefing link is unchanged. |
| The existing full briefing does not gain new post-presentation rows as a side effect. | briefing material eligibility | Positive fixture includes a Ready row from `meeting-tracker-post-presentation` and proves it is excluded. |
| Staff identity comes only from the authenticated session. | Meeting Tracker routes/services | Exact-body route tests reject actor/request overrides; Request Document create uses required explicit actor policy. |

## 4. Target user flow

### 4.1 Meeting Tracker: Post-presentation materials

Add `PostPresentationMaterialsCard` immediately after `SiteVisitMaterialsCard` in the existing
visit editor. It renders only after an active Site Visit exists.

The card contains:

- **Recording source**
  - `Zoom link`: paste the complete Zoom share URL. The helper copy tells staff to use Zoom's
    “Copy link and passcode” result when their account embeds the passcode.
  - `Upload video`: select one MP4 and upload it to SharePoint.
- **Transcript**
  - upload VTT, TXT, PDF, or DOCX;
  - label TXT as “plain-text transcript” so Zoom's `chat.txt` is not mistaken for an audio
    transcript.
- **Current material**
  - source, filename/host, added time, actor when available, Open/Watch action, and Replace;
  - no destructive hard delete in the first slice. A replacement supersedes the old row.
- **Board presentation link**
  - Generate link when none exists;
  - Copy link for the live row;
  - Issue new link behind the same explicit confirmation pattern as the briefing link;
  - show the fixed expiration date.

The link controls do not send mail, alter recipients, or change a distribution ledger.

### 4.2 Staff Deliberations

Add a compact read-only “Research presentation follow-up” section:

- `Watch recording` for a Zoom URL or SharePoint MP4;
- `Open transcript` when present;
- `Open transcript summary` when present;
- an honest “Not added yet” state rather than hiding the section after the visit.

Staff-authenticated SharePoint files continue to use their human-openable SharePoint `webUrl`.
The external short-lived redirect is not needed for internal staff.

### 4.3 External presentation page

Add `/external/presentation/[token]` with minimal context:

- institution and proposal title;
- “Research presentation materials” heading;
- active applicant slides and other presentation materials already in the registry;
- latest Recording, Transcript, and Transcript Summary only;
- no proposal document, reviews, review bundle, consultant feedback, staff brief, attendee list,
  meeting join link, or request number.

For a Zoom-backed recording, `Watch on Zoom` calls a token-checked redirect route; the raw URL is
not returned in context JSON. Zoom's own viewer/passcode/expiry policy applies after redirect.

For a SharePoint-backed MP4:

- `Watch` performs one token-checked material-resolution action, then points an HTML5 video
  element at the resulting short-lived Microsoft URL so Microsoft serves range requests directly;
- `Download` performs the same one-shot membership-checked resolution in download mode;
- no 50 MB application cap applies because the application does not fetch the complete bytes.

**[ASSUMED — Slice 0 browser decision]** begin with a no-store 302 resolver. Observe whether
subsequent media range requests go directly to Microsoft or re-enter the application route. If
they re-enter, the accepted fallback is a no-store one-shot resolver response containing only the
fresh short-lived Microsoft URL; the client assigns that URL to `video.src`. The URL is a bearer
credential in either design and is visible to the browser in either a `Location` header or JSON,
so it is never persisted, logged, or placed in the context payload. If neither design supports
playback, seeking, and download without application byte proxying, stop for an owner transport
decision rather than falling back to buffering the complete MP4.

The external page and every token-bearing response set `Referrer-Policy: no-referrer` and
`Cache-Control: private, no-store`.

## 5. Persistence model

### 5.1 Request Document: support an external recording source

Add one nullable URL field in the next available Dataverse schema wave:

| Field | Shape | Purpose |
|---|---|---|
| `wmkf_ExternalUrl` (`wmkf_externalurl`) | URL string, max 2000 | Validated Zoom recording share URL for a link-backed Recording row. |

Do not add a source-kind choice in the first slice. The server-owned backing-mode predicate is:

- **external:** `wmkf_externalurl` is a permitted Zoom HTTPS URL and all SharePoint identity
  fields are empty;
- **file:** `wmkf_externalurl` is empty and drive ID plus item ID are present;
- **invalid:** both or neither. Invalid rows are not externally served and produce a visible staff
  reconciliation warning.

Only Recording may use the external mode. Transcript and Transcript Summary remain
SharePoint-backed files. Existing rows remain compatible because the new field is nullable.

Update the Request Document entity/operation descriptions so “Ready” means the row agrees with
its validated backing source, not unconditionally with SharePoint bytes. Add
`POST_PRESENTATION_SELECT_FIELDS = ['wmkf_externalurl']` to the Request Document adapter and append
it only when the exact-on post-presentation schema-readiness helper returns true. Do not place the
field in `BASE_REQUEST_DOCUMENT_SELECT` or the legacy `REQUEST_DOCUMENT_SELECT` constant. This lets
deploy-safe code run while the Dataverse wave is still absent. The raw field-name and hardcoded
select-list fan-out must be audited before release, with readiness-off and readiness-on tests.

### 5.2 Link-backed Recording row

Saving a Zoom URL creates a normal Request Document row:

- artifact type Recording;
- operation Ready;
- lifecycle Draft;
- producer `meeting-tracker-post-presentation`;
- generation key derived from request ID + client operation UUID;
- input fingerprint is SHA-256 of the normalized complete URL;
- cycle code is server-derived from the request;
- explicit initiated actor is required from the authenticated Meeting Tracker session;
- `wmkf_externalurl` is populated and every SharePoint identity/content field is empty.

The route accepts a client operation UUID only for retry identity. It does not accept a generation
key, request ID in the body, actor, producer, lifecycle, or artifact type.

Allowed hosts are `zoom.us` and its subdomains. The URL must be absolute HTTPS, must not contain
credentials, and must use a recording/share path recognized by the implementation's allowlist.
Unknown Zoom URL shapes fail closed with actionable copy; broadening the allowlist is a reviewed
code change.

### 5.3 SharePoint files

Use flat request-relative folders to match the shipped applicant-materials convention:

- `Site Visit - Recording`
- `Site Visit - Transcript`
- `Site Visit - Transcript Summary` (reader-ready; no new summary producer in this plan)

The server chooses the library, folder, and collision-proof physical filename. The browser never
chooses a path. Each finalized file gets stable Graph site/drive/item/version/eTag facts on its
Request Document row. Recording and transcript files created by this feature use producer
`meeting-tracker-post-presentation`, matching the Zoom-link row and making the existing-briefing
exclusion explicit and testable.

Accepted first-slice formats:

| Artifact | Formats | Validation |
|---|---|---|
| Recording upload | MP4 (`video/mp4`) | extension + MIME + bounded range read proving an ISO BMFF `ftyp` signature after upload |
| Transcript | VTT | extension + MIME + a new bounded `WEBVTT` header validator |
| Transcript | TXT | extension + MIME + bounded-size and fail-closed malware scan; plain text has no reliable magic-byte signature |
| Transcript | PDF, DOCX | extension/MIME plus the existing signature-aware validators and fail-closed malware scan |

The first-slice MP4 limit is **2,000,000,000 bytes**. This fits the existing Dataverse integer
maximum for `wmkf_FileSize`; both declared and final Graph sizes must be at or below the limit and
must match exactly. A future increase requires a reviewed larger-size schema field and reader
migration, not merely a configuration change.

M4A audio exists in Zoom but is outside the first slice because the requested consumer experience
is watching the presentation. It can be added later as a reviewed format extension.

### 5.4 Durable external-link rows

Add `presentation_material_links` in the next free numbered Postgres migration, following the
proven briefing-link shape:

- id, request ID, JTI, token digest, encrypted token, expiration, creator, creation time;
- revoked time/actor and `superseded_by`;
- partial unique index: at most one non-revoked row per request;
- unique token digest;
- expiry fixed to issuance + 60 days in both JWT and row.

`ensure` reuses a readable, unexpired row. If the single non-revoked row is expired or cannot be
decrypted, the service mints a replacement and atomically revokes/replaces the expected live row.
A concurrent loser adopts the winner after the partial-unique-index conflict. `reissue` uses the
same compare-and-swap expected-row contract and never touches a briefing link.

Use a distinct JWT audience and operation:

- audience `presentation-materials`;
- operation `view_presentation_materials`.

Do not store presentation rows in `deliberation_briefing_links`. The existing briefing reissue
transaction is coupled to unsent distribution attempts; presentation-link reissue has no such
transport dependency and must not revoke or stale a briefing send.

### 5.5 Durable large-upload intents

Add `presentation_material_uploads` in the same migration. A row exists before any Graph upload
URL leaves the server and carries:

- upload ID, request ID, active Site Visit ID, authenticated actor ID;
- artifact type, original display filename, validated MIME, declared size;
- server-chosen library/folder/physical filename and deterministic generation key;
- state (`initiated`, `uploaded`, `finalizing`, `finalized`, `failed`, `abandoned`);
- expiry, lease token/expiry, bounded sanitized error;
- after upload: exact candidate site/drive/item/version/eTag/size facts;
- after registry commit: Request Document ID and finalized time.

Never persist the preauthenticated Graph `uploadUrl`; return it once to the authenticated browser.
If an unfinished session expires, Graph discards its partial fragments. If the final byte commits
but registration fails, the finalizer re-resolves the exact server-owned path, persists the
candidate identity, and retries registration without creating another file.

An abandoned intent may point to a fully committed file even when the browser never called
finalize. Cleanup resolves only the exact persisted server-chosen path, persists the candidate
site/drive/item identity, and then deletes that exact candidate. It never deletes by prefix,
folder scan, inferred name, or browser-supplied identity.

### 5.6 Cross-producer slot leases

Add `presentation_material_slot_leases` in the same numbered migration:

- composite primary key `(request_id, artifact_type)`;
- nullable lease token and lease expiry plus `updated_at`;
- artifact type is restricted to Recording, Transcript, and Transcript Summary;
- acquisition is a conditional insert/update that succeeds only when the row is unleased, expired,
  or already held by the same retry token;
- release/renewal requires the matching token.

Zoom-link save, transcript finalize, and MP4 finalize all acquire this lease before creating or
superseding a Request Document. Upload/staging rows keep their own operation lease for idempotent
recovery; slot-lease acquisition is fail-fast and occurs immediately before registry mutation so
the operation lease is not held while waiting. A collision returns a retryable conflict and leaves
the existing visible winner unchanged.

### 5.7 Transcript staging scope

The same numbered Postgres migration widens `portal_upload_staging_scope_check` with
`post_presentation_transcript`; the fresh-install definition changes in the same commit. Add the
scope constant and a `reconcilePostPresentationTranscriptCandidate` branch. Its binding proof
requires one generation-key registry match that is also the current request/type winner. An
unbound, structurally valid candidate is deleted only by its exact persisted identity; ambiguous,
malformed, or lookup-failed candidates are retained and alerted.

## 6. Latest-only and replacement contract

Latest-only applies independently to Recording, Transcript, and Transcript Summary. Applicant
Slides and Other Applicant Materials retain their existing collection semantics.

For each post-presentation type:

1. acquire the short `presentation_material_slot_leases` lease for request + artifact type using
   the operation UUID as the retry token;
2. create or recover the new Ready row by generation key;
3. only after the new row is confirmed, mark older non-Superseded rows of that type Superseded;
4. project the newest Ready non-Superseded row as the visible winner;
5. if more than one such row remains after a partial failure, still show only the deterministic
   newest winner, record an operational reconciliation event, and retry superseding the losers;
6. release the slot only with the matching lease token. Failure paths leave the producer operation
   retryable and never release another operation's lease.

The external and internal readers use the same pure winner predicate. The browser does not sort
or choose winners independently.

A Zoom-link replacement can supersede a prior SharePoint recording and a completed MP4 upload can
supersede a prior Zoom-link row. The old link/file remains retained internally but is no longer
resolvable through the presentation token.

## 7. Upload and recovery sequence

### 7.1 MP4 begin

1. Meeting Tracker POSTs exact metadata: operation UUID, filename, MIME, and byte size.
2. Route verifies Meeting Tracker grant, request GUID, mapped staff actor, feature readiness, and
   active Site Visit/request binding.
3. Service validates MP4 metadata and the 2,000,000,000-byte maximum, resolves the request's
   active SharePoint bucket, chooses the exact folder/path, and inserts the durable intent.
4. Service creates a Graph upload session with conflict behavior `fail` for that unique path.
5. Response returns upload ID, preauthenticated upload URL, chunk contract, and expiry with
   `Cache-Control: no-store`. Neither token nor URL is logged.

### 7.2 Browser upload

The browser PUTs sequential 5–10 MiB chunks directly to the preauthenticated Graph upload URL,
using multiples of 320 KiB. It follows Graph's `nextExpectedRanges` response for retry while the
page remains mounted. Progress is UI state only.

**[ASSUMED — Slice 0 browser decision]** direct browser PUTs to the tenant-issued upload URL work
under the deployed Preview origin/CORS posture. Prove this with the Slice 0 disposable-file test
before building durable schema or the full UI. If it fails, stop for a transport decision; do not
route the complete MP4 through a Function body as an unreviewed fallback.

### 7.3 Finalize

1. Client POSTs only upload ID + operation UUID; it does not supply drive/item/path authority.
2. Service claims the intent lease and revalidates actor/request/visit binding.
3. Service resolves the exact persisted path from Graph and persists candidate identity before
   any Dataverse write.
4. Service verifies the exact size at or below 2,000,000,000 bytes, MP4 signature through a bounded
   range read, and rejects a non-null Graph malware facet.
5. Service acquires the Recording slot lease, creates or recovers the Request Document row, then
   supersedes predecessors.
6. Service releases the matching slot lease, marks the intent finalized, and returns the projected
   current material.

Microsoft documents SharePoint scanning as asynchronous and not a single complete defense:
<https://learn.microsoft.com/en-us/defender-office-365/anti-malware-protection-for-spo-odfb-teams-about>.
Before release, verify the tenant's Safe Attachments and `DisallowInfectedFileDownload` posture.
The external redirect always rechecks the Graph malware facet and refuses a flagged item. A
missing facet means “not currently flagged,” not proof that every byte was synchronously scanned.
Slice 0 must determine whether the facet is observably populated for a security-owner-provided
sanctioned flagged item or equivalent tenant evidence. Do not upload malware-like test content
without explicit owner/security approval. If non-vacuous behavior cannot be proved, retain the
check as defense in depth but do not describe it as a complete scan guarantee.

### 7.4 Transcript upload

Transcripts use the existing private Blob staging/finalize pattern because their bounded size is
compatible with bounded validation and the malware scanner. Extend the document allowlist for
VTT/TXT and add the migrated `post_presentation_transcript` scope bound to actor + request +
artifact type. Add the VTT header validator; treat TXT as extension/MIME/size/scan-gated rather
than claiming magic-byte validation. Persist the SharePoint candidate before creating the Request
Document, acquire the Transcript slot lease, then use the same generation-key recovery and
predecessor-supersede contract as MP4 finalization. The cleanup reconciler proves whether an
expired candidate is bound to the current winner or deletes the exact unbound candidate.

Proposed first-slice transcript cap: 25 MB. This is code-owned and independently tested.

## 8. Services and routes

All Meeting Tracker routes call `requireAppAccess(req, res, 'meeting-tracker')`, stop when it
returns no access, require both existing Meeting Tracker schema readiness and the new exact-on
post-presentation readiness, use `withDalContext`, take a GUID request ID from the path, enforce an
exact body allowlist, and use the session's mapped Dynamics system-user actor.

| Route | Method | Contract |
|---|---|---|
| `/api/meeting-tracker/visits/[requestId]/presentation-materials` | GET | Current Recording/Transcript/Summary winners, conflicts, and supported formats; no upload secret. |
| same | PATCH | Exact action to save/replace a Zoom link; request and actor are server-owned. |
| `/api/meeting-tracker/visits/[requestId]/presentation-uploads` | POST | Begin MP4 or bounded transcript upload; returns the appropriate staging/upload contract. |
| `/api/meeting-tracker/visits/[requestId]/presentation-uploads/[uploadId]/finalize` | POST | Lease-fenced, request-bound finalize/recovery. |
| `/api/meeting-tracker/visits/[requestId]/presentation-link` | GET, POST | GET current link; POST exact `ensure` or compare-and-swap `reissue`. |
| Existing `/api/workbench/site-visit/logistics?requestId=…` | GET | Continue `requireAppAccess(req, res, 'reviewers')`; preserve the legacy `materials` array and add a distinct `presentationMaterials` projection for `useSiteVisitContext` and `StaffDeliberationsTab`. Zoom-backed winners must not be filtered out by the legacy SharePoint-web-URL predicate. While post-presentation readiness is off, return the legacy payload with `presentationMaterials: []`; do not 503 the existing logistics read. |
| `/api/external/presentation/[token]/context` | GET | Rate limit, verify presentation token, return minimal material descriptors. |
| `/api/external/presentation/[token]/open` | GET | Reverify token and live membership; redirect Zoom. For SharePoint, use the Slice 0-selected no-store 302 or one-shot URL response. `mode=watch|download` is an allowlist. |

Keep routes thin. Domain logic belongs under
`lib/services/post-presentation-materials/`; Postgres stores, Request Document projection, Graph
session/redirect helpers, and token verification remain separately testable.

Suggested source ownership:

- `material-model.js`: backing-mode validation and latest-winner projection;
- `material-service.js`: staff read, Zoom-link write, transcript finalize;
- `video-upload-service.js` / `upload-store.js`: Graph intent lifecycle and recovery;
- `presentation-link-service.js` / `presentation-link-store.js`: 60-day token lifecycle;
- `presentation-page-service.js`: external context/member resolution;
- `lib/external/verify-presentation-token.js`: signature/digest/request/revocation checks.

The Staff Deliberations implementation path is explicit: the existing `reviewers`-grant logistics
GET calls the shared winner projector; `useSiteVisitContext` exposes `presentationMaterials`;
`StaffDeliberationsTab` renders the read-only section. Existing applicant-material/distribution
`materials` semantics remain unchanged.

Reuse the external-token cryptographic primitive and small value helpers. Do not extract a broad
generic “magic link framework” during this feature: briefing reissue has distribution-specific
locking semantics that the presentation link must not collapse.

## 9. External media resolution and the 50 MB limit

The presentation page does not call the existing buffered material download for MP4s. Rate limits
apply to the initial user Watch/Download resolution action, not to Microsoft-hosted byte ranges.

For every initial Watch/Download resolution:

1. rate-limit and verify the presentation token;
2. parse the bounded member ID;
3. re-read the Request and current material winners;
4. require that the requested row is the current Ready non-Superseded winner and belongs to the
   token's request;
5. require file backing for SharePoint media and reject a malware facet;
6. request a fresh `@microsoft.graph.downloadUrl` for that exact drive/item;
7. use the Slice 0-proved delivery shape:
   - retain a no-store 302 only if browser traces prove subsequent range requests go directly to
     Microsoft and do not exhaust the per-token/per-IP application buckets; otherwise
   - return a no-store one-shot response containing the short-lived URL, and assign it directly to
     `video.src` or the Download action.

The short-lived Microsoft URL is never persisted or returned in context JSON. Reissuing/revoking
the 60-day presentation token blocks future redirect creation. A short-lived Microsoft URL
already handed to a browser can remain usable until Microsoft expires it; this bounded residual
risk is inherent to preauthenticated redirects and must be stated in release/UAT notes.

The proof records application-resolver hit count and response bytes while playing and seeking. If
range traffic re-enters the application, the 302 design fails even when video appears to play; do
not compensate by merely increasing the generic external token bucket. The chosen design gets a
dedicated regression test and structured metric that contains no raw token or URL.

Do not create permanent SharePoint Anyone links. They are independent file permissions and could
outlive revocation of the application token.

## 10. Async and stale-state contract

The new Meeting Tracker card keys every request operation to a monotonically increasing request
generation and uses an `AbortController` for fetches. After every await—success and failure—the
component verifies that request ID, generation, and mounted state still match before writing UI
state.

Upload-specific rules:

- changing request/navigation aborts client work where possible and suppresses stale progress;
- it does not pretend that already-sent Graph chunks were undone;
- finalize remains recoverable from the durable upload row;
- Copy link state is reset when the link ID changes;
- a pending save/finalize cannot replace data displayed for a newly selected request.

## 11. Security and privacy contract

- Presentation tokens are bearer credentials. Store only digest plus encrypted token; never log
  raw token, Zoom URL, embedded passcode query, or Graph upload/download URL.
- External routes disclose no SharePoint site/drive/item/path identity and accept none from the
  browser.
- Context uses opaque `material:<requestdocument-guid>` members. Unknown, foreign, Superseded,
  non-current, invalid-backing, and non-material rows return 404 before Graph access.
- Zoom redirects accept only the current validated Zoom-backed Recording winner.
- Graph upload URLs are returned only to the authenticated actor who created the request-bound
  intent and are marked no-store.
- Upload finalization reauthorizes independently; possession of an upload ID or Graph result is
  insufficient.
- Dataverse target/write interlock and DAL enforcement remain active on every Request Document
  and Site Visit read/write.
- No client-supplied user/profile identity is accepted.
- External pages and redirects retain the existing per-token/per-IP rate-limit pattern.
- Rate limiting applies to material-resolution actions. Microsoft range traffic must not consume
  the generic application token/IP bucket; Slice 0 selects the resolver shape that enforces this.
- Token-bearing pages and resolver responses set `Referrer-Policy: no-referrer` and no-store
  headers.

## 12. Implementation slices

### Slice 0 — Deployed-Preview browser proof

This is a disposable transport spike, not the production feature. It may add a Preview-only,
authenticated proof route and minimal harness, but it creates no durable application schema and is
removed or converted into production code after the decision. Use a sanctioned test request,
SharePoint test folder, and a real Zoom-produced MP4 larger than 50 MB. Never log the token,
upload URL, download URL, or passcode.

#### Upload procedure

1. From the deployed Preview origin, request a Graph upload session for a server-chosen disposable
   path.
2. Upload the MP4 from the browser in sequential 5–10 MiB chunks that are multiples of 320 KiB;
   exercise at least one paused/resumed chunk sequence using `nextExpectedRanges`.
3. Capture a redacted browser network trace and server request-size metric proving the MP4 bytes
   travel browser → Microsoft, not browser → application → Microsoft.
4. Resolve the committed item by the exact server-owned path, verify its size, then delete that
   exact disposable item after the playback/download proof.

#### Playback/download procedure

1. Issue a short-lived, Preview-only signed proof token with no durable row and load the proof page
   in a private window with DevTools Preserve Log enabled. Token persistence/revocation is tested
   later through the production link service; this spike isolates transport behavior.
2. Start with the no-store 302 resolver. Play at least two minutes; seek forward and backward to at
   least ten positions, including near the end; pause/resume; reload; then invoke Download.
3. Record origins, status codes, `Range`/`Content-Range` behavior, application resolver hit count,
   any 429s, and application response bytes. Evidence is redacted and contains no bearer URL.
4. Verify an expired proof token fails. Record that an already-issued Microsoft URL may remain
   valid only until its short expiry.
5. If the browser re-enters the application resolver for range traffic, switch the spike to a
   no-store one-shot URL response, assign the result directly to `video.src`, and repeat the same
   play/seek/download sequence.

#### Pass/fail decision

Pass only when all of the following are observed:

- direct browser chunk PUT works under the deployed origin/CORS posture and resumes correctly;
- Watch starts, plays, and seeks; Download produces the complete file;
- byte ranges are served by Microsoft, not buffered or proxied by the application;
- the selected resolver shape causes one bounded application resolution per user action and does
  not exhaust the existing per-token/per-IP limiter during the seek script;
- no raw token or preauthenticated URL appears in application logs or persisted rows;
- exact-item cleanup succeeds for the disposable upload.

If the 302 passes, keep it. If only the one-shot URL response passes, adopt that shape and state
the short-lived URL exposure explicitly in the security contract. If direct upload or both media
resolution shapes fail, stop before durable schema/full UI work and return to the owner with the
redacted trace and a bounded alternative; do not silently route complete MP4 bytes through a
Function.

Also verify tenant Safe Attachments and `DisallowInfectedFileDownload` posture. A security owner
may supply sanctioned evidence that the Graph malware facet becomes non-null for a flagged item;
without that evidence, keep the facet check as defense in depth and do not claim it proves a
synchronous scan. The first-slice size cap is resolved at 2,000,000,000 bytes.

### Slice 1 — Additive schema and readiness

- Dataverse wave adds `wmkf_ExternalUrl` to Request Document plus exact preflight.
- Request Document adapter adds readiness-gated `POST_PRESENTATION_SELECT_FIELDS`; the base and
  legacy selects remain safe while the wave is absent.
- One Postgres migration adds presentation links, upload intents, slot leases, and the
  `post_presentation_transcript` staging-scope constraint; update fresh-install shape and
  migrations manifest.
- Add `POST_PRESENTATION_MATERIALS_SCHEMA_READY`, exact-on only after both stores are applied and
  preflighted. Invalid values fail closed; unset is off.
- Update Atlas and credential/runbook surfaces before flag enablement.

Tier 2: owner applies migration/wave and later flips the readiness flag.

### Slice 2 — Shared material model and Zoom producer

- Add backing-mode validator and latest-only projector.
- Add Meeting Tracker GET/PATCH service/routes and Zoom URL producer.
- Acquire the named Recording slot lease in the Zoom PATCH before registry mutation.
- Add Request Document writer to the explicit writer census and required-actor tests.
- Update logistics/Workbench read models to consume the shared projection.

### Slice 3 — Transcript producer

- Extend private staging validation for transcript formats.
- Add actor/request/type-bound transcript staging/finalize.
- Add candidate-before-Dataverse recovery and latest-only supersede behavior.
- Add the scope-specific cleanup reconciler and positive unbound-candidate discard test.

### Slice 4 — Large MP4 producer

- Add durable upload-intent store and Graph session creation helper.
- Add browser chunk client, progress/cancel presentation, lease-fenced finalize, bounded range
  signature check, candidate recovery, and reconciliation event.
- Add exact orphan/expiry maintenance. Never delete by prefix or inferred path; cleanup uses only
  persisted exact candidate identity, including an upload that completed before the browser
  abandoned finalize.

### Slice 5 — Internal and external consumers

- Extend the existing `reviewers`-grant Workbench logistics GET with a distinct
  `presentationMaterials` projection; wire `useSiteVisitContext` to `StaffDeliberationsTab` and
  add the read-only section without changing legacy distribution materials.
- Add presentation-link lifecycle, Meeting Tracker Copy/Reissue controls, external verifier,
  materials-only page, Zoom redirect, and SharePoint Watch/Download redirect.
- Exclude rows produced by `meeting-tracker-post-presentation` from the existing full briefing,
  with a positive fixture containing an otherwise eligible row.
- Prove cross-audience isolation and >50 MB media behavior.

### Slice 6 — Release and reconciliation

- Owner-applied schema/migration and readiness enablement.
- Signed-in Meeting Tracker smoke with one Zoom link, one transcript, and one disposable MP4.
- Private-window 60-day link smoke: materials only, Watch seek, Download, replace-to-latest, old
  token revoked after reissue.
- Reconcile canonical docs, Atlas, route matrix, service catalog, and session handoff.

## 13. Test matrix

### Model and persistence

- external/file/both/neither backing modes;
- Recording external allowed; Transcript external rejected;
- Ready + non-Superseded filtering;
- newest deterministic winner with two active rows;
- positive exclusion fixtures for old/Superseded rows;
- generation-key lost-response replay;
- replacement failure before new row leaves old winner;
- supersede failure after new row leaves new deterministic winner and recoverable warning;
- one live presentation link per request; ensure reuse; exact 60-day expiry; compare-and-swap
  replacement of an expired/unreadable non-revoked row; reissue; old token revoked; briefing link
  unchanged;
- upload intent actor/request binding, per-upload lease collision, expiry, candidate persistence,
  retry, and finalized replay;
- cross-producer slot lease: Zoom PATCH racing MP4 finalize and transcript finalize racing a second
  transcript replacement; one winner, retryable loser, prior visible material preserved;
- MP4 cap boundaries accept 2,000,000,000 and reject 2,000,000,001; persisted size equals Graph;
- Request Document select excludes `wmkf_externalurl` while readiness is off and includes it only
  when exact-on readiness is enabled;
- full briefing positive-exclusion fixture contains a Ready post-presentation row and proves it is
  omitted rather than merely absent from setup.

### Routes and security

- method guards, size limits, exact body allowlists, GUID validation, app grants, feature flag;
- body cannot override request ID, actor, artifact type, producer, path, or Graph identity;
- reviewer/grantee/briefing tokens rejected by presentation routes and presentation token rejected
  by their verifiers/routes;
- unknown/foreign/Superseded/non-current material returns 404 with no Graph call;
- Zoom redirect allowlist and credential/non-HTTPS rejection;
- selected resolver shape has no-store headers and no URL in context JSON, persistence, or logs;
- `Referrer-Policy: no-referrer` on the token-bearing page and resolution responses;
- rate-limit success/failure accounting for one user resolution action; media range traffic does
  not consume the application bucket.

### Upload and recovery

- client chunks are sequential 320 KiB multiples and resume from `nextExpectedRanges`;
- navigation/request change suppresses stale progress/success/error state;
- incomplete Graph session never creates a Request Document;
- completed Graph upload + Dataverse failure retries the same exact item;
- MP4 signature mismatch, size mismatch, missing item, wrong parent, and malware facet all refuse;
- transcript VTT/TXT/PDF/DOCX validation and infected/unavailable scan refusal;
- VTT header validation and explicit TXT no-magic-signature behavior;
- transcript-scope cleanup deletes an exact unbound candidate and retains malformed/ambiguous
  candidates;
- cleanup touches only exact persisted candidate identity, including abandoned-after-complete MP4.

### UI and browser

- source chooser, replace confirmation, honest empty/error states, upload progress;
- Copy link success/failure/manual fallback and state reset after reissue;
- Staff Deliberations renders Zoom, SharePoint, transcript, and missing states;
- external page contains presentation materials and explicitly does not contain proposal,
  reviews, staff brief, consultant feedback, or request number;
- deployed-Preview real MP4 over 50 MB completes the Slice 0 play/seek/download script without
  application buffering, repeated resolver throttling, or bearer values in logs;
- expired/revoked tokens and expired short-lived Microsoft URL recovery.

## 14. Durable surfaces and gates

Implementation must update, as applicable:

- one numbered Postgres migration covering both new link/upload tables, the slot-lease table, and
  the widened transcript staging-scope constraint; `scripts/setup-database.js`; and
  `lib/db/migrations-manifest.json`;
- Request Document Dataverse schema wave/preflight and its Atlas page;
- `docs/APPLICATION_STATE_ATLAS.md` / Postgres infra Atlas for the three new tables plus the
  widened staging scope;
- `docs/API_ROUTE_SECURITY_MATRIX.md` for every new route;
- `docs/CREDENTIALS_RUNBOOK.md` for readiness and any code-owned caps surfaced there;
- `docs/SERVICE_AND_UTILITY_CATALOG.md`;
- `docs/PC_MEETING_TRACKER_PLAN.md` to retire “recording/transcript producers” from out of scope;
- `docs/DELIBERATION_BRIEFING_PAGE_PLAN.md` to record that the full briefing link remains separate,
  its 50 MB buffered route is not the new presentation media route, and rows from the new
  post-presentation producer are excluded in the first slice;
- `docs/atlas/dataverse-wmkf-sitevisit.md` consumer/producer list if the visit editor mounting or
  reader contract changes;
- agent wiki/memory only after source is built and live facts are known.

Relevant gates, each gate followed sequentially by its self-test when one exists:

- focused Jest suites and scoped ESLint;
- `npm run check:types`;
- `npm run check:migrations-manifest` and migration/fresh-install parity tests;
- `npm run check:request-document-writers` then `:self-test`;
- `npm run check:api-routes` then `:self-test`;
- `npm run check:trust-boundary-guid` then `:self-test`;
- `npm run check:route-service-boundary` then `:self-test`;
- `npm run check:dataverse-access-layer` then `:self-test`;
- `npm run check:dynamics-context-boundary` then `:self-test`;
- `npm run check:atlas` then `:self-test`;
- `npm run check:fact-consistency` then `:self-test` if registered counts change;
- documentation currency/catalog/symbol gates selected by the changed surfaces;
- production build and full `npm run test:ci` before release.

## 15. Release and rollback

This is Tier 2 cross-store runtime work. Build on a feature branch and promote deliberately.

Release order:

1. complete and record the Slice 0 deployed-Preview transport proof; select 302 or one-shot URL
   resolution from observed range behavior;
2. merge deploy-safe code with readiness off and `wmkf_externalurl` absent from all live selects;
3. owner applies the single Postgres migration and Dataverse wave;
4. run exact preflights and schema readback while readiness remains off;
5. deploy the compatible runtime, then owner sets
   `POST_PRESENTATION_MATERIALS_SCHEMA_READY=on` in Preview;
6. run signed-in and private-window acceptance with a file over 50 MB, including the same
   play/seek/download and resolver-hit assertions used in Slice 0;
7. enable Production and repeat a bounded smoke on a sanctioned request.

Rollback is unsetting the readiness flag and redeploying the prior runtime. Additive schema and
retained superseded rows remain. Do not delete uploaded files or link rows during rollback.

## 16. Contract reconciliation

### Whole flow

`Meeting Tracker staff → request-bound client state → exact route payload → grant/auth/GUID/body
validation → post-presentation service → SharePoint/Request Document/Postgres → projected response
→ Staff Deliberations or presentation-token page → tests/docs/gates` is accounted for above.

### Partial success

- Zoom link: generation-key replay prevents duplicate rows after a lost response.
- Transcript: private staging records exact SharePoint candidate before Dataverse registration.
- MP4: durable intent records exact path before upload and exact candidate before Dataverse.
- All three producers acquire the named request/type slot lease immediately before registry
  mutation; a collision is retryable and cannot supersede the prior visible winner.
- Transcript cleanup has a scope-specific binding proof; abandoned completed MP4 cleanup resolves
  and deletes only the exact persisted candidate identity.
- New-row confirmation precedes predecessor supersede, so failure never erases the last usable
  material.
- A response returns concrete material/link/upload identifiers, never success-by-count.

### Async/stale state

Every client post-await state write is request-generation guarded. Server retries are keyed by
operation/upload ID, and every finalization independently reauthorizes.

### Helper extraction

Shared pure helpers may normalize material backing and choose current winners. Briefing and
presentation link lifecycle services stay separate because briefing reissue participates in a
distribution-send lock and presentation reissue does not.

### Durable surfaces

The single Postgres migration includes link rows, upload intents, slot leases, and the transcript
scope constraint. Fresh-install parity, manifest, schema wave/preflight, readiness-gated select,
Atlas, route matrix, service catalog, readiness runbook, writer census, cleanup policy, tests, and
gates are all named.

### Symbol-consumer fan-out

Before implementation completion, grep both `wmkf_externalurl` and every Request Document select
list. Verify logistics, external briefing, new presentation page, Staff Deliberations, applicant
materials, distribution, dashboards, and generic registry readers. Unknown or invalid backing
modes fail closed; no existing file-backed consumer may mistake an external row for a SharePoint
file. The existing briefing audit must include a positive row from
`meeting-tracker-post-presentation` and prove the intended exclusion.

## 17. Review resolutions

The 2026-09-22 OAuth Claude Opus review was reconciled against source and resolved as follows:

- the first-slice MP4 cap is 2,000,000,000 bytes, within `wmkf_FileSize`;
- `wmkf_externalurl` is select-gated until the Dataverse wave is ready;
- the Postgres migration names the transcript constraint and cross-producer slot-lease store;
- transcript and abandoned-MP4 cleanup have exact candidate binding/deletion contracts;
- Staff Deliberations uses the existing `reviewers`-grant logistics route through an explicit new
  projection;
- new post-presentation producer rows do not silently enter the existing full briefing;
- the media rate-limit concern is resolved by the Slice 0 browser decision: keep 302 only if
  range traffic bypasses the application; otherwise use a one-shot short-lived URL response.

No product value remains open in this plan. A failed Slice 0 proof is an evidence-based transport
blocker that returns to the owner; it is not permission to introduce application byte proxying.
