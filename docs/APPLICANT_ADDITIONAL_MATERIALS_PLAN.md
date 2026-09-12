---
title: Applicant Additional Materials Plan
domain: applicant-materials
kind: plan
status: active
summary: "Canonical Site Visit-led plan for applicant material collection, staff follow-up, and a shared external briefing room."
canonical: true
cataloged: 2026-09-08
last_verified: 2026-09-10
owner: product-engineering
related:
  - docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md
  - docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md
  - docs/REVIEWER_MATERIALS_FOLDER_SPEC.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - docs/atlas/dataverse-wmkf-requestdocument.md
  - docs/atlas/dataverse-wmkf-sitevisit.md
  - docs/atlas/postgres-infra-tables.md
---

# Applicant Additional Materials Plan

## 1. Status and recommendation

**Planning only. No implementation is authorized by this document.**

Build one **Site Visit Materials** workflow that collects applicant files, lets a Program
Coordinator (PC) verify that the required files are present and render, and publishes selected
materials plus the Pre-Site Visit Writeup and peer reviews through a shared read-only briefing
page. Site Visit is the defining use case; a later staff request for other proposal materials is
another invocation of the same collection capability, not a parallel product. **[VERIFIED via
owner decisions recorded 2026-09-08; implementation PLANNED]**

Use two deliberately different bearer links bound to one Site Visit:

- a shared, forwardable **contributor link** for the applicant PI, liaison, and anyone to whom
  they delegate the upload; and
- a shared, read-only **briefing link** for the small group of Board members, consultants, and
  staff who need the published package without signing into the app suite.

The system is strict about request/Site Visit scope, file safety, exact document identity, and
read-versus-write authority. It does not try to prove which applicant-side person clicked Upload.
The operational goal is a complete, usable package with everyone informed about missing work.
**[VERIFIED via owner decisions recorded 2026-09-08; implementation PLANNED]**

The first Site Visit is approximately twenty days from the planning date, and materials are
normally requested three days before the meeting. The first release therefore has roughly
seventeen days of business runway and must include both collection and the minimal briefing room.
Email/Dropbox remains the explicit fallback for an unsafe or late pilot; scheduling and Datto
retirement do not block this cycle. **[VERIFIED via owner direction 2026-09-08; exact calendar
dates ASSUMED until read from the Site Visit Activity]**

## 2. Product contract decided by the owner

The following decisions supersede conflicting recommendations elsewhere in this document's
2026-09-08 first revision. They also supersede the unbuilt July Site Visit upload proposal where
that proposal called for a different first-release boundary. **[VERIFIED via owner decisions
recorded 2026-09-08]**

| Area | Decided contract |
|---|---|
| Workflow anchor | A PC manually initiates materials collection for an already scheduled Site Visit. Scheduling remains outside the first release. |
| Minimum requested set | A native applicant-supplied PDF presentation, a source presentation (normally PPTX or Keynote), and a participant/bios document. Exact checklist copy remains TBD. |
| Flexible requirements | Staff starts from a bare-minimum template, may add or waive request-specific items, and permits bounded applicant-initiated Other materials. |
| Staff ownership | PC owns creation, follow-up, render sanity check, and publication. PD has visibility. |
| Applicant responsibility | PI and liaison share responsibility. Both receive the requirements and reminders; either may upload or forward the contributor link. |
| Attribution | Record the active collection link and its intended contacts, not an unprovable human uploader identity. |
| Presentation revisions | PDF and source presentation advance independently. Retain prior SharePoint versions and show a soft out-of-sync reminder when only one side changes; do not block the newer file. |
| Readiness | Presence is primary. A PC confirms required files open/render; no substantive approval workflow is needed. |
| External package | A small, named but trusted external audience receives one expiring read-only briefing link. Forwarding risk is owner-accepted because recipients are covered by NDAs or similar agreements. |
| Briefing contents | PC-published applicant materials, exact Pre-Site Visit Writeup version, and selected peer reviews. |
| Physical-file rule | Prefer one canonical SharePoint file plus stable item/version pointers. Do not create audience copies merely to assemble a package. |
| Naming | Applicant filename is receipt metadata; SharePoint uses stable request-numbered canonical names; external labels and download names use institution and omit the internal request number. |
| Sunset | Contributor and briefing access close automatically seven days after the Site Visit. No manual closeout is required. |
| Current-cycle exclusions | Do not build Site Visit scheduling or a Datto migration. Exceptional applicant formats may be handled through the existing email fallback. |

## 3. Evidence-first current state

| Surface | Current state | Consequence |
|---|---|---|
| Site Visit Activity | `wmkf_sitevisit` is a live custom Activity with Request binding, scheduled start/end, format/location, and organizer/attendee parties. Workbench reads it; visits are maintained outside the current Workbench editor. **[VERIFIED via `docs/atlas/dataverse-wmkf-sitevisit.md`]** | Bind collection and both links to the exact active Activity, not merely a client-supplied request or date. |
| Governed Pre-Site document | The current Pre-Site Word workspace is registered through `wmkf_requestdocument`, lives under `Artifacts/Pre-Site Visit/`, and retains stable SharePoint item/version identity. A live distribution path can create retained Word/PDF snapshots. **[VERIFIED via `shared/config/requestDocument.js`, `docs/atlas/dataverse-wmkf-requestdocument.md`, and `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`]** | The briefing manifest may pin a native version. Create a distinct PDF only when that representation is actually required; do not duplicate it merely for access. |
| Peer reviews | Completed generated review files use the request-level `Reviews` folder and stable review-suggestion pointers. **[VERIFIED via `lib/services/review-documents/individual-file-service.js` and `docs/APPLICATION_STATE_ATLAS.md`]** | Pin selected exact review items/versions in the briefing manifest; do not expose the folder broadly. |
| Request Document registry | Existing artifact choices include Applicant Slides and Other Applicant Materials, and rows retain request binding, stable Graph identity, version/eTag, content facts, operation/lifecycle, and provenance. There is no dedicated Participant Bios choice. **[VERIFIED via `shared/config/requestDocument.js` and `docs/atlas/dataverse-wmkf-requestdocument.md`]** | Reuse the registry; propose a Participant Bios artifact choice rather than permanently hiding a baseline requirement under Other. |
| Applicant upload | The July Site Visit upload contract is planned, not built. Current route inventory has no Site Visit applicant-material contributor page or routes. **[VERIFIED via `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` and `rg --files pages shared lib`]** | The first release must build the external contributor surface. |
| Applicant portal | `/apply` has identity, draft, upload, and submit foundations, but the new-application portal is parked and J27 remains in GOApply. **[VERIFIED via `docs/agent-wiki/topics/intake-portal.md` and `docs/INTAKE_PORTAL_DESIGN.md`]** | Reuse reviewed safety ideas, not applicant sign-in, memberships, draft forms, or submission lifecycle. |
| Shared staging | `portal_upload_staging` has actor/resource/scope ownership, lease, downstream-candidate, replay, and exact cleanup semantics, but currently admits only grantee-image scopes and image types. **[VERIFIED via `lib/db/migrations/031_portal_upload_staging.sql`, `lib/services/portal-upload-staging.js`, and `docs/atlas/postgres-infra-tables.md`]** | Extend the state-machine pattern additively; do not call the image-only contract unchanged. |
| Reviewer and AI boundaries | External reviewer delivery exposes one exact reviewer PDF; Initial Assessment reads one exact Proposal Narrative. **[VERIFIED via `lib/external/reviewer-materials.js` and `lib/services/initial-assessment/artifact-service.js`]** | Site Visit collection/publication never widens either allow-set or silently changes AI inputs. |
| AkoyaGo legibility | The request's active SharePoint folder is linked by Dataverse, but signed-in behavior for root files, nested folders, additional Document Locations, and link-like representations is still discovery-gated. **[VERIFIED via `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md`, “AkoyaGo publication projection”]** | The logical file model is decided below; exact physical folder depth remains blocked on immediate signed-in discovery. |

## 4. Problem, actors, and boundaries

When the Foundation is sufficiently interested in a proposal, it schedules a “Site Visit,” which
is now usually remote but remains the working process name. For the current cycle, dates and the
general requested material types are already known. Staff need usable materials a few days before
the meeting to prepare questions and request corrections. Applicants may still change the deck at
the last minute and present from their own equipment; WMKF is collecting a reviewable snapshot,
not certifying the deck shown during the meeting. Post-meeting deck reconciliation is rare and is
not a routine workflow. **[VERIFIED via owner decisions recorded 2026-09-08]**

Actors:

- **PC:** creates the collection, communicates requirements, monitors missing items, checks that
  files render, requests replacement when necessary, and publishes the briefing package.
  **[VERIFIED via owner decision 2026-09-08]**
- **PD:** can see status and materials but does not own routine follow-up. **[VERIFIED via owner
  decision 2026-09-08]**
- **Applicant team:** PI and liaison share a contributor link and may delegate it. The system is
  agnostic about who uploads each item. **[VERIFIED via owner decision 2026-09-08]**
- **Briefing audience:** a few Board members and consultants, plus staff who may use the same
  external page shortly before the meeting. **[VERIFIED via owner decision 2026-09-08]**

Non-goals for the first release: Site Visit scheduling, applicant accounts, replacing GOApply,
full Datto retirement, arbitrary SharePoint browsing, Board/consultant login, a permanent external
document room, or automated ingestion into reviewer/AI proposal inputs. **[PLANNED]**

## 5. Candidate approaches

| Approach | Reuse/build | Benefits | Costs and risks | Verdict |
|---|---|---|---|---|
| **A. Site Visit collection plus briefing room** | Reuse Site Visit Activity, external-token patterns, staging/recovery semantics, Request Documents, Pre-Site/review identities, and Workbench. Build collection/checklist state, contributor routes, briefing manifest/link/routes, and PC UI. **[VERIFIED reuse candidates via §3; build PLANNED]** | Solves receipt, follow-up, staff access, oversized email/Dropbox distribution, and consistent external access in one bounded workflow. | Cross-store finalize/publication must remain recoverable; AkoyaGo folder behavior must be discovered immediately. | **Recommend.** |
| **B. Collection only; retain email/Dropbox/Datto distribution** | Build upload/checklist only and continue today’s external delivery. **[PLANNED]** | Smaller release. | Leaves the hodgepodge that motivated the work; does not validate exact external access or include Pre-Site/reviews. | Keep only as launch fallback. |
| **C. Revive the parked applicant portal** | Reuse Entra applicant sessions, membership, drafts, and submit/drain. Build post-submission binding, staff requests, SharePoint registry, and briefing delivery. **[VERIFIED reuse candidates via intake source; build PLANNED]** | Stronger person identity and future new-application continuity. | Couples a time-sensitive Site Visit need to a parked product and unnecessary onboarding/identity administration. | Reject for this workflow. |

## 6. End-to-end workflow

### 6.1 Create and communicate **[PLANNED]**

1. PC opens the Request Workbench and manually creates a collection from the exact active
   `wmkf_sitevisit` Activity. The server re-reads the Activity, Request, PI, liaison, institution,
   and dates.
2. A baseline template supplies Presentation PDF, Presentation Source, and Participant Bios.
   The PC may add bounded request-specific items, mark an item optional, or waive it.
3. The server creates durable collection/checklist and pending link state before email.
4. The same contributor link is addressed to the server-resolved PI and liaison. Forwarding is
   accepted. Link activation occurs only after transport accepts the invitation.
5. Staff sees sent time, intended contacts, due date, missing-item summary, and last reminder.

### 6.2 Upload and revise **[PLANNED]**

1. Contributor context reveals only institution, Site Visit date, instructions, checklist, current
   accepted files, and completion state.
2. Each upload-token request repeats link/activity/collection/deadline checks. The browser supplies
   filename, declared type, and byte count; the server owns staging identity and pathname.
3. Browser bytes travel directly to a private staging store. Finalize repeats authorization,
   claims the exact staging row, downloads only its persisted path, verifies size/type/extension/
   magic/hash, and requires a successful malware result.
4. The server assigns the canonical destination and filename. It records the SharePoint stable
   identity and byte facts before the registry write so retry can reconcile a partial success.
5. Same-format replacement advances the canonical SharePoint item’s native version history when
   safely supported. A source-format change creates the new canonical source item and supersedes
   the prior format. The external client never chooses the item or overwrite target.
6. PDF and source presentation have independent latest versions. If only one changes, both
   contributor and PC receive a soft “may be out of sync” notice; the newer file remains usable.
7. Optional Other uploads do not affect checklist completion. Required items determine presence.

### 6.3 Follow up and sanity-check **[PLANNED]**

The first release uses PC-triggered reminders rather than a new scheduler. A reminder goes to PI
and liaison, reuses the active link, and lists each required item as received, missing, or needing
replacement. It records transport receipt and last-notified time. Once all required items are
present, ordinary missing-item reminders stop.

Collection display uses five plain states:

- **Missing** — at least one non-waived required item is absent.
- **Received** — every non-waived required item has a current file.
- **Needs replacement** — PC found a file that does not open or render adequately.
- **Ready** — required items are present and the PC completed the sanity check.
- **Closed** — seven days have elapsed after the Site Visit.

The PC’s check is operational, not substantive approval. A change request reopens the affected
item without deleting its prior usable version. **[PLANNED]**

### 6.4 Publish and view **[PLANNED]**

1. PC opens package assembly after applicant materials are usable.
2. PC selects exact applicant document versions, the exact Pre-Site Visit Writeup version, and
   the appropriate peer-review files/versions.
3. Publication writes a new manifest version only after every selected identity remains valid.
   A failure leaves the previously published manifest active.
4. The stable briefing link serves only the active manifest. It is read-only, needs no app-suite
   login, displays its last-published time, and expires seven days after the Site Visit.
5. “Open external view” in Workbench opens the same page used by Board members and consultants.
6. A later applicant or internal-document change appears in Workbench as unpublished. External
   users continue seeing the prior published manifest until the PC checks and republishes.

## 7. SharePoint and naming contract

### 7.1 One physical source **[PLANNED]**

One canonical physical item plus a stable version reference is the default. The briefing package
is a logical manifest, not a second folder of copies. Existing governed Pre-Site and review files
remain in their current canonical locations. Create a new physical artifact only for a genuinely
different representation—such as a requested PDF derived from Word—not because another audience
needs access.

### 7.2 Candidate request-relative structure **[PLANNED; physical depth UNKNOWN]**

```text
Site Visit/
└── Applicant Materials/
    ├── Slides/
    ├── Participant Bios/
    └── Other/
```

The existing July plan already reserves `Site Visit/Applicant Materials/Slides` and `/Other`.
This plan adds the baseline Participant Bios category. Each accepted file receives a Request
Document row and stable Graph identity; folder or filename is never its durable key. **[VERIFIED
precedent via `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`; extension PLANNED]**

Before locking the folder depth, inspect representative current requests in signed-in AkoyaGo and
prove whether nested folders are visible and usable. If AkoyaGo obscures the second nesting level,
the approved fallback is a flatter, still server-owned `Site Visit - <Category>` structure. Do not
choose an additional Document Location or shortcut representation without the same proof.

### 7.3 Three naming layers **[PLANNED]**

1. **Applicant filename:** retained as operational receipt metadata, never authoritative.
2. **Canonical staff filename:** server-minted and stable, for example
   `{Request#} Site Visit Presentation.pdf`, `{Request#} Site Visit Presentation.pptx`, and
   `{Request#} Site Visit Participant Bios.docx`. Revisions do not gain `final-v2` suffixes.
3. **External label/download name:** institution-led and request-number-free, for example
   `UCLA — Presentation.pdf` and `UCLA — Participant Bios.pdf`.

Institution is the primary external identifier. Proposal title may be secondary context. If two
active proposals from one institution would be ambiguous, add a recognizable program/proposal
qualifier rather than the internal request number. **[VERIFIED via owner decision 2026-09-08]**

## 8. Briefing-manifest and consumer contract

The active manifest binds one exact Site Visit and contains an ordered set of permitted document
references. Each reference records its source kind, stable SharePoint drive/item identity, pinned
version, content facts, audience label/download name, and inclusion order. The external route
resolves those server-side references and streams bytes; it never returns a raw SharePoint or
Dataverse URL. **[PLANNED]**

Default first-release sections:

1. Meeting context
2. Pre-Site Visit Writeup
3. Peer reviews
4. Applicant presentation
5. Participant bios
6. Selected additional applicant materials

The manifest may reference heterogeneous existing owners: Request Document rows for governed and
applicant artifacts, and current review-suggestion file identities for peer reviews. The build
must define and gate that closed source-type set; an unrecognized type fails closed. It must not
solve the problem with folder enumeration. **[PLANNED]**

The external page does not automatically include the presentation source. The PC normally
publishes the applicant-supplied PDF for viewing/printing and may deliberately include the source
when useful. Exact peer-review display labels and whether any representation must suppress reviewer
identity remain open product decisions. **[ASSUMED — owner has not yet settled representation and
label policy]**

## 9. Security contract

### 9.1 Trust boundaries **[PLANNED]**

- Contributor and briefing links use separate audiences/operations and token digests. A viewer
  token can never upload; a contributor token can never read internal briefing materials.
- Both are bearer links and may be forwarded. Do not claim visitor identity from link use.
- Every request rechecks signature, audience, operation, expiry, stored digest, active collection,
  exact Site Visit/Request binding, and route-specific rate limits.
- Server resolves Activity, Request, contacts, SharePoint drive/folder/item, canonical pathname,
  and package allowlist. None comes from external request input.
- Finalize repeats authorization and staging ownership after browser upload. A mint-time check is
  not sufficient.
- Scanner disabled, unavailable, or inconclusive fails closed. The dormant intake path’s
  skipped-clean behavior is not inherited.
- Viewer responses use exact pinned versions, safe content types, `nosniff`, bounded disposition
  filenames, and private/no-store caching. No folder listing or neighboring file fallback exists.
- Expiry blocks new context, upload, finalize, and download operations. Staff may reissue; raw
  tokens are never stored or logged.

### 9.2 Proposed route-matrix shapes **[PLANNED — do not add yet]**

Each implementation route must enter `docs/API_ROUTE_SECURITY_MATRIX.md` in the same change using
the registered columns Route | Methods | Auth | Guard | Data scope | Persistence | Risk | Notes.
Candidate route names are planning identifiers, not built state:

| Route family | Methods | Auth/guard | Scope and persistence | Risk |
|---|---|---|---|---|
| `/api/workbench/site-visit/materials` | GET, POST | staff app access plus PC/PD action allowlist | Reads Activity/Request/contacts/documents; creates collection, sends/reminds, checks/publishes | High |
| `/api/external/site-visit-materials/[token]/context` | GET | contributor verifier + rate limit | Minimal one-collection checklist/current applicant files | Low |
| `/api/external/site-visit-materials/[token]/upload-token` | POST | contributor verifier repeated | Creates exact collection-bound private staging row | Medium |
| `/api/external/site-visit-materials/[token]/finalize` | POST | contributor verifier + staging lease + byte policy | Private Blob → SharePoint → Request Document → terminal replay | High |
| `/api/external/site-visit-briefing/[token]/context` | GET | viewer verifier + rate limit | One active published manifest and minimal meeting context | Low |
| `/api/external/site-visit-briefing/[token]/document` | GET | viewer verifier + manifest membership | Streams one exact pinned file version; no broad folder/file identifier | Medium |

## 10. Proposed data model

### 10.1 Dataverse **[PLANNED]**

- Existing `wmkf_sitevisit` remains the durable meeting/date/party anchor.
- Existing `akoya_request` remains the proposal and SharePoint-parent anchor.
- Existing `wmkf_requestdocument` owns applicant-file identity, request binding, artifact kind,
  stable Graph identity/version/content facts, operation/lifecycle, and provenance.
- Add a Participant Bios artifact choice after schema review. Continue using Applicant Slides for
  both PDF and source; representation comes from content type and controlled checklist slot.
- Do not add a current-file pointer to `akoya_request`. Collection/checklist and manifest state are
  one-to-many and operational.

The current registry has no Site Visit lookup. The implementation design must decide whether exact
Activity association lives only in the collection/manifest ledger or also needs a nullable Request
Document relationship. **[VERIFIED absence via registry Atlas/schema search; decision OPEN]**

### 10.2 Postgres operational coordination **[PLANNED]**

Use one bounded coordination model, with exact identifiers selected during implementation design,
for:

- collection identity, Request/Site Visit binding, PC owner, due/access-close times, and state;
- ordered checklist items, required/optional/waived status, accepted file references, and PC sanity
  check/replacement state;
- shared contributor link and viewer link digests, lifecycle, send/reissue receipts, and expiry;
- invitation/reminder attempts, PI/liaison recipients, last-notified time, and recovery evidence;
- versioned briefing manifests and ordered, exact pinned document references; and
- idempotency keys, leases, attempts, and bounded partial-failure evidence.

Do not store bytes or raw bearer tokens. Terminal operational retention remains an owner/security
decision; accepted files remain governed by SharePoint/Dataverse retention. **[PLANNED]**

### 10.3 Private staging **[PLANNED]**

Extend `portal_upload_staging` or its reviewed state-machine pattern with a controlled document
scope, collection/link ownership, declared/verified byte facts, candidate-before-registry identity,
terminal replay, and exact-path cleanup. Preserve existing image callers unchanged. Keynote and
large presentation validation/scanning require explicit proof before the size cap is settled.

## 11. Failure, concurrency, and partial success

| Event | Required behavior **[PLANNED]** |
|---|---|
| One file in a batch fails | Successful files remain received; failed item remains retryable with its own error. |
| Same link used concurrently | Checklist/file writes use version or ETag fences; stale replacement refreshes instead of silently overwriting. |
| SharePoint succeeds; registry fails | Persist exact candidate identity first; retry reconciles that item or removes only the proven orphan. |
| Registry succeeds; response drops | Deterministic staging/operation identity returns the same accepted result. |
| One presentation half changes | Publish the accepted file, retain the other current half, and show the soft out-of-sync warning. |
| Package publication validation fails | Keep the previous manifest active; publish no partial external package. |
| Source changes after publication | Mark newer source available in Workbench; external page remains on the pinned manifest until republish. |
| Link expires during upload | Finalize rechecks expiry and refuses the write; PC reissues if the business window remains open. |
| Pilot is not safe by go/no-go | Use the documented email/Dropbox fallback; do not waive auth, scan, or recovery invariants. |

No handler returns overall success when every requested operation failed. Response payloads identify
per-file/per-action success and failure so the client updates only committed items. **[PLANNED]**

## 12. Immediate owner/operating decisions still open

1. **Exact baseline checklist and instructions.** Current working minimum is PDF presentation,
   source presentation, and one participant/bios document. Confirm against the current email when
   available. **Recommendation:** keep one cycle template plus PC add/waive controls.
2. **Review-due offset.** “A few days” is not yet exact. **Recommendation:** three calendar days
   before the Site Visit for this cycle, with access still open until seven days after.
3. **File-size ceiling and Keynote proof.** **Recommendation:** inspect several historical decks,
   including the largest, before fixing the first-release cap; retain email/Dropbox only for
   exceptional oversize or unsupported files.
4. **External representations.** Decide Word versus PDF for the Pre-Site Writeup and peer reviews,
   whether source slides are normally included, and the external peer-review labels/anonymity rule.
   **Recommendation:** browser-friendly PDF where already available/proven; otherwise serve the
   exact native document rather than adding a risky conversion to the deadline.
5. **Physical SharePoint depth.** **Recommendation:** test the candidate hierarchy immediately in
   signed-in AkoyaGo; choose the nested form only if it is visibly navigable.
6. **Email sender and copy.** **Recommendation:** PC initiates, both PI and liaison receive every
   requirements/reminder message, and the visible sender/reply-to follows the current staff email
   convention once the existing example is reviewed.
7. **Update communication to Board/consultants.** **Recommendation:** stable link plus visible
   last-published timestamp; do not send a new message on every republish unless staff explicitly
   chooses Notify.
8. **First-cycle go/no-go date.** **Recommendation:** set a date that still gives the first applicant
   enough time to use the fallback process; no production launch merely because the meeting is near.

## 13. Build slices and release tier

The plan is Tier 0. The feature is Tier 2 because it combines external bearer authorization,
email, untrusted file upload, Postgres coordination, private Blob, SharePoint, Dataverse, Workbench,
and cross-store recovery. **[VERIFIED tier definition via
`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`]**

### Slice 0 — immediate discovery and contract freeze **[PLANNED]**

- Obtain the current request email/checklist and representative PPTX/Keynote/PDF/bios files.
- Read the exact active Site Visit date and recipients from a representative Activity.
- Inspect AkoyaGo Documents and select nested versus flat physical folder form.
- Set due offset, size/type limits, external representations, review labels, and go/no-go date.
- Design migrations, Atlas/matrix/catalog changes, retention, route allowlist, and failure recovery.

### Slice 1 — collection and staff control **[PLANNED]**

- PC creates one collection from one existing Site Visit.
- Shared contributor invitation goes to PI and liaison.
- Baseline checklist, PDF/source/bios upload, independent versions, Other, and soft mismatch warning.
- PC sees missing/received/problem/ready, previews/downloads, and sends exact missing-item reminders.
- Include scan unavailable/reject, oversize, response-drop, duplicate finalize, concurrent replace,
  and SharePoint-before-Dataverse recovery tests.

### Slice 2 — briefing room in the first release **[PLANNED]**

- PC selects exact applicant, Pre-Site, and review versions into an atomic manifest.
- One stable shared read-only viewer link, institution-led labels, pinned-version download/preview,
  last-published time, and external-view preview from Workbench.
- Include unauthorized neighboring document, stale source, partial publish, republish, expired link,
  revoked link, response-drop, and same-link concurrent-read tests.

Slices 1 and 2 together define the minimum current-cycle release. Slice 2 is not a later Datto-
retirement enhancement. **[VERIFIED via owner decision 2026-09-08]**

### Slice 3 — post-pilot improvements **[PLANNED]**

- Automated reminder cadence, richer package update notifications, large/resumable uploads if
  measured need justifies them, and practical recovery/admin tools.
- Reuse the collection capability for staff-requested non-Site-Visit additional materials.
- Add calendar invitation integration and retire Site Visit dependence on Dropbox/Datto only after
  the new path is exercised and the remaining Datto scope is inventoried.
- Consider Site Visit scheduling only as a separately authorized workflow.

## 14. Contract reconciliation

| Stage | Producer/entry | Persistence | Consumer |
|---|---|---|---|
| Schedule | PC in current external/AkoyaGo process | `wmkf_sitevisit` Activity | Workbench collection creation |
| Collection | PC Workbench action | Postgres coordination linked to Activity/Request | Contributor page, PC/PD status |
| File intake | Shared contributor link | Private staging → canonical SharePoint item → Request Document | PC/PD Workbench and package composer |
| Publication | PC package action | Versioned manifest of exact source identities/versions | External briefing context/document routes |
| Viewing | Shared briefing link | Read-only manifest and exact source bytes | Board, consultants, and staff external view |

### Prior requirements disposition

| Earlier requirement | Current disposition |
|---|---|
| Parked intake portal must not be revived | Preserved; applicant login/membership/forms remain out. |
| Site Visit should be the narrow external precedent | Promoted: it is now the defining product workflow. |
| One shared applicant link | Preserved and explicitly accepts forwarding/lightweight attribution. |
| Fixed 60-day link | Superseded by seven days after the actual Site Visit; due date remains a separate earlier milestone. |
| 1 GB / 20-file contract | Not accepted without representative-file and scanner evidence; exact cap is an immediate decision. |
| Applicant delete/replace | Replacement is required; destructive delete/restore UI is not required for the first cycle. |
| Physical briefing copies | Rejected by default; use exact item/version pointers and create only genuinely distinct representations. |
| Staff-only generic-material default | Site Visit applicant intake is staff-visible; selected versions are deliberately published to the trusted briefing audience. |
| Reviewer/AI exact allow-sets | Preserved; this package is a separate audience and does not widen either path. |

### Review findings

1. The earlier general-additional-material framing put Site Visit reuse too late. Owner discussion
   establishes the larger overlap and makes Site Visit the primary workflow. **[RESOLVED in this
   plan; other durable restatements remain outside the brief-owned edit surface]**
2. A physical Briefing Package folder would duplicate mutable applicant, Pre-Site, and review
   files. The package is now a pinned-version manifest; copies exist only for distinct derived
   representations. **[RESOLVED in this plan]**
3. Exact AkoyaGo folder visibility remains unproved, so a final physical schema cannot be called
   verified. **[OPEN discovery gate; candidate and flat fallback are explicit in §7]**
4. Participant Bios is a baseline material but the Request Document option set has no typed choice.
   **[OPEN additive schema design; verified via current constants]**
5. The first-release briefing manifest must read both Request Document and peer-review pointer
   sources. That closed heterogeneous-reference contract is not built today. **[OPEN build design]**

**Final verdict: READY WITH NAMED CHANGES.** Product purpose and first-release boundaries are
decided. Implementation remains blocked on Slice 0’s AkoyaGo discovery, actual file-size/type
evidence, external representation/label policy, exact schema design, and a safe go/no-go date.

## 15. Sweep report

- **Mode:** changed-product-fact reconciliation within the brief-owned documentation surface.
- **Authoritative evidence:** owner decisions in the 2026-09-08 planning discussion; current Site
  Visit Activity Atlas; Request Document Atlas/constants; Pre-Site distribution contract; review
  file writer; applicant/staging/external-token source; AkoyaGo publication discovery gate.
- **Structural changes:** Site Visit now drives the product; first release includes collection and
  briefing distribution; shared contributor/viewer bearer links are explicit; package assembly is
  pointer/version based; naming has staff and external layers; launch slicing reflects the current
  cycle deadline.
- **Semantic omissions found:** Participant Bios has no current artifact choice; briefing manifest
  spans two current document-owner shapes; AkoyaGo nested-folder usability is unverified.
- **Excluded durable surfaces:** `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`, Atlas, API matrix, wiki,
  memory, source, schemas, and migrations remain unchanged under the planning brief’s file-ownership
  restriction. Reconcile them in the separately authorized implementation/change set.
- **Residual conflict:** the July unbuilt Site Visit subsection retains earlier 60-day, 1 GB,
  physical-path, and delete semantics. This canonical applicant-materials plan records the newer
  owner decisions; the older subsection requires structural reconciliation before implementation.
- **Verdict:** CLAIM NOT RECONCILED repo-wide because the owned surface excludes the older canonical
  file-model restatement; the new plan itself is internally reconciled and names that dependency.


## 16. Owner decisions 2026-09-10 (S503) and build design

These close §12 and supersede the recommendations there. Slice 2 (the briefing room) was built on
2026-09-09/10 as the deliberation briefing page (`docs/DELIBERATION_BRIEFING_PAGE_PLAN.md`, D13–D20):
it already serves the request's Ready applicant slides, other applicant materials, recording,
transcript, and transcript summary live from `wmkf_requestdocument`, so the collection built here
needs no manifest and no viewer work; a finalized upload appears on the page on the next load.

| # | Decision |
|---|---|
| M1 | Baseline checklist: **Presentation (PDF)**, **Presentation source (PPTX or Keynote)**, **Participant bios (PDF or Word)**. One cycle template; the PC may waive an item per request and applicants may add bounded "Other" files. |
| M2 | Due date: **two business days before the site visit starts**, computed in the visit's IANA zone (`lib/utils/business-days.js`, weekends only; no holiday calendar this cycle). Contributor access closes seven days after the visit ends, matching the briefing link's own expiry. |
| M3 | Upload size cap: an **admin-editable setting** `site_visit_materials.upload_max_mb` (Admin › Site visits), **default 100 MB**. The briefing page serves files up to 50 MB and lists larger ones with a note (D19). |
| M4 | SharePoint layout: **flat request-relative folders** `Site Visit - Slides`, `Site Visit - Participant Bios`, `Site Visit - Other`; no nested `Site Visit/Applicant Materials/…` form. Canonical filenames per §7.3. |
| M5 | **Go for this cycle.** Reminders are PC-triggered in the first release; an automated reminder cron is a follow-up the owner has flagged to remember. |

### 16.1 Reuse map [VERIFIED 2026-09-10 via source]

- PI and liaison: `resolveGranteeInviteRecipients({ requestId })` in
  `lib/services/workbench/grantee-deliverables/recipients-service.js` (PI = `wmkf_projectleader`,
  liaison = `akoya_primarycontactid`, both → contact email).
- Contributor link: stored-digest token like the briefing link (`mintScopedToken` with audience
  `materials`, sealed with `lib/utils/encryption.js`, verifier cloned from
  `lib/external/verify-briefing-token.js`).
- Direct upload: `portal_upload_staging` with a new document scope (`site_visit_material`), the
  `UPLOADS_BLOB_RW_TOKEN` store, actor binding = the collection link digest; finalize claims the
  row, downloads only its persisted pathname, verifies size/type/magic, scans through
  `lib/services/cloudmersive-scan.js` (`scanBytes`), uploads with `GraphService.uploadFileLarge`, then
  creates the `wmkf_requestdocument` row (Applicant Slides for both presentation formats, Other
  Applicant Materials for bios and Other) with the external contributor's unattributed actor policy.
- Email: Dynamics email activity from the PC's mailbox (`createEmailActivity` + `sendEmail`),
  plain-text body rendered with `lib/external/plain-text-email-html.js`.
- Admin setting: `lib/services/settings-service.js` `getSettingStrict`/`setSetting`, surfaced like
  `shared/components/admin/MeetingTrackerDefaultsSection.js`.
- Tracker surface: the collection is started, watched, and reminded from the tracker's visit page
  (`shared/components/meeting-tracker/SiteVisitEditor.js`, slice 2b), with a status cue on the list row.

### 16.2 Data model (migrations 042, 044) [SOURCE-BUILT; owner migration pending]

`site_visit_material_collections`: `id UUID PK`, `request_id UUID NOT NULL`,
`site_visit_activity_id UUID NOT NULL`, `status TEXT` in `open | ready | closed`, `due_at TIMESTAMPTZ
NOT NULL`, `closes_at TIMESTAMPTZ NOT NULL`, `checklist JSONB NOT NULL` (ordered items
`{ key, label, required, waived }` for `presentation_pdf`, `presentation_source`, `participant_bios`),
`contacts JSONB NOT NULL` (`{ pi: { name, email }, liaison: { name, email } }` snapshot at creation),
`jti TEXT UNIQUE`, `token_digest CHAR(64) UNIQUE`, `token_ciphertext TEXT`, `created_by UUID`,
`invited_at`, `invitation_email_id UUID`, `last_reminder_at`, `reminder_count INTEGER DEFAULT 0`,
`ready_confirmed_at`, `created_at`, `updated_at`. One non-closed collection per request (partial
unique index). Migration 044 adds `slot_leases JSONB NOT NULL DEFAULT '{}'::jsonb` for five-minute
per-canonical-slot finalize leases. Received files are not duplicated here: the collection reads
the registry rows of the material types whose filename carries the request's canonical name for
each checklist slot.

### 16.3 Slices

PR 1 and PR 2 were built on `claude/applicant-materials-collection` on 2026-09-10 (S503) and are
merged and production-smoked (ZZTEST-03, 2026-09-10). PR 3 was built 2026-09-11 (S506) on
`claude/applicant-materials-pr3`.

- **PR 1 — staff side:** migration 042; business-day helper; admin cap setting; collection service
  (create from the active visit, contacts snapshot, checklist, link mint, invitation email; reminder
  email; waive; state read joining the registry); tracker route
  `/api/meeting-tracker/visits/[requestId]/materials`; visit-page card. (The list-row cue named
  here was not built in PR 1; it landed in PR 3.)
- **PR 2 — applicant side [BUILT 2026-09-10]:** external page `pages/external/materials/[token].js`
  (institution, title, due and close dates, checklist with current files, upload per slot, Other);
  routes `/api/external/materials/[token]/{context,upload-token,finalize}`; verifier
  `lib/external/verify-materials-token.js` (`aud:'materials'`, digest lookup, refuses closed/expired);
  migration 043 adds staging scope `site_visit_material`; byte validation
  `lib/utils/site-visit-material-file.js` (extension per slot, signature per extension);
  `GraphService.uploadFileLarge` (upload session, 10 MiB chunks above the 60 MB simple cap);
  `lib/services/site-visit-materials/contributor-service.js` files under the canonical name with
  `replace` (SharePoint version history), registers a READY/DRAFT `wmkf_requestdocument` row
  (producer `site-visit-materials-portal`, unattributed actor policy), supersedes the slot's prior
  row, and flags PDF/source receipts more than an hour apart as out of sync. A conditional
  five-minute lease in `site_visit_material_collections.slot_leases` serializes each canonical
  request slot. Before the Dataverse create, staging `candidate_result` freezes the predecessor
  artifact id plus exact Graph drive/item/version/filename; replay accepts only the matching
  request-bound READY, non-superseded generation row and retires that recorded predecessor; a
  candidate with no generation row is redone from the top, while a superseded or mismatched row
  stays held for staff attention. Codex adversarial review (2026-09-10) also made
  cap reads strict (only an absent setting uses the 100 MB default), requires the settings writer
  to confirm success, classifies thrown scanner failures, retains the same staging id in browser
  session storage for transient finalize retry, and validates PPTX/DOCX through bounded exact ZIP
  central-directory entries rather than marker substrings.
- **PR 3 — visibility and closeout [BUILT 2026-09-11, S506]:** a counts-only summary
  (`lib/services/site-visit-materials/summary-reader.js`, fail-open all-null like the tracker's
  schedule reader; state, received/required counts, window, overdue, invited; never the contributor
  link or contacts) rides the `/api/workbench/pre-site-visit` GET, `/api/workbench/staff-deliberations`,
  and `/api/meeting-tracker/dashboard` payloads and renders as one line
  (`shared/utils/site-visit-materials-line.js`: "Materials: 2 of 3 received · due Oct 5.", overdue,
  ready, closed, and invitation-not-sent variants) on the Staff Deliberations tab, the cycle view
  card, and the tracker list row's Site visit section ("Materials not requested." when a visit
  exists without a collection). **Auto-close:** the daily maintenance cron's step 7.8 calls the
  store's `closeExpiredCollections` (open or ready → closed past `closes_at`; readiness-gated),
  which frees the one-open-collection index; reads already treated a past `closes_at` as closed.
  **Reminder cron:** `/api/cron/site-visit-materials-reminders` +
  `lib/services/site-visit-materials/reminder-sweep.js`, policy: one automatic reminder per
  collection, on the first run after `due_at` with a required item still missing and no reminder
  (PC or automatic) recorded on or after `due_at`; claim-before-send (conditional UPDATE stamps the
  reminder before the email goes out, at-most-once; recipients, sender, link, and the optional
  site-visit read all resolve before the claim, and a delivered email whose receipt fails to attach
  is counted as `receiptFailed`, not as a transport failure), sent from the creating PC's mailbox to
  the collection's contacts, `?dryRun=1` supported. **Built but not scheduled**: the `vercel.json` entry
  is the owner's decision (M5). **Staff signal for `replay_ambiguous`:** the contributor finalize
  records one durable operational event (`site_visit_material_replay_ambiguous`, error, keyed on the
  staging id) when it holds a staged upload, so staff see the hold in Admin operational events.

### 16.4 2026-09-10 UX pass (Build D)

Owner feedback after the first production smoke (ZZTEST-03). Four items, built on
`claude/materials-ux-pass`:

1. Invitation and reminder emails now render through a new site-visit-materials email helper
   (`renderMaterialsEmailHtml`), mirroring the grantee/reviewer button-plus-fallback-link pattern
   instead of the raw-URL paragraph from `renderPlainTextEmailHtml`. The invitation button reads
   "Upload site visit materials"; the reminder button reads "Upload the missing items".
2. Copy only: the upload page and the invitation email no longer tell the applicant the link
   stays open past the meeting (`closes_at`, the token expiry, and the auto-close sweep are
   unchanged).
3. A failed finalize now offers "Choose a different file" alongside "Retry" in `SlotUploader`,
   clearing the abandoned pending staging key client-side and minting a fresh staging id. The
   abandoned staging row itself is left alone: it is swept by the existing portal-upload-staging
   TTL sweep (60-minute row expiry, then pruned after the retention window) via the daily
   maintenance cron's "Private portal-upload staging cleanup" step — no new cleanup was added.
4. The upload page shows a "Need help?" mailto footer using the `support` alert-recipients
   category's first configured address (`getSupportEmail()` in `contributor-service.js`; no
   fallback to `default`), surfaced as `supportEmail` on the context response.

### 16.5 2026-09-11 (S507): optional "other" upload hidden from applicants

Owner decision: the "Anything else you would like the Foundation to have" uploader is hidden, not
retired. `SITE_VISIT_MATERIALS_OTHER_UPLOADS_ENABLED = false` in `shared/config/siteVisitMaterials.js`
gates all three seams together: the contributor page does not render the slot, the upload-token
mint refuses `slot=other` (400, no staging row), and `finalizeMaterialUpload` refuses it
(`slot_not_open`). Storage path, folder, artifact type, and the "Other files received" list stay
built; §6.2 item 7 describes the re-enabled behaviour. The reminder cron is unaffected in either
state: `missingRequiredItems` reads only checklist items, and `other` is never a checklist key.

### 16.6 2026-09-11 (S507): PC manual reminder claims before sending

Owner decision: the PC's "Send reminder" (`remindMaterialsContributors`) now claims before sending,
the same shape as the automatic sweep — resolve everything the send needs, claim, send, attach the
email id. Unlike the sweep's claim (`claimAutomaticReminder`, gated on being past due), the manual
path is allowed at any time on an open collection, any number of times: `claimManualReminder`
(`lib/services/site-visit-materials/collection-store.js`) is a single conditional UPDATE that stamps
`last_reminder_at = NOW()` and increments `reminder_count` only when the collection is `open` and no
reminder (manual or automatic) was stamped in the last 60 seconds; a lost claim throws
`site_visit_materials_reminder_just_sent` (409). This serializes the PC click against a concurrent
cron run so a click during the daily sweep can never produce two reminder emails. `recordReminder`
is removed; nothing else referenced it.
