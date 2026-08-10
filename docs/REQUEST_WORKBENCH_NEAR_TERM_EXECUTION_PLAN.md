---
title: "Request Workbench — near-term execution plan"
domain: architecture
kind: plan
status: canonical
summary: "Initial Assessment core flow, native version restore, and first-stage recovery are proven; administrative and milestone controls remain."
canonical: true
cataloged: 2026-07-26
last_verified: 2026-08-10
owner: product-engineering
related:
  - docs/audits/AUDIT_REQUEST_WORKBENCH_TRUTH_2026-07-26.md
  - docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md
  - docs/CURRENT_WORK_QUEUE.md
  - docs/GROUP_B_WRITEUP_SPINE_DESIGN.md
---

# Request Workbench — near-term execution plan

## Outcome

Over the next few weeks, turn the Workbench from a mixture of mature reviewer
functionality, partial AI synthesis, and old design assumptions into a deliberately
sequenced lifecycle product. The immediate goal is not to fill every placeholder. It is
to make the current review stage reliable, lock the contracts for the next deadline-bound
stage, and then build only the smallest complete slice needed on time.

This plan is grounded in the 2026-07-26 truth audit. Runtime truth still belongs to source,
the Atlas, tests, and live probes.

## Calendar gate

The first internal target was **2026-08-10**: the shared governed-artifact
foundation and the J27 Initial Assessment working end to end in draft form,
ahead of proposal intake beginning around **2026-08-18**.

> **Status as of 2026-08-10 (S413) — this date is NOT a live deadline.** The owner
> classified 2026-08-10 as a **deliberately early internal buffer, not an external
> commitment** (owner, 2026-08-10 / S412; recorded in `docs/CURRENT_WORK_QUEUE.md`
> row 1). It has now passed without being met — the administrator evidence is still
> outstanding with Connor — and **that is expected, not slippage.** Do not raise it
> as a missed deadline or plan around it as a date. The real gate is the completion
> decision in the work-queue row: administrator policy/access evidence obtained, and
> product history/milestone controls recorded or built. The remaining external date,
> proposal intake around **2026-08-18**, is unchanged.
>
> References to "August 10" further down this document are retained as the original
> plan's framing and as records of owner decisions made at the time. Read them
> against this status note, not as live commitments.

The August 10 acceptance path is a real human-in-the-loop pilot. On
2026-07-30, Request `1002788` completed the mechanics in steps 1–4 and 6
below, proved same-input no-duplicate retry, and created native SharePoint
version history. It used an old Phase I proposal rather than the current Phase
II reviewer package, so it did not complete step 2's approved-input or
semantic-content requirement:

1. authorized staff starts Initial Assessment generation for a dedicated
   representative dummy production request through the intended Workbench
   entry point;
2. the server reads the real proposal and authoritative Dataverse metadata,
   executes the governed prompt, and creates the canonical Word artifact in
   the governed SharePoint location;
3. Dataverse records the typed artifact identity, exact SharePoint item/version,
   template/prompt/run provenance, lifecycle state, and last-modified context;
4. the Workbench displays the created artifact and opens that same file in
   Word;
5. a staff tester reviews and edits the canonical Word document, and the saved
   SharePoint version remains discoverable from the Workbench; and
6. the cycle-wide pilot locator lists that same registered artifact and lets
   an authorized staff tester find and open it without navigating request by
   request. This proves the shared read contract, not the full Editor Dashboard.

The pilot must use representative source data and human review, not route
mocks or UI-only placeholders. The owner decided 2026-07-29 to use a
controlled production rehearsal with colleague-created dummy requests rather
than build the existing Dataverse sandbox organization into an integrated
application/file test environment. Request `1002788` became the authorized
pilot target. Its same-input retry passed, but the intended post-upload
recovery path exposed whole-package byte-hash drift when SharePoint
canonicalized the DOCX, and the historical linked Executor run has a null
request lookup. The proposal source was also later identified as an old Phase
I proposal. Production commit `9c88a1fa` now hashes normalized governed
Word parts and passes `requestId`; focused synthetic tests and the actual pilot
packages verify the hash complement. Request `1003109` subsequently
production-proved a verified canonical proposal, one new linked AI run, and
exact-input reuse on merge commit `84155a5a`. A controlled production
interrupted-finalization exercise then restored the same registry row,
request pointer, AI run, and SharePoint item/version without another model
call or upload. An attributed substantive staff edit then advanced the same
item to SharePoint version `2.0`, replaced the Foundation Opportunity marker,
and remained discoverable through both consumers. The edit showed that
Dataverse retains upload-time version `1.0` metadata. Response-only
Graph-current refresh and display in both consumers are deployed and
live-verified on Request `1003109` via production deployment
`dpl_HhiYXVFAtsGMwjU9UDcKz22AfvR2`. Target-library protection checks remain
required before the pilot is complete. A controlled disposable-file audit
subsequently proved previous-version inspection/restore and signed-in
first-stage recycle recovery in the production Request library. It did not
prove the configured version limit, second-stage administrator recovery,
site/library Purview retention, or ordinary-editor least privilege; Workbench
history/admin restore and milestone snapshots also remain unbuilt.
Passing this draft-functional gate is not a broad production-readiness claim
and never required the later Pre-Site, Site Visit, or Final slices to be built
alongside it.

“Week 1/2/3” below remain relative execution windows for later lifecycle work
until those stages receive their own deadlines.

## Owner-decided lifecycle and document foundations — 2026-07-28

These decisions now constrain every remaining writeup slice:

### Lifecycle meaning

- **D26:** the Initial Writeup placeholder corresponds to the approximately
  one-page staff Phase I writeup completed before the Workbench was built. Do
  not backfill or reinterpret it as a live D26 workflow.
- **J27:** every complete single-submission proposal receives an AI-generated
  **Initial Assessment** before the staff merits discussion and Board
  advancement decision.
- Staff deliberate from the Initial Assessments and recommend a subset to the
  Board. The Board's decision to advance is recorded through the Workbench
  dashboard and marks the internal Phase II transition.
- Phase II remains a business-process stage but creates no second applicant
  submission. Reviewer recruitment, returned reviews, and Pre Site Visit work
  use the original full submission.

The historical Group B proposal's `triage = Advancing` generation trigger is
therefore wrong for the J27 Initial Assessment: an artifact used to decide
advancement must exist before advancement and for every in-scope proposal.

### Document authority

- SharePoint Word is the canonical editable narrative and co-authoring surface.
- Dataverse is the canonical registry for request/cycle/artifact identity,
  stable SharePoint drive/item/version references, lifecycle state, structured
  decisions, and workflow/audit metadata.
- The Workbench is the per-request creation, discovery, preview, open-in-Word,
  workflow, milestone, and authorized recovery surface.
- A planned cycle-wide **Editor Dashboard** is the cross-request discovery and
  progress surface for Allison and the staff-wide writeup audience. It
  opens the same registered SharePoint artifacts; it does not create another
  editable copy.
- Do not maintain a second independently editable copy of the Word body in a
  Dataverse memo. Derived extracted text may exist only as a version-keyed,
  rebuildable search/AI representation.

### Search

Microsoft Graph Search can search indexed body text in SharePoint Word and PDF
files. The current `GraphService.searchFiles()` implementation and a read-only
tenant probe prove that capability, but the present method is limited to 100
hits, has no pagination, and is exposed only through Dynamics Explorer.
Workbench search must add authorization, pagination/completeness, typed
Dataverse result joins, lifecycle filters, and an explicit index-freshness
posture. Dataverse remains the structured-filter layer; SharePoint remains the
file-body search layer.

### Version and data protection

- Before a target library is approved, verify its version limits, restore
  behavior, recycle-bin recovery, Purview retention, and editor permissions.
- Ordinary collaborators need content-edit rights, not uncontrolled
  delete/move/rename/permission/version-deletion rights.
- The Workbench must show current version and last-modified metadata, link to
  version history, and restrict restore to an approved administrative role.
- Every official Board milestone must retain the exact SharePoint item/version,
  actor, timestamp, content hash, and a protected DOCX and/or PDF snapshot.

**Controlled audit result 2026-07-30 local / 2026-07-31 UTC:** native version
listing, prior-version content inspection, restore to a new current version,
exact byte recovery, and signed-in first-stage recycle restore all passed in
the production Request library using disposable probes. Justin's account was
denied the second-stage administrator recycle-bin view. The app's
`Sites.Selected` token could read the drive/list but received `403` when
enumerating site permissions. An item-level retention-label read returned no
label fields, which does not establish whether a site/library Purview policy
applies. Library version limits, second-stage recovery, retention, and
ordinary-editor permission design therefore still require administrator
evidence. The Workbench current-metadata portion is live; its version-history
link/admin restore and the Board milestone freeze remain planned.

### Cycle-wide editing

Allison historically reviewed and edited writeups from one designated
SharePoint folder. Removing that folder-browsing workflow must not force her to
open each request separately in the Workbench.

The planned replacement is a staff-wide **Editor Dashboard**, not the broader
historical “Executive Dashboard” proposal. Allison remains a primary user, but
all PDs are expected eventually to evaluate the materials and designated staff
proofreaders also need access. Its minimum contract is:

- one cycle-scoped list of registered writeup artifacts, with request,
  institution, program/PD, artifact stage, lifecycle state, and last-modified
  context;
- direct preview and **Open in Word** against the canonical SharePoint file;
- filters for cycle, program/PD, artifact stage, and editing/review state;
- an explicit per-editor **Reviewed** marker to distinguish “reviewed; no
  changes needed” from “not yet reviewed”; and
- personal progress such as “reviewed N of M.” A coordinator matrix may be
  added only if Sarah or another coordinator needs it.

“Reviewed” is a progress signal, not an approval gate. SharePoint revisions or
tracked changes may provide a secondary “has edits” hint, but they cannot
replace the explicit marker. The audience direction is staff-wide, including
all PDs and designated staff proofreaders; exact app/file authorization still
must be enforced rather than inferred from employment. Marker granularity
(request versus artifact stage), coordinator view, and app-access key remain
open. The first draft-functional delivery gate was the August 10 internal
buffer (see the Calendar gate status note — passed, not a live deadline). App
visibility and SharePoint file permission are separate controls and both must
be enforced.

The detailed target contract and current-vs-planned boundary live in
`docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`.

### Document lineage and Site Visit dossier

**[VERIFIED via owner decisions 2026-07-28; implementation PLANNED.]**
The three writeup stages are three distinct governed Word documents:

1. **Initial Assessment** — the J27 proposal-level assessment used for staff
   deliberation and the Board advancement decision. The D26 Initial Writeup
   placeholder remains historical and requires no backfill.
2. **Pre Site Visit Writeup** — the pre-decisional staff briefing. Its stable
   proposal-derived core may be created when a request advances, while its
   review analysis is refreshed explicitly from the reviews then available.
   Every distribution version must state its review coverage and as-of time,
   and the Workbench must mark the working document stale when later review
   evidence arrives.
3. **Final Writeup** — a separate Word document created from the latest
   Pre Site Visit version available when staff invokes creation. The registry
   must preserve the source artifact and exact source version used for that
   copy. The Final then evolves independently as the PD incorporates the visit,
   late reviews, transcript evidence, and staff edits. A rare, explicit
   regenerate-from-latest action is required, but it must preserve the prior
   Final version and must never silently overwrite staff edits.

There is no fourth “Site Visit Writeup.” The Site Visit tab is a dossier that
brings together structured visit metadata, applicant slides and other
applicant materials, recordings, transcripts and their derived summaries, and
staff observations. Pre-Site distribution snapshots and the Final Writeup
remain linked lifecycle documents rather than Site Visit material categories.
“Create Final Writeup” copies the latest Pre-Site version at action time into
the separate Final artifact; it does not rename or overwrite the Pre-Site
document.

Internal staff receive the canonical Word link. When a Board member or
consultant without staff access joins a visit, the minimum external
distribution path is a PDF attachment representing an exact frozen Pre-Site
version. Staff send that attachment through the ordinary approved email path;
an external document-sharing portal is not required for this use case.

The Pre-Site document is informational and normally does not need a Reviewed
marker. The Final Writeup may expose a soft, optional Reviewed acknowledgement
for expected readers, but that signal is not an approval/sign-off gate.
Board-ready freeze remains a separate owner-controlled milestone.

### Initial Assessment source and first-template contract

**[VERIFIED 2026-07-30 via four owner-supplied D26 Phase I Word examples,
current source, production Dataverse/Graph readback, and signed-in Workbench
checks; production schema, governed prompt v1, and application LIVE; controlled
pilot PARTIAL.]**
The D26 examples provide the starting content contract for the J27
Initial Assessment. Each is a one-page Word document with this sequence:

1. the applicant-submitted proposal title;
2. the institution display name;
3. **Summary** narrative;
4. a **Rationale** heading; and
5. four labeled rationale bullets: **Significance & Impact**, **Research
   Plan**, **Team Expertise**, and **Foundation Opportunity**.

The approved automated proposal input is exactly
`Reviewer Materials/Proposal_{Request#}.pdf` in the active request's
Dynamics-associated `akoya_request` SharePoint folder. Initial Assessment and
Workbench Field Primer request mode share that strict contract. They must fail
before any model or result write when the exact active file is missing or
ambiguous; they must not silently fall back to the D26 Proposal-tab
`Phase I/ProjectDescription.pdf` display bridge. Reviewer Finder is a separate
staff discovery surface: for the current cycle only, its default loader first
prefers the same exact canonical file and then falls back to exactly one active
`Phase I/ProjectDescription.pdf`. That bounded compatibility rule does not
change the approved governed-artifact input or external reviewer visibility.

The AI drafts Summary, Significance & Impact, Research Plan, and Team
Expertise from the approved proposal inputs. **Foundation Opportunity is a
staff-authored section.** Generation must create a clearly visible editable
slot for it and mark staff completion as outstanding; the model must not
invent Foundation Opportunity prose merely to make the document appear
complete.

The title and institution are authoritative Dataverse metadata rather than
model output:

- **Institution:** use `akoya_request.wmkf_organizationname` when populated,
  otherwise the formatted applicant lookup
  `_akoya_applicantid_value_formatted`. The current Workbench resolver already
  applies this fallback. All four supplied D26 example rows have a null direct
  organization-name field and obtain the expected institution display name
  from the applicant lookup.
- **Title:** use the applicant-submitted proposal title in
  `akoya_request.akoya_title`. Do not use the later house-style Keck title in
  `wmkf_wmkfprojectdescription` for the Initial Assessment. The current
  Workbench resolver already selects `akoya_title` and returns it as `title`,
  so this metadata input is available without waiting for the post-decision
  Keck-title workflow.

The four D26 examples place an italic “To …” Keck title at the top, and a
read-only production probe matched those displayed titles to
`wmkf_wmkfprojectdescription`. That verifies the examples' provenance but does
not make the field part of the J27 Initial Assessment contract. The owner chose
the applicant-submitted title because the house-style Keck title is created
later, after advancement.

These examples establish the first semantic structure, not a permanently
hard-coded layout. The exact format remains in flux during the single-phase
transition. Treat the sample structure as the starting point for iteration,
implemented through a versioned, replaceable template with recorded
template/prompt provenance so spacing, styles, labels, and future cycle
structures can change without rewriting prior artifacts.

### Pre Site Visit input, regeneration, and template contract

**[VERIFIED via owner decisions 2026-07-28; document pipeline PLANNED.]**
The Pre-Site draft has two independently refreshable source layers:

1. **Proposal-derived factual material.** Use the full proposal text with an
   iterated form of the existing `phase-ii.summarize` prompt. Where the
   document repeats authoritative request metadata such as institution,
   requested amount, project period, or named request relationships, source
   those values from Dataverse rather than asking the model to infer them from
   the proposal.
2. **Review-derived material.** Use the exact **currently submitted review**
   population for two separately rendered outputs; staff do not select a
   subset:

   - a deterministic named reviewer roster composed by application code, with
     the engagement-specific accepted `wmkf_revieweraffiliation` first, the
     potential-reviewer person's primary affiliation as fallback, and an
     explicit missing-affiliation state; and
   - anonymous analysis from `review-synthesis.generate`, whose observations
     continue to say “a reviewer” / “reviewers” rather than naming the person
     who made a point.
   Staff may edit the resulting synthesis in the canonical Word document, but
   the template—not the model—renders reviewer names and affiliations. Contact
   `parentcustomerid` is not a prerequisite for the roster.

The two named prompt surfaces do not currently have the same runtime posture:

- **[VERIFIED via
  `shared/config/prompts/phase-ii-dynamics.js`, `pages/api/process.js`, and a
  read-only production prompt inventory probe on 2026-07-28.]**
  `phase-ii.summarize` has one current production v1 row and a tracked config,
  but the retained sunset-candidate PDF route still calls the older
  `createSummarizationPrompt()` builder; the row currently drives nothing.
  The new Dataverse-native Pre-Site producer must adopt, iterate, and execute
  the governed prompt through the shared Executor rather than extend the
  retained PDF-upload route.
- **[VERIFIED via
  `lib/services/review-manager/synthesize-reviews-service.js`.]**
  `review-synthesis.generate` already receives a server-composed digest of all
  selected review engagements carrying `wmkf_reviewreceivedat`, reads their
  answer snapshots, and supports deliberate regeneration. Its current service
  requires at least one submitted review.

The Site Visit date governs distribution; review completeness does not.
Therefore:

- zero reviews must not block creating or distributing the Pre-Site document;
  the review section states that no reviews were received as of the document's
  evidence timestamp;
- one or more reviews use the latest `review-synthesis.generate` output and
  disclose submitted-review count/coverage and as-of time; the same evidence
  snapshot supplies the named affiliation roster, so roster and synthesis
  cannot silently describe different reviewer populations;
- a late review makes the review-derived section stale and permits
  `review-synthesis.generate` to run again;
- rerunning review synthesis does not regenerate the proposal-derived core;
  and
- because staff may have edited the Word prose, a new synthesis must not
  silently overwrite that section. The Workbench presents a deliberate
  refresh/incorporation action and preserves the earlier distributed version.

The Final Writeup initially inherits the exact named roster and anonymous
review section from the selected Pre-Site version. If staff deliberately
incorporates late reviews into the Final, the roster, coverage/as-of stamp, and
anonymous synthesis refresh together as one review-evidence snapshot; the
prior Final version remains preserved.

Use the supplied Pre-Site and Final example documents plus the current prompts
as the starting design reference. Formatting and section structure may change
between cycles. The implementation must therefore use a versioned,
replaceable Word template rather than hard-code layout in a Workbench
component. Each generation records the template identity/version and prompt
identity/version. A structural change publishes a compatible prompt/template
pair for new documents without rewriting earlier artifacts. The exact initial
template and template-storage mechanism remain to be approved during the
writeup slice.

### Site Visit dossier content contract

**[VERIFIED via owner decisions 2026-07-28; implementation PLANNED.]**
The Site Visit dossier captures this structured visit information:

- visit date;
- start and end time, with time zone;
- in-person, virtual, or hybrid format;
- physical location and/or meeting link;
- lead PD;
- participating WMKF staff;
- applicant participants; and
- participating Board members or consultants.

Do not add a separate visit-status field such as Scheduled, Completed,
Cancelled, or Rescheduled unless a consuming workflow is later identified.

The dossier's material categories are limited to:

1. applicant slides;
2. other applicant materials;
3. recording;
4. transcript;
5. transcript summary; and
6. staff observations.

The first five categories are file-backed artifacts. Staff observations are
one paste-friendly notes area for the lead PD; the product does not require
separate entries, authors, or timestamps. Normal Dataverse audit and
modified-by/modified-on metadata may still protect the record behind the
scenes.

Do not introduce a general app-level revision chain or current-version selector
for staff- or system-managed Site Visit materials without observed need.
Register each file independently and display both if an unexpected second file
appears in the same category rather than inferring that one replaces the
other. The applicant upload surface is the narrow exception: while authorized
access remains active, an applicant may deliberately delete or replace an
applicant-material file. That action must be explicit and recoverable rather
than inferred from category or filename. Native SharePoint version/recycle
history and Dataverse audit/provenance remain the protection layers. Transcript
summaries still record the exact source transcript item and version/hash so
their evidence provenance is unambiguous.

### Site Visit applicant materials and transcript summaries

**[VERIFIED via owner decision 2026-07-28; implementation PLANNED.]**
A narrow **Site Visit Materials Upload** surface is planned within the
Workbench lifecycle. It does not reopen the parked general applicant-intake
product. An authorized staff user manually triggers the request from the Site
Visit workflow. Entering or changing a visit date does not send the email
automatically. Any authenticated staff member with access to the Workbench Site
Visit workflow may send, resend, or reissue the request; there is no lead-PD or
administrative-role restriction. The visible sender/reply-to and whether or
how the lead PD is copied remain unresolved. The owner will settle those
questions with staff before implementation. Historically, non-PD staff usually
sent these requests without PD involvement; that is context for the discussion,
not the future contract. Site Visits are scheduled soon after a request advances,
roughly when reviewer invitations begin. Once the visit date is recorded, the
manual request action is available and staff chooses when to send it; review
receipt, review synthesis, and Pre-Site Writeup readiness do not gate the
action. Recipient choices come from the request's Dataverse-linked liaison and
PI. The normal default is the
liaison in **To**; staff may instead address the PI and optionally copy the
liaison. The server re-resolves the selected contacts and email addresses from
Dataverse at send time rather than trusting client-supplied addresses. No
free-form recipient requirement is established for the minimum product. The
owner expects the liaison/PI data to remain complete and non-duplicative. The
send boundary must still fail closed if the selected contact is missing, has no
valid email, or the selected To/CC records resolve to the same address; staff
corrects the Dataverse contact data rather than typing a substitute address.
The server sets link expiration to exactly 60 days after the invitation is
successfully sent. Staff do not enter or edit an expiry date, and moving the
Site Visit date does not change the expiration.

While the current link is active, **Resend invitation** sends that same link
again and retains its original expiration. It never silently extends access.
**Reissue link** is a separate deliberate action that revokes the prior link,
creates a replacement, and starts a new 60-day period from the successful
reissue send. An expired or revoked link cannot be resent as though it were
active; staff must reissue. This is also the recovery path when staff needs to
restart the process. A failed replacement attempt must not destroy a still
active prior link: stage the replacement, have the email transport accept the
new invitation, and only then activate the replacement and revoke the old
link. If no active link exists, a failed attempt leaves none active and staff
may restart again.

The minimum product has no standalone **Revoke upload link** action. The
Foundation wants the invited recipients to respond, normal access ends through
the 60-day expiry, and Reissue already revokes the superseded link as part of a
safe replacement. This does not remove the underlying revocation state needed
to enforce Reissue.

The recipient sees only the request identity, upload instructions, permitted
material types, and the applicant files they are authorized to manage. The
recipient must not select a Dataverse record, SharePoint folder, or destination
identifier. The server resolves those from the signed request context,
validates the operation, places the bytes inside the request's governed
SharePoint folder under `Site Visit/Applicant Materials/Slides` or
`Site Visit/Applicant Materials/Other`, and registers the artifact and its
provenance in Dataverse.

Applicant-facing uploads are limited to **PDF** and **PPTX** files in the
**applicant slides** and **other applicant materials** categories. Multiple
upload sessions are allowed while access remains active. Each file may be up to
**1 GB**, and a request may have at most **20 current applicant files** across
the two categories. Retired/replaced versions do not count toward that current
file limit. A request already at 20 current files may still replace one of
those files: the replacement operation reserves the target's slot and makes
the new registry row current only as the prior row becomes retired. A
twenty-first unrelated current file remains blocked. The 1 GB ceiling leaves
approximately fourfold headroom over the roughly 250 MB files the owner has
encountered; no known file has exceeded 1 GB.

The applicant sees only the current file list and may delete or replace an
authorized current file. Replacement must first persist and register the new
file successfully so a partial failure does not remove the prior working file.
The prior registry record remains as retired/removed provenance, and native
SharePoint version/recycle recovery protects the bytes. The minimum product has
no applicant restore function and no dedicated Workbench restore button for
these materials; authorized staff recover through SharePoint when needed.
Recording, transcript, transcript summary, and staff observations remain
staff- or system-side categories and are never manageable through this link.

The email contains one shared request-scoped bearer link. Both the **To** and
**CC** recipients may use it and manage the same applicant-material file list.
The system records actions against the request/link, but without sign-in or
separate personalized links it must not claim whether the PI or liaison
performed a particular action. The applicant sees the current file list and
success/error confirmations, not an activity log. Staff sees each upload,
replacement, and deletion with file name, category, size, timestamp, request,
and link identity; the audit does not label the actor as PI or liaison.

Cross-store partial-failure handling is an engineering acceptance invariant,
not an owner workflow question. The build must never report success until both
the SharePoint file and Dataverse registry state are reconciled, must preserve
the prior working file when replacement fails, and must expose a retryable
staff-visible exception instead of silently orphaning or deleting evidence.

Successful applicant-material uploads, replacements, and deletions are
summarized in a short automated digest rather than generating one email per
operation. The digest goes to the lead PD and the relevant staff audience. A
designated program coordinator may be part of that audience, but staffing is
changing and the product must not hard-code the PC as the only additional
recipient. The exact recipient policy and short batching window remain to be
settled with staff.

**[VERIFIED 2026-07-28 via current source and vendor documentation; feature
implementation PLANNED.]** File bytes belong in SharePoint, not Postgres or
Dataverse. Postgres may hold expiring-link and resumable-upload workflow state;
Dataverse holds the typed artifact registry and provenance. SharePoint Online
allows an individual file up to 250 GB, and Microsoft Graph upload sessions
accept sequential fragments smaller than 60 MiB. Dataverse file columns can
reach 10 GB only through chunked APIs, while an ordinary PostgreSQL variable
field has a 1 GB logical ceiling; neither is the chosen byte store. The current
`GraphService.uploadFile()` buffers the whole file and deliberately stops at
60 MB, and the current external reviewer upload route caps files at 25 MB.
Therefore, supporting applicant files that are impractical to email requires a
new resumable/chunked Graph upload-session path; the existing buffered helper
must not simply have its limit raised. The product cap is 1 GB per file and 20
current applicant files per request. The target-library and large-file
malware-scanning paths must still be proved before implementation is complete.

The recording and transcript remain the authoritative visit evidence. A
transcript summary is a derived, version-bound artifact. Prefer the summary
produced by the approved transcription platform when one is available and
acceptable; do not automatically make a second suite LLM call. A suite LLM
summary is a deliberate fallback when the platform supplies none, staff
requests regeneration, or the supplied summary fails the approved quality
contract. The registry must identify the summary producer/system, source
transcript item and version/hash, generation time, and current/stale state.
The operational transcript workflow still requires coordination with a
program coordinator; provider, handoff, timing, and ownership details remain
pending.

## Production review-synthesis smoke — reliability proven

On 2026-07-27, the owner-authorized staff-triggered production smoke ran against
Request `1002788`. A reversible synthetic review was entered through the normal
staff Manual Review Entry path and verified before regeneration.

The first and only regeneration attempt failed cleanly:

- `POST /api/review-manager/synthesize-reviews` returned HTTP 500;
- Vercel and Dataverse recorded
  `Claude output not valid JSON: Unexpected end of JSON input`;
- failed AI run `be61f383-f289-f111-ab0f-70a8a59cded0`
  (`2026-27-07-1355`) resolved `review-synthesis.generate` v2
  (`7423049a-3f89-f111-ab0f-7ced8d3d15a6`) with
  `claude-sonnet-5`, source `Vercel Interactive`, and a redacted
  `reviews_digest` override;
- the request memo was never partially written: it remained 1,709 characters,
  SHA-256
  `a91f05cc0a20cad72341db9d7fc5fe808ed3b28610a35dfdaca82d69beebbcba`,
  with `modifiedOn=2026-07-24T18:43:25Z`; and
- the synthetic review was fully restored: zero staged answers, no draft, the
  four staged suggestion fields back to baseline, and all other target/sibling
  fields—including email, reminder, materials, and thank-you markers—unchanged.
  The append-only failed AI audit row intentionally remains.

That bounded failure supplied the diagnosis baseline. On 2026-07-28, governed
`review-synthesis.generate` v3
(`660d7e3f-9e8a-f111-ab0f-000d3a31c468`) was published with the exact tracked
native JSON-schema contract and verified as the sole current row. A second,
owner-authorized Request `1002788` smoke then completed on its first semantic
attempt with `end_turn`, persisted a valid five-key synthesis, and wrote
completed AI run `20aec518-9f8a-f111-ab0f-6045bd018deb` against prompt version
3. Cleanup atomically removed the 11 staged answers and restored the four
parent fields while preserving the new synthesis and append-only audit.
Reliability is therefore production-proven; reviewer exposure remains gated by
the separate multiselect rollback/legacy-writer/final-smoke sequence.

## Week 1 — close the current Reviews contract

### 1. Make synthesis generation reliable — completed 2026-07-28

- Use the three controlled current-v2 failures, including the 2026-07-27 run
  above, to diagnose the incomplete/truncated-JSON failure.
- Decide whether the fix belongs in the prompt, model/output settings, structured parsing,
  bounded retry/repair, or a combination.
- Preserve the shared Executor contract and audit trail.
- Add characterization tests for malformed/truncated output and write-on-success only.

Exit: repeated controlled runs produce valid, persisted synthesis or a clean failure with no
memo write.

Completed: v3 is the sole current governed prompt, and the first controlled
post-fix run persisted valid synthesis with a completed, prompt-linked audit
row. The three v2 no-write failures remain append-only historical evidence.

### 2. Implement the owner-approved lifecycle — deployed and enabled 2026-07-28

- Generation readiness: automatic only when every participating invitation is complete.
- Manual staff override: allow an early run with explicit confirmation.
- Stored-output visibility: show an existing synthesis independently of current readiness.
- Regeneration: always deliberate and auditable.
- Participation population (owner-confirmed 2026-07-27): selected,
  not-applicant-excluded rows that have entered invitation/engagement
  (`wmkf_invited=true` or `wmkf_accepted=true`).
- Resolved with content: `wmkf_reviewreceivedat` is set. Resolved without
  content: declined, no-response, `withdrawn_sufficient`, withdrew, released,
  or the current token is revoked/expired.
- Blocking: any other participant with no receipt, including a live-token
  not-yet-accepted invitee; malformed/unknown state fails closed.
- Removed/excluded/merged-away rows do not participate. An unresolved duplicate
  that still satisfies the population rule blocks.
- Require at least one submitted review before either automatic generation or
  the existing staff override.
- Replacement-token minting clears revocation and assigns a future expiry. It
  reopens readiness only when token state was the otherwise-participating,
  nonterminal row's sole resolved-without-content condition; it does not undo
  removal or a terminal outcome. Keep an older synthesis visible but treat it as
  not current until synthesis runs again after genuine reactivation and
  resolution.

Exit: one documented state machine, one tested readiness calculation, one automatic trigger
path, and one manual override path.

Production result: the state machine, exact digest+lifecycle fingerprint,
manual early-confirmation path, durable Postgres job/currentness ledger, and
feature-gated automatic drain are implemented with focused tests. Stored output
is visible independently of submitted count and is labeled Current/Stale from a
matching completed fingerprint. Merge `70956477` reached READY production
deployment `dpl_2tgAYjUXFFx4nQo7FgE2Z3TBMqP9`; production migration 028 is live.
Signed-in manual/read-only verification then passed, Production automation was
enabled, and the controlled Request `1002788` automatic smoke completed in one
claim: job `2`, maintenance run `27723`, and prompt-v3 AI run
`1b882cf6-bf8a-f111-ab0f-7ced8d3d15a6` completed. Exact cleanup removed the 11
temporary answers, restored the four parent fields, left no draft, and returned
the global census to zero eligible requests; the retained memo correctly became
Stale after cleanup. PR #98 fixed the run-source defect found by the first
pre-LLM attempt, and PR #99 fixed stale-claim cancellation before content
loading. Final deployment `dpl_FdUJSjNwhbNWKWVzpyymiB2mpJo1` is Ready; a
post-deploy authenticated drain returned zero eligible/enqueued/claimed/failed.

### 3. Finish Reviews observability — deployed and automation enabled 2026-07-28

- Surface last-generated time and generation state.
- Keep generation errors visible and actionable without hiding returned reviews.
- Record the production-smoke evidence in the Reviews buildout plan.

Production result: the DTO/UI expose readiness, queued/running/failed state,
last/current completion time, sanitized failure detail, and Current/Stale status
without hiding returned reviews. Signed-in verification passed before enablement
and again after cleanup, with the retained synthesis visible and correctly Stale.

## Week 1–2 — lifecycle design freeze

Hold one focused product/engineering review for each remaining placeholder. Every tab must
leave the review with this contract:

| Contract field | Required answer |
| --- | --- |
| User and moment | Who uses it, and at what lifecycle event? |
| Inputs | Exact Dataverse fields, SharePoint files, reviews, synthesis, or staff entry used. |
| Producer | Manual staff action, app action, Power Automate, or status event. |
| Persistence | Exact Dataverse column/child row and SharePoint path/file contract. |
| Consumer | Workbench tab, Word, Editor Dashboard, downstream automation, or board material. |
| Readiness | The condition under which generation/editing is allowed. |
| Regeneration | Overwrite/version/history behavior. |
| Access | Who may read, generate, edit, and approve. |
| Failure recovery | What staff sees and how the operation is retried safely. |
| Search | Which body/metadata searches are required, their scope, freshness, pagination, and authorization. |
| Version/data protection | Version limits, restore rights, deletion recovery, retention, and milestone-freeze behavior. |
| Deadline | Fixed date and minimum viable outcome. |

Decision order:

1. **Pre Site Visit Writeup** — input and regeneration behavior are
   owner-decided. Next freeze its calendar, first versioned Word template,
   prompt/template compatibility contract, and artifact persistence/access
   contract.
2. **Site Visit** — the dossier metadata, six material categories,
   paste-friendly observations shape, and basic applicant file-management
   behavior are owner-decided. The materials request is a manual staff action,
   not a date-driven automatic send. Next freeze the sender/reply-to and
   lead-PD copy behavior after the owner's staff discussion, plus the exact
   automated-notification audience and digest window, the large-file scanner
   contract, recording/transcript/summary contracts, and persistence/access.
3. **Final Writeup** — freeze the latest-Pre-Site copy/lineage contract, safe
   explicit regeneration behavior, and the visit, late-review, and editorial
   inputs.
4. **Initial Assessment** — provision and exercise the source-built pilot
   before staff/Board advancement deliberation, then decide scale-out to every
   in-scope J27 proposal. The current D26 Initial Writeup placeholder remains
   historical and requires no backfill.

Explicit non-goals during design freeze:

- no expansion of the implemented pilot locator beyond its approved
  staff-wide cycle list/direct Word entry under the existing `reviewers` grant
  until the Reviewed-marker and coordinator-view contracts are fixed;
- no Reviewer Pool build without observed need and owner priority;
- no new writeup URL fields merely because the June proposal named them;
- no automatic status-driven workflow until its event, idempotency, retry, and ownership
  contracts are explicit.

## First deadline-bound slice — governed Initial Assessment pilot

> **Implementation checkpoint (2026-07-30): [VERIFIED via repository source
> plus Production schema/prompt apply and readback].** The branch implementation now includes the
> `wmkf_requestdocument` schema wave/adapter, governed prompt seed, versioned
> DOCX producer, `Artifacts/Initial Assessment/` destination, deterministic
> retry/recovery contract, Workbench Initial Assessment panel, and a cycle-wide
> **pilot locator** under the existing `reviewers` app grant. The locator
> supports the August 10 discovery/Open-in-Word path only; it is not the full
> Editor Dashboard minimum contract above and does not yet provide program/PD,
> stage, or editing-state filters, preview, current-version detail, or
> per-editor Reviewed progress. Unit tests prove Ready-row no-overwrite,
> atomic replacement-Ready/prior-supersession, exact-input reactivation, exact
> request-pointer fencing across concurrent first-time activations,
> approved path with a positively resolved request-library parent, claim-lost
> upload cleanup with operator-visible exact cleanup work on delete failure
> (manual cleanup; bounded primary capacity spills exact identities to durable
> overflow storage and then blocks further generation), canonical-file
> visibility during a failed replacement, false-success prevention after a
> post-upload registry failure, and
> intended content-hash recovery without a second AI call. The 2026-07-30
> pilot falsified whole-package hashing; the deployed runtime now uses a
> normalized governed-DOCX hash that matches the actual producer/v1 packages
> and distinguishes v2. A controlled Request `1003109`
> interrupted-finalization exercise then recovered the same registry row,
> request pointer, AI run, and SharePoint item/version without another model
> call, upload, overwrite, or duplicate. Mismatched content still triggers
> fresh-filename regeneration while retaining the prior item identity for
> operator cleanup. **[VERIFIED 2026-07-30]** The complete Wave 16 entity,
> relationships, alternate key, and request pointer are live in Production,
> and governed `initial-assessment.generate` v1 is live at
> `fc8a4c3b-5e8c-f111-ab0f-7ced8d3d15a6`. PR #102 merged as `1e958ee0`, and production deployment
> `dpl_AxxroabhpXLX1pz75MW6486fB4ci` is Ready on the expected aliases with a
> clean initial error scan. Requests `1002788` and `1003109` now provide the
> controlled production evidence described above. Request `1003109`'s
> attributed substantive edit then passed through both consumers on stable
> SharePoint item identity. Response-only Graph-current
> version/last-modified refresh is deployed and live-verified in both consumers
> on Request `1003109` via deployment `dpl_HhiYXVFAtsGMwjU9UDcKz22AfvR2`.
> A controlled production-library probe also passed native previous-version
> inspection/restore and signed-in first-stage recycle recovery. The remaining
> pilot acceptance work is the administrator audit of version limits,
> second-stage recovery, Purview retention, and ordinary-editor permissions,
> plus Workbench history/admin restore and milestone snapshots.

The Initial-Assessment-first minimum (set for the August 10 buffer) changes the
former default. Exercise the now-live
governed artifact spine through the J27 Initial Assessment first;
Pre Site Visit becomes a dependent reuse of that proven contract.

Build in producer-to-consumer order:

1. approve the input contract and prompt identity;
2. approve/provision the typed Dataverse document registry and governed
   SharePoint destination;
3. implement a request-bound server producer with idempotent retry behavior;
4. write the Word artifact to the approved SharePoint destination;
5. persist stable drive/item identity, current version/eTag, lifecycle state,
   and generation provenance;
6. render current state, version/last-modified metadata, and “Open in Word” in
   the Workbench through a read contract the Editor Dashboard can reuse;
7. add audit/observability, authorized version recovery, and explicit
   partial-failure handling;
8. verify full-text search, structured result joins, version restore,
   delete/recycle recovery, retention posture, and milestone snapshot creation;
9. run contract, security, Atlas, and browser/API verification;
10. after separate approval of production schema, prompt, and application
    promotion, complete the human-in-the-loop August 10 controlled-production
    pilot with designated staff and a dedicated dummy request, including a
    safe failure/retry exercise; and
11. reconcile every expected production write and retained/removed test
    artifact before deciding whether to scale beyond the dummy request set.

Exit: one dedicated production dummy request can move from ready inputs to a
durable, editable Word artifact and back to a visible Workbench state without
filename guesswork or silent partial success; an authorized user can identify
and recover a prior version; and the official milestone can be proven
independently of later working edits.

## Dependent lifecycle slices

- **Site Visit:** build the dossier read model and governed artifact paths,
  including the narrow applicant-material request/upload flow, only after the
  exact metadata, token, validation, persistence, and recovery contracts are
  approved.
- **Final Writeup:** create a distinct artifact from the latest Pre-Site
  version at action time, preserve that lineage, and add the approved visit
  and late-review inputs. A deliberate rare regeneration preserves the prior
  Final version and never silently overwrites staff edits.
- **Initial Assessment scale-out:** after the designated pilot, extend the
  proven path to every in-scope J27 proposal before staff/Board advancement.
- **Editor Dashboard:** reuse the typed registry and artifact read contract to
  provide the cycle-wide list, direct Word entry, and per-editor Reviewed
  tracking once its deadline and access contract are approved.
- **Overview:** add next-action/writeup signals only after their underlying state exists.

Do not parallelize these dependent slices merely to fill tabs. A proven shared writeup
contract should be reused; unproven assumptions should not be multiplied.

## Completion controls

For every slice:

- use `/contract-reconcile` across caller → persistence → consumer;
- use the evidence-first `/sweep` in domain-audit mode before changing durable truth claims;
- update the Atlas and route security matrix when contracts change;
- require write-on-success behavior and explicit partial-failure handling;
- run the relevant gate and then its self-test sequentially;
- promote to production deliberately under the campaign release strategy;
- record live-smoke evidence before changing status from planned/partial to verified.

## Decision log

Owner-decided:

1. J27 Initial Assessment purpose, audience, and pre-advancement timing;
2. SharePoint Word as canonical editable narrative;
3. Dataverse as typed registry/workflow/structured-decision authority;
4. Microsoft Search for SharePoint body search rather than a second editable
   Dataverse body; and
5. version recovery, retention, least-privilege editing, and immutable Board
   milestones as required parts of the artifact contract;
6. preserving Allison's cycle-wide review/edit workflow through a planned
   Editor Dashboard rather than requiring per-request Workbench navigation;
7. three distinct writeup documents, with Final copied from the latest
   Pre-Site version at action time and no separate Site Visit Writeup;
8. the Site Visit tab as a dossier for metadata, applicant materials,
   recording, transcript, derived summary, and staff observations;
9. PDF attachment as the sufficient external Pre-Site distribution path;
10. a narrow request-scoped Site Visit Materials Upload link that does not
    reopen the general applicant-intake product; and
11. transcription-platform summary reuse before any deliberate suite LLM
    fallback;
12. Pre-Site proposal material from an iterated `phase-ii.summarize` over the
    full proposal, with authoritative request metadata supplied from
    Dataverse;
13. review analysis from `review-synthesis.generate` over every currently
    submitted review, with deliberate rerun when a late review arrives;
14. Site Visit date—not review count—as the distribution gate, including a
    valid zero-review document state;
15. independent proposal/review refresh so a late review does not regenerate
    the factual core or silently overwrite staff-edited Word prose; and
16. a versioned, replaceable Word template, initially based on the supplied
    examples and existing prompts, with prompt/template provenance retained;
17. Site Visit logistics comprising date, time/time zone, format,
    location/link, lead PD, WMKF staff, applicant participants, and
    Board/consultant participants, without a separate status field;
18. Site Visit material categories limited to applicant slides, other
    applicant materials, recording, transcript, transcript summary, and staff
    observations;
19. one paste-friendly staff-observations area without a per-entry
    author/timestamp workflow; and
20. no general app-level Site Visit revision chain or current-version picker
    absent observed need, while applicant materials support deliberate,
    recoverable delete/replace and native SharePoint history remains a
    file-recovery layer;
21. applicant-facing material formats limited to PDF and PPTX;
22. additional uploads allowed while access remains active; and
23. applicant-material changes notify the lead PD and other relevant staff
    through a short automated digest rather than a message per operation; the
    exact additional audience and batching window still require staff input,
    and the design must not hard-code a program coordinator as the only
    additional recipient;
    and
24. the applicant-material request is manually staff-triggered rather than
    automatically sent when the Site Visit is scheduled or its date changes;
    and
25. request recipients are selected from the Dataverse-linked liaison and PI,
    normally the liaison in To, with the option to address the PI and copy the
    liaison; and
26. To and CC recipients share one request-scoped link and may manage the same
    applicant-material files, without person-level action attribution; and
27. the manual materials-request action is available once the promptly
    scheduled Site Visit date is recorded, roughly in the reviewer-invitation
    window, without waiting for reviews, synthesis, or a Pre-Site Writeup; and
28. link expiration is exactly 60 days after a successful invitation send,
    requires no staff-entered date, and is unaffected by Site Visit
    rescheduling; and
29. Resend reuses an active link without extending its original expiration,
    while Reissue revokes the prior link and starts a fresh 60-day period from
    the successful replacement send; and
30. any authenticated staff member with access to the Workbench Site Visit
    workflow may send, resend, or reissue the materials request, without a
    lead-PD or administrative-role restriction; and
31. invalid or duplicate liaison/PI email data blocks sending and is corrected
    in Dataverse rather than bypassed with a free-form address; and
32. restart/reissue is the backup recovery path, and a failed replacement must
    not revoke a still-active prior link; and
33. applicant uploads are capped at 1 GB per file and 20 current applicant
    files per request across both categories, with retired/replaced versions
    excluded from the current-file count and replacement at the cap reserving
    the target file's slot;
34. applicants see only current files and operation confirmations; authorized
    staff use native SharePoint version/recycle recovery, with no custom
    applicant or Workbench restore control in the minimum product;
35. staff audit display records action, file name, category, size, timestamp,
    request, and shared-link identity without claiming PI-versus-liaison
    attribution; applicants do not receive an activity log; and
36. applicant files land inside the request's governed SharePoint folder under
    `Site Visit/Applicant Materials/Slides` or
    `Site Visit/Applicant Materials/Other`;
37. no standalone applicant-upload-link revocation action is needed in the
    minimum product; normal access ends at 60 days and Reissue revokes the
    superseded link;
38. Final Writeup creation uses the latest Pre-Site version available at action
    time, records that exact lineage, and offers a rare deliberate regeneration
    path that preserves prior Final content;
39. the Editor Dashboard audience is staff-wide, including all PDs and
    designated staff proofreaders, subject to explicit app and SharePoint file
    authorization; and
40. the first fixed gate is a human-in-the-loop, end-to-end Initial Assessment
    pilot by 2026-08-10, before proposal intake begins around 2026-08-18. It
    covers real proposal/metadata inputs, governed generation, SharePoint Word
    creation and human editing, Dataverse registry/provenance, Workbench
    discovery/opening, cycle-wide pilot-locator discovery/opening, and one
    safe failure/retry path; it does not require later lifecycle tabs;
41. the starting Initial Assessment structure is a one-page Word document with
    the applicant-submitted proposal title, institution, Summary, and a
    Rationale comprising
    Significance & Impact, Research Plan, Team Expertise, and Foundation
    Opportunity; and
42. Foundation Opportunity is a visibly incomplete staff-authored slot, while
    the institution and applicant-submitted title come from authoritative
    Dataverse metadata rather than model inference; the exact document format
    remains intentionally open to iteration during the single-phase
    transition; and
43. the Initial Assessment pilot uses a controlled production rehearsal with
    colleague-created representative dummy requests; building the existing
    Dataverse sandbox organization into an integrated application/file test
    environment is out of scope; and
44. on 2026-07-30 the owner accepted the provisional v1 prompt/template pair
    and explicitly authorized the additive Production writes. Wave 16 and
    `initial-assessment.generate` v1 were applied and independently read back;
    PR #102 then merged as `1e958ee0` and deployed Ready as
    `dpl_AxxroabhpXLX1pz75MW6486fB4ci`. Artifact generation remains the
    separate controlled pilot gate. The 2026-07-30 Request `1002788` rehearsal
    proved generation mechanics, shared consumers, and same-input retry, but
    used an old Phase I proposal and therefore is not semantic Phase II
    evidence. Request `1003109` subsequently production-proved canonical-input
    generation, exact-input reuse, new-run request linkage, and
    interrupted-finalization recovery using the same row/run/item/version.
    The subsequent attributed substantive edit advanced that same item to
    SharePoint version `2.0` and remained reachable through both consumers.
    Response-only current-version metadata refresh and display in both
    consumers are deployed and live-verified on Request `1003109` via
    deployment `dpl_HhiYXVFAtsGMwjU9UDcKz22AfvR2`. Native previous-version
    inspection/restore and first-stage recycle recovery subsequently passed
    in the production Request library; administrator policy/access checks and
    product history/milestone controls remain open. The owner
    accepts service-principal attribution for system-generated Dataverse
    registry writes; SharePoint native version attribution remains the
    required human-edit audit surface; and
45. on 2026-08-10 the owner required both current Reviews outputs and the
    planned Pre-Site/Final proposal writeups to list reviewer names and
    affiliations while leaving observations anonymous. The roster is
    deterministic application/template output from the submitted-review
    population: accepted suggestion affiliation first, potential-reviewer
    affiliation fallback, explicit missing state, and no dependency on the
    linked Contact's `parentcustomerid`.

Still required:

1. production dummy request IDs and representative content shape, named human
   testers, the exact pilot schedule, and deadlines for later lifecycle stages;
2. first approved Pre-Site Word template and prompt/template compatibility
   contract, implementing the decided deterministic reviewer roster alongside
   the anonymous review narrative;
3. administrator verification of the target library's configured version
   limit, second-stage recycle recovery, applicable site/library Purview
   retention, and ordinary-editor least-privilege policy; stable-identity
   metadata read-through, consumer display, native version restore,
   first-stage recycle recovery, and production registry/pointer readback are
   complete;
4. Workbench version-history navigation, administrator-only restore, and
   immutable Board milestone snapshot behavior;
5. exact Dataverse schema and dossier read model for the decided Site Visit
   metadata, material categories, and observations;
6. Site Visit Materials Upload visible sender/reply-to and lead-PD copy
   behavior after owner/staff coordination, large-file malware scanning,
   idempotency, partial-failure recovery, exact additional notification
   audience and short-digest window, audit, and retention;
7. approved transcription provider/output contract, summary quality fallback,
   and transcript/summary refresh behavior after coordination with a program
   coordinator;
8. exact safe regeneration behavior and any additional Final Writeup inputs
   beyond copying the latest Pre-Site version; and
9. Editor Dashboard Reviewed-marker granularity, coordinator view, SharePoint
   file-access verification, and restore authority.
