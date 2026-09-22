---
title: Post-research-presentation materials and Board presentation link
domain: meeting-tracker
kind: plan
status: active
summary: "Active plan for Meeting Tracker to capture a Zoom recording link or SharePoint-hosted MP4 plus the latest transcript, surface them to program directors, and mint a 60-day materials-only Board link; deployed Chrome now proves direct Graph MP4 upload, playback, and download after a route-scoped CSP correction."
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
| Link lifecycle | 60 days from issuance; ensure reuses the readable live link; reissue immediately blocks new application resolutions through the old token. Microsoft or Zoom URLs already revealed to a browser remain governed by their host-side expiry/access policy. |
| External content | Presentation materials only. |
| Version display | Recording, transcript, and transcript summary are latest-only. Superseded rows remain retained internally. |
| SharePoint video delivery | Offer Watch and Download without proxying the complete file through the application. |
| First-slice MP4 cap | 2,000,000,000 bytes (about 1.86 GiB), so the exact byte count fits the existing Dataverse `wmkf_FileSize` integer. Raising the cap requires a reviewed larger-size schema field. |
| Existing full briefing | Preserve D19/D28: the existing distributed briefing remains a superset and continues to include research-presentation materials. Add audience-specific non-buffering Watch/Download resolution for Zoom and large SharePoint recordings. The new copied link is an additional materials-only option. |
| Transport proof | **CHROME CORE PATH PASSED 2026-09-22.** The original status-0 failure was the application CSP, not Graph transport. After adding route-scoped Microsoft upload/media origins, deployed Chrome uploaded a 96.0 MiB MP4 directly to Graph, finalized it, played it through both resolver shapes, and downloaded the complete bytes. Edge, macOS Safari, iPadOS Safari, reload/reselect resume, expiry recovery, and long-duration seeking remain required before Slice 0 is complete. |
| Distribution | No new email composer or automatic distribution for the materials-only link. Meeting Tracker provides Copy link for staff to share through their chosen channel; the existing deliberation email continues distributing the full briefing link. |

## 2. Verified current state

- **[VERIFIED 2026-09-21 via `shared/config/requestDocument.js:10-31` and
  `lib/dataverse/schema/wave16-request-document-registry/wmkf_requestdocument.json:20-31`]**
  Request Document already defines Recording, Transcript, and Transcript Summary artifact types.
- **[VERIFIED 2026-09-21 via `lib/services/site-visit/logistics-service.js:43-51,340-359`]**
  the Site Visit logistics reader already recognizes those artifact types, but its current
  projection requires `wmkf_sharepointweburl`; it cannot represent a Zoom recording URL.
- **[VERIFIED 2026-09-22 via repo-wide symbol and raw-value enumeration]**
  `REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING`, `TRANSCRIPT`, and `TRANSCRIPT_SUMMARY` appear under
  runtime source only in reader sets (`briefing-page-service.js`, `logistics-service.js`, and
  `pre-site-visit/distribution/model.js`); raw values `100000005`–`100000007` have no runtime
  writer. Recording/transcript production was explicitly out of scope for the shipped Meeting
  Tracker.
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
- **[VERIFIED 2026-09-22 via `lib/services/portal-upload-staging.js:28-35,549-572,632-637`,
  `lib/db/migrations/049_consultant_feedback_attachments.sql:11-15`, and
  `scripts/setup-database.js:1143-1151`]** the live private-staging constraint has four scopes:
  `grantee_image`, `staff_grantee_image`, `site_visit_material`, and `consultant_feedback`. A new
  scope must preserve all four, add its own candidate reconciler, and update the full-list parity
  test; unknown candidates are deliberately retained rather than deleted.
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
- **[VERIFIED 2026-09-22 via signed-in Chrome, Preview deployment
  `dpl_4zAYDFC4YDntkHFQsWBFxeTfTJD2`, and commit `35b9990bf`]** the earlier status-0 browser
  failure was caused by the application CSP: `connect-src` did not permit the Graph upload host.
  The route-scoped fix permits `https://*.up.1drv.com` plus the canonical SharePoint tenant only
  on the Preview upload proof, and permits that exact tenant in `media-src` only on the Preview
  playback proof. Ordinary routes keep the baseline policy.
- **[VERIFIED 2026-09-22 via signed-in Chrome and the configured runtime targets]** the corrected
  Preview read sanctioned Request `1003222` from Production Dataverse under the one-off read-only
  allowance and uploaded the 100,665,703-byte MP4 to the canonical akoyaGO SharePoint site. The
  repository has no separate Preview SharePoint target or SharePoint deployment/write interlock;
  the Preview deployment label alone did not make that disposable write non-production. The proof
  finalized the exact item after a bounded 32-byte `ftyp` read, visibly played it through the 302 resolver,
  successfully resolved the one-shot URL Watch path, and downloaded a complete 100,665,703-byte
  copy. The resolver count advanced
  once per explicit Watch/Download action and not for video range traffic. Microsoft supplied the
  opaque physical filename on download, so production UX still needs an explicit display-filename
  decision rather than relying on a cross-origin `download` attribute.
- **[VERIFIED 2026-09-22 via direct Node transport probes]** Microsoft accepted aligned
  `Content-Range` PUTs from the same machine: 320 KiB and 1.25 MiB fragments returned `202` with
  advancing `nextExpectedRanges`, and the CORS preflight returned `200` with an allow-origin
  response. Together with the corrected browser proof, this confirms Graph transport and identifies
  the application CSP as the original browser failure.

## 3. Invariant table

This table is the implementation guardrail. A build is not complete when only the happy-path UI
works.

| Invariant | Files likely touched | Verification |
|---|---|---|
| The presentation token cannot open the full briefing page or any briefing-only member. | external-token verifier, presentation routes/page | Cross-audience and cross-route tests in both directions; presentation token against briefing routes returns fail-closed. |
| An external request never chooses a request ID, SharePoint path, drive ID, item ID, or redirect target. | presentation external routes/service | Route accepts token plus bounded `member`; service re-resolves request membership before every redirect. |
| Zoom URLs are not stored in `wmkf_sharepointweburl`. | Request Document schema/adapter, post-presentation service | Writer test proves `wmkf_externalurl` is used and SharePoint identity fields are empty. |
| A Request Document material has exactly one backing mode: validated external Zoom URL, or stable SharePoint drive/item identity. | projector + writer/finalizer | Table tests cover external-only, file-only, both, and neither; both/neither fail closed. |
| Recording, Transcript, and Transcript Summary have one deterministic visible winner per type. | post-presentation service/read model | New rows use a monotonic slot-fence version; shared order is `wmkf_slotversion DESC NULLS LAST, createdon DESC, wmkf_requestdocumentid DESC`. A stale lower-fence writer cannot become visible even if it commits later. |
| Replacement becomes visible only after the new source is valid. | link writer, upload finalizer | Failure before new-row confirmation leaves the old material visible; retry converges on the same generation key. |
| Superseded material is retained but cannot be served externally or shown as current internally. | registry writer + both readers | Positive fixture includes the superseded row and proves it is excluded. |
| The app never buffers a complete uploaded or downloaded MP4. | Graph upload-session client, media resolver | Large synthetic/browser test proves chunked browser upload and Microsoft-served range/download bytes; the application resolution response contains no media bytes. |
| Every persisted MP4 byte count fits `wmkf_FileSize`. | upload metadata validator, Request Document writer | Boundary tests accept 2,000,000,000 bytes and reject 2,000,000,001; final Graph size must match declared size before registry create. |
| Deploying code before the Dataverse wave cannot add `wmkf_externalurl` to a live `$select`. | Request Document adapter, readiness helper | Readiness-off test proves the field is absent; readiness-on test proves it is present; invalid/unset readiness fails closed. |
| A completed SharePoint upload is recoverable if Dataverse registration fails. | upload-intent store/finalizer | Inject failure after candidate persistence; retry registers the exact same drive item and does not upload a second file. |
| An incomplete or abandoned upload cannot become a Board-visible material. | upload-intent store/finalizer/reader | Only a Ready Request Document is externally eligible; expired intent cleanup never promotes an item. |
| Cleanup never deletes SharePoint bytes referenced by any Request Document lifecycle state. | transcript staging reconciler, MP4 intent reconciler | Exact generation-key and drive/item match to one registry row means bound even when Superseded; zero matches may delete the exact candidate; ambiguous/mismatched/failed lookup retains and alerts. |
| Zoom save, transcript finalize, and MP4 finalize cannot replace the same artifact type concurrently. | presentation-material slot-lease store + all three producers | Lease acquisition increments a fencing version stored on the new registry row; the holder renews/revalidates before each Dataverse mutation, and a stale lower-fence row never wins or supersedes predecessors. |
| Expired transcript staging cannot strand or destroy a registered SharePoint candidate. | portal-upload staging migration/reconciler | Positive fixtures prove: any exact registry binding clears cleanup authority without deleting bytes; a true zero-row orphan is discarded by exact identity; unknown/ambiguous/mismatched shapes remain retained. |
| A stale Meeting Tracker request cannot update the newly selected request after an await. | new card/hooks | Request-generation or AbortController tests cover load, save, upload, finalize, copy, and error paths. |
| Reissuing the presentation link revokes only the prior presentation link. | presentation-link store/service | Compare-and-swap tests; the deliberation briefing link is unchanged. |
| The existing full briefing remains a superset while preserving audience isolation. | briefing material model + briefing-token media resolver | Positive fixtures include current Zoom, MP4, and transcript rows; briefing token resolves them but cannot open the materials-only page, and presentation token cannot open briefing-only members. |
| Staff identity comes only from the authenticated session. | Meeting Tracker routes/services | Exact-body route tests reject actor/request overrides; Request Document create uses required explicit actor policy. |

## 4. Target user flow

### 4.1 Meeting Tracker: Post-presentation materials

Add `PostPresentationMaterialsCard` immediately after `SiteVisitMaterialsCard` in the existing
visit editor. It renders only after an active Site Visit exists.

The card contains:

- **Recording source**
  - `Zoom link`: paste a bare Zoom share URL or Zoom's multiline “Copy link and passcode” result.
    The client extracts exactly one absolute HTTPS URL; zero or multiple URLs fail with actionable
    copy. A `pwd` query parameter is allowed and retained. If the pasted text contains a separate
    passcode line but the URL has no embedded `pwd`, reject it and tell staff to copy an
    embedded-passcode share link; the first slice does not store a separate passcode.
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

The section has three explicit load states: loading, loaded-empty (“Not added yet”), and
unavailable (“Presentation materials could not be loaded”). The presentation projection is not
coupled to the recipient-directory fetch; a recipient lookup failure cannot turn a material-load
failure into a false empty state.

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

The presentation audience has an exact material-membership model:

- collection members are file-backed Applicant Slides or Other Applicant Materials produced by
  `site-visit-materials-portal`, belonging to the token's request, Ready, non-Superseded, and not
  a pre-site distribution snapshot; every eligible row is included, with no latest-only collapse;
- singleton members are only the shared projector's current Recording, Transcript, and Transcript
  Summary winners;
- all other artifact types/producers are briefing-only or internal and return 404 before Graph;
- opaque `material:<requestdocument-guid>` remains the only browser-supplied member identity.

All SharePoint-backed members on the materials-only page use its non-buffering Microsoft URL
resolver, with `open`, `watch`, or `download` allowed only where appropriate for that content type;
the presentation token never calls the briefing audience's buffered document route. Tests serve a
positive Applicant Slides member and prove a Ready non-allowlisted artifact returns 404 before any
Graph call.

For a Zoom-backed recording, `Watch on Zoom` calls a token-checked redirect route; the raw URL is
not returned in context JSON. Zoom's own viewer/passcode/expiry policy applies after redirect.

For a SharePoint-backed MP4:

- `Watch` performs one token-checked material-resolution action, then points an HTML5 video
  element at the resulting short-lived Microsoft URL so Microsoft serves range requests directly;
- `Download` performs the same one-shot membership-checked resolution in download mode;
- no 50 MB application cap applies because the application does not fetch the complete bytes.

The existing full briefing uses the same material projection and pure media-resolution helper,
but verifies its own `briefing` token/audience and member set through a briefing-specific route.
It continues to show applicant slides, other applicant materials, Recording, Transcript, and
Transcript Summary under D19/D28. The materials-only page never gains proposal, reviews, staff
brief, or consultant feedback merely because the media helper is shared.

**[VERIFIED IN CHROME — Slice 0 browser decision]** both the no-store 302 resolver and the no-store
one-shot URL response resolved successfully without application byte proxying; the 302 path visibly
played and video range traffic
did not increase the application resolver count. Prefer the 302 because it reveals the bearer URL
only through the redirect chain rather than JSON, subject to the remaining Edge/Safari matrix and
expiry-recovery tests. The URL is browser-visible in either design, so it is never persisted,
logged, or placed in the context payload. If the remaining matrix falsifies 302 behavior, retain
the one-shot response as the bounded fallback rather than buffering the complete MP4.

If a Microsoft URL expires during playback, the client performs one bounded re-resolution,
restores the last confirmed playback position after metadata loads, and exposes a manual Resume
action if automatic recovery fails. An expired Download URL offers a fresh Download action; it
does not proxy or silently restart bytes through the application. Every re-resolution is
membership-checked, fail-closed rate-limited, and counted as a new resolution action. Slice 0
records the observed URL TTL against the longest expected recording and slow-download case.

The external page and every token-bearing response set `Referrer-Policy: no-referrer` and
`Cache-Control: private, no-store`.

## 5. Persistence model

### 5.1 Request Document: support an external recording source

Add two nullable fields in the next available Dataverse schema wave:

| Field | Shape | Purpose |
|---|---|---|
| `wmkf_ExternalUrl` (`wmkf_externalurl`) | URL string, max 2000 | Validated Zoom recording share URL for a link-backed Recording row. |
| `wmkf_SlotVersion` (`wmkf_slotversion`) | Whole number, min 1 | Monotonic Postgres lease-fence version for Recording/Transcript/Summary winner ordering; null only for legacy rows. |

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
`POST_PRESENTATION_SELECT_FIELDS = ['wmkf_externalurl', 'wmkf_slotversion']` to the Request
Document adapter and append it only when the exact-on post-presentation schema-readiness helper
returns true. Do not place either field in `BASE_REQUEST_DOCUMENT_SELECT` or the legacy
`REQUEST_DOCUMENT_SELECT` constant. This lets deploy-safe code run while the Dataverse wave is
still absent. The raw field-name and hardcoded select-list fan-out must be audited before release,
with readiness-off and readiness-on tests.

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
- `wmkf_slotversion` is the fencing version returned by the acquired Recording slot lease.

The route accepts a client operation UUID only for retry identity. It does not accept a generation
key, request ID in the body, actor, producer, lifecycle, or artifact type.

The route accepts either a bare URL or the bounded multi-line text produced by Zoom's Copy link
and passcode action. The server, not only the client, extracts exactly one absolute HTTPS URL;
zero or multiple URLs fail closed. The hostname must be exactly `zoom.us` or end in `.zoom.us`
(`zoom.com` is not accepted in the first slice), `username` and `password` URL components are
forbidden, and the path must match a reviewed recording/share allowlist. The normal `pwd` query
parameter is permitted and retained because Zoom uses it for embedded passcodes. Unknown hosts or
URL shapes fail with actionable copy; broadening either allowlist is a reviewed code change. If
the surrounding paste contains a passcode line but the URL lacks `pwd`, reject it with instructions
to obtain an embedded-passcode link rather than silently discarding the passcode.

### 5.3 SharePoint files

Use flat request-relative folders to match the shipped applicant-materials convention:

- `Site Visit - Recording`
- `Site Visit - Transcript`
- `Site Visit - Transcript Summary` (reader-ready; no new summary producer in this plan)

The server chooses the library, folder, and collision-proof physical filename. The browser never
chooses a path. Each finalized file gets stable Graph site/drive/item/version/eTag facts on its
Request Document row. Recording and transcript files created by this feature use producer
`meeting-tracker-post-presentation`, matching the Zoom-link row and making current-winner and
briefing inclusion behavior consistent across both backing modes.

All three producers create Ready + Draft rows, matching the existing applicant-material lifecycle
that D19 currently serves; only Superseded is externally ineligible. File-backed post-presentation
rows also carry the acquired slot-fence version. The Zoom URL, including an embedded `pwd`, is
stored as governed plaintext in Dataverse so server-side resolvers can use it. It is never returned
in external context JSON or application logs; the schema wave must evaluate Dataverse field-level
security and document why the application identities and `meeting-tracker`/`reviewers` grants are
the minimum readers if field-level security cannot be enabled.

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
- artifact type, original display filename, validated MIME, declared size as `BIGINT`, and a
  client resume fingerprint over size plus the first and last 1 MiB;
- server-chosen library/folder/physical filename and deterministic generation key;
- state (`initiated`, `uploaded`, `finalizing`, `finalized`, `failed`, `abandoned`);
- encrypted Graph upload-session URL, upload-session expiry, intent expiry, lease token/expiry,
  and bounded sanitized error;
- after upload: exact candidate site/drive/item/version/eTag/size facts;
- after registry commit: Request Document ID and finalized time.

Persist the preauthenticated Graph `uploadUrl` only as application-encrypted ciphertext, never as
plaintext or in logs. An independently authenticated resume endpoint rechecks the creating actor,
request, active visit, intent state, and expiry before decrypting it into a no-store response and
querying `nextExpectedRanges`. A browser reload requires staff to reselect the local file; the
client recomputes the bounded resume fingerprint before continuing, because a browser cannot be
assumed to retain a `File` handle. The normal materials GET lists that actor's unfinished intents
for the request using only upload ID, filename, size, state, timestamps, and `canResume`/
`canFinalize`; it never returns the encrypted URL. Clear the ciphertext on finalization,
abandonment, or expiry.

`upload_session_expires_at` is copied from Graph and is the last instant at which byte resume may
be offered. `intent_expires_at` is three days after that value, preserving a finalize-only grace
period after the session closes. The existing daily maintenance cron calls a new
`cleanupPresentationMaterialUploads` subtask. It claims an expired intent with the same lease
discipline, first checks the exact server-owned path for a committed item, persists any candidate,
and applies the registry-binding proof below. It never cleans an unexpired intent or an intent with
a live operation lease.
If an unfinished session expires, Graph discards its partial fragments. If the final byte commits
but registration fails, the finalizer re-resolves the exact server-owned path, persists the
candidate identity, and retries registration without creating another file.

When Graph reports that the session is complete/closed, or the exact path already resolves to the
declared-size item, resume returns `canFinalize: true` and no upload URL; the UI offers **Finish
saving** without requiring file reselection. A slot conflict during finalization remains
`uploaded`, is retried automatically with bounded backoff while the page is open, and remains
manually finalizable throughout the three-day grace. It is not marked abandoned merely because a
five-minute slot lease was busy.

An abandoned intent may point to a fully committed file even when the browser never called
finalize. Cleanup resolves only the exact persisted server-chosen path and persists the candidate
site/drive/item identity. Before deletion it queries Request Document by generation key. Exactly
one registry row whose stored drive/item matches the candidate is binding proof in any lifecycle,
including Superseded, so cleanup clears its deletion authority and retains the bytes. Zero rows
permits deletion of that exact candidate. Multiple rows, identity mismatch, or lookup failure
retain the candidate and raise an operational alert. Cleanup never deletes by prefix, folder scan,
inferred name, or browser-supplied identity.

### 5.6 Cross-producer slot leases

Add `presentation_material_slot_leases` in the same numbered migration:

- composite primary key `(request_id, artifact_type)`;
- nullable lease token and lease expiry, a monotonically increasing positive integer
  `fence_version` constrained at or below 2,147,483,647 for Dataverse whole-number parity, plus
  `updated_at`;
- artifact type is restricted to Recording, Transcript, and Transcript Summary;
- acquisition is a conditional insert/update that succeeds only when the row is unleased, expired,
  or already held by the same retry token;
- release/renewal requires the matching token.

The lease TTL is five minutes. Every successful acquisition by a new retry token atomically
increments and returns `fence_version`; idempotent reacquisition by the same token preserves it.
Exhaustion of the Dataverse-representable range fails closed and alerts rather than wrapping.
MP4 uses durable upload ID as its retry/lease token, transcript uses staging ID, and Zoom uses the
client operation UUID. Finalize accepts no second client-chosen operation UUID. Recovery under a
reacquired/renewed lease always re-runs the shared current-winner projection after reconciling the
recovered generation; it never returns a recovered row directly because a later successful
operation may already have superseded it.

The holder atomically renews and revalidates matching token + fence immediately before Request
Document create/recover and again before each predecessor update. It captures explicit predecessor
IDs under that fence and supersedes only those IDs, never an open-ended “older rows” query. Every
new row stores the fence in `wmkf_slotversion`. If a holder stalls after validation and commits
after a newer holder, its lower-fence row cannot win; after create it must revalidate again, and a
lost holder is forbidden from superseding anything. A reconciliation event records the stale
lower-fence active row for later supersede repair.

Zoom-link save, transcript finalize, and MP4 finalize all acquire this lease before creating or
superseding a Request Document. Upload/staging rows keep their own operation lease for idempotent
recovery; slot-lease acquisition is fail-fast and occurs immediately before registry mutation so
the operation lease is not held while waiting. A collision returns a retryable conflict and leaves
the existing visible winner unchanged.

### 5.7 Transcript staging scope

The same numbered Postgres migration widens `portal_upload_staging_scope_check` with
`post_presentation_transcript`; the fresh-install definition changes in the same commit. Add the
scope constant and a `reconcilePostPresentationTranscriptCandidate` branch. Replace the live
constraint from migration 049 and the V51 fresh-install definition with the complete five-scope
allowlist: `grantee_image`, `staff_grantee_image`, `site_visit_material`,
`consultant_feedback`, and `post_presentation_transcript`. The parity test asserts that exact full
list in both migration and fresh-install source.

Transcript binding proof is exactly one generation-key registry match whose stored drive/item
matches the candidate, regardless of lifecycle or whether the row is still the current winner.
Such a match clears candidate cleanup authority and retains the bytes. Zero rows permits deletion
of only the exact persisted candidate; multiple rows, identity mismatch, malformed state, or
lookup failure retain it and alert. This deliberately differs from current-slot-only cleanup:
Superseded transcript registry rows still retain and may legitimately reference their SharePoint
bytes.

## 6. Latest-only and replacement contract

Latest-only applies independently to Recording, Transcript, and Transcript Summary. Applicant
Slides and Other Applicant Materials retain their existing collection semantics.

For each post-presentation type:

1. acquire the short `presentation_material_slot_leases` lease for request + artifact type using
   the producer's durable retry identity and receive its monotonic fence version;
2. capture the explicit current predecessor IDs, renew/revalidate the lease, and create or recover
   the new Ready row by generation key with that fence version;
3. after the new row is confirmed, renew/revalidate again and mark only the captured predecessors
   whose fence is lower (or legacy-null) Superseded;
4. project the newest Ready non-Superseded row by the total order
   `wmkf_slotversion DESC NULLS LAST, createdon DESC, wmkf_requestdocumentid DESC` as the visible
   winner;
5. if more than one such row remains after a partial failure, still show only the deterministic
   newest winner, record an operational reconciliation event, and retry superseding the losers;
6. if the lease expires between writes, stop mutation; a lower-fence row is not visible over a
   newer winner and the reconciliation event schedules safe loser supersede repair;
7. on replay or lease recovery, reconcile the generation and then reproject the current winner;
   never return the recovered row directly;
8. release the slot only with the matching lease token. Failure paths leave the producer operation
   retryable and never release another operation's lease.

The external and internal readers use the same pure winner predicate. The browser does not sort
or choose winners independently.

A Zoom-link replacement can supersede a prior SharePoint recording and a completed MP4 upload can
supersede a prior Zoom-link row. The old link/file remains retained internally but is no longer
resolvable through the presentation token.

## 7. Upload and recovery sequence

### 7.1 MP4 begin

1. Meeting Tracker POSTs exact metadata: operation UUID, filename, MIME, byte size, and the client
   resume fingerprint over size plus the first and last 1 MiB.
2. Route verifies Meeting Tracker grant, request GUID, mapped staff actor, feature readiness, and
   active Site Visit/request binding.
3. Service validates MP4 metadata and the 2,000,000,000-byte maximum, resolves the request's
   active SharePoint bucket, chooses the exact folder/path, and inserts the durable intent.
4. Service creates a Graph upload session with conflict behavior `fail` for that unique path and
   encrypts the returned upload URL into the intent row.
5. Response returns upload ID, preauthenticated upload URL, chunk contract, and Graph session
   expiry with `Cache-Control: no-store`. Neither token nor URL is logged.

### 7.2 Browser upload — selected candidate, browser matrix pending

The selected candidate has the browser PUT sequential chunks directly to the preauthenticated
Graph upload URL and follow `nextExpectedRanges`. The deployed proof uses Graph's 320 KiB alignment
unit and a 60-second XHR fragment timeout with byte-level progress. Chrome completed a 96.0 MiB
upload after the proof route's CSP admitted only the Microsoft upload and canonical tenant origins.
The reload/reselect/fingerprint-resume design remains to be exercised in the rest of the required
browser matrix before production implementation.

After reload, the materials GET makes unfinished intents discoverable. An in-progress intent shows
Resume; a committed candidate with no registry row shows Finish saving. Only the creating actor
may resume/finalize. If the active Site Visit no longer matches the intent, both actions refuse;
the exact candidate is retained until the expiry reconciler can prove it unbound and clean it.

**[PASSED CORE CHROME PATH — Slice 0 browser decision, 2026-09-22]** direct browser PUTs to the
tenant-issued upload URL work in deployed desktop Chrome after the route-scoped CSP correction.
The browser sent the complete 100,665,703-byte file directly to Microsoft, and the application
handled only session metadata, bounded validation, and resolver actions. Do not route the complete
MP4 through a Function body; the direct Graph candidate now proceeds to the remaining matrix.

The bounded fallback decision, only if the remaining browser matrix fails, is:

1. **Fallback:** Meeting Tracker resolves/ensures the governed request folder, opens that folder
   in SharePoint for Microsoft's first-party upload UI, then lets staff return and attach one
   server-enumerated MP4 from that exact folder. Finalization still revalidates parent, stable
   drive/item identity, size, signature, and malware posture before creating the Request Document.
   This keeps video bytes out of Vercel Functions and avoids the browser-to-upload-session boundary,
   at the cost of an extra SharePoint tab and explicit return/attach step.
2. **Parked pending a separate proof:** browser-direct upload to an intermediate private object
   store followed by a server-side chunked SharePoint copy. This avoids the 4.5 MB request-body
   limit but adds a second durable byte store, copy leases, recovery/cleanup, egress, and long-run
   execution risk near the 2 GB cap. It is not an implicit fallback.
3. **Rejected:** proxying the complete MP4 through a Vercel Function request or creating a
   permanent SharePoint Anyone link.

### 7.3 Finalize

1. Client POSTs no authority-bearing body; upload ID is in the path and is the stable retry/lease
   identity. It does not supply a second operation UUID, drive/item, path, or actor.
2. Service claims the intent lease and revalidates actor/request/visit binding.
3. Service resolves the exact persisted path from Graph and persists candidate identity before
   any Dataverse write.
4. Service verifies the exact size at or below 2,000,000,000 bytes, MP4 signature through a bounded
   range read, and rejects a non-null Graph malware facet.
5. Service acquires the Recording slot lease/fence, captures predecessors, renews before create,
   creates or recovers the fenced Request Document row, renews again, then supersedes only the
   captured lower-fence predecessor IDs.
6. Service releases the matching slot lease, clears upload-session ciphertext, marks the intent
   finalized, and returns the newly projected current material rather than assuming the recovered
   generation is still current.

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
predecessor-supersede contract as MP4 finalization. The cleanup reconciler treats any exact
generation plus drive/item registry match as bound, even when Superseded; only a proven zero-match
candidate may be deleted by exact identity.

Proposed first-slice transcript cap: 25 MB. This is code-owned and independently tested.

## 8. Services and routes

All Meeting Tracker routes call `requireAppAccess(req, res, 'meeting-tracker')`, stop when it
returns no access, require both existing Meeting Tracker schema readiness and the new exact-on
post-presentation readiness, use `withDalContext`, take a GUID request ID from the path, enforce an
exact body allowlist, and use the session's mapped Dynamics system-user actor.

| Route | Method | Contract |
|---|---|---|
| `/api/meeting-tracker/visits/[requestId]/presentation-materials` | GET | Current Recording/Transcript/Summary winners, conflicts, supported formats, and the authenticated actor's unfinished intent descriptors; no upload secret. |
| same | PATCH | Exact action to save/replace a Zoom link; request and actor are server-owned. |
| `/api/meeting-tracker/visits/[requestId]/presentation-uploads` | POST | Begin MP4 or bounded transcript upload; returns the appropriate staging/upload contract. |
| `/api/meeting-tracker/visits/[requestId]/presentation-uploads/[uploadId]/resume` | POST | Independently reauthorize creating actor/request/visit. For an open session, verify file resume fingerprint and return the no-store URL plus `nextExpectedRanges`; for an already committed item return finalize-only state and no URL. |
| `/api/meeting-tracker/visits/[requestId]/presentation-uploads/[uploadId]/finalize` | POST | Lease-fenced, request-bound finalize/recovery. |
| `/api/meeting-tracker/visits/[requestId]/presentation-link` | GET, POST | GET current link; POST exact `ensure` or compare-and-swap `reissue`. |
| Existing `/api/workbench/site-visit/logistics?requestId=…` | GET | Continue `requireAppAccess(req, res, 'reviewers')`; preserve the legacy `materials` array and add a distinct `presentationMaterials` projection/status for `useSiteVisitContext` and `StaffDeliberationsTab`. Zoom-backed winners must not be filtered out by the legacy SharePoint-web-URL predicate. While readiness is off, return the legacy payload with `presentationMaterialsStatus: 'disabled'`, not a false empty collection; do not 503 the existing logistics read. |
| `/api/external/presentation/[token]/context` | GET | Rate limit, verify presentation token, return minimal material descriptors. |
| `/api/external/presentation/[token]/open` | GET | Reverify token and exact live audience membership; redirect Zoom. For eligible SharePoint members, use the Slice 0-selected no-store 302 or one-shot URL response. `mode=open|watch|download` is content-type constrained. |
| `/api/external/briefing/[token]/open` | GET | Preserve D19/D28 full-briefing semantics while resolving eligible Zoom or large SharePoint-backed post-presentation winners through the briefing token's distinct verifier/audience. |

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

Extend the Graph service surface with named, separately tested helpers for (a) creating and
resuming upload sessions, (b) resolving a fresh non-buffered download URL without fetching file
bytes, (c) bounded byte-range reads for signatures, and (d) malware metadata reads. Do not reuse
the existing whole-file-buffering `lib/services/graph/downloads.js` path for large media.

The Staff Deliberations implementation path is explicit: the existing `reviewers`-grant logistics
GET calls the shared winner projector; `useSiteVisitContext` exposes `presentationMaterials`;
`StaffDeliberationsTab` renders the read-only section. Existing applicant-material/distribution
`materials` semantics remain unchanged. The hook loads presentation materials independently from
recipient/logistics work and exposes explicit `loading`, `loaded-empty`, and `unavailable` states;
an unrelated recipient lookup failure cannot erase successfully loaded presentation materials.

The route matrix explicitly records the intentional grant split: Meeting Tracker producer/link
routes require `meeting-tracker`; the Workbench consumer remains on its existing `reviewers`
grant. The presentation and briefing external routes use distinct audiences and token verifiers.

Reuse the external-token cryptographic primitive and small value helpers. Do not extract a broad
generic “magic link framework” during this feature: briefing reissue has distribution-specific
locking semantics that the presentation link must not collapse.

## 9. External media resolution and the 50 MB limit

Neither the materials-only page nor the existing full briefing calls the buffered material
download path for MP4s. Both use the same pure winner/media resolver, but each route verifies its
own token audience and membership. Rate limits apply to the initial user Watch/Download resolution
action, not to Microsoft-hosted byte ranges.

For every initial Watch/Download resolution:

1. apply a dedicated resolver limiter that fails closed when its Postgres state is unavailable,
   then verify the route's presentation or briefing token with the matching audience;
2. parse the bounded member ID;
3. re-read the Request, eligible applicant-material collection, and current singleton winners;
4. require token-request membership and then either (a) exact inclusion in the Ready,
   non-Superseded, file-backed `site-visit-materials-portal` Applicant Slides/Other Applicant
   Materials collection, or (b) identity as the current Recording/Transcript/Summary singleton
   winner; every other type/producer returns 404 before Graph;
5. require file backing for SharePoint media and reject a malware facet;
6. request a fresh `@microsoft.graph.downloadUrl` for that exact drive/item;
7. use the Slice 0-proved delivery shape:
   - retain a no-store 302 only if browser traces prove subsequent range requests go directly to
     Microsoft and do not exhaust the per-token/per-IP application buckets; otherwise
   - return a no-store one-shot response containing the short-lived URL, and assign it directly to
     `video.src` or the Download action.

The short-lived Microsoft URL is never persisted or returned in context JSON. Reissuing/revoking
the 60-day presentation token blocks future redirect creation. A short-lived Microsoft URL
already handed to a browser can remain usable until Microsoft expires it. Similarly, a Zoom URL
already revealed through a successful redirect remains governed by Zoom host permissions after
application-token revocation. These bounded residual risks must be stated in release/UAT notes.

The proof records application-resolver hit count and response bytes while playing and seeking. If
range traffic re-enters the application, the 302 design fails even when video appears to play; do
not compensate by merely increasing a token bucket. The dedicated resolver limiter has explicit
per-token and per-IP limits selected during Slice 0, rejects link minting/resolution if its durable
state cannot be read or written, and gets failure-injection coverage. The chosen delivery design
gets a dedicated regression test and structured metric that contains no raw token or URL.

Do not create permanent SharePoint Anyone links. They are independent file permissions and could
outlive revocation of the application token.

All new presentation context/media routes and the new briefing media-open route check exact-on
post-presentation readiness before touching new fields or tables. They fail closed with the
route's non-disclosing unavailable/not-found response while readiness is off. The existing
briefing context and bounded-document route continue their legacy behavior and omit unsupported
post-presentation backing while readiness is off; staff routes expose `disabled` explicitly.

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
- Graph upload URLs are encrypted at rest and returned only to the independently reauthenticated
  actor who created the request-bound, unexpired intent; every response is no-store.
- Upload-session encryption derives a purpose-specific subkey from `EXTERNAL_LINK_SECRET` with a
  fixed `presentation-upload-session-v1` context; raw link-token and upload-session encryption do
  not reuse the same key material directly. Release checks secret presence, never value.
- Upload finalization reauthorizes independently; possession of an upload ID or Graph result is
  insufficient.
- Dataverse target/write interlock and DAL enforcement remain active on every Request Document
  and Site Visit read/write.
- No client-supplied user/profile identity is accepted.
- External page/media resolution uses a dedicated per-token/per-IP limiter that fails closed when
  durable limiter state is unavailable; bearer links are not minted or resolved on limiter error.
- Rate limiting applies to material-resolution actions. Microsoft range traffic must not consume
  the generic application token/IP bucket; Slice 0 selects the resolver shape that enforces this.
- Token-bearing pages and resolver responses set `Referrer-Policy: no-referrer` and no-store
  headers.
- Revocation prevents future application resolutions; already revealed Microsoft URLs may last
  until their short expiry and already revealed Zoom URLs remain subject to Zoom host controls.
- Decline or withdrawal does not silently shorten the owner-approved fixed 60-day lifetime; staff
  must reissue to revoke. This matches briefing D17 unless the owner later chooses a new policy.

## 12. Implementation slices

### Slice 0 — Deployed-Preview browser proof

**Implementation status (2026-09-22): CHROME CORE PATH PASSED; SLICE REMAINS OPEN.** [VERIFIED via
focused unit/contract tests] the isolated
feature branch contains the Preview-only staff harness, browser-direct Graph upload session,
encrypted staff permit, five-minute encrypted-subject proof token, fail-closed resolver limiter,
302/one-shot playback comparison, scoped CSP, and exact-item cleanup. [VERIFIED via signed-in
Chrome] the deployed Preview completed the 96.0 MiB upload, bounded finalize, visible 302 playback,
successful one-shot Watch resolution, complete download, and exact-item deletion. Resolver counts stayed bounded
to explicit actions. The downloaded filename was the opaque physical MP4 name, not the display
name. The required Edge/macOS Safari/iPadOS Safari, reload/reselect resume, expiry recovery,
long-duration seek, and 2 GB throughput-cap evidence remain open, so Slice 0 is not yet complete.

This is a disposable transport spike, not the production feature. It may add a Preview-only,
authenticated proof route and minimal harness, but it creates no durable application schema and is
removed or converted into production code after the decision. Use an owner-sanctioned disposable
request, the server-chosen proof folder in that request's configured governed SharePoint site, and
a real Zoom-produced MP4 larger than 50 MB. Record the actual Dataverse and SharePoint targets
before each run; Preview is an application-deployment boundary, not automatic data-target isolation.
Never log the token, upload URL, download URL, or passcode.

The transport decision must pass in current stable desktop Chrome, desktop Edge, macOS Safari,
and iPadOS Safari. These are the first-slice Board browser/device matrix; a resolver shape that
passes only Chromium does not pass Slice 0.

The proof harness fails closed unless `classifyDeployment() === 'preview'`, its mint route requires
an authenticated Meeting Tracker user, and its short-lived JWT uses a distinct
`presentation-media-proof` audience. Every proof route denies Production even if a configuration
value is wrong. Remove the harness before Slice 2 or convert only reviewed pieces into the
production routes; a release gate asserts that the proof audience/routes cannot ship enabled.

#### Upload procedure

1. From the deployed Preview origin, request a Graph upload session for a server-chosen disposable
   path.
2. Attempt the MP4 from the browser in sequential 320 KiB chunks (the proof's final deployed
   setting after latency probes); if the first response succeeds, exercise at least one
   paused/resumed chunk sequence using `nextExpectedRanges`, then reload,
   reselect the same file, verify its resume fingerprint, and resume again.
3. Capture a redacted browser network trace and server request-size metric proving the MP4 bytes
   travel browser → Microsoft, not browser → application → Microsoft.
4. Resolve the committed item by the exact server-owned path, verify its size, then delete that
   exact disposable item after the playback/download proof.
5. Record Graph's observed upload-session expiry and extrapolate the tested throughput to the
   2,000,000,000-byte cap on the target network. If a same-file resume cannot reliably complete
   within the observed expiry, stop and reduce the cap or obtain an owner transport decision.

#### Playback/download procedure

1. Issue a short-lived, Preview-only signed proof token with no durable row and load the proof page
   in a private window with DevTools Preserve Log enabled. Token persistence/revocation is tested
   later through the production link service; this spike isolates transport behavior.
2. Start with the no-store 302 resolver. Play at least two minutes; seek forward and backward to at
   least ten positions, including near the end; pause/resume; reload; then invoke Download.
3. Record origins, status codes, `Range`/`Content-Range` behavior, application resolver hit count,
   any 429s, application response bytes, and the Microsoft `Content-Disposition` behavior used by
   Download (do not rely on a cross-origin HTML `download` attribute). Evidence is redacted and
   contains no bearer URL.
4. Verify an expired proof token fails. Record that an already-issued Microsoft URL may remain
   valid only until its short expiry.
5. If the browser re-enters the application resolver for range traffic, switch the spike to a
   no-store one-shot URL response, assign the result directly to `video.src`, and repeat the same
   play/seek/download sequence.
6. Record the observed Microsoft URL lifetime against the longest expected presentation and a
   slow-download case; exercise expiry during playback and the bounded re-resolution/position
   restore behavior.

#### Pass/fail decision

Pass only when all of the following are observed:

- direct browser chunk PUT works under the deployed origin/CORS posture and resumes correctly;
- Watch starts, plays, and seeks; Download produces the complete file;
- byte ranges are served by Microsoft, not buffered or proxied by the application;
- the selected resolver shape causes one bounded application resolution per user action and does
  not exhaust the dedicated fail-closed resolver limiter during the seek script;
- no raw token or preauthenticated URL appears in application-emitted logs or persisted rows;
  the accepted `docs/DELIBERATION_BRIEFING_PAGE_PLAN.md` D18 limitation is that the hosting
  platform may retain the request-path token;
- exact-item cleanup succeeds for the disposable upload.

If the 302 passes, keep it. If only the one-shot URL response passes, adopt that shape and state
the short-lived URL exposure explicitly in the security contract. If direct upload or both media
resolution shapes fail, stop before durable schema/full UI work and return to the owner with the
redacted trace and a bounded alternative; do not silently route complete MP4 bytes through a
Function.

**Execution receipt (2026-09-22):** after the scoped CSP fix, the shared OAuth alias was temporarily
moved to immutable Preview deployment `dpl_4zAYDFC4YDntkHFQsWBFxeTfTJD2`. Chrome uploaded the
100,665,703-byte MP4, finalized it, visibly played it through the 302 resolver, resolved the
one-shot Watch path, and downloaded a byte-complete local copy. Two transient Microsoft range-fetch failures occurred while refreshing the
five-minute proof; a later retry succeeded, so production finalization needs a bounded transient
retry decision. With explicit user confirmation, cleanup deleted the exact committed SharePoint
item. The alias was then restored and re-inspected at its prior exact target
`dpl_8hUghEjVqCG1CHK7AjRJH8NXPvjr`. The proof deployment used one-off runtime settings; no
branch-scoped Preview settings were created. The request lookup was a read against Production
Dataverse, while the disposable file write and deletion occurred in the canonical akoyaGO
SharePoint site. The exact item was deleted; the shared `Artifacts/Presentation Media Proof`
folder remains as the reusable proof container.

Also verify tenant Safe Attachments and `DisallowInfectedFileDownload` posture. A security owner
may supply sanctioned evidence that the Graph malware facet becomes non-null for a flagged item;
without that evidence, keep the facet check as defense in depth and do not claim it proves a
synchronous scan. The first-slice size cap is resolved at 2,000,000,000 bytes.

Also send a sanctioned 25 MB clean transcript through the configured scanner in Preview and
record success; if the scanner cannot accept the proposed cap, reduce the cap before Slice 3.

Run this harness only from the Preview application deployment and only with an owner-sanctioned
disposable request. Before every run, explicitly record the configured Dataverse and SharePoint
targets and obtain authorization appropriate to those targets. Do not describe Preview as a
sandbox-data guarantee: the 2026-09-22 proof read Production Dataverse and wrote the disposable
item to the canonical SharePoint site. Cleanup must delete the exact committed item; an uncertain
session cancellation retains the encrypted permit for retry rather than claiming success.

### Slice 1 — Additive schema and readiness

- Dataverse wave adds `wmkf_ExternalUrl` and `wmkf_SlotVersion` to Request Document plus exact
  preflight.
- Request Document adapter adds readiness-gated `POST_PRESENTATION_SELECT_FIELDS`; the base and
  legacy selects remain safe while the wave is absent.
- One Postgres migration adds presentation links, upload intents, slot leases, and the
  `post_presentation_transcript` staging-scope constraint; it enumerates all five live scopes in
  migration and fresh-install source and updates the manifest/full-list parity test.
- Add `POST_PRESENTATION_MATERIALS_SCHEMA_READY`, exact-on only after both stores are applied and
  preflighted. Invalid values fail closed; unset is off.
- Update Atlas and credential/runbook surfaces before flag enablement.

Tier 2: owner applies migration/wave and later flips the readiness flag.

### Slice 2 — Shared material model and Zoom producer

- Add backing-mode validator and latest-only projector.
- Add Meeting Tracker GET/PATCH service/routes and Zoom URL producer.
- Acquire the named Recording slot lease/fence in the Zoom PATCH, revalidate before each explicit
  Dataverse mutation, and persist the fence version.
- Add Request Document writer to the explicit writer census and required-actor tests.
- Update logistics/Workbench read models to consume the shared projection.
- Extend the existing full briefing in the same slice to include eligible Zoom/file-backed
  post-presentation winners through its own verifier and the non-buffering media resolver. D19/D28
  must hold before the first producer can create a row.
- Deliver the non-buffering Graph download-URL helper, dedicated fail-closed resolver limiter,
  Zoom redirect, and new briefing media-open route in this same slice; the current buffered
  `/api/external/briefing/[token]/document` route remains for bounded files.

### Slice 3 — Transcript producer

- Extend private staging validation for transcript formats.
- Add actor/request/type-bound transcript staging/finalize.
- Add candidate-before-Dataverse recovery and latest-only supersede behavior.
- Add the scope-specific cleanup reconciler with any-lifecycle registry binding proof, plus bound
  Superseded-retention and true-unbound discard tests.

### Slice 4 — Large MP4 producer

- **PENDING completion of the Slice 0 browser matrix.** Use the proven browser-direct Graph
  candidate only after Edge/macOS Safari/iPadOS Safari, resume, expiry, and throughput gates pass.
- If the SharePoint-first-party fallback becomes necessary, replace the upload-session intent
  with a bounded attach intent: server-owned request/folder, creating actor, expected filename/size,
  exact-folder enumeration, independently authorized attach, and stable drive/item validation.
- Preserve progress/cancel UI only for operations the chosen transport can truthfully observe;
  keep lease-fenced finalize, bounded range signature check, candidate recovery, and reconciliation
  for the selected SharePoint item.
- Add exact orphan/expiry maintenance. Never delete by prefix or inferred path; cleanup uses only
  persisted exact candidate identity and deletes only after a zero-row registry proof, including
  an upload that completed before the browser abandoned finalize.
- Wire the cleanup into the existing daily maintenance cron and expose unfinished/finish-saving
  intent states in the staff GET/UI.

### Slice 5 — Internal and external consumers

- Extend the existing `reviewers`-grant Workbench logistics GET with a distinct
  `presentationMaterials` projection; wire `useSiteVisitContext` to `StaffDeliberationsTab` and
  add the read-only section without changing legacy distribution materials.
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
- newest deterministic winner with two active rows; higher slot fence wins even when it commits
  earlier, while legacy-null/equal timestamp rows fall back to request-document ID;
- positive exclusion fixtures for old/Superseded rows;
- generation-key lost-response replay;
- replacement failure before new row leaves old winner;
- supersede failure after new row leaves new deterministic winner and recoverable warning;
- one live presentation link per request; ensure reuse; exact 60-day expiry; compare-and-swap
  replacement of an expired/unreadable non-revoked row; reissue; old token revoked; briefing link
  unchanged;
- upload intent actor/request binding, per-upload lease collision, expiry, candidate persistence,
  encrypted-URL clearing, retry, and finalized replay that reprojects rather than returning a
  superseded recovered row;
- cross-producer slot lease: Zoom PATCH racing MP4 finalize and transcript finalize racing a second
  transcript replacement; one winner, retryable loser, prior visible material preserved;
- lease expiry between create and supersede: stale lower-fence row never wins, cannot supersede,
  and reconciliation repairs only explicit predecessor IDs;
- MP4 cap boundaries accept 2,000,000,000 and reject 2,000,000,001; persisted size equals Graph;
- Request Document select excludes `wmkf_externalurl` while readiness is off and includes it only
  when exact-on readiness is enabled; the same assertions cover `wmkf_slotversion`;
- migration/fresh-install parity asserts all five staging scopes, including existing
  `consultant_feedback`;
- full briefing positive-inclusion fixtures contain Ready Zoom and large SharePoint-backed
  post-presentation winners and prove they remain in the D19/D28 superset.

### Routes and security

- method guards, size limits, exact body allowlists, GUID validation, app grants, feature flag;
- body cannot override request ID, actor, artifact type, producer, path, or Graph identity;
- reviewer/grantee/briefing tokens rejected by presentation routes and presentation token rejected
  by their verifiers/routes;
- unknown/foreign/Superseded/non-current material returns 404 with no Graph call;
- Zoom Copy-link/passcode extraction accepts exactly one eligible URL, retains `pwd`, and rejects
  multiple URLs, URL userinfo, non-HTTPS, `zoom.com`, and suffix-confusion hosts; a separate
  passcode line without embedded `pwd` is rejected with corrective copy;
- materials-only audience serves eligible `site-visit-materials-portal` Slides/Other collection
  rows plus current singleton winners, and rejects every non-allowlisted type/producer before
  Graph;
- selected resolver shape has no-store headers and no URL in context JSON, persistence, or logs;
- `Referrer-Policy: no-referrer` on the token-bearing page and resolution responses;
- rate-limit success/failure accounting for one user resolution action; media range traffic does
  not consume the application bucket; Postgres/limiter failure rejects mint/resolution.
- external routes fail closed with readiness off; staff logistics returns disabled, not empty.

### Upload and recovery

- client chunks are sequential 320 KiB multiples and resume from `nextExpectedRanges`, including
  reload/reselect with a matching fingerprint; mismatched file and expired session refuse;
- unfinished intent rediscovery, complete-session Finish saving, creating-actor-only resume,
  active-visit drift refusal, and automatic bounded retry after a slot conflict;
- navigation/request change suppresses stale progress/success/error state;
- incomplete Graph session never creates a Request Document;
- completed Graph upload + Dataverse failure retries the same exact item;
- MP4 signature mismatch, size mismatch, missing item, wrong parent, and malware facet all refuse;
- transcript VTT/TXT/PDF/DOCX validation and infected/unavailable scan refusal;
- VTT header validation and explicit TXT no-magic-signature behavior;
- transcript-scope cleanup deletes an exact unbound candidate and retains malformed/ambiguous
  candidates, while an exact Superseded registry match retains its bytes;
- abandoned-after-complete MP4 cleanup retains an exact Ready/Superseded registry match after an
  intent-finalization failure and deletes only a proven zero-row exact candidate.

### UI and browser

- source chooser, replace confirmation, distinct loaded-empty/unavailable states, upload progress;
- presentation-material success remains visible when recipient/logistics loading fails;
- Copy link success/failure/manual fallback and state reset after reissue;
- Staff Deliberations renders Zoom, SharePoint, transcript, and missing states;
- external page contains presentation materials and explicitly does not contain proposal,
  reviews, staff brief, consultant feedback, or request number;
- deployed-Preview real MP4 over 50 MB completes the owner-selected upload/attach transport and
  play/seek/download script without application buffering, repeated resolver throttling, or bearer
  values in logs across desktop Chrome, desktop Edge, macOS Safari, and iPadOS Safari; the
  browser-direct Graph variant remains the selected candidate unless the remaining matrix falsifies it;
- expired/revoked tokens, Microsoft URL expiry recovery with playback-position restore, and fresh
  download action after URL expiry;
- Preview proof harness rejects Production and is removed/disabled before release.
- pre-compatibility runtime is rejected as a rollback target; compatibility-floor readers tolerate
  external-backed, fenced, duplicate-active, and Superseded fixtures.

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
- `pages/api/cron/maintenance.js`, `lib/services/maintenance-service.js`, and maintenance tests for
  the daily expired-intent reconciler and its retained/alerted outcomes;
- `next.config.js` path-specific headers so presentation/briefing token pages and media resolver
  responses override the global policy with `Referrer-Policy: no-referrer`;
- `docs/PC_MEETING_TRACKER_PLAN.md` to retire “recording/transcript producers” from out of scope;
- `docs/DELIBERATION_BRIEFING_PAGE_PLAN.md` to record that the full briefing link remains separate,
  retains D19/D28 superset behavior, and uses the new non-buffering media resolver for eligible
  post-presentation rows rather than its 50 MB buffered route;
- `shared/config/deliberationShareEmail.js` remains factually accurate and gets a regression
  assertion that its presentation-materials promise is fulfilled;
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
- update canonical route/access counts, then run `npm run check:fact-consistency` followed by its
  self-test unconditionally because the new routes change registered counts;
- documentation currency/catalog/symbol gates selected by the changed surfaces;
- production build and full `npm run test:ci` before release.

## 15. Release and rollback

This is Tier 2 cross-store runtime work. Build on a feature branch and promote deliberately.

Release order:

1. **IN PROGRESS:** the fail-closed Slice 0 harness passed the deployed Chrome core path after a
   route-scoped CSP correction. Complete Edge/macOS Safari/iPadOS Safari, resume, expiry, and
   throughput gates before schema work; keep 302 as the leading resolver and the one-shot URL as
   the bounded fallback;
2. remove/convert the proof harness and merge the compatibility floor: deploy-safe readers,
   backing validation, disabled-state payload, and external-route readiness guards with readiness
   off and both new fields absent from live selects. Confirm only the presence—not the value—of
   `EXTERNAL_LINK_SECRET` separately in Preview and Production;
3. for Preview, owner applies the Postgres migration to the Preview-connected database and the
   Dataverse wave to the sandbox organization, then runs exact schema/readback preflights while
   readiness remains off;
4. deploy the compatible producer runtime to Preview, run the prior-runtime-tolerance fixtures,
   then owner sets
   `POST_PRESENTATION_MATERIALS_SCHEMA_READY=on` only in Preview, and run signed-in/private-window
   acceptance with a file over 50 MB, including reload/resume and URL-expiry recovery;
5. for Production, separately confirm the target registry/interlock classifies the production
   Dataverse organization, owner applies the same Postgres migration to the Production-connected
   database and the Dataverse wave to the production organization, and runs exact preflights with
   Production readiness still off;
6. deploy/promote the already-proven compatible runtime, rerun the tolerance fixtures, owner sets readiness on only in
   Production, and repeat a bounded smoke on a sanctioned request. Verify D19 full-briefing access
   and the materials-only link as separate audiences.

Once any producer can write a post-presentation row, the compatibility-floor commit becomes the
oldest permitted runtime. Rollback is unsetting readiness and keeping/redeploying that compatible
runtime; never redeploy a pre-compatibility runtime unless its exact artifact passed tolerance
tests against link-backed and Superseded fixtures. Additive schema and retained rows remain. Do not
delete uploaded files or link rows during rollback. With readiness off, external routes fail
closed and Staff Deliberations shows disabled rather than a false empty state.

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
  mutation; its monotonic fence is stored on the row, renewed before each explicit write, and makes
  a stale late commit non-winning. A collision is retryable and cannot supersede the prior visible
  winner.
- Transcript and MP4 cleanup first prove registry binding by exact generation plus drive/item.
  Any-lifecycle matches retain bytes; only a proven zero-row candidate may be deleted by exact
  persisted identity, while ambiguity/mismatch/lookup failure retains and alerts.
- New-row confirmation precedes predecessor supersede, so failure never erases the last usable
  material.
- A response returns concrete material/link/upload identifiers, never success-by-count.

### Async/stale state

Every client post-await state write is request-generation guarded. Server retries are keyed by
operation/staging/upload ID, unfinished uploads are rediscoverable after reload, and every resume
or finalization independently reauthorizes the creating actor, request, and active visit.

### Helper extraction

Shared pure helpers may normalize material backing and choose current winners. Briefing and
presentation link lifecycle services stay separate because briefing reissue participates in a
distribution-send lock and presentation reissue does not.

### Durable surfaces

The single Postgres migration includes link rows, upload intents, fenced slot leases, and the
transcript scope constraint. Fresh-install parity, manifest, two-field schema wave/preflight,
readiness-gated selects/routes, Atlas, route matrix, service catalog, readiness runbook, writer
census, daily cleanup policy, tests, and gates are all named.

### Symbol-consumer fan-out

Before implementation completion, grep both `wmkf_externalurl` and every Request Document select
list. Verify logistics, external briefing, new presentation page, Staff Deliberations, applicant
materials, distribution, dashboards, and generic registry readers. Unknown or invalid backing
modes fail closed; no existing file-backed consumer may mistake an external row for a SharePoint
file. The existing briefing audit must include positive Zoom and SharePoint-backed rows from
`meeting-tracker-post-presentation` and prove D19/D28 inclusion through the non-buffering resolver.

## 17. Review resolutions

The 2026-09-22 OAuth Claude Opus reviews were reconciled against source. The adversarial findings
are resolved in this revision as follows:

- the first-slice MP4 cap is 2,000,000,000 bytes, within `wmkf_FileSize`;
- `wmkf_externalurl` is select-gated until the Dataverse wave is ready;
- the Postgres migration replaces migration 049/V51 parity with an explicit five-scope allowlist
  and adds the cross-producer slot-lease store with a five-minute TTL;
- transcript and abandoned-MP4 cleanup protect every exact registry-bound candidate regardless of
  lifecycle; only a proven zero-row exact candidate can be deleted;
- Staff Deliberations uses the existing `reviewers`-grant logistics route through an explicit new
  projection;
- the locked D19/D28 full briefing remains a superset and gains Zoom/large-media resolution with
  the first producer; the new materials-only link is an additional audience;
- the media rate-limit concern is resolved by the Slice 0 browser decision: keep 302 only if
  range traffic bypasses the application; otherwise use a one-shot short-lived URL response;
- upload-session URLs are encrypted at rest and independently reauthorized for reload/reselect
  resume; expiry observations gate the 2 GB cap;
- Zoom Copy-link parsing, total winner ordering, resolver expiry recovery, fail-closed rate
  limiting, Preview-only proof isolation, per-environment schema waves, and Staff Deliberations
  loaded-empty/unavailable behavior are explicit and covered by tests.

The subsequent document-only Opus pass identified six further blockers, now incorporated:

- presentation-token membership explicitly separates the applicant-material collection from
  latest-only singleton types and allowlists `site-visit-materials-portal`;
- unfinished uploads are rediscoverable, complete sessions expose Finish saving, slot conflicts
  retry, and daily cleanup waits through an explicit three-day finalize grace;
- the compatibility floor, not a pre-feature runtime, is the rollback minimum once producers run;
- separate Zoom passcodes without embedded `pwd` are rejected rather than silently discarded;
- Slice 0 must pass desktop Chrome/Edge plus macOS/iPadOS Safari; and
- monotonic slot fencing plus renew/revalidate-before-write prevents an expired lease holder from
  becoming the visible winner or superseding an uncaptured row.

The product behavior remains locked. Browser-direct Graph upload is the leading MP4 transport after
the corrected Chrome proof; the remaining implementation decision is whether it survives the full
browser/resume/expiry matrix. Failure in that matrix returns to the bounded SharePoint-first-party
fallback and is not permission to introduce application byte proxying.
