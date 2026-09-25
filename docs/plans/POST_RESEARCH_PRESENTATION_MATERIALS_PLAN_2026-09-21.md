---
title: Post-research-presentation materials and Board presentation link
domain: meeting-tracker
kind: plan
status: active
summary: "Active plan for Meeting Tracker presentation materials; Slice 1 additive schema/readiness is source-built but unapplied, the shared 10 MiB direct-Graph transport passed its representative Chrome Preview benchmark, and Graph-confirmed expiry, Safari, and near-cap Production gates remain."
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
| Production test isolation | Schema readiness is environment-wide and is not a feature rollout guard. Add a separate server-enforced presentation access mode: `off`, `test:<approved request GUID>`, or `on`. Keep Production `off` until an owner-approved human-created disposable Request exists; the Test Request Factory is unfinished and is not a dependency. Use `test:<GUID>` for the bounded Safari/near-cap run and switch to `on` only after the release gates pass. |
| Supported browser scope | Staff desktop browsers are the release target. The owner removed iPadOS support and its browser/device acceptance rows on 2026-09-24; no iPadOS run blocks this feature. Keep the near-cap upload check on desktop for the proposed 2 GB cap. |
| Existing full briefing | Preserve D19/D28: the existing distributed briefing remains a superset and continues to include research-presentation materials. Add audience-specific non-buffering Watch/Download resolution for Zoom and large SharePoint recordings. The new copied link is an additional materials-only option. |
| Transport proof | **CHROME CORE PATH PASSED 2026-09-22; EDGE PARTIAL PATH REPORTED 2026-09-23; CHROME RELOAD/RESELECT AND PROOF-TOKEN RECOVERY PASSED 2026-09-24; SHARED 10 MiB PERFORMANCE TRANSPORT BENCHMARKED IN CHROME PREVIEW 2026-09-25.** The original status-0 failure was the application CSP, not Graph transport. A later current-hardening run exposed that Graph can publish a smaller same-path placeholder while the upload session is live; the corrected status contract treats that item as in progress only while the matching session remains live. Deployed Chrome then paused and resumed a 96.0 MiB direct Graph upload, finalized it, played it through both resolver shapes, downloaded byte- and SHA-256-identical content, and deleted the exact item to the recycle bin. Commit `bab770fe6` replaces the proof's 320 KiB/60-second loop with the shared 10 MiB, status-aware, stall-aware transport and removes the sealed-initial-expiry refusal. Deployment `dpl_FX7HvZZWTvvVchDytB3rRqCtEYoX` then uploaded the same 100,665,703-byte MP4 in Chrome with a 3.22 Mbps final post-resume active rate and 300.133-second begin-to-verification wall time, including one deliberate 10 MiB boundary pause; a separate same-machine/network direct-Graph Chrome baseline measured 2.383 Mbps over 337.997 seconds. This one sample shows no apparent application throughput penalty but is not a generalized speed-improvement claim or a substitute for the near-cap gate. The earlier session-expiry UI refusal/cleanup used the sealed initial timestamp while Graph later confirmed cancellation, so Graph-confirmed expiry remains unverified. The Windows Edge colleague reported upload, playback, and Download for a 97,777,999-byte MP4; the exact item was deleted after owner approval. Owner accepted Chrome and Edge as working. The later Factory dependency is superseded: desktop macOS Safari must use an owner-approved human-created disposable Production Request because the Factory remains unfinished. Long-duration seeking and a desktop near-cap upload remain required before release; iPadOS was removed from scope by the owner on 2026-09-24. |
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
- **[VERIFIED 2026-09-25 via `lib/services/graph/upload-session.js`,
  `shared/utils/graph-browser-upload.js`, focused tests, and the signed-in Chrome benchmark]** the
  existing server Graph upload-session helper still accepts the complete file as a Node `Buffer`;
  it chunks transport to Graph but does not remove application memory/body limits. The separate
  browser-direct transport now also owns a code-level 10 MiB default and sends bytes browser →
  Graph without a full-file application body. The earlier deployed proof's 320 KiB loop is
  historical.
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
  Preview read owner-authorized Request `1003222` from Production Dataverse and uploaded the
  100,665,703-byte MP4 to the canonical akoyaGO SharePoint site. The
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
only through the redirect chain rather than JSON, subject to the deferred Production Safari
matrix. The URL is browser-visible in either design, so it is never
persisted, logged, or placed in the context payload. If the remaining matrix falsifies 302 behavior, retain
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

**[PLANNED production surface; not created by `bab770fe6`.]** The Preview proof continues to use
only a session-scoped encrypted browser permit and creates no application table. The production
producer still requires the durable intent below before any Production upload-session URL is
issued.

Add `presentation_material_uploads` in the same migration. A row exists before any Graph upload
URL leaves the server and carries:

- upload ID, request ID, active Site Visit ID, authenticated actor ID;
- artifact type, original display filename, validated MIME, declared size as `BIGINT`, and a
  client resume fingerprint over size plus the first and last 1 MiB;
- server-chosen library/folder/physical filename and deterministic generation key;
- state (`initiated`, `uploaded`, `finalizing`, `finalized`, `failed`, `abandoned`);
- encrypted Graph upload-session URL, last server-observed Graph upload-session expiry, intent
  review-after time, lease token/expiry,
  and bounded sanitized error;
- after upload: exact candidate site/drive/item/version/eTag/size facts;
- after registry commit: Request Document ID and finalized time.

Persist the preauthenticated Graph `uploadUrl` only as application-encrypted ciphertext, never as
plaintext or in logs. An independently authenticated resume endpoint rechecks the creating actor,
request, active visit, intent state, and rollout access before decrypting it into a no-store
response and querying Graph's current `nextExpectedRanges` and expiry. A browser reload requires staff to reselect the local file; the
client recomputes the bounded resume fingerprint before continuing, because a browser cannot be
assumed to retain a `File` handle. The normal materials GET lists that actor's unfinished intents
for the request using only upload ID, filename, size, state, timestamps, and `canResume`/
`canFinalize`; it never returns the encrypted URL. Clear the ciphertext on finalization or a
destructive transition permitted by the access mode and exact cleanup policy; retain it on
uncertain transport and while the bounded Production test remains under `test:<GUID>`.

`upload_session_expires_at` is the last expiry observed by the server at session creation or an
authorized status read, not a terminal predicate. The browser may display later expiry from
successful fragment responses but cannot set this persisted field. `intent_expires_at` is a
review-after time three days after the last server-observed expiry and is recomputed when an
authorized status read moves that expiry forward. After this time, the existing daily maintenance
cron calls `cleanupPresentationMaterialUploads`: claim with the same lease discipline, inspect
the exact server-owned path and live session status, repeat an ambiguous final-commit path lookup
with bounded backoff, persist any committed candidate, and apply the registry-binding proof below.
It never treats a stored expiry or Graph 404 alone as deletion authority, never cleans a live
operation lease, and retains/alerts on uncertain Graph or registry reads. In access `off` or
`test:<GUID>`, maintenance is inspect/record/alert only: it may refresh observed expiry and
persist a candidate, but cannot cancel a session, clear its URL, mark abandoned, or delete bytes.
In access `on`, the owner-approved routine cleanup policy may make those terminal transitions
after the exact registry proof. A separately approved operator action may also do so for a named
test intent; no staff abandon route is in this slice. A live session only moves its review-after
time. Switching access to `off` stops new app-authorized PUTs but cannot revoke a preauthenticated
Graph URL already delivered to a browser; the test operator must wait for confirmed expiry or
separately approved cancellation before treating its exact candidate as stable. If an unfinished
session is confirmed gone with no exact item after that visibility check, Graph's partial bytes
are no longer resumable. If the final byte committed but registration failed, the finalizer
re-resolves the exact server-owned path, persists candidate identity, and retries registration
without creating another file.

Only when the exact path resolves to the declared-size item and identity checks pass does resume
return `canFinalize: true` and no upload URL; a closed Graph session by itself remains ambiguous.
The UI offers **Finish saving** without requiring file reselection. A slot conflict during finalization remains
`uploaded`, is retried automatically with bounded backoff while the page is open, and remains
manually finalizable throughout the three-day grace. It is not marked abandoned merely because a
five-minute slot lease was busy.

An abandoned intent may point to a fully committed file even when the browser never called
finalize. Cleanup resolves only the exact persisted server-chosen path and persists the candidate
site/drive/item identity. Before deletion it queries Request Document by generation key. Exactly
one registry row whose stored drive/item matches the candidate is binding proof in any lifecycle,
including Superseded, so cleanup clears its deletion authority and retains the bytes. Zero rows
permits deletion of that exact candidate only under the approved `on` cleanup policy or a
separately approved operator action. Multiple rows, identity mismatch, or lookup failure
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
Graph upload URL and follow `nextExpectedRanges`. The deployed *historical* proof uses Graph's
320 KiB alignment unit as its whole fragment and a 60-second XHR fragment timeout with byte-level
progress; these are not the production performance policy in §7.2.1. Chrome completed a 96.0 MiB
upload after the proof route's CSP admitted only the Microsoft upload and canonical tenant origins.
[VERIFIED via branch source and focused tests, 2026-09-23] The Preview harness now stores a
SHA-256 fingerprint of file size plus the first and last 1 MiB alongside its encrypted browser
permit. After reload it requires reselection and checks name, size, modification time, and that
fingerprint before requesting Graph resume status. An old permit without a fingerprint remains
available for exact Cleanup but cannot resume. [VERIFIED via signed-in desktop Chrome on 2026-09-24]
Reload and same-file reselect resumed the paused upload to a full-size commit. Safari remains
deferred to a Production run on an owner-approved human-created disposable Request; the unfinished
Test Request Factory is not a dependency, and the production intent remains a
separate build.

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

### 7.2.1 Direct-Graph performance and recovery policy (Preview benchmark passed 2026-09-25; remaining live gates pending)

**[VERIFIED via commit `bab770fe6`, `shared/utils/graph-browser-upload.js`, the Preview proof
service/harness, and 84 focused tests]** the branch now has one browser-direct transport with a
code-owned 10 MiB default, strict sequential ranges, status-aware bounded retry, stall/response
watchdogs, truthful progress/rate/ETA states, pause/offline/reconnect handling, and a same-browser
lock. The Preview proof uses it and checks live Graph state after the sealed initial expiry.
**[VERIFIED via signed-in desktop Chrome, immutable Preview deployment
`dpl_FX7HvZZWTvvVchDytB3rRqCtEYoX`, Vercel request logs, and Microsoft Graph on 2026-09-25]**
the representative benchmark in item 2 below passed with the same 100,665,703-byte MP4 and an
independent same-machine/network direct-Graph baseline. This live receipt verifies the revised
transport's 10 MiB chunk policy, boundary pause/resume, committed-versus-in-flight UI, final
verification, short-lived playback-proof mint, and exact cleanup. It does not exercise a live
retry, reconnect, watchdog, or Graph-confirmed terminal expiry; those remain covered only by
offline tests until their named live gates run.
Keep browser → preauthenticated Microsoft Graph → governed SharePoint as the MP4 byte route.
The transcript's private Blob staging remains a separate small-file route; routing MP4s through
it would add a complete second byte transfer and another recovery/cleanup surface. Converge the
authorization, durable intent, lease, candidate registration, and cleanup contracts, not the
byte route.

Microsoft's [upload-session contract](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0)
requires sequential ranges, each nonfinal fragment a multiple of 320 KiB, and each request below
60 MiB. It recommends 5–10 MiB and identifies 10 MiB as optimal for stable high-speed links.
**[VERIFIED via source and focused tests]** Use a code-owned 10 MiB default (32 alignment units); consider a code-owned 5 MiB
alternative (16 units) only if measured slow/unstable-link evidence justifies it. Neither is an
Admin or environment setting. The final remainder may be smaller. At 2,000,000,000 bytes this
reduces the nominal sequential PUT count from 6,104 at 320 KiB to 191 at 10 MiB; this is a
request-count calculation, not a measured throughput claim. Keep the file cap exactly
2,000,000,000 bytes and the bounded first/last-1-MiB SHA-256 resume fingerprint.

The shared transport and its tests preserve these failure contracts:

| Condition | Planned behavior |
|---|---|
| Successful `202` | Treat Graph's `nextExpectedRanges` as the committed-byte authority. The next offset must advance and cannot exceed the end of the fragment just sent; reject a malformed, backward, or out-of-file range. Read the response's refreshed `expirationDateTime` for the current UI. A `200`/`201` final response still needs exact committed-item verification before registration. |
| Network error, stalled request, timeout, or 5xx | Do not infer that the in-flight bytes committed. Reauthorize through the existing resume/status route, query Graph's current session ranges, and resume only from the missing range. Use capped exponential backoff with jitter, at most three automatic attempts without Graph-confirmed offset progress, resetting the count after progress; leave a resumable intent and manual Resume action when exhausted. Never blindly replay an ambiguous range. |
| `416` already-received range | Query status and continue from Graph's missing range, or verify the exact completed item. Do not turn this into an automatic fresh upload. |
| `429` | Follow Graph's [throttling guidance](https://learn.microsoft.com/en-us/graph/throttling): expose the response's `Retry-After` through the browser XHR wrapper and honor a valid value before the next status/PUT request; otherwise use capped exponential backoff. Cap automatic throttling at three consecutive 429s or two minutes of total wait, whichever comes first. Then pause and require a fresh authorized status check for manual Resume; never spin indefinitely. |
| `404`/`410` session after an ambiguous or final PUT | A closed session may mean a successful commit. Check the exact full-size item immediately and twice more after 2 and 10 seconds to allow SharePoint visibility. If still absent, mark the session closed but the item outcome unresolved; retain the intent/candidate for later status and registry-safe cleanup. Never auto-start a replacement or delete on this signal alone. Other 4xx or malformed/ambiguous ranges fail closed and retain the intent. |
| Application resume/status route returns `401`/`403`, `5xx`, or is unreachable | Preserve the intent and Graph offset. Ask staff to sign in again for `401`/`403`; show Retry later for transient app/Dataverse failures. These are not Graph fragment failures and do not consume the fragment retry budget. Never bypass server reauthorization with a cached upload URL. |
| Pause, reload, same-file reselect, or request switch | Show Pausing while a 10 MiB fragment finishes. The shipped control is graceful pause-after-fragment, not immediate abort. A lifecycle abort cancels XHR/timers and retains the permit; the next manual Resume performs the fresh authorized status reconciliation because commit is uncertain. Reauthorize and fingerprint-check before resume, and suppress stale progress/errors/PUTs for a different Request. Do not discard a recoverable intent or claim that committed bytes must restart. |

**[VERIFIED via `presentation-media-proof-service.js::getPresentationMediaProofUploadStatus`
and focused tests]** the proof still seals the *initial* Graph expiry as advisory evidence, but
no longer returns 410 merely because that timestamp passed. It checks the exact full-size item,
then Graph's live status, with exact-item rechecks after terminal 404/410 outcomes. Microsoft's
[upload-session contract](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0)
says each successful fragment extends expiry. A transient/uncertain status retains the permit.
The disposable proof permit now uses an absolute 72-hour lifetime from mint, independent of the
initial Graph expiry; after that, any unresolved exact item needs an operator-approved cleanup
path rather than an unguarded browser deletion. This lifetime bounds proof access and covers
the planned desktop run plus cleanup grace. The durable production intent stores the last *server-observed* Graph
expiry as advisory; the browser may display refreshed expiry from `202` responses, but cannot
extend server authority by submitting its own timestamp. No per-fragment application callback is
required. Maintenance checks live Graph and exact item state before terminal cleanup.

**[VERIFIED via source and simulated slow/stall tests]** The fixed 60-second whole-fragment XHR timeout is replaced with a resettable
upload-inactivity watchdog (provisional 120 seconds), plus a provisional 180-second wait for
Graph's response after the browser reports the fragment sent. The initial supported-link
assumption is at least 1 Mbps upstream; a 10 MiB fragment at that rate takes about 84 seconds
before commit overhead. Slower links remain recoverable through status/manual Resume, but their
near-cap UX is INCONCLUSIVE until measured. Do not assume an XHR
progress event means Microsoft has received the bytes. A continuous 10 MiB transfer at 1 Mbps
may exceed the old 60-second timeout. Every watchdog trip, including a slow final commit,
enters status reconciliation and never discards the intent. Clear timers on completion, abort,
unmount, and Request change. Validate thresholds and Safari progress-event cadence in simulated
slow-link tests and the real desktop gate; revise them from evidence, not an Admin setting.

**[VERIFIED via source, focused UI tests, and adversarial review]** The staff UI distinguishes
Graph-confirmed bytes from in-flight bytes and shows effective Mbps and an ETA only after a
meaningful uniquely confirmed sample attributable to this browser; status-reconciled
cross-device bytes advance the progress bar but do not inflate local rate. When the browser is offline,
wait up to two minutes for an `online` event without spending a Graph attempt, then offer manual
Resume if connectivity does not return. It labels waiting for a retry
as Reconnecting, intentional stop as Paused, and an expired session as needing a new upload.
The ETA becomes unknown while stalled or reconnecting and is recalculated after resume; the UI
must not show an uncommitted fragment as durable progress. A same-browser upload-intent lock
prevents a second tab from starting another PUT stream for that intent; a second device may still
race, so server reauthorization, Graph range/status reconciliation, and finalize fencing must
remain correct under two clients. Test both cases. Keep preauthenticated URLs and tokens out of
logs, measurements, and persisted plaintext.

Performance verification is a release gate with separate evidence levels:

1. **Offline before another live run — PASS at `bab770fe6`:** 84 focused proof tests cover 10 MiB alignment and final remainder, sequential
   ranges and final commit, slow continuous progress versus true stall, abort/pause, bounded
   5xx/network and 429 retries, ambiguous commit/416 status reconciliation, terminal 404,
   refreshed expiry after initial expiry, reselect fingerprint, duplicate-tab/device attempts,
   app-route `401`/`403`/`5xx`, cancelled retry timers, and stale Request UI state. Invert the
   former tests that expected an initial-expiry 410 and a 60-second XHR timeout. They exercise the
   XHR path, protected proof resume route, encrypted permit, and exact cleanup semantics rather
   than only a helper. The durable production intent remains a later Slice 4 implementation.
2. **Representative desktop benchmark — PASS 2026-09-25:** on a freshly approved disposable request/target and
   approved MP4, record exact byte count, chunk policy, start/commit timestamps, active transfer
   and wall time, retry/pause count, Graph expiry changes, progress-event cadence/watchdog trips,
   and effective decimal Mbps (`8 × committed bytes / elapsed seconds / 1,000,000`). For a
   comparable transport baseline, time the same file over sequential 10 MiB direct Graph PUTs
   from the same machine/network to a *second* owner-approved disposable SharePoint session,
   without the app UI; include that exact item and its cleanup in the live approval list.
   Compare the app's active rate with this single-stream Microsoft baseline. The old 320 KiB
   receipts have no timing; claim no measured
   improvement without a same-session A/B run. Extrapolate a 2,000,000,000-byte duration using
   the measured end-to-end rate and label it **ESTIMATE**, not near-cap PASS. Redact URLs/tokens.

   **[VERIFIED receipt]** Request `1003220` / GUID
   `4bfb6e40-678f-f111-8076-7ced8d3d15a6`, governed folder
   `akoya_request/1003220_4BFB6E40678FF11180767CED8D3D15A6/Post Site Visit Materials/`, and
   `Gallivan_Peleg Intro.mp4` (100,665,703 bytes; SHA-256
   `951bcdf7d07dd5653d6717f95ec3ec3e14019b001c4155af2cd7255618b3e33f`) were owner-approved.
   The direct-Graph Google Chrome baseline sent ten sequential ranges using a 10,485,760-byte
   default and a smaller final remainder. Every nonfinal response was `202` with the exact next
   offset; the final response was `201`. It ran from 09:02:38.368 to 09:08:16.366 PDT
   (337.997 seconds, 2.383 decimal Mbps), with zero retries or pauses. Graph read-back matched the
   full size. Its exact item `codex-baseline-56d2bed7-9d0e-403b-a865-ab22b8aecbcf.mp4` /
   `01G4GVMSZVL54J6EWVVRGZ7MMA2OSIJOFB` was protected when the first cleanup ETag became stale
   (`412`), then deleted with a freshly read ETag; Graph confirmed the stable item ID absent.

   The app run began at the logged begin request 09:11:12.912 PDT and reached the logged complete
   verification request at 09:16:13.045 PDT: 300.133 seconds wall time including one deliberate
   pause. Chrome requested pause during the first fragment, showed Pausing with only in-flight
   bytes, then reached Paused at exactly 10.0 MiB Graph-confirmed and 0 bytes in flight; Resume
   continued from that boundary. The UI showed separately advancing confirmed/in-flight bytes,
   decreasing ETA, and a final post-resume active rate of 3.22 decimal Mbps at 100%, ETA 0.
   Initial/refreshed displayed Graph expiries advanced from 09:26:19 to 09:26:43 and finally
   09:30:56 PDT. No reconnect, retry, or watchdog state surfaced. Microsoft and the application
   verified the committed file and the app minted the five-minute playback proof. The exact item
   `ebfd459a-0189-4684-8e91-b912edbd50a4.mp4` /
   `01G4GVMS7LYCLMCV7HI5GL427ZLUYRYSV2` was deleted using its fresh ETag; Graph confirmed it
   absent and the folder empty. The app's final active rate was about 35% above this immediately
   preceding baseline and its pause-inclusive wall rate was about 2.683 Mbps; interpret that only
   as no apparent app penalty in this run, not a repeatable acceleration. At 3.22 Mbps,
   2,000,000,000 bytes would take about 82.8 minutes of active transfer (**ESTIMATE**); the actual
   near-cap Safari Production row remains open.
3. **Actual near-cap desktop Production gate:** after the production-safe flow exists and the owner
   approves an exact human-created disposable Request, run a real MP4 close to the
   2,000,000,000-byte cap in macOS Safari, record
   elapsed time/effective Mbps and refreshed expiry, exercise an interruption/resume, the
   selected Production Watch shape (and a fallback only if shipped), >2-minute seeking, and
   Download size/hash integrity. Immediately before this run, on the same Mac and network, time
   a sequential 10 MiB direct-Graph single-stream baseline using a second owner-approved
   disposable Production session; approve and verify its exact-item cleanup separately. The
   near-cap app path must reach at least 60% of this same-session baseline. The near-cap
   engineering gate is *active upload time* (including retries/backoff but excluding the
   deliberate pause) no greater than the smaller of 45 minutes or 1.5× the same-session
   baseline-extrapolated 2 GB time plus five minutes. The item-2 Preview benchmark informs the
   chunk policy and measures app overhead there; it is not the Safari time baseline. Also record
   total staff wall time including the deliberate pause. An unstable baseline or
   unexplained throttling makes the result INCONCLUSIVE and requires a repeat or an owner
   decision before release. PASS also requires no involuntary restart,
   truthful recovery/UI states, exact committed size, and recorded Safari progress cadence.
   Because playback finalization binds the item to a Request Document and the first slice has no
   hard delete, the planned disposition is **retain the exact governed test item** with its
   human-created test Request and registry row. Record its identity, size, and retention decision in the
   run receipt; include that retention in the owner's preflight approval. Do not assume the
   unfinished Factory provides any teardown. Any later deletion requires a separately reviewed/approved
   teardown that removes every exact Ready or Superseded registry binding first, proves zero
   rows by generation key and drive/item, then ETag-deletes only the exact item and verifies
   exact-path absence. Never delete registry-bound bytes merely to close the test receipt.
   A 100 MB extrapolation alone cannot close the owner-retained near-cap row. Any live write,
   deployment, alias move, or deletion still requires the fresh approval and preflight in §12 and
   the §15 release order.

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
post-presentation schema readiness, use `withDalContext`, take a GUID request ID from the path,
enforce an exact body allowlist, and use the session's mapped Dynamics system-user actor. A
separate server-enforced `POST_PRESENTATION_MATERIALS_ACCESS` mode is `off` by default,
`test:<owner-approved human-created request GUID>` for the bounded Production gate, or `on` after release;
invalid values fail closed. The server validates and normalizes the configured GUID before a
case-insensitive comparison with the trusted path/request binding, never a client-supplied
override. Apply the mode to every producer/read/link
route, external token resolution after deriving the token's request, and the materials GET's
`canResume`/`canFinalize` descriptors; begin, resume, and finalize each recheck independently.
The Staff Deliberations projection is disabled outside the configured test Request, and the
new post-presentation member on the existing full briefing is gated by its verified token Request
without disabling legacy briefing members. In `test` mode, any other request returns
disabled/404 before a presentation write or Graph resolution. The
mode is a rollout guard, separate from the code-owned chunk-size policy. Record it in the
credential runbook and route/security tests. The unfinished Factory branch remains outside this
feature and supplies no test Request.

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

- `shared/utils/graph-browser-upload.js`: **[SOURCE-BUILT/OFFLINE-TESTED at `bab770fe6`;
  REPRESENTATIVE CHROME PREVIEW BENCHMARK PASSED 2026-09-25]** the shared browser byte transport
  consumed by the Preview harness and later production producer;
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

**Implementation status (2026-09-25): CHROME CORE PATH PASSED; EDGE UPLOAD/PLAYBACK/DOWNLOAD
REPORTED; SHARED PERFORMANCE TRANSPORT IMPLEMENTED AT `bab770fe6` AND REPRESENTATIVE CHROME
PREVIEW BENCHMARK PASSED; SLICE REMAINS OPEN.** [VERIFIED via focused unit/contract tests] the isolated
feature branch contains the Preview-only staff harness, browser-direct Graph upload session,
encrypted staff permit, five-minute encrypted-subject proof token, fail-closed resolver limiter,
302/one-shot playback comparison, scoped CSP, and exact-item cleanup. [VERIFIED via signed-in
Chrome] the current-hardening Preview paused and resumed the 96.0 MiB upload in the same page,
completed bounded finalize, visibly played and sought through the 302 resolver without extra
application resolution, played through one-shot Watch resolution, downloaded byte- and
SHA-256-identical content, and deleted the exact item to the recycle bin. Resolver counts stayed
bounded to explicit actions. The downloaded filename was the opaque physical MP4 name, not the
display name. [VERIFIED via branch source and focused tests, 2026-09-23] The Preview harness
now checks a bounded same-file fingerprint before reload/reselect resume, retains cleanup authority
on session expiry, can delete only the exact partial placeholder after a confirmed terminal
session outcome, can mint a fresh five-minute token from the exact committed item, and performs
one automatic playback re-resolution with position restore before offering manual Resume Watch.
The bounded Graph signature-range policy makes at most three total attempts, refreshing the
Microsoft URL for retryable network or 408/429/500/502/503/504 failures; a malformed/unbounded
response and other statuses fail immediately. These additions were deployed at `209cf18c3` but
their reload, expiry, and retry behavior has not been tested live in Edge/Safari. [VERIFIED via
local Jest/build/gates, 2026-09-23] 11 focused suites / 132 tests,
scoped ESLint, the Next.js build, 66/67 startup gate/self-test commands initially, then 67/67 after repairing and rerunning
the local Claude-memory symlink invariant, and 27/27 changed-surface gate commands passed.
The owner's Windows Edge colleague reported a 93.2 MiB upload, playback, and completed Download;
[VERIFIED via Microsoft Graph] its exact committed item was 97,777,999 bytes before deletion. No
Edge byte/hash comparison or detailed pause, resolver, seek, or range evidence was recorded.
[VERIFIED via signed-in desktop Chrome, owner UI report, and Graph on 2026-09-24]
Reload/reselect and proof-token expiry recovery passed. The upload-session expiry cell proved
the local initial-timestamp refusal and cancellation, not Graph-confirmed expiry; it needs a
corrective retest after §7.2.1. Production desktop macOS Safari, long-duration seeking, and
near-cap throughput remain open, so Slice 0 is not yet complete.

[VERIFIED via commit `bab770fe6`, 84 focused proof tests, scoped ESLint, type checking, and a
local webpack production build] the Preview harness consumes the shared 10 MiB browser transport
described in §7.2.1, and its status service no longer refuses solely on the initial Graph expiry.
[VERIFIED via the 2026-09-25 receipt in §7.2.1] deployment
`dpl_FX7HvZZWTvvVchDytB3rRqCtEYoX` passed the approved representative Chrome benchmark and exact
cleanup on Request `1003220`; the independent direct-Graph baseline item and app item are both
Graph-confirmed absent, and the governed folder is empty. The shared alias was restored to exact
Ready Factory deployment `dpl_8hUghEjVqCG1CHK7AjRJH8NXPvjr`, and the three temporary
`codex/feature-request` Preview settings were removed. The default Turbopack build remains
incompatible with this worktree's external `node_modules` symlink; the webpack build passed with
the existing dynamic-dependency warnings.

This is a disposable transport spike, not the production feature. It may add a Preview-only,
authenticated proof route and minimal harness, but it creates no durable application schema and is
removed or converted into production code after the decision. Use an owner-sanctioned disposable
request, the server-chosen proof folder in that request's configured governed SharePoint site, and
a real Zoom-produced MP4 larger than 50 MB. Record the actual Dataverse and SharePoint targets
before each run; Preview is an application-deployment boundary, not automatic data-target isolation.
Never log the token, upload URL, download URL, or passcode.

The first-slice staff browser matrix covers desktop Chrome, desktop Edge, and macOS Safari.
Chrome passed the core, reload/reselect, and proof-token recovery rows; the owner accepted the reported Edge upload,
playback, and Download actions without a further Edge run. Desktop macOS Safari remains the
unpassed browser gate; a resolver shape that passes only Chromium does not complete Slice 0.
iPadOS is outside the release matrix by owner decision.

The proof harness fails closed unless `classifyDeployment() === 'preview'`, its mint route requires
an authenticated Meeting Tracker user, and its short-lived JWT uses a distinct
`presentation-media-proof` audience. Every proof route denies Production even if a configuration
value is wrong. Remove or convert the harness before Slice 2 now that the timed benchmark is complete, carrying only
the reviewed shared browser transport into the production routes; a release gate asserts that
the proof audience/routes cannot ship enabled.

#### Remaining Slice 0 browser matrix (updated 2026-09-25)

Each live run needs a fresh owner-approved request and SharePoint target, each upload/write and
exact cleanup, an immutable Preview deployment, and any change to the shared Preview alias.
The owner's 2026-09-24 override permits needed Dataverse reads without another per-read approval.
A performance benchmark requires a second explicitly approved Graph session/item for the direct
single-stream baseline; the 2026-09-25 run received that approval and verified its exact cleanup.
Coordinate
any shared-alias move with the Factory-owning agent as well as the owner. Request
`1003222` was authorized for the completed 2026-09-22 run and separately for one Edge upload on
2026-09-23; both authorizations are spent. The owner corrected that second candidate request to
`1003222`. [VERIFIED
2026-09-23 via one approved, interlock-checked Production Dataverse lookup of three GETs]
the request GUID is `e43ae6ea-698f-f111-8076-6045bd018a07`, and its resolved governed
library/folder is `akoya_request/1003222_E43AE6EA698FF11180766045BD018A07`.
The location rows did not include the SharePoint site URL. The owner supplied a SharePoint link
whose URL identifies `https://appriver3651007194.sharepoint.com/sites/akoyaGO` and the same
governed library/folder; the page contents were not read. For the next approved run, new uploads
create/use `Post Site Visit Materials` directly under that request folder, with the disposable
MP4 directly inside. Existing sealed permits retain their original paths for resume/cleanup.
An earlier approved single GET for the mistakenly supplied `1003332` returned zero exact rows;
no document-location reads followed that result. The owner selected the MP4 for the completed
Edge run; any later file and upload need fresh approval. The Windows Edge colleague has Meeting
Tracker access and had the MP4 on that PC; give them the staff harness link after any newly
approved deployment, since the playback proof link lasts only five minutes. Re-inspect the alias target and
branch-scoped Preview variable names before an alias change, then restore and re-inspect the exact
prior target. Do not clear a permit or delete an item on an uncertain cleanup response; ask the
owner before deleting each exact disposable item.

**Authenticated Preview URI preflight and rollback (2026-09-23).** [VERIFIED via read-only Entra app query]
`https://wmkfresearchapps-preview.vercel.app/api/auth/callback/azure-ad` is already a registered
Web redirect URI; no Entra URI edit is needed for this alias. [VERIFIED via read-only Vercel
inspection] the shared alias currently resolves to Ready Test Request Factory deployment
`dpl_8hUghEjVqCG1CHK7AjRJH8NXPvjr`, and `codex/feature-request` then had no branch-scoped Preview
variables. [VERIFIED via Vercel alias and env APIs after the Edge run] that exact Factory target is
restored, the proof-window user access grant is absent, the three temporary presentation branch
variables are removed, and the Factory branch's four scoped variable names remain. Follow
`docs/AUTHENTICATION_SETUP.md` Step 2.4 before another signed-in proof: with separate
owner approval, set **Preview scoped only to `codex/feature-request`** `NEXTAUTH_URL` to the exact
origin `https://wmkfresearchapps-preview.vercel.app` (no trailing slash), and set the approved
SharePoint site target for this branch. For the 2026-09-24 Chrome pass, the owner explicitly authorized Dataverse reads when needed and
authorized the agent to correct `DATAVERSE_ALLOW_PROD_READS=yes` via Vercel CLI in Preview scope
only for `codex/feature-request`; consult the owner before writes. This decision supersedes the
older per-read and owner-only-setting instructions for this pass.
Create a new immutable Preview deployment after those settings exist, attest its branch, commit,
ID, and Preview class, and ask separately before temporarily moving the shared alias. Use the
alias for browser traffic; an immutable-host signed-in POST has a different Origin while the
override is active. Prove a protected GET and an approved validation-only POST through the alias
before the upload: send `{}` to the staff proof POST route and expect its exact-body `400`
after the auth check, before any proof service action. After the run, restore and re-inspect the
exact prior alias target, remove only
the approved presentation-branch settings, and redeploy the active branch if needed so future
deployments use normal Preview `VERCEL_URL` derivation. Do not edit the Factory branch settings.

**Owner decisions (2026-09-23 Session 536; updated 2026-09-24 and 2026-09-25):** Chrome and Edge are accepted as working; no further Edge runs are planned. The 2026-09-23 decision initially deferred macOS and iPadOS Safari until the Test Request Factory could create a Production test request. The owner removed iPadOS support from this staff feature on 2026-09-24, so iPadOS upload, playback, Files-app integrity, and backgrounding/memory rows no longer gate Slice 0 or release. On 2026-09-25 the owner clarified that the Factory is unfinished and must not block this work: the remaining Production Safari run uses an individually approved human-created disposable Request. It covers upload, the selected Production Watch shape with long seeking, and Download integrity. The owner kept one real near-cap upload to test the proposed 2 GB cap on desktop; [PLANNED] combine it with that macOS Safari run. Agent-run Chrome passed reload/reselect and proof-token expiry recovery; the upload-session expiry UI refusal and cleanup occurred, but Graph-confirmed expiry was not established (see §7.2.1). The final upload's Finish saving and Cleanup UI receipts were supplied by the owner after browser auto-review blocked agent access. No row waits on Edge.

**Chrome recovery pass preflight (2026-09-24 PT).** [VERIFIED via signed-in Production
Grant Reporting read and the document picker] the owner-selected test copy Request `1003220`
has GUID `4bfb6e40-678f-f111-8076-7ced8d3d15a6` and governed target
`https://appriver3651007194.sharepoint.com/sites/akoyaGO`, library/folder
`akoya_request/1003220_4BFB6E40678FF11180767CED8D3D15A6/Post Site Visit Materials/`.
[VERIFIED via local `stat` and SHA-256] the owner-selected `Gallivan_Peleg Intro.mp4` is
100,665,703 bytes with SHA-256
`951bcdf7d07dd5653d6717f95ec3ec3e14019b001c4155af2cd7255618b3e33f`.
[VERIFIED via Vercel CLI and dashboard] Preview variables `NEXTAUTH_URL`,
`SHAREPOINT_SITE_URL`, and `DATAVERSE_ALLOW_PROD_READS` are scoped only to
`codex/feature-request`; the Factory branch's four scoped variable names remain.
The first Ready CLI Preview deployment, `dpl_6gN8m1kFsLCQBVkojEAEarkVyGdB`, accepted a
signed-in protected GET through the temporarily moved alias but returned origin-guard `403`
for validation-only `{}` POST, before any Graph session or SharePoint write. The alias was
immediately restored to its exact Ready Factory target
`dpl_8hUghEjVqCG1CHK7AjRJH8NXPvjr`. [VERIFIED via Vercel dashboard] corrective
Git-linked Preview deployment `dpl_GWuSCry4wQGwNmdJpDX7XSBeRgwc` is Ready from branch
`codex/feature-request`, commit `5c5fbcb0bc8265b10de003a9fd1bc3f3e81b725f`.
[VERIFIED via CLI and signed-in desktop Chrome] after the owner approved the exact new
target, the shared alias moved to `dpl_GWuSCry4wQGwNmdJpDX7XSBeRgwc`, the protected proof
page loaded, and validation-only `{}` POST returned the expected `400` before upload. The
owner then approved up to three bounded uploads of the selected MP4 to Request `1003220`.
The first Graph session paused at 0.9 MiB, survived page reload and same-file reselection,
resumed with direct Microsoft `202` chunk responses, and committed all 100,665,703 bytes.
Finish saving minted a five-minute token; the 302 Watch played the 67.33-second video without
media error. After the token expired at 8:31:43 PM PDT, reloading the old link returned
`expired`; Finish saving minted a new link from the same committed item. Its Watch played and
accepted End/Home seeks with one application resolver action. [VERIFIED via Graph] the item was
`b9bf5fd4-3e89-4357-ba53-8b44cb759209.mp4`, ID
`01G4GVMS3EB2O3Z4YXRZDIKF77SV5YM5XB`, size 100,665,703 bytes. With separate exact-item
owner approval, `Cleanup exact item` returned `item_deleted`; exact-path GET returned 404
and the folder listing was empty. No bearer URL or token was saved in this receipt.

[VERIFIED via Chrome and Graph] the second Graph session paused at 0.6 MiB, with initial
expiry 8:49:47 PM PDT on 2026-09-24; the governed folder listing showed no committed item.
After that *initial sealed timestamp*, Resume displayed the specific `presentation_media_proof_session_expired`
message while keeping the saved permit. The Graph folder listing was still empty. A fresh
signed-in GET through the remapped alias loaded the protected proof page. The owner approved
expired-session cleanup; [VERIFIED via Chrome] the app returned `session_cancelled` and cleared
the permit, and [VERIFIED via Graph] the folder remained empty. The alias was restored and
re-inspected at Ready Factory deployment `dpl_8hUghEjVqCG1CHK7AjRJH8NXPvjr` while awaiting
approval, then remapped to the approved presentation deployment. A third fresh session uploaded
the same 100,665,703-byte MP4. [VERIFIED via Graph] exact item
`75649f0c-dfae-4aa7-9887-980fa9efc4e1.mp4`, ID `01G4GVMSZEWMUR6P2R2RDIHYOWMYJ5ET3H`,
had full size and ETag `"{1F29B324-513F-46D4-83E1-D66613D24F67},3"`. Automatic approval
review blocked further agent browser inspection as potentially disruptive to the tab's permit.
[REPORTED by owner] Finish saving displayed “Playback proof created,” and the owner-authorized
Cleanup moved the exact third item to the SharePoint recycle bin.
[VERIFIED via Graph] its exact path returned not found and the governed folder listing was empty.
[VERIFIED via Vercel CLI] the shared alias was restored and re-inspected at the exact Ready
Factory deployment `dpl_8hUghEjVqCG1CHK7AjRJH8NXPvjr`; the three temporary variables scoped
only to `codex/feature-request` were removed, and the Factory branch's four scoped variable
names remained. This is PARTIAL evidence for upload-session expiry recovery: the old app refused
at its initial timestamp, while Graph's accepted cancellation did not prove the live session
had expired. Automatic approval review
blocked agent browser inspection after the fresh Graph commit, so the owner supplied the final
Finish saving and Cleanup UI receipts; Graph independently verified the committed size and
exact deletion. No bearer URL or token was saved.

| Browser | Scenario | Recorded or pending evidence | Runner |
|---|---|---|---|
| Desktop Chrome | Historical core path | 2026-09-22 receipt above: 100,665,703 bytes, 302 and one-shot Watch, seek, size/SHA-256 match, exact cleanup. | Agent (historical PASS) |
| Desktop Chrome | Reload and same-file reselect Resume | 2026-09-24 PASS: paused at 0.9 MiB, reloaded, reselected the same file, resumed direct Microsoft `202` chunks, committed 100,665,703 bytes, finalized, and cleaned the exact item. | Agent |
| Desktop Chrome | Upload-session expiry and recovery | PARTIAL: after the sealed initial expiry, Resume refused and retained its permit; approved Cleanup returned `session_cancelled` with no item. This proves the old local refusal/cleanup path, but a 2xx Graph cancellation means Graph-confirmed expiry was not observed. Commit `bab770fe6` corrected the initial-expiry predicate offline; retest live status/terminal recovery before changing this row. The third fresh session did commit 100,665,703 bytes and was cleaned exactly. | Agent, with owner final UI clicks after browser auto-review block |
| Desktop Chrome | Five-minute proof-token expiry recovery | 2026-09-24 PASS: old link refused as `expired` after reload; fresh link from the same item played and accepted End/Home seeks with resolver count one. | Agent |
| Desktop Edge | 2026-09-23 upload, playback, Download | Colleague reported these actions for 97,777,999 bytes; Graph confirmed the item. Remaining detailed Edge trace is not a Slice 0 blocker under Session 536. | Historical owner colleague; no new Edge run |
| macOS Safari | Upload, selected Production Watch shape with long seeking, Download | Deferred to Production on an owner-approved human-created disposable Request; record redacted statuses/ranges and source/download size and SHA-256. Test a fallback Watch shape only if it ships. | Owner by hand |
| macOS Safari desktop | One real near-cap MP4 upload | Deferred to the same Production human-created test-Request run; record exact size, refreshed Graph expiry, throughput, seeking, Download integrity, and exact-item disposition. Delete bytes only after approved teardown proves no registry binding. | Owner by hand |

**Slice 0 cell status (2026-09-24).** PASS means the stated evidence was recorded;
it does not close a broader browser row. No current cell has a recorded unresolved FAIL.
The earlier Chrome CSP and live-placeholder failures were corrected by `35b9990bf` and
`cdc7574e1`, respectively.

| Browser or scenario | Status | Evidence and limit |
|---|---|---|
| Chrome core upload, same-page pause/resume, finalize, both Watch modes, seek, Download | PASS | [VERIFIED via signed-in 2026-09-22 Chrome receipt] 100,665,703-byte MP4, 302 and one-shot Watch, 67.3-second seek, equal source/download SHA-256, exact cleanup; current-hardening fix `cdc7574e1`. |
| Windows Edge upload, playback, Download | PASS for these reported actions; full Edge row NOT RUN | [VERIFIED via owner report] colleague reported 93.2 MB upload, playback, and Download. [VERIFIED via Graph] committed item was 97,777,999 bytes. No pause/reload, resolver trace, seek, or download hash/size comparison was recorded. |
| macOS Safari full path | DEFERRED | [UPDATED by owner 2026-09-25] Production run on an owner-approved human-created disposable Request remains for upload, selected Watch shape with long seeking, Download, and integrity evidence; the unfinished Factory is not a prerequisite. |
| iPadOS Safari full path | OUT OF SCOPE | [VERIFIED via 2026-09-24 owner decision] Staff will not use iPadOS for this work; its upload, playback, Files-app, and backgrounding checks are removed from the acceptance matrix. |
| Reload and same-file reselect resume | PASS | [VERIFIED via signed-in 2026-09-24 Chrome] 0.9 MiB pause, reload, reselect, direct Microsoft `202` chunks, 100,665,703-byte commit/finalize, exact ETag-guarded cleanup with Graph 404 and empty folder. |
| Upload-session expiry recovery | PARTIAL; Graph-confirmed expiry NOT VERIFIED | [VERIFIED via Chrome] after the *initial sealed* expiry at 8:49:47 PM PDT, Resume refused and retained the permit; approved Cleanup returned `session_cancelled` (Graph accepted cancellation, so the session was not proved expired). [VERIFIED via Graph] a third fresh session committed the full 100,665,703-byte MP4 at its exact path. [REPORTED by owner] Finish saving created the playback proof and Cleanup moved that exact item to the recycle bin. [VERIFIED via Graph] exact-path not found and folder empty. [VERIFIED offline at `bab770fe6`] the false terminal predicate is corrected; live expiry recovery still requires a fresh approval and retest. |
| Five-minute proof-token expiry recovery | PASS | [VERIFIED via signed-in 2026-09-24 Chrome] expired old link refused after reload; Finish saving minted a fresh link from the same committed item; Watch played and End/Home seeks caused no additional resolver action. |
| Long-duration seeking | DEFERRED | [VERIFIED via Chrome receipt] current recording is only 67.33 seconds; desktop macOS Safari Production run still needs a >2-minute recording and ten seeks. |
| Upload and throughput near 2,000,000,000 bytes | DEFERRED | [VERIFIED via 2026-09-24 owner decision; fixture corrected 2026-09-25] one near-cap desktop Production upload remains to test the proposed 2 GB cap. [PLANNED] Run it with the macOS Safari check on the exact owner-approved human-created disposable Request. |
| Production-sized chunk policy and measured throughput | PASS FOR REPRESENTATIVE CHROME PREVIEW BENCHMARK | [VERIFIED via `bab770fe6`, signed-in Chrome, deployment logs, and Graph on 2026-09-25] the 100,665,703-byte app run used the shared code-owned 10 MiB transport, paused at a 10.0 MiB Graph-confirmed boundary, resumed, finished at a displayed 3.22 Mbps active rate, and took 300.133 seconds begin-to-verification wall time including the pause. The separate same-machine/network direct-Graph Chrome baseline took 337.997 seconds at 2.383 Mbps. Both exact items are Graph-confirmed absent and the folder is empty. This is one comparative sample, not a general speed claim, and does not substitute for the near-cap Production gate. |

**Owner actions:** approve each new disposable request and governed SharePoint target, each
Preview deployment, each temporary shared-alias change, each upload, and each exact cleanup
separately. The owner's 2026-09-24 override permits needed Dataverse reads; consult the owner
before writes. The owner runs desktop macOS Safari by hand in the deferred Production run on an
approved human-created test Request. No Windows Edge follow-up is planned.
Before any alias move, re-inspect its current target and presentation/Factory branch-scoped
Preview variable names; restore and re-inspect afterward. The 2026-09-23 Edge upload approval
and cleanup authorization are spent.

**Historical Preview click sequence, superseded by the Session 536 Production decision.**
The numbered steps below describe the Preview harness and are not instructions for the deferred
Safari run. [VERIFIED via branch source and Session 536 owner decision] The harness is Preview-only;
the Production Safari run needs a Production-safe presentation flow and an owner-approved
human-created disposable Request before the owner can exercise upload, the selected Watch shape,
long seeking, Download, and the
near-cap desktop upload. Define its exact disposable target and cleanup receipts at that time.

**Owner click sequence for macOS Safari (historical Preview procedure).**
Use a newly approved disposable item.
[VERIFIED via Applications and Spotlight, 2026-09-23] Edge is not installed on the agent's Mac.
The owner chose a colleague's Windows Edge device and approved one disposable Edge upload to
the corrected Request `1003222` target; its upload, playback, and Download were reported and its
exact item was deleted after owner approval.

**Owner Edge sequence (Windows; historical, no further Edge run planned).** In Edge, open
**⋯ → Help and feedback → About Microsoft Edge** and record its version. Press **F12**, open
**Network**, enable **Preserve log**, and follow steps
1, 2, 4, 5, and 6 below with the same approved target and a fresh disposable item. For step 3,
right-click
**Open proof page** and select **Copy link**; open Edge's **⋯ → New InPrivate window**,
paste the link, then perform both Watch modes and seeks as described. In Edge DevTools,
record only redacted method/status/origin/range/byte-count facts. Do not share a Network archive
that contains bearer URLs. In PowerShell, run
`(Get-Item -LiteralPath 'C:\path\to\source.mp4').Length` and
`(Get-FileHash -Algorithm SHA256 -LiteralPath 'C:\path\to\source.mp4').Hash`, then repeat with
the downloaded file's actual path; record both byte counts and hashes, not the file bytes.

1. Open the owner-approved stable Preview alias after its exact target has been attested and sign
   in to Meeting Tracker. Open
   `/meeting-tracker/presentation-media-proof`. In macOS Safari Web Inspector, enable Preserve
   Log and record only redacted method/status/origin/range/byte-count
   facts. Do not capture bearer tokens, upload URLs, or media bytes. Record browser version,
   request GUID, approved SharePoint site, source MP4 byte size, duration, and source SHA-256.
2. Enter that request GUID, choose the approved MP4 (>50 MiB), and click **Begin and upload**.
   After progress advances, click **Pause after chunk**. Record the paused byte count and the
   Microsoft `202`/`nextExpectedRanges` evidence. Reload the same tab, select the same file in
   **Zoom MP4**, and click **Resume**. Record the resumed starting range and final byte count.
   Record any file-mismatch refusal if encountered; the changed-edge-byte case is pinned by offline tests.
3. Click **Finish saving**. Control-click **Open proof page**, choose **Copy Link**, open
   **File → New Private Window**, and paste the link before the five-minute token expiry.
   With **302 redirect** selected, click
   **Watch**, play at least two minutes, seek to ten
   positions including near the end, pause/resume, and record 302 → Microsoft 206 plus the page's
   resolver count. Select **one-shot URL**, click **Watch** again, and repeat a forward/back seek.
   If the proof token expires between modes, return to the staff harness, click **Finish saving**
   to mint a fresh link for the same committed item, and copy that link into a new Private tab.
4. Click **Download** once for each delivery shape if the browser allows it. Record the final
   downloaded size and SHA-256. They must equal the source. Record the filename Microsoft supplies and any 429 or
   range-fetch error. If a media error occurs before token expiry, record whether the single
   automatic re-resolution restores the position; after another failure use **Resume Watch** once.
5. After five minutes, reload the old proof page and record its refusal. Return to the staff
   harness and click **Finish saving** again, then open the fresh link and confirm Watch. For a
   separate expiry run, pause upload and wait until the last observed Graph session expiry before
   clicking **Resume**; record the live status result and retained permit. The old initial-timestamp
   refusal is not proof that Graph expired. Do not click **Cleanup exact item**
   until the owner has confirmed deletion of that exact disposable item/session. Then begin a new
   upload and record its result.
6. Send back a pass/fail row per scenario with browser/version, file size/duration, source and
   downloaded SHA-256, upload start/end and Graph expiry times, ten seek timestamps, statuses and
   resolver counts, any error wording, and exact cleanup outcome. Redact all secret URLs and tokens.

#### Upload procedure

1. From the deployed Preview origin, request a Graph upload session for a server-chosen disposable
   path.
2. For the historical 2026-09-22/24 proof, attempt the MP4 from the browser in sequential
   320 KiB chunks (that proof's deployed setting after latency probes); if the first response succeeds, exercise at least one
   paused/resumed chunk sequence using `nextExpectedRanges`, then reload,
   reselect the same file, verify its resume fingerprint, and resume again.
3. Capture a redacted browser network trace and server request-size metric proving the MP4 bytes
   travel browser → Microsoft, not browser → application → Microsoft.
4. Resolve the committed item by the exact server-owned path, verify its size, then delete that
   exact disposable item after the playback/download proof.
5. Record Graph's expiry after each successful fragment and on authorized status reads, plus
   start/commit time and effective throughput. This historical procedure did not collect timing,
   so its old receipt cannot support a 2 GB speed extrapolation. The current §7.2.1 benchmark
   and near-cap gate supersede this step. A single initial expiry is not a whole-upload deadline.

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
- exact-item cleanup succeeds for a Preview-harness disposable upload; a registry-bound
  Production gate or release-smoke item instead records its exact identity and the owner-approved
  retention decision (§7.2.1 item 3).

If the 302 passes, keep it. If only the one-shot URL response passes, adopt that shape and state
the short-lived URL exposure explicitly in the security contract. If direct upload or both media
resolution shapes fail, stop before durable schema/full UI work and return to the owner with the
redacted trace and a bounded alternative; do not silently route complete MP4 bytes through a
Function.

**Execution receipt (2026-09-22):** after the scoped CSP fix, the shared OAuth alias was temporarily
moved to immutable Preview deployment `dpl_4zAYDFC4YDntkHFQsWBFxeTfTJD2`. Chrome uploaded the
100,665,703-byte MP4, finalized it, visibly played it through the 302 resolver, resolved the
one-shot Watch path, and downloaded a byte-complete local copy. Two transient Microsoft range-fetch failures occurred while refreshing the
five-minute proof; a later retry succeeded. The Preview Graph signature-range helper now has a three-attempt
transient policy verified offline; its live behavior and the production finalization policy remain
unverified. With explicit user confirmation, cleanup deleted the exact committed SharePoint
item through Graph, moving it to the canonical site's recycle bin rather than permanently purging
it. The alias was then restored and re-inspected at its prior exact target
`dpl_8hUghEjVqCG1CHK7AjRJH8NXPvjr`. The proof deployment used one-off runtime settings; no
branch-scoped Preview settings were created. The request lookup was a read against Production
Dataverse, while the disposable file write and deletion occurred in the canonical akoyaGO
SharePoint site. The shared `Artifacts/Presentation Media Proof` folder remains as the reusable
proof container, and the deleted item remains governed by the site's recycle-bin retention policy.

**Current-hardening execution receipt (2026-09-22):** immutable Preview deployment
`dpl_9jDj7Xu6euv9e1CH3FrBKtHbdrTu` at source commit `5d32dc682` paused after 10.9 MiB, but Resume
failed because Graph exposed a smaller same-drive, same-name path item while the upload session was
still live and status misclassified that placeholder as a committed-file mismatch. Confirmed
cleanup cancelled that session and verified that no committed item existed. Commit `cdc7574e1`
made status accept only that narrow placeholder case while a matching upload session remains live;
stable identity drift, negative/oversized content, and full-size mismatch continue to fail closed,
and finalize/cleanup still require the exact full-size committed item.

The shared OAuth alias was then temporarily moved to immutable Preview deployment
`dpl_2oyHRnNLwuXvuNPK3MLqcKnwNyop`. Signed-in Chrome paused the 100,665,703-byte upload at 0.6 MiB,
resumed it in the same page, and reached 100%. Finalize succeeded. The 302 Watch path played and
an End-key seek reached 67.3 seconds without increasing its single application resolver hit; the
one-shot Watch path played from the canonical SharePoint tenant with exactly one additional
resolver hit. Download returned exactly 100,665,703 bytes, and source/download SHA-256 both equaled
`951bcdf7d07dd5653d6717f95ec3ec3e14019b001c4155af2cd7255618b3e33f`. With explicit user
confirmation, cleanup deleted the exact stable DriveItem through Graph, moving it to the canonical
site's recycle bin. The alias was restored and re-inspected at its prior exact target
`dpl_8hUghEjVqCG1CHK7AjRJH8NXPvjr`. The run used one-off runtime settings; no
`codex/feature-request` Preview environment settings were created. It read owner-authorized Request
`1003222` from Production Dataverse and wrote only the disposable proof item to the canonical
SharePoint site. This proves same-page pause/resume on current hardening; reload/reselect resume is
a separate open requirement.

**Windows Edge partial execution and cleanup receipt (2026-09-23):** [VERIFIED via Vercel deployment
inspection] the owner-triggered immutable Preview deployment
`dpl_4R14xsX2jYHHgHYSzvuRjUDQUhM1` was Ready from `codex/feature-request` commit `209cf18c3`.
The owner approved the one disposable upload to Request `1003222` in the governed
`akoya_request/1003222_E43AE6EA698FF11180766045BD018A07/Post Site Visit Materials/`
folder on the akoyaGO site, the Production Dataverse reads for this run, the branch-scoped
Preview settings, and the temporary alias move. [VERIFIED via Vercel inspection] the three
presentation-only Preview variables were scoped to `codex/feature-request` before deployment;
the owner set `DATAVERSE_ALLOW_PROD_READS` and the agent did not set it. [REPORTED by owner from
the Windows Edge colleague] the page showed 93.2 MB, the file uploaded, played, and Download
completed. The colleague did not record pause/reload/reselect, expiry, both Watch shapes, seek
positions, direct network statuses, or a downloaded byte/SHA-256 comparison; those cells remain
open. [VERIFIED via Microsoft Graph metadata] the child folder contained exactly one disposable
proof MP4, `b5c53a06-52e3-447e-a0df-38c45c8e7e05.mp4`, DriveItem
`01G4GVMS622FX7MM5RIRGYL4EXWARAED2P`, 97,777,999 bytes. After the owner's cleanup request,
the agent matched its exact drive, parent, item ID, name, size, creation time, and ETag, then
deleted it with `If-Match`: Graph returned 204, exact item GET returned 404, and the child-folder
listing contained zero items. The disposable MP4 is in SharePoint's recycle bin; the governed
request and child folders were retained. [VERIFIED via Vercel alias API] the proof-window access
record was a single user-scoped grant, not a shareable link; denial by its exact user ID removed
the grant. The shared alias was then restored and re-inspected at its exact prior Factory
deployment `dpl_8hUghEjVqCG1CHK7AjRJH8NXPvjr`, with zero protection-bypass records.
[VERIFIED via Vercel branch environment listing] the three temporary presentation-scoped
`DATAVERSE_ALLOW_PROD_READS`, `SHAREPOINT_SITE_URL`, and `NEXTAUTH_URL` records were removed;
the Factory branch's four scoped variables remain. The immutable proof deployment remains a
historical Preview artifact with its deployment-time environment snapshot; another live run
requires fresh, separate authorization and configuration.

**Final live-state re-inspection for handoff:** [VERIFIED via Graph on 2026-09-23] the
`Post Site Visit Materials` and retained `Artifacts/Presentation Media Proof` folders each
have zero children, and the exact Edge DriveItem returns 404. [VERIFIED via the 2026-09-22
cleanup receipts] the first Chrome and current-hardening Chrome committed items were deleted
to SharePoint's recycle bin; the intervening 10.9 MiB hardening session was cancelled with no
committed item. [ASSUMED] their short-lived upload-session URLs are no longer usable; no URL
was retained for a fresh session-status GET, so current session state was not re-probed.
[VERIFIED via Vercel alias and environment APIs] the shared alias remains on its pre-run
Factory target `dpl_8hUghEjVqCG1CHK7AjRJH8NXPvjr` with zero protection-bypass records;
`NEXTAUTH_URL`, `SHAREPOINT_SITE_URL`, and `DATAVERSE_ALLOW_PROD_READS` are absent from the
presentation branch's Preview scope, and the Factory branch's four scoped records remain.

Also verify tenant Safe Attachments and `DisallowInfectedFileDownload` posture. A security owner
may supply sanctioned evidence that the Graph malware facet becomes non-null for a flagged item;
without that evidence, keep the facet check as defense in depth and do not claim it proves a
synchronous scan. The first-slice size cap is resolved at 2,000,000,000 bytes.

Also send a sanctioned 25 MB clean transcript through the configured scanner in Preview and
record success; if the scanner cannot accept the proposed cap, reduce the cap before Slice 3.

Run this harness only from the Preview application deployment and only with an owner-sanctioned
disposable request. Before every run, explicitly record the configured Dataverse and SharePoint
targets and obtain authorization appropriate to those targets. Do not describe Preview as a
sandbox-data guarantee: the owner-authorized 2026-09-22 proof read Request `1003222` from Production
Dataverse and wrote the disposable item to the canonical SharePoint site. Preview-harness cleanup must delete the
exact committed item to the recycle bin or confirm that the upload session is cancelled, gone, or
expired with no exact item; an uncertain transport retains the encrypted permit for retry.

### Slice 1 — Additive schema and readiness — SOURCE-BUILT 2026-09-25; NOT APPLIED

**[VERIFIED via source, focused tests, preflight self-test, and migration/fresh-install parity.]**
Wave 30, migration 054/V55, readiness/access parsing, compatibility-gated Request Document
projection, Atlas, and runbook updates are built on `codex/feature-request`. No migration or
Dataverse wave was applied, no environment variable was set, and no route/producer was enabled.

- Dataverse wave adds `wmkf_ExternalUrl` and `wmkf_SlotVersion` to Request Document plus exact
  preflight.
- Request Document adapter adds readiness-gated `POST_PRESENTATION_SELECT_FIELDS`; the base and
  legacy selects remain safe while the wave is absent.
- One Postgres migration adds presentation links, upload intents, slot leases, and the
  `post_presentation_transcript` staging-scope constraint; it enumerates all five live scopes in
  migration and fresh-install source and updates the manifest/full-list parity test.
- Add `POST_PRESENTATION_MATERIALS_SCHEMA_READY`, exact-on only after both stores are applied and
  preflighted. Invalid values fail closed; unset is off.
- Add `POST_PRESENTATION_MATERIALS_ACCESS` with `off`/`test:<GUID>`/`on` semantics above, defaulting
  to off. Slice 1 tests the parser and trusted GUID comparison; later slices must test every
  presentation entry point. Its test GUID comes from an owner-approved human-created disposable
  Request at run time, not from the unfinished Factory and never hardcoded in source. Schema
  readiness alone enables no producer.
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

- Wire the §7.2.1 browser-direct Graph transport module already built and timed with the Preview
  harness in Slice 0 into the durable producer. It accepts a status/reauthorization adapter:
  the Preview proof and Production intent routes share byte/range/retry code but not authorization
  state. Any later change to that shared module requires a renewed benchmark or explicit coverage
  in the Production gate. The deferred Production macOS Safari, long-seek, and desktop near-cap cells remain
  in the Slice 0 matrix but block **general release**, not implementation. Keep Production access
  in `off`/`test:<GUID>` until the gate passes; iPadOS has no acceptance gate.
- If the SharePoint-first-party fallback becomes necessary, replace the upload-session intent
  with a bounded attach intent: server-owned request/folder, creating actor, expected filename/size,
  exact-folder enumeration, independently authorized attach, and stable drive/item validation.
- Preserve progress/cancel UI only for operations the chosen transport can truthfully observe;
  keep lease-fenced finalize, bounded range signature check, candidate recovery, and reconciliation
  for the selected SharePoint item.
- Add exact orphan/expiry maintenance. In `off`/`test:<GUID>` it only inspects and alerts; after
  the routine cleanup policy is approved and access is `on`, deletion uses only persisted exact
  candidate identity after a zero-row registry proof. Never delete by prefix or inferred path,
  including when an upload completed before the browser abandoned finalize.
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
- Signed-in Meeting Tracker smoke with one Zoom link, one transcript, and one owner-approved,
  registry-bound retained test MP4 (retention per §15 step 6).
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
- schema readiness alone exposes no presentation producer: access `off`, malformed, and
  `test:<other GUID>` refuse begin/resume/finalize/link and suppress `canResume`/`canFinalize`;
  the existing briefing still serves legacy members while its new presentation member is gated;
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

- client chunks use the code-owned 10 MiB default (a 320 KiB multiple), remain sequential, and
  resume from Graph-confirmed `nextExpectedRanges`, including reload/reselect with a matching
  fingerprint; a mismatched file refuses, while expiry is confirmed from live Graph status rather
  than the initial timestamp;
- slow continuous fragments avoid a fixed 60-second wall timeout; a true stall enters bounded,
  status-aware retry. Network/5xx and 429, ambiguous final commit, duplicate-range 416,
  refreshed expiry, and terminal 404 are covered with positive fixtures;
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
  intent-finalization failure and deletes only a proven zero-row exact candidate when the
  owner-approved `on` cleanup policy is active; `off`/`test:<GUID>` only inspect/record/alert and
  preserve the encrypted session URL, even after the review-after timestamp.

### UI and browser

- source chooser, replace confirmation, distinct loaded-empty/unavailable states, upload progress;
- presentation-material success remains visible when recipient/logistics loading fails;
- Copy link success/failure/manual fallback and state reset after reissue;
- Staff Deliberations renders Zoom, SharePoint, transcript, and missing states;
- external page contains presentation materials and explicitly does not contain proposal,
  reviews, staff brief, consultant feedback, or request number;
- deployed real MP4 over 50 MB completes the owner-selected upload/attach transport and
  play/seek/download script without application buffering, repeated resolver throttling, or bearer
  values in logs. Chrome and Edge have historical Preview receipts; the remaining macOS Safari
  check runs in Production on an owner-approved human-created disposable Request. The browser-direct Graph variant
  remains the selected candidate unless that desktop check falsifies it;
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
- `proxy.js` route-scoped Preview and Production `connect-src` admitting only
  `https://*.up.1drv.com` and the canonical SharePoint tenant on
  `/meeting-tracker/visits/[requestId]`, and `media-src` admitting only that tenant on the shipped
  `/external/presentation/[token]` and `/external/briefing/[token]` Watch pages,
  preserving ordinary-route CSP; test
  Production-positive and unrelated-route-negative cases. The existing Preview-only proof CSP
  does not cover these paths;
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
   route-scoped CSP correction. Chrome reload/reselect and proof-token recovery passed on
   2026-09-24; Graph-confirmed session expiry needs a corrective retest. Commit `bab770fe6`
   built and offline-tested the §7.2.1 transport as one browser module used by the Preview
   benchmark harness and intended for the later production producer. The separately approved
   representative Chrome benchmark passed on 2026-09-25; retest the expiry row through live Graph status.
   Keep 302 as the
   leading resolver and the one-shot URL as the bounded fallback. The deferred Production Safari,
   long-seek, and near-cap cells remain in the Slice 0 matrix but block general release after
   the production-safe flow exists, not coding of that flow;
2. now remove/convert the proof harness and merge the compatibility floor: deploy-safe readers,
   backing validation, disabled-state payload, and external-route readiness guards with readiness
   off and both new fields absent from live selects. Confirm only the presence—not the value—of
   `EXTERNAL_LINK_SECRET` separately in Preview and Production;
3. for Preview, owner applies the Postgres migration to the Preview-connected database and the
   Dataverse wave to the sandbox organization, then runs exact schema/readback preflights while
   readiness remains off;
4. deploy the compatible producer runtime to Preview, run the prior-runtime-tolerance fixtures,
   then owner sets
   `POST_PRESENTATION_MATERIALS_SCHEMA_READY=on` only in Preview and enables the separate
   `POST_PRESENTATION_MATERIALS_ACCESS=test:<approved request GUID>` for a bounded Preview
   acceptance with a file over 50 MB, including reload/resume, a live upload-session expiry and
   recovery through the durable producer's authenticated resume route, and separate short-lived
   playback-URL expiry recovery;
5. for Production, separately confirm the target registry/interlock classifies the production
   Dataverse organization, owner applies the same Postgres migration to the Production-connected
   database and the Dataverse wave to the production organization, and runs exact preflights with
   Production readiness still off;
6. deploy the compatible runtime to Production with schema readiness and access both off, rerun
   tolerance fixtures, then owner enables schema readiness and sets
   `POST_PRESENTATION_MATERIALS_ACCESS=test:<verified owner-approved request GUID>` for the bounded
   Production gate. The approval list includes the same-Mac direct-Graph baseline session,
   its exact target and cleanup, plus retention of the registry-bound near-cap MP4. Complete the
   actual desktop Safari near-cap, long-seek, Download-integrity,
   and performance checks before setting access to `on` for general release. If a gate fails,
   set access to `off` while preserving the exact intent/item for approved recovery; schema
   readiness can remain on for compatible readers. Verify D19 full-briefing access and the
   materials-only link as separate audiences. The Production near-cap item remains a
   registry-bound governed test artifact by default; obtain explicit retention approval before
   the run and record its exact identity. The unfinished Factory supplies neither the Request nor
   teardown. If the
   owner later wants deletion, design a separately reviewed teardown for the exact Ready and
   Superseded Request Document IDs, prove zero remaining bindings, and seek separate approval
   before an ETag-guarded exact-item deletion.

Once any producer can write a post-presentation row, the compatibility-floor commit becomes the
oldest permitted runtime. Rollback is setting presentation access to `off` and keeping/redeploying
that compatible runtime; never redeploy a pre-compatibility runtime unless its exact artifact passed tolerance
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
- the original Slice 0 review called for desktop Chrome/Edge plus macOS/iPadOS Safari; Session 536
  accepted Edge and deferred Safari to Production, then the owner removed iPadOS from the
  acceptance matrix on 2026-09-24 while keeping the near-cap upload check on desktop; and
- monotonic slot fencing plus renew/revalidate-before-write prevents an expired lease holder from
  becoming the visible winner or superseding an uncaptured row.

**2026-09-24 read-only Claude Opus performance review:** the ordinary OAuth CLI review found one
release blocker and nine major plan gaps. The blocker was that schema readiness is environment-wide
and could not isolate the proposed Production near-cap test. This revision adds an exact
`off`/`test:<approved human-created request GUID>`/`on` access mode across producers and consumers. It also
reclassifies the old initial-timestamp expiry receipt as PARTIAL, specifies live Graph/item
reconciliation and bounded retries, includes Production CSP and duplicate-client tests, makes
the benchmark and producer share one browser module, and retains registry-bound Production test
items unless a separately approved teardown proves zero references. The review was advisory;
no code was changed.
Two read-only Opus follow-ups checked the revisions. The final follow-up found no remaining
isolation, expiry, retry, CSP, or cleanup-policy blocker and asked for two final wording fixes:
Preview disposable cleanup must be distinct from retaining a registry-bound Production test MP4,
and the Safari speed threshold must use a same-Mac/same-network direct-Graph baseline. Both are
now explicit in §7.2.1, the Slice 0 pass criteria, the test matrix, and §15. The reviewer stated
those two edits were sufficient to make the plan ready for implementation; live acceptance is
still a separate gate.

**2026-09-25 implementation, read-only adversarial review, and representative benchmark:** commit `bab770fe6`
implemented the shared transport and corrected Preview status/permit behavior; that implementation
commit itself performed no live activity. The fresh review found strict-range, Retry-After-cap, monotonic-stall, cross-device
rate, stale-async, paused-ETA, refreshed-expiry, reconnect-copy, pause-enablement, timer-cleanup,
and final-fragment rate-accounting gaps; each was fixed and covered by focused tests before the
runtime commit. The one deliberately narrowed contract is immediate abort: the staff control
finishes the current fragment before pausing, while page-lifecycle abort cancels local work,
retains the encrypted permit, and relies on manual Resume for the next authorized status check.
The reviewer found no remaining authorization, exact-item cleanup, fingerprint, or full-file
proxy regression. The separately approved Chrome Preview benchmark then passed with the
100,665,703-byte app upload and same-machine/network direct-Graph baseline recorded in §7.2.1;
both exact items were deleted and Graph confirmed the folder empty. This closes the representative
desktop benchmark item only. Graph-confirmed expiry, Safari, and near-cap Production gates remain
open and approval-bound.

**2026-09-25 Slice 1 offline implementation:** Wave 30 now defines the exact optional
`wmkf_ExternalUrl` URL field and positive Dataverse-sized `wmkf_SlotVersion` fence, with a
creation-only apply record and read-only typed preflight. The Request Document adapter excludes
both from its base projection and admits them only behind literal-on schema readiness. Migration
054 and fresh-install V55 define the materials-only link ledger, ciphertext-only durable Graph
upload intents, monotonic request/artifact slot fences, and the complete five-scope staging
allowlist. The separate access parser accepts only `off`, `on`, or one normalized `test:<GUID>`;
unset/invalid values fail closed. The preflight self-test, type check, scoped lint, and 14
changed-surface Jest suites (196 tests) pass. Migration-manifest, Atlas, Dataverse access-layer,
Request Document writer, doc-currency, fact-consistency, doc-symbol, status-enum, GUID-boundary,
secret-scan, scaffolding-token, docs-catalog, and agent-invariant gates pass; every applicable
self-test passed sequentially. **No schema was applied, no environment flag was changed, no
producer/route was enabled, and no external write occurred.** The owner also corrected the future
fixture assumption: the Test Request Factory is unfinished, so bounded Production checks must use
an individually approved human-created disposable Request.

The product behavior remains locked. Browser-direct Graph upload is the leading MP4 transport
after the corrected Chrome proof. The remaining decision is whether it survives the measured
desktop and Production Safari/near-cap release gates. Failure returns to the bounded
SharePoint-first-party fallback and is not permission to introduce application byte proxying.
