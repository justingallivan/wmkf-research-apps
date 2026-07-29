---
title: "Request Workbench — near-term execution plan"
domain: architecture
kind: plan
status: canonical
summary: "Review synthesis lifecycle is production-proved with automation enabled; the next sequence is the remaining Workbench lifecycle design freeze."
canonical: true
cataloged: 2026-07-26
last_verified: 2026-07-28
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

The work is ordered below, but exact calendar dates cannot be assigned until the owner
provides:

1. each fixed deadline;
2. the audience using the system at that deadline; and
3. the minimum artifact or action that must work by that date.

Until then, “Week 1/2/3” are relative execution windows, not delivery promises.

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
  progress surface for Allison and other approved writeup collaborators. It
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

### Cycle-wide editing

Allison historically reviewed and edited writeups from one designated
SharePoint folder. Removing that folder-browsing workflow must not force her to
open each request separately in the Workbench.

The planned replacement is an **Editor Dashboard**, not the broader historical
“Executive Dashboard” proposal. Its minimum contract is:

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
replace the explicit marker. The exact approved collaborator group, marker
granularity (request versus artifact stage), coordinator view, app-access key,
and delivery deadline remain open. App visibility and SharePoint file
permission are separate controls and both must be enforced.

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
3. **Final Writeup** — a separate Word document created from a deliberately
   selected Pre Site Visit version. The registry must preserve the source
   artifact and source version used for that copy. The Final then evolves
   independently as the PD incorporates the visit, late reviews, transcript
   evidence, and staff edits.

There is no fourth “Site Visit Writeup.” The Site Visit tab is a dossier that
brings together structured visit metadata, applicant slides and other
applicant materials, recordings, transcripts and their derived summaries, and
staff observations. Pre-Site distribution snapshots and the Final Writeup
remain linked lifecycle documents rather than Site Visit material categories.
“Create Final Writeup” copies the selected Pre-Site version into the separate
Final artifact; it does not rename or overwrite the Pre-Site document.

Internal staff receive the canonical Word link. When a Board member or
consultant without staff access joins a visit, the minimum external
distribution path is a PDF attachment representing an exact frozen Pre-Site
version. Staff send that attachment through the ordinary approved email path;
an external document-sharing portal is not required for this use case.

The Pre-Site document is informational and normally does not need a Reviewed
marker. The Final Writeup may expose a soft, optional Reviewed acknowledgement
for expected readers, but that signal is not an approval/sign-off gate.
Board-ready freeze remains a separate owner-controlled milestone.

### Pre Site Visit input, regeneration, and template contract

**[VERIFIED via owner decisions 2026-07-28; document pipeline PLANNED.]**
The Pre-Site draft has two independently refreshable source layers:

1. **Proposal-derived factual material.** Use the full proposal text with an
   iterated form of the existing `phase-ii.summarize` prompt. Where the
   document repeats authoritative request metadata such as institution,
   requested amount, project period, or named request relationships, source
   those values from Dataverse rather than asking the model to infer them from
   the proposal.
2. **Review-derived analysis.** Use `review-synthesis.generate` over **all
   currently submitted reviews**. Staff do not select a subset. Staff may edit
   the resulting synthesis in the canonical Word document.

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
  disclose submitted-review count/coverage and as-of time;
- a late review makes the review-derived section stale and permits
  `review-synthesis.generate` to run again;
- rerunning review synthesis does not regenerate the proposal-derived core;
  and
- because staff may have edited the Word prose, a new synthesis must not
  silently overwrite that section. The Workbench presents a deliberate
  refresh/incorporation action and preserves the earlier distributed version.

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
automatically. The exact authorized staff roles and visible sender/reply-to
still require product design. Site Visits are scheduled soon after a request
advances, roughly when reviewer invitations begin. Once the visit date is
recorded, the manual request action is available and staff chooses when to send
it; review receipt, review synthesis, and Pre-Site Writeup readiness do not gate
the action. Recipient choices come from the request's Dataverse-linked liaison
and PI. The normal default is the
liaison in **To**; staff may instead address the PI and optionally copy the
liaison. The server re-resolves the selected contacts and email addresses from
Dataverse at send time rather than trusting client-supplied addresses. No
free-form recipient requirement is established for the minimum product. The
server sets link expiration to exactly 60 days after the invitation is
successfully sent. Staff do not enter or edit an expiry date, and moving the
Site Visit date does not change the expiration.

While the current link is active, **Resend invitation** sends that same link
again and retains its original expiration. It never silently extends access.
**Reissue link** is a separate deliberate action that revokes the prior link,
creates a replacement, and starts a new 60-day period from the successful
reissue send. An expired or revoked link cannot be resent as though it were
active; staff must reissue.

The recipient sees only the request identity, upload instructions, permitted
material types, and the applicant files they are authorized to manage. The
recipient must not select a Dataverse record, SharePoint folder, or destination
identifier. The server resolves those from the signed request context,
validates the operation, places the bytes in the governed SharePoint location,
and registers the artifact and its provenance in Dataverse.

Applicant-facing uploads are limited to **PDF** and **PPTX** files in the
**applicant slides** and **other applicant materials** categories. Multiple
upload sessions are allowed while access remains active. The applicant should
be able to see, delete, or replace an authorized applicant file; replacement
must first persist and register the new file successfully so a partial failure
does not remove the prior working file. Delete/replace must be auditable and
recoverable, and the exact cross-contact visibility and underlying
SharePoint/Dataverse replacement mechanism remain open. Recording, transcript,
transcript summary, and staff observations remain staff- or system-side
categories and are never manageable through this link.

The email contains one shared request-scoped bearer link. Both the **To** and
**CC** recipients may use it and manage the same applicant-material file list.
The system records actions against the request/link, but without sign-in or
separate personalized links it must not claim whether the PI or liaison
performed a particular action.

A successful applicant-material change should notify the lead PD and other
designated staff. The exact additional staff audience, event batching, and
message timing remain to be decided alongside the request-email workflow.

The recording and transcript remain the authoritative visit evidence. A
transcript summary is a derived, version-bound artifact. Prefer the summary
produced by the approved transcription platform when one is available and
acceptable; do not automatically make a second suite LLM call. A suite LLM
summary is a deliberate fallback when the platform supplies none, staff
requests regeneration, or the supplied summary fails the approved quality
contract. The registry must identify the summary producer/system, source
transcript item and version/hash, generation time, and current/stale state.

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
   not a date-driven automatic send. Next freeze the authorized staff roles,
   sender identity, standalone revocation and failed-reissue recovery,
   applicant-file recovery and shared-link audit behavior, and
   recording/transcript/summary contracts plus persistence and access.
3. **Final Writeup** — freeze the selected-Pre-Site copy/lineage contract and
   the visit, late-review, and editorial inputs.
4. **Initial Assessment** — design for every in-scope J27 proposal before
   staff/Board advancement deliberation. The current D26 Initial Writeup
   placeholder remains historical and requires no backfill.

Explicit non-goals during design freeze:

- no Editor Dashboard implementation until its audience, minimum view,
  Reviewed-marker contract, access boundary, and deadline are fixed; the need
  to preserve Allison's cycle-wide editing workflow is no longer an optional
  historical idea;
- no Reviewer Pool build without observed need and owner priority;
- no new writeup URL fields merely because the June proposal named them;
- no automatic status-driven workflow until its event, idempotency, retry, and ownership
  contracts are explicit.

## Week 2–3 — build the first complete writeup slice

The default candidate is Pre Site Visit Writeup, subject to the calendar gate.

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
10. perform a narrow production smoke with a designated test request.

Exit: one real request can move from ready inputs to a durable, editable Word artifact and
back to a visible Workbench state without filename guesswork or silent partial
success; an authorized user can identify and recover a prior version; and the
official milestone can be proven independently of later working edits.

## Week 3+ — dependent lifecycle slices

- **Site Visit:** build the dossier read model and governed artifact paths,
  including the narrow applicant-material request/upload flow, only after the
  exact metadata, token, validation, persistence, and recovery contracts are
  approved.
- **Final Writeup:** create a distinct artifact from a selected Pre-Site
  version, preserve that lineage, and add the approved visit and late-review
  inputs.
- **Initial Assessment:** reuse the proven artifact path for every in-scope J27
  proposal before the staff/Board advancement decision.
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
7. three distinct writeup documents, with Final copied from a deliberately
   selected Pre-Site version and no separate Site Visit Writeup;
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
23. applicant-material changes notify the lead PD and other designated staff,
    with the additional audience still to be decided; and
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
    the successful replacement send.

Still required:

1. fixed deadlines and minimum outcomes;
2. first approved Pre-Site Word template and prompt/template compatibility
   contract;
3. exact Dataverse registry schema and SharePoint destination;
4. target-library version, retention, recycle, and permission audit;
5. exact Dataverse schema and dossier read model for the decided Site Visit
   metadata, material categories, and observations;
6. Site Visit Materials Upload authorized staff roles, visible sender/reply-to,
   missing/duplicate contact handling, standalone revocation and failed-reissue
   recovery, shared-link audit disclosure, file size/count limits,
   destination, delete/replace persistence and recovery, idempotency,
   partial-failure recovery, exact notification audience/timing, audit, and
   retention;
7. approved transcription provider/output contract, summary quality fallback,
   and transcript/summary refresh behavior;
8. Final Writeup creation inputs and source-version selection behavior; and
9. Editor Dashboard audience, Reviewed-marker granularity, coordinator view,
   app/file access enforcement, delivery timing, and restore authority.
