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

Owner decisions recorded 2026-09-21:

| Decision | Contract |
|---|---|
| Producer | Meeting Tracker is the staff authoring surface. |
| Internal consumer | Staff Deliberations is read-only and shows the current recording/transcript. |
| External consumer | A distinct presentation-materials link is available for Board members. It is not the existing full deliberation briefing link. |
| Link lifecycle | 60 days from issuance; ensure reuses the readable live link; reissue revokes the old link immediately. |
| External content | Presentation materials only. |
| Version display | Recording, transcript, and transcript summary are latest-only. Superseded rows remain retained internally. |
| SharePoint video delivery | Offer Watch and Download without proxying the complete file through the application. |
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
| The app never buffers a complete uploaded or downloaded MP4. | Graph upload-session client, Graph redirect helper | Large synthetic/browser test proves chunked browser upload; server route returns redirect without reading response bytes. |
| A completed SharePoint upload is recoverable if Dataverse registration fails. | upload-intent store/finalizer | Inject failure after candidate persistence; retry registers the exact same drive item and does not upload a second file. |
| An incomplete or abandoned upload cannot become a Board-visible material. | upload-intent store/finalizer/reader | Only a Ready Request Document is externally eligible; expired intent cleanup never promotes an item. |
| A stale Meeting Tracker request cannot update the newly selected request after an await. | new card/hooks | Request-generation or AbortController tests cover load, save, upload, finalize, copy, and error paths. |
| Reissuing the presentation link revokes only the prior presentation link. | presentation-link store/service | Compare-and-swap tests; the deliberation briefing link is unchanged. |
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

- `Watch` uses an HTML5 video element whose source is a token-checked application route; that
  route obtains a fresh preauthenticated Graph URL and redirects, allowing Microsoft to serve
  range requests directly;
- `Download` calls the same membership-checked resolver in download mode;
- no 50 MB application cap applies because the application does not fetch the complete bytes.

**[ASSUMED — must be browser-proved before build acceptance]** the tenant's returned MP4 headers
permit in-browser playback and an explicit download affordance after the redirect. If the proof
fails, stop and adjust the UX/transport; do not silently fall back to buffering the full file.

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
its validated backing source, not unconditionally with SharePoint bytes. Add the new field to
every applicable Request Document select list; the raw field-name fan-out must be audited before
release.

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
Request Document row.

Accepted first-slice formats:

| Artifact | Formats | Validation |
|---|---|---|
| Recording upload | MP4 (`video/mp4`) | extension + MIME + bounded range read proving an ISO BMFF `ftyp` signature after upload |
| Transcript | VTT, TXT, PDF, DOCX | extension/MIME plus existing signature-aware validators; VTT must contain a valid `WEBVTT` header |

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

## 6. Latest-only and replacement contract

Latest-only applies independently to Recording, Transcript, and Transcript Summary. Applicant
Slides and Other Applicant Materials retain their existing collection semantics.

For each post-presentation type:

1. serialize finalization with a short Postgres lease scoped to request + artifact type;
2. create or recover the new Ready row by generation key;
3. only after the new row is confirmed, mark older non-Superseded rows of that type Superseded;
4. project the newest Ready non-Superseded row as the visible winner;
5. if more than one such row remains after a partial failure, still show only the deterministic
   newest winner, record an operational reconciliation event, and retry superseding the losers.

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
3. Service validates MP4 metadata and the code-owned maximum, resolves the request's active
   SharePoint bucket, chooses the exact folder/path, and inserts the durable intent.
4. Service creates a Graph upload session with conflict behavior `fail` for that unique path.
5. Response returns upload ID, preauthenticated upload URL, chunk contract, and expiry with
   `Cache-Control: no-store`. Neither token nor URL is logged.

### 7.2 Browser upload

The browser PUTs sequential 5–10 MiB chunks directly to the preauthenticated Graph upload URL,
using multiples of 320 KiB. It follows Graph's `nextExpectedRanges` response for retry while the
page remains mounted. Progress is UI state only.

**[ASSUMED — implementation prerequisite]** direct browser PUTs to the tenant-issued upload URL
work under the deployed origin/CORS posture. Prove this with a disposable file in the sanctioned
test target before building the full UI. If it fails, stop for a transport decision; do not route
the complete MP4 through a Function body as an unreviewed fallback.

### 7.3 Finalize

1. Client POSTs only upload ID + operation UUID; it does not supply drive/item/path authority.
2. Service claims the intent lease and revalidates actor/request/visit binding.
3. Service resolves the exact persisted path from Graph and persists candidate identity before
   any Dataverse write.
4. Service verifies size, MP4 signature through a bounded range read, and rejects a non-null Graph
   malware facet.
5. Service creates or recovers the Request Document row, then supersedes predecessors.
6. Service marks the intent finalized and returns the projected current material.

Microsoft documents SharePoint scanning as asynchronous and not a single complete defense:
<https://learn.microsoft.com/en-us/defender-office-365/anti-malware-protection-for-spo-odfb-teams-about>.
Before release, verify the tenant's Safe Attachments and `DisallowInfectedFileDownload` posture.
The external redirect always rechecks the Graph malware facet and refuses a flagged item. A
missing facet means “not currently flagged,” not proof that every byte was synchronously scanned.

### 7.4 Transcript upload

Transcripts use the existing private Blob staging/finalize pattern because their bounded size is
compatible with the existing signature validation and malware scanner. Extend the document scope
allowlist for VTT/TXT and add a post-presentation transcript scope bound to actor + request +
artifact type. Persist the SharePoint candidate before creating the Request Document, then use the
same generation-key recovery and predecessor-supersede contract as MP4 finalization.

Proposed first-slice transcript cap: 25 MB. This is code-owned and independently tested.

## 8. Services and routes

All staff routes use `requireAppAccess('meeting-tracker')`, `withDalContext`, a GUID request ID
from the path, an exact body allowlist, and the session's mapped Dynamics system-user actor.

| Route | Method | Contract |
|---|---|---|
| `/api/meeting-tracker/visits/[requestId]/presentation-materials` | GET | Current Recording/Transcript/Summary winners, conflicts, and supported formats; no upload secret. |
| same | PATCH | Exact action to save/replace a Zoom link; request and actor are server-owned. |
| `/api/meeting-tracker/visits/[requestId]/presentation-uploads` | POST | Begin MP4 or bounded transcript upload; returns the appropriate staging/upload contract. |
| `/api/meeting-tracker/visits/[requestId]/presentation-uploads/[uploadId]/finalize` | POST | Lease-fenced, request-bound finalize/recovery. |
| `/api/meeting-tracker/visits/[requestId]/presentation-link` | GET, POST | GET current link; POST exact `ensure` or compare-and-swap `reissue`. |
| `/api/external/presentation/[token]/context` | GET | Rate limit, verify presentation token, return minimal material descriptors. |
| `/api/external/presentation/[token]/open` | GET | Reverify token and live membership; redirect Zoom or SharePoint material. `mode=watch|download` is an allowlist. |

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

Reuse the external-token cryptographic primitive and small value helpers. Do not extract a broad
generic “magic link framework” during this feature: briefing reissue has distribution-specific
locking semantics that the presentation link must not collapse.

## 9. External media resolution and the 50 MB limit

The presentation page does not call the existing buffered material download for MP4s.

For every Watch/Download request:

1. rate-limit and verify the presentation token;
2. parse the bounded member ID;
3. re-read the Request and current material winners;
4. require that the requested row is the current Ready non-Superseded winner and belongs to the
   token's request;
5. require file backing for SharePoint media and reject a malware facet;
6. request a fresh `@microsoft.graph.downloadUrl` for that exact drive/item;
7. return a no-store 302 redirect.

The short-lived Microsoft URL is never persisted or returned in context JSON. Reissuing/revoking
the 60-day presentation token blocks future redirect creation. A short-lived Microsoft URL
already handed to a browser can remain usable until Microsoft expires it; this bounded residual
risk is inherent to preauthenticated redirects and must be stated in release/UAT notes.

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

## 12. Implementation slices

### Slice 0 — Proofs and owner confirmation

- Prove browser-to-Graph chunk PUT from the deployed Preview origin with a disposable MP4.
- Prove a token-checked redirect supports HTML5 playback, range seeking, and a usable Download
  action for a real Zoom-produced MP4.
- Verify tenant malware-download posture; record only the setting result, never credentials.
- Confirm the proposed 5 GB MP4 cap. **[ASSUMED pending owner confirmation.]** Zoom documents
  approximately 200 MB/hour for video, so 5 GB is intentionally generous without being unbounded:
  <https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0064394>.

No durable schema or UI work begins until the direct-upload and playback proofs pass. If either
fails, return to the owner with the observed constraint and a bounded alternative.

### Slice 1 — Additive schema and readiness

- Dataverse wave adds `wmkf_ExternalUrl` to Request Document plus exact preflight.
- Postgres migration adds presentation links and upload intents; update fresh-install shape and
  migrations manifest.
- Add `POST_PRESENTATION_MATERIALS_SCHEMA_READY`, exact-on only after both stores are applied and
  preflighted. Invalid values fail closed; unset is off.
- Update Atlas and credential/runbook surfaces before flag enablement.

Tier 2: owner applies migration/wave and later flips the readiness flag.

### Slice 2 — Shared material model and Zoom producer

- Add backing-mode validator and latest-only projector.
- Add Meeting Tracker GET/PATCH service/routes and Zoom URL producer.
- Add Request Document writer to the explicit writer census and required-actor tests.
- Update logistics/Workbench read models to consume the shared projection.

### Slice 3 — Transcript producer

- Extend private staging validation for transcript formats.
- Add actor/request/type-bound transcript staging/finalize.
- Add candidate-before-Dataverse recovery and latest-only supersede behavior.

### Slice 4 — Large MP4 producer

- Add durable upload-intent store and Graph session creation helper.
- Add browser chunk client, progress/cancel presentation, lease-fenced finalize, bounded range
  signature check, candidate recovery, and reconciliation event.
- Add exact orphan/expiry maintenance. Never delete by prefix or inferred path; cleanup uses only
  persisted exact candidate identity.

### Slice 5 — Internal and external consumers

- Add Staff Deliberations section.
- Add presentation-link lifecycle, Meeting Tracker Copy/Reissue controls, external verifier,
  materials-only page, Zoom redirect, and SharePoint Watch/Download redirect.
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
  reissue; old token revoked; briefing link unchanged;
- upload intent actor/request binding, lease collision, expiry, candidate persistence, retry, and
  finalized replay.

### Routes and security

- method guards, size limits, exact body allowlists, GUID validation, app grants, feature flag;
- body cannot override request ID, actor, artifact type, producer, path, or Graph identity;
- reviewer/grantee/briefing tokens rejected by presentation routes and presentation token rejected
  by their verifiers/routes;
- unknown/foreign/Superseded/non-current material returns 404 with no Graph call;
- Zoom redirect allowlist and credential/non-HTTPS rejection;
- Graph redirect no-store headers and no URL in JSON/log fixtures;
- rate-limit success/failure accounting.

### Upload and recovery

- client chunks are sequential 320 KiB multiples and resume from `nextExpectedRanges`;
- navigation/request change suppresses stale progress/success/error state;
- incomplete Graph session never creates a Request Document;
- completed Graph upload + Dataverse failure retries the same exact item;
- MP4 signature mismatch, size mismatch, missing item, wrong parent, and malware facet all refuse;
- transcript VTT/TXT/PDF/DOCX validation and infected/unavailable scan refusal;
- cleanup touches only exact persisted candidate identity.

### UI and browser

- source chooser, replace confirmation, honest empty/error states, upload progress;
- Copy link success/failure/manual fallback and state reset after reissue;
- Staff Deliberations renders Zoom, SharePoint, transcript, and missing states;
- external page contains presentation materials and explicitly does not contain proposal,
  reviews, staff brief, consultant feedback, or request number;
- real MP4 over 50 MB plays, seeks, and downloads without application buffering;
- expired/revoked tokens and expired short-lived redirect recovery.

## 14. Durable surfaces and gates

Implementation must update, as applicable:

- numbered Postgres migration, `scripts/setup-database.js`, and
  `lib/db/migrations-manifest.json`;
- Request Document Dataverse schema wave/preflight and its Atlas page;
- `docs/APPLICATION_STATE_ATLAS.md` / Postgres infra Atlas for both new tables;
- `docs/API_ROUTE_SECURITY_MATRIX.md` for every new route;
- `docs/CREDENTIALS_RUNBOOK.md` for readiness and any code-owned caps surfaced there;
- `docs/SERVICE_AND_UTILITY_CATALOG.md`;
- `docs/PC_MEETING_TRACKER_PLAN.md` to retire “recording/transcript producers” from out of scope;
- `docs/DELIBERATION_BRIEFING_PAGE_PLAN.md` only to clarify that its full briefing link remains
  separate and its 50 MB buffered route is not the new presentation media route;
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

1. merge deploy-safe code with readiness off;
2. owner applies Postgres migration and Dataverse wave;
3. run exact preflights and schema readback;
4. deploy the compatible runtime;
5. owner sets `POST_PRESENTATION_MATERIALS_SCHEMA_READY=on` in Preview;
6. run signed-in and private-window proof, including a file over 50 MB;
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

Migration, fresh-install parity, manifest, schema wave/preflight, Atlas, route matrix, service
catalog, readiness runbook, writer census, cleanup policy, tests, and gates are all named.

### Symbol-consumer fan-out

Before implementation completion, grep both `wmkf_externalurl` and every Request Document select
list. Verify logistics, external briefing, new presentation page, Staff Deliberations, applicant
materials, distribution, dashboards, and generic registry readers. Unknown or invalid backing
modes fail closed; no existing file-backed consumer may mistake an external row for a SharePoint
file.

## 17. Remaining owner confirmation

Only one product value remains open: **the proposed MP4 upload cap is 5 GB**. The architecture does
not depend on that exact number, but implementation should not silently choose an unbounded limit.
