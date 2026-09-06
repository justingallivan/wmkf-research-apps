---
title: Workbench Writeup Lifecycle Plan
domain: workbench
kind: plan
status: active
summary: "Pre-Site/Site Visit lifecycle, Final acknowledgement/dashboard, and explicit persona lenses are live; later Final stage transitions remain."
canonical: false
cataloged: 2026-08-17
last_verified: 2026-09-04
owner: product-engineering
related:
  - docs/PRE_SITE_VISIT_DATAVERSE_SCHEMA_DESIGN.md
  - docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md
  - docs/POWER_AUTOMATE_PROPOSAL_FILE_CONTRACT.md
  - docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md
  - docs/atlas/dataverse-wmkf-requestdocument.md
  - lib/dataverse/schema/wave19-pre-site-draft/01_wmkf_requestdocument_pre_site_draft.json
  - lib/dataverse/schema/wave19-pre-site-draft/02_akoya_request_writeup_pointers.json
  - lib/dataverse/schema/wave20-guarded-reopen/wmkf_requestdocument_guarded_reopen.json
---

# Workbench Writeup Lifecycle Plan

## Decision and current status

**UI merge (S466, 2026-08-28):** the former Pre Site Visit Writeup and Site
Visit tabs are now ONE Workbench tab, **Staff Deliberations**
(`shared/components/workbench/StaffDeliberationsTab.js`), with a stage rail
Draft → Share → Wrap Up; the old tab keys alias in. This is a
presentation-layer merge only — every document-lifecycle contract, route, and
guarantee below is unchanged, and references to the two separate tabs in this
plan describe the pre-merge UI accurately as history.

**[OWNER DECISION 2026-08-17; PRE-SITE WRITER PRODUCTION-PROVED; SITE VISIT
HANDOFF PRODUCTION-PROVED 2026-08-21; GUARDED REOPEN PRODUCTION-PROVED
2026-08-23; SITE VISIT LOGISTICS/CALENDAR PRODUCTION-PROVED 2026-08-25; FINAL
SAME-ITEM HANDOFF PRODUCTION-PROVED 2026-08-30 PT / 2026-08-31 UTC.]** The three Workbench
tabs (as originally built; see the merge note above) form one document
lifecycle, not three independent data-entry systems:

1. **Pre-Site Visit Writeup** creates a governed Word document from Dataverse
   data and governed AI output persisted in Dataverse. Once created, that Word
   document becomes the PD's working document.
2. **Site Visit** continues to use the same Pre-Site Word document. The PD
   records visit observations directly in Word while SharePoint preserves the
   native version history. The tab separately manages logistics and supporting
   files such as slides, recordings, transcripts, and summaries.
3. **Final Writeup** creates a new governed registry lineage row over the same
   stable SharePoint Word item. The transition pins the exact Site Visit-stage
   Pre-Site row/version/hash selected at action time, but does not copy or
   upload a second editable file.

There is no separate Site Visit Writeup, no Dataverse staff-observations text
field in this design, and no attempt to synchronize arbitrary staff edits from
Word back into the eight generated Dataverse narrative fields.

**[PRODUCTION-PROVED 2026-08-30 PT / 2026-08-31 UTC.]** Final no longer falls
through to a placeholder in Production. Commit `ebb147bb` is live in Ready
deployment `dpl_7kzQ1v7XGtyNx4Fady2JxMrTxQEJ`; Wave 22 readback is 4 exact /
0 absent / 0 divergent and `FINAL_WRITEUP_SCHEMA_READY` is literal `on`.
Authorized Request `1002788` proved the same-item group-review handoff and
separate-Word Final tab: one Final Ready/Review row and current-Final pointer,
the retained current Pre-Site row moved to lifecycle Final, Justin Gallivan was
recorded at `2026-08-31T03:57:20Z`, and both rows retained the exact same
SharePoint item, version `1.0`, 38,273-byte size, and governed hash. The
distinct file count remained four, so no copy/upload occurred.
Acknowledgement/dashboard data remain later slices. Word editing stays outside the
Workbench in a separate browser window/tab or desktop Word when Microsoft
permits. **[DEPLOYED TO PRODUCTION 2026-08-17]**
the Site Visit tab and authenticated transition route implement the guarded
handoff of the current Ready/Draft Pre-Site item into the Site Visit workspace.
The Pre-Site tab also adds a
visually separate next-stage panel and explanatory confirmation modal that call
the same guarded route, then navigate to the Site Visit tab after success. The Pre-Site tab
now calls the Production durable writer and shows the stable Word file returned
from the registry. **[DEPLOYED TO PRODUCTION 2026-08-17; SIGNED-IN FEATURE
SMOKE OPEN]** its compact action panel shows Generate before a draft
exists and Edit, Download, and confirmation-guarded Regenerate actions only
while the current Ready artifact remains Draft; detailed workflow guidance is
behind an accessible help control. **[DEPLOYED TO PRODUCTION AND SIGNED-IN
RECEIPT SMOKE PASSED 2026-08-21]** commit `b3bb0ef6` first reached Production in
Ready deployment `dpl_FkWu55fyBqSEo8q4DBcdcA3xvigi` and makes the Pre-Site tab a read-only handoff
receipt after Review with one `Continue in Site Visit` action. It moves any
durable edit-check warnings inside that receipt and fails closed for later or
unknown lifecycle values. Signed-in Request `1002379` verified that receipt,
zero Pre-Site work controls, one continuation action, and the expected same-file
Site Visit Edit/Download workspace without invoking a write. The request carried
no visible warning, so post-handoff warning rendering remains component-test
evidence rather than part of this browser smoke. Wave 19 is live in Production: its owner-approved
metadata-only apply created all 12 attributes and two request lookups, and
independent readback found 14 exact with no absence or divergence. Request
`1002379` later created the first Ready Pre-Site row, completed governed v3 AI
run, populated the request pointer, and uploaded the stable Word item. Exact
Ready retry reused those same identities. The 2026-08-23 post-reopen inventory
is 10 Request Documents: three Initial Assessments and seven Pre Site Visits;
nine are Ready, one Failed, six Draft, and four Superseded.

**[DEPLOYED TO PRODUCTION 2026-08-18; SIGNED-IN GENERATION + NO-DUPLICATE
SMOKES PASSED 2026-08-27.]** The Pre-Site producer
now distinguishes editorial deviations from integrity failures: usable drafts
reach Ready with durable edit-check warnings, while malformed, empty,
placeholder-bearing, unreconciled, or authority/lineage-invalid content remains
blocking. It preserves v2 reads. The 2026-08-27 owner-approved smoke on
Request `1002852` proved Ready-with-warning generation under sole-current
prompt v5 (an unattributed content-identical republish of v4, verified by the
runtime exact-match preflight) and the exact no-duplicate unchanged retry;
the hard-failure smoke was skipped by owner decision and remains test-proven.
Evidence: `docs/PRE_SITE_VISIT_GENERATION_RESILIENCE_PLAN.md` §Status.

## Evidence boundary

| Claim | Evidence | Status |
|---|---|---|
| The deployed Workbench exposes Staff Deliberations and a readiness-gated same-item group-review handoff plus separate-Word Final workspace | Production deployment `dpl_7kzQ1v7XGtyNx4Fady2JxMrTxQEJ`; Wave 22 4 exact / 0 absent / 0 divergent; signed-in Request `1002788` transition and Dataverse/SharePoint postcheck on 2026-08-30 PT / 2026-08-31 UTC | PRODUCTION-PROVED |
| `wmkf_requestdocument` already has artifact types for Pre Site Visit, Final Writeup, Applicant Slides, Other Applicant Materials, Recording, Transcript, and Transcript Summary | Wave 16 tracked schema plus read-only Production metadata inventory | VERIFIED |
| The registry already carries request ownership, stable Graph identity, lifecycle, exact source version/hash, prompt/run/template lineage, and retry fields | Request Document adapter, schema, and Atlas | VERIFIED |
| Request `1002379` had one current Ready/Review Pre-Site workspace after the controlled handoff | Signed-in Production transition plus fresh authenticated same-item status readback on 2026-08-21; superseded by the approved 2026-08-23 guarded reopen | VERIFIED HISTORICAL STATE |
| `akoya_request` has `akoya_sitevisitdate` and `akoya_sitevisitnotes`; the latter is not an approved workspace for this design | Read-only Production metadata inventory plus owner decision | VERIFIED / NOT REPURPOSED |
| The current Reviews flow persists structured synthesis in `akoya_request.wmkf_reviewsynthesisjson` | `review-synthesis.generate` prompt and Reviews callers | VERIFIED |
| Current Pre-Site and Final request lookups exist | 2026-08-17 post-apply Production preflight: both relationships exact; all 14 Wave 19 items exact and 0 divergent | VERIFIED LIVE |
| Guarded reopen preserves the handoff and creates one successor | Merge `af986d92`; focused tests; Ready deployment `dpl_BbtmRghhSYa7EPiQkWxsmdkgRozp`; signed-in Request `1002788` read-only smoke; approved Request `1002379` durable mutation, exact retry reuse, and Dataverse/Graph byte/cardinality readback | PRODUCTION-PROVED |
| Wave 20 guarded-reopen fields exist in Production | Approved 2026-08-23 additive apply followed by typed metadata readback: 3 exact, 0 absent, 0 divergent | VERIFIED LIVE |

## Ownership model

| Information | System of record | Editing contract |
|---|---|---|
| Request, institution, location, meeting, staff lead, invited/requested amounts, project budget, personnel | Dataverse source entities | Read-only inputs to document creation |
| Eight proposal-core narrative sections | Named fields on the Pre-Site `wmkf_requestdocument` row | Generated and reviewable before Word activation; frozen as the render inputs for that row |
| Canonical normalized proposal core, content-free diagnostics, and bounded input snapshot | Pre-Site `wmkf_requestdocument` JSON snapshot fields | Write-once render/audit evidence; raw provider output remains on the governed AI run |
| Reviewer roster and review narrative | Submitted-review roster plus current `wmkf_reviewsynthesisjson` | Deterministically rendered at the selected evidence timestamp; no duplicate Pre-Site review store initially |
| Graphical abstract image/caption and staff recommendation | The Word document | Manually pasted or entered by the PD |
| Institutional funding history | Dataverse, rendered deterministically at generation (S467: account `wmkf_countofprogramgrants`/`wmkf_sumofprogramgrants` rollups + newest program-grant request; `lib/services/pre-site-visit/funding-history.js`) | Stored only in the v3 input snapshot and the rendered Word bytes, like the other DV fields; no LLM and no new Dataverse column |
| Site Visit observations and later editorial prose | The current Word document | Direct staff edits; SharePoint native versions are authoritative |
| Site Visit logistics | Dataverse | Separate bounded schema/adapter decision; do not hide these inside the Word file |
| Slides, other applicant materials, recording, transcript, transcript summary | SharePoint bytes plus one `wmkf_requestdocument` row per file | Governed upload/registration and normal SharePoint version/recycle behavior |
| Current document selection | Request lookup to the current Ready Word row | Service-controlled atomic transition |

The existing `akoya_sitevisitnotes` field may contain historical content. This
plan neither deletes it nor silently changes its meaning. Before any future
migration or retirement, inventory populated rows and live callers.

## Lifecycle and lineage

```text
Dataverse facts + AI Materials narrative + review evidence
                         │
                         ▼
       Pre-Site Request Document row ─── stable SharePoint DOCX
                         │                    │
                         │                    ├─ PD adds graphical abstract,
                         │                    │  recommendation, and edits
                         │                    └─ PD adds Site Visit observations
                         │                       as native Word versions
                         │
               exact row + item version + hash
                         │
                         ▼
         Final Request Document row ───── same stable SharePoint DOCX
                                              │
                                              └─ staff continue editing in Word
```

The source of a Final Writeup is never “whatever file currently has this
name.” It is the exact Pre-Site Request Document row and exact SharePoint
version/hash captured when the action runs. The source and Final rows point to
the same stable drive/item identity; the two rows describe lifecycle lineage,
not two editable files.

## Pre-Site Visit Writeup tab

### Minimum interface

- Show source readiness for the exact proposal narrative, authoritative Dataverse
  metadata, governed prompt/model configuration, and Word template.
- Generate or retry the Pre-Site draft through one durable operation.
- While the current Ready artifact is Draft, show its compact status plus Edit,
  Download, and confirmation-guarded Regenerate actions. Keep detailed source,
  provenance, and manual-completion guidance available through contextual help
  rather than permanently occupying the panel.
- Once the current artifact is Review, remove all Pre-Site Edit, Download,
  filename-link, and Regenerate controls. Show a read-only handoff receipt with
  the promoted filename as plain text and one `Continue in Site Visit` action;
  the Site Visit tab owns all working-document actions. Later and unknown
  lifecycle values also fail closed and show a read-only stage notice rather
  than controls that the server will reject.
- When a Ready Draft artifact has editorial diagnostics, show a compact “Draft
  needs a quick edit check” warning panel beside its document link. After
  handoff, keep those warnings inside the receipt immediately above the Site
  Visit continuation action so they remain actionable without restoring a
  misleading direct file link. A handled failure must refresh status once,
  display the durable support reference, and never repeat the generation POST
  automatically.
- Show the Draft→Review handoff as a separate next-stage panel, not as a document
  action. Its confirmation modal must explain same-file reuse, exact-version
  recording, continued Word editing, and the regeneration lock before calling
  the shared guarded transition.
- Identify manual Word tasks: graphical abstract image/caption and staff
  recommendation. Institutional funding history is filled at generation from
  Dataverse (S467); it is no longer a manual placeholder.
- If review evidence is included, show its as-of timestamp and submitted-review
  coverage so staff can choose a deliberate refresh rather than silently
  overwriting an edited document.

### Creation transaction

1. Resolve the Request and authoritative related Dataverse records.
2. Resolve the exact `AI Materials/ProposalNarrative_{Request#}.pdf` by stable
   Graph site/drive/item/version identity; the path is a discovery convention,
   not the durable key.
3. Build a bounded input snapshot and deterministic generation key.
4. Execute the admin-configured governed prompt through the shared Executor,
   persisting the `wmkf_ai_run` audit.
5. Validate and deterministically normalize all eight proposal-core sections,
   reject empty or unresolved reserved placeholders, compute content-free
   editorial diagnostics, reconcile the named fields exactly with the
   canonical core, and write envelope v3 plus the immutable input snapshot to
   the claimed Request Document row.
6. Render Word only from that persisted row and deterministic supporting data.
7. Upload the DOCX, read it back, and transition the row to Ready.
8. In one Dataverse changeset, supersede the prior current Pre-Site row and set
   `akoya_request.wmkf_CurrentPreSiteVisit` to the new Ready Word row.

Success means all of Dataverse, the AI-run audit, the SharePoint item, and the
current pointer agree. A Claude response or an uploaded file alone is not
success. Exact retry reuses the same claimed operation; changed inputs create a
new row rather than overwriting a staff-edited Ready Word document.

## Site Visit tab

### Document workspace

The Site Visit tab opens the current Pre-Site Word document. Site Visit
observations are entered directly into that document. Each save produces
ordinary SharePoint/Word version history. The application does not create:

- a Site Visit Writeup artifact;
- a current Site Visit writeup lookup;
- a staff-observations Request Document category;
- a staff-observations Dataverse Memo field; or
- a field-by-field synchronization job that parses staff-edited Word prose.

**[DEPLOYED TO PRODUCTION 2026-08-17]** the first handoff slice is built and
live. Before promotion, the Site Visit tab shows the current Ready/Draft filename
and a `Start Site Visit Stage` confirmation action. The Pre-Site tab also offers a visually separate
`Start Site Visit` panel whose modal states the lifecycle consequences before it
calls the same endpoint. The server resolves the current
request pointer independently, requires the browser's artifact id to match,
reads the same stable SharePoint item before and after download, hashes the
verified DOCX, and performs one ETag-conditional lifecycle transition from
Draft to Review. The `wmkf_milestoneversionid`,
`wmkf_milestonecontenthash`, and `wmkf_milestonecreatedat` fields record this
Site Visit handoff point; current Graph metadata is refreshed on the same row.
The SharePoint item is not copied or mutated. A completed exact transition is
idempotent, and Pre-Site regeneration is locked before inputs, prompt, Claude,
claim, render, or upload work once the lifecycle is Review.

The tab should display the current Word item and its latest version metadata so
the PD can confirm which document is the workspace. The application must not
replace that stable item as a side effect of receiving site-visit files.

### Content correction and guarded reopen

**[OWNER DIRECTION 2026-08-21; PRODUCTION-PROVED 2026-08-23.]**
Ordinary correction and lifecycle reopening are different
operations:

- A typo, missing fact, or later Site Visit observation is corrected by editing
  the current Word document from the Site Visit tab. That does not reopen
  Pre-Site generation or change lifecycle state.
- Reopen is an exception for an accidental handoff or a draft generated from
  the wrong governed inputs when staff truly needs another Pre-Site generation
  cycle. It is never a generic Undo button and never mutates the prior Review
  row back to Draft in place.

The minimum reopen transaction is a preserve-and-succeed operation:

1. Require an authorized staff actor, a reason code plus note, a typed request
   number confirmation, the expected current artifact ID, and a client
   operation ID. The server independently resolves the Request pointer and all
   file authority.
2. Require the pointer to target a Ready/Review Pre-Site Word row with a
   complete handoff milestone. Re-read the same stable SharePoint item around
   an exact-version download/hash and require it still to match the recorded
   handoff version/hash. A post-handoff Word edit therefore blocks automatic
   reopen; staff continues correcting that live document or uses a separately
   approved reconciliation procedure.
3. Fail closed if a current Final row, AkoyaGo publication, or any other
   non-distribution downstream artifact already derives from this handoff.
   Frozen distribution snapshot rows are retained informational evidence, not
   editable lifecycle children: prepared or sent snapshots remain preserved
   and do not block guarded reopen. An unsent prepared attempt cannot be sent
   after reopen moves the current pointer/source version; staff must prepare a
   new exact preview for the new cycle.
4. Create a new Ready/Draft Pre-Site successor row and a new stable Word item
   by copying the exact verified handoff bytes. Link the successor to the prior
   Review row and exact source version/hash. Preserve the prior row, file, and
   handoff milestone; mark it superseded only as the Request pointer moves to
   the successor in the same ETag-guarded changeset.
5. Persist actor, time, reason, source and successor identities, and the client
   operation ID in a durable append-only reopen audit representation. Exact
   unchanged retry returns the same successor and never creates another row or
   file. A Failed attempt remains append-only evidence but does not permanently
   block a later operation. The client operation ID is minted once when the
   dialog opens; after the first submit its audit inputs are frozen for exact
   retry, and staff must close/reopen the dialog to start a different operation.
6. Show every durable reopen attempt with an explicit Completed, Failed, In
   progress, or Needs reconciliation outcome alongside its preserved source
   evidence. The new Draft may be edited or regenerated under the normal rules,
   and a later Site Visit handoff records a new milestone on the successor rather
   than overwriting the old milestone.

The selected bounded representation is the successor Request Document row
itself: `wmkf_ReopenCycleId`, `wmkf_ReopenReasonCode`, and
`wmkf_ReopenReasonNote`, plus its existing source/version/hash lineage. The
client operation UUID is both
the durable correction-cycle identity and the exact-operation dedupe input;
the existing generation-key alternate key remains the uniqueness fence. Only
superusers may invoke the route or receive the reopen-attempt history or nested
correction details; other authorized Workbench readers receive artifacts with
that audit data removed from GET, generation, and Site Visit handoff responses. A second reopen
is refused while a different generation has a live 15-minute lease. An expired
reopen claim is atomically marked Failed before a new operation proceeds; if its
copy exists, exact drive/item identity is retained in the row's cleanup queue
and its history outcome becomes Needs reconciliation. The same cleanup rule is
applied when a different operation supersedes a Failed attempt that retained a
copy; same-operation retry remains recoverable until that supersession. The
history UI explicitly calls out retained copies requiring reconciliation.
Later generated drafts carry the same cycle ID
in their generation identity, and final activation rechecks that the target's
cycle still equals the current Draft pointer's cycle, so an older in-flight
generation cannot supersede a newer correction cycle. Actor/time is shown only
on the actual reason-bearing reopen event, not on later cycle-bearing generated
descendants. Non-superuser status responses also omit a pending reopen-attempt
row entirely while retaining ordinary pending-generation status.

Wave 20 must pass a target read-only preflight and be explicitly applied before
the feature is enabled. The base adapter projection excludes the new columns
while `GUARDED_REOPEN_SCHEMA_READY` is off, and the reopen route fails closed
with 503. After exact metadata readback, set the non-sensitive flag to literal
`on` and deploy/redeploy the runtime. Once a correction cycle exists in an
environment, do not unset the flag as a rollback; generation identity depends
on the cycle field remaining visible.

### Logistics

The desired logistics are date, time/time zone, format, location/link, lead PD,
WMKF staff, applicant participants, and Board/consultant participants.

**[VERIFIED 2026-08-24 via Production metadata and
`scripts/probe-site-visit-logistics-capabilities.mjs`; sandbox target
`orgd9e66399.crm.dynamics.com` re-probe.]** The existing `wmkf_sitevisit`
custom Activity is the bounded persistence surface: it exists in Production and
sandbox, has the Request `regardingobjectid` relationship, standard
`scheduledstart` / `scheduledend`, `subject`, `description`, `organizer`,
`requiredattendees`, and `optionalattendees` fields, and has zero rows in both
targets. The sandbox app user can read the entity and is assigned System
Administrator/System Customizer. The entity has no custom attributes and no
native `location` field. The sandbox still lacks `wmkf_requestdocument`, so it
can prove Activity/calendar transport but not the full governed material-link
projection.

**[OWNER DIRECTION 2026-08-24; OPUS PLAN AND CODE REVIEWS `READY WITH NAMED
CHANGES`; PRODUCTION-PROVED 2026-08-25.]** The first
logistics slice uses the custom Activity rather
than standard `appointment`, because the custom entity and Request relationship
already express the intended domain. It adds only four structured Dataverse
fields needed for round-trip editing:

| Field | Shape | Purpose |
|---|---|---|
| `wmkf_VisitFormat` | local Choice: In person / Virtual / Hybrid | Explicit visit format |
| `wmkf_IanaTimeZone` | String, 100 | Stable IANA zone used to interpret and re-render local wall time |
| `wmkf_LocationOrLink` | String, 2000 | Physical location, meeting URL, or hybrid instructions |
| `wmkf_AttendeeRefsJson` | Memo, 32000 | Server-owned versioned map from ActivityParty rows to immutable staff/profile, roster, or manual recipient references |

`description` remains the staff-authored visit/email note; it is not overloaded
with a machine JSON envelope. `scheduledstart` and `scheduledend` store the UTC
instants derived from validated local date/time plus the persisted IANA zone.
The server rejects nonexistent DST wall times. The simplified UI hides the
daylight-saving panel and consistently chooses the earlier occurrence for a
repeated wall time. Standard Activity state/status remains the lifecycle
authority; no parallel Scheduled/Completed/Cancelled enum is added.

The UI contract allows zero or one open Site Visit Activity per Request. GET
returns none or the single open row plus its ETag. If multiple open rows exist,
the route fails closed for reconciliation rather than selecting one. First save
creates. Later saves with unchanged attendee identity use entity `PATCH` with
`If-Match`. Dataverse rejects direct ActivityParty create/update/delete, so an
attendee-role change uses a sandbox-proved atomic changeset: ETag-fenced delete
plus nested-party create of the same Activity GUID. This is a deliberate
same-ID replacement, not upsert or stale-write fallback; a rejected operation
commits neither half. Completed or cancelled rows are history and are never
edited by this panel. **[VERIFIED 2026-08-24 in tracked sandbox
`orgd9e66399.crm.dynamics.com`]** nested organizer create and atomic same-ID
replacement passed, direct ActivityParty create failed with expected Dataverse
code `0x80040800`, and the exact sentinel was deleted/read back absent.

The Site Visit attendee-reference compatibility directory has two authoritative
sources:

- WMKF staff: active `user_profiles` reconciled to enabled Dataverse
  `systemusers`; the stable system-user ID is retained for ActivityParty binding.
- Board and consultants: active `expertise_roster` rows. A nullable normalized
  preferred email is added directly to this existing roster table and managed
  with the existing roster editor. The immutable roster primary key remains the
  identity; names are display text, never a join key.

Staff may type an additional address for one send, but manual values are shown
in exact preview and are not silently persisted into either directory. The
server normalizes and deduplicates all addresses and rejects a To/CC or
required/optional conflict as an all-or-nothing validation failure.

**[VERIFIED IN SOURCE 2026-08-29.]** The distribution composer now has a
separate Admin-curated picker. Its Dataverse app-setting value stores only
active app-profile IDs, Contact GUIDs, and consultant/board category. Staff
identity resolves through enabled `systemusers`; external identity resolves
live from active Dataverse Contacts. Admin search is read-only toward Contacts,
and Contact creation/editing remains outside this app. Unavailable configured
identities stay visible to Admin for removal but are omitted from Workbench;
picker failure leaves manual To/Cc entry and preview creation available.

**[VERIFIED IN SOURCE 2026-08-24.]** For every calendar-enabled preview, the
server-resolved Site Visit organizer is a mandatory `To` recipient. Preparation
adds that address exactly once, removes the same address from `Cc`, and uses the
resulting recipient set in both preview hashes and the durable distribution
attempt. The UI suggests the organizer up front, but the prepare service is the
authoritative enforcement point.

The first calendar attachment is deliberately informational
`METHOD:PUBLISH`, matching the already-deployed review-due attachment contract:
it offers Add to Calendar but does not request RSVP and does not claim reliable
update/cancel behavior. A changed date, location, or attendee set requires a
new explicit preview and email. Formal `METHOD:REQUEST` scheduling is a later
slice that must implement incremented `SEQUENCE`, cancellations to every
affected removed attendee, and whole-event cancellation before it can claim
meeting-update semantics. The attachment still uses a stable UID derived from
the Site Visit Activity ID to reduce accidental duplicates where a client
honors PUBLISH identity, but the application does not rely on that client
behavior.

Selected material links come only from the governed Request Document adapter
and the current stable SharePoint identities already rendered by Workbench.
The email contains links; it does not attach, copy, rename, or publish the live
Word workspace. Exact preview freezes each selected artifact ID, Graph
site/drive/item/version identity, web URL, and display label. Retry uses that
snapshot and never silently substitutes a newer link or version.

Send remains separate from Activity save. The existing Postgres
`pre_site_distribution_attempts` ledger is extended rather than creating a
second orchestration table: it records the exact Site Visit snapshot,
material-link snapshot, calendar byte hash, authenticated actor/sender, Dynamics
email ID, and calendar-attachment step alongside the already-proven frozen
DOCX/PDF snapshot. Exact retry resumes the same Dynamics email activity; a
changed schedule, recipients, note, or material selection requires a new
preview and operation. Transport acceptance is not inbox-delivery proof.

#### Implementation invariants

| Invariant | Likely surfaces | Verification |
|---|---|---|
| Schedule round-trips without losing the entered zone or DST meaning | Wave 21 Site Visit fields; adapter/service; UI | exact metadata preflight; ambiguous/nonexistent DST tests; UTC/local round-trip tests |
| A stale save cannot create or overwrite another Site Visit | route; service; Dataverse adapter | GUID + same-Request check; ETag-fenced `PATCH` or atomic same-ID replacement; 404/412 and wrong-ID tests; reversible sandbox proof |
| Multiple open Site Visits fail closed | adapter/service/route/UI | two-row fixture returns reconciliation error and no write |
| Suggested recipients retain stable authority | attendee compatibility: `user_profiles`/`systemusers` + `expertise_roster.id`; distribution picker: reference-only app setting + live `systemusers`/Contacts | disabled/unreconciled staff excluded; inactive/email-less Contacts omitted; names/emails never copied into the curated setting |
| A calendar-enabled send always includes the saved organizer | Site Visit ActivityParty snapshot; preview service; Postgres ledger | omitted organizer is inserted into `To`; a matching `Cc` entry moves to `To`; hashes and persisted recipients use the enforced set |
| Exact preview binds every recipient, event field, link identity, and calendar bytes | preview service; Postgres ledger | any changed input changes preview hash and disables prior confirmation |
| Partial email failure resumes one Dynamics activity | extended distribution store/service; email adapter | activity-created and calendar-attachment failure tests; exact retry returns same email ID |
| PUBLISH is never presented as RSVP/update/cancel scheduling | calendar builder; UI copy; docs | ICS contract tests and component copy assertions |
| Sandbox proof cannot contact external recipients | smoke script/runbook | internal-recipient allowlist and explicit target assertion before every send |

The bounded route surface is one authenticated logistics GET/PATCH endpoint,
the legacy read-only attendee-reference directory, one reviewers-only curated
distribution-options endpoint, and one superuser Admin read/search/full-save
endpoint. The existing frozen-distribution
prepare/send/history routes gain the calendar and material-link contract; they
retain the proven confirmation and recovery pattern. Every route establishes
`withDalContext`, resolves the Request independently, and never accepts actor or
sender identity from the request body.

Sandbox proof covers Site Visit create/read/PATCH and same-ID replacement, ActivityParty behavior,
internal-recipient calendar attachment transport, exact retry, and exact-ID
cleanup of disposable rows. Because sandbox lacks `wmkf_requestdocument`,
material-link selection is first covered by adapter/service tests. A later
Production sentinel is restricted to an internal WMKF recipient and a
disposable Site Visit Activity; its runbook must name exact cleanup/closure and
independent readback before execution.

### Supporting-file registry and paths

Each file is one Request Document row and one stable SharePoint item. Use the
existing artifact choices; do not infer category from filenames alone.

| Artifact type | Governed request-relative folder |
|---|---|
| Applicant Slides | `Site Visit/Applicant Materials/Slides` |
| Other Applicant Materials | `Site Visit/Applicant Materials/Other` |
| Recording | `Site Visit/Recording` |
| Transcript | `Site Visit/Transcript` |
| Transcript Summary | `Site Visit/Transcript Summary` |

Folder strings should become shared server-side constants when the upload
surface is implemented. Stable Graph site/drive/item identity remains the
registry key even if names or folders later change.

Applicant-facing upload access remains limited to the first two categories.
Recording, transcript, and summary are staff/system-side. The established
expiring-link, validation, malware, size, resumable-upload, notification, and
recovery decisions remain governed by the near-term execution plan.

## Final Writeup tab

### Minimum interface

- From Staff Deliberations, require a deliberate **Ready for group review**
  action against the current Word workspace.
- After handoff, show group-review state and open the same canonical Word item
  through **Edit writeup** or **Review writeup**.
- Open Word in its own browser window/tab; do not embed it or build an
  in-Workbench editor. Desktop Word remains Microsoft's own supported option.
- Do not offer Final regeneration or backward-stage UI in the first release.
  Native Word version history and operator recovery cover the approved cases.

### Same-item lineage transaction

1. Read `wmkf_CurrentPreSiteVisit` and verify that it targets a Ready,
   non-superseded Pre Site Visit Word row owned by the same Request.
2. Resolve and freeze the exact current SharePoint item version and content
   hash at action time.
3. Build a Final generation key from Request ID, Final artifact type, source
   row ID, source item version/hash, and lineage/producer contract version.
4. Claim or reuse the matching Final Request Document operation.
5. Set the Final row's stable site/drive/item identity to the exact current
   Pre-Site Word item. Make no Graph upload, copy, rename, or move call.
6. Set `wmkf_SourceDocument` to the Pre-Site row and persist the exact source
   version/hash on the Final row.
7. In one ETag-fenced Dataverse transition, make Final Ready/Review, move the
   source Pre-Site row to `FINAL`, retain `wmkf_CurrentPreSiteVisit`, set
   `akoya_request.wmkf_CurrentFinalWriteup`, and persist the explicit actor/time.
8. Open that same Word item as the continuing collaborative workspace.

The pinned source version already contains the visit observations, reviewer
roster, and review narrative present at handoff. Later edits remain native
SharePoint versions of the same item; they do not rewrite the pinned source
checkpoint or create an editable sibling.

## Dataverse schema impact

### Wave 19: Production schema live

Wave 19 was applied to Production on 2026-08-17. It provides:

- 12 fields on `wmkf_requestdocument`: eight named proposal-core Memo fields,
  two immutable JSON snapshots, render fingerprint, and content type; and
- two N:1 Request lookups: `wmkf_CurrentPreSiteVisit` and
  `wmkf_CurrentFinalWriteup`.

There is intentionally no Site Visit current-document lookup. Both lookups
must be validated in service code because Dataverse metadata cannot enforce
same-Request ownership, artifact type, Word content type, Ready status, or
non-superseded lifecycle.

### Later bounded schema decisions

1. **Completed for the first logistics slice 2026-08-24:** Wave 21 adds only
   visit format, IANA time zone, location/link, and the server-owned attendee
   reference map to the existing `wmkf_sitevisit` Activity. Sandbox and
   Production preflights report all four exact; no new relationship or status
   field was added.
2. ~~Define the Institutional Funding History result field, its governed prompt,
   refresh semantics, and how it is incorporated into a new Pre-Site version.~~
   **Resolved S467 (2026-08-28) without a new field or prompt:** the sentence is
   derived deterministically from Dataverse at generation time and travels in
   the v3 input snapshot (so it participates in the generation key — a changed
   award history yields a new draft on the next generation, never a silent edit).
3. **Completed for group-review handoff 2026-08-30 PT / 2026-08-31 UTC:**
   Wave 22 adds explicit group-review and leadership-review transition actor/time
   fields on the Final row; `modifiedby` is not authoritative. Group-review
   attribution is Production-proved; leadership fields remain reserved for the
   later leadership slice.
4. **Completed and Production-proved 2026-08-31 (Wave 23
   `wmkf_finalwriteupreviewacknowledgement`):** Editor Dashboard Reviewed
   acknowledgements are a separate child entity.
   They are version-aware tracking, not document lifecycle or approval fields.
   The full coordinator matrix is a read model over those rows and each
   request's configured broad Grant Program reviewer audience, with no required
   count, due date, compliance semantics, or enforced reviewer order.
5. **Selected and Production-proved 2026-08-23; actor correction
   Pre-Site creation Production-proved 2026-08-31:** successor-row audit fields in Wave 20, client UUID dedupe/cycle
   identity, existing source/version/hash lineage, and a superuser-only route.
   The standard `createdby` projection currently names the service principal
   after fallback; explicit human actor/time is live behind the Production-only
   Wave 24 readiness flag described in
   `docs/REQUEST_DOCUMENT_EXPLICIT_ACTOR_PLAN.md`. Signed-in health passed.
   Naturally generated Request `1002874` then proved a Ready/Draft Pre-Site row
   with explicit Justin Gallivan origin actor/time, application built-in
   creator, exact current pointer, no missing-attribution event, and census 1
   attributed / 0 event-backed unattributed / 0 violations. Guarded reopen and
   Site Visit milestone proofs remain opportunistic; do not manufacture rows.
6. **Selected and Production-proved 2026-08-24 on Request `1002379`:** Postgres
   `pre_site_distribution_attempts` is the exact-preview and
   recovery ledger; retained file identities remain in SharePoint plus Request
   Document rows, and Dynamics owns the email activity.
7. Complete the AkoyaGo publication-projection discovery below before proposing
   any publication-purpose field, relationship, entity, filename contract, or
   SharePoint destination.

## Frozen snapshots and informational email distribution

Every informational send first retains a separate Word snapshot Request
Document row and SharePoint item linked to the exact editable Word row/version/
hash. If staff selects PDF or both, Graph converts that retained immutable Word
item and a second Request Document row links to the Word snapshot. A current
writeup pointer always targets the editable Word workspace, never a snapshot.

**[OWNER DIRECTION 2026-08-23; PRODUCTION-PROVED 2026-08-24.]**
Distribution is informational. Staff can attach the retained Word DOCX, the
derived PDF, or both; recipients are not asked to edit the live workspace, and
promotion never sends automatically. Migration
`034_pre_site_distribution_attempts.sql` was applied and schema-read-back on
2026-08-23. Request `1002379`, PDF-only operation
`85f52fc5-fb48-4ceb-84d6-0f246af0b6fb`, retained Ready/Board Ready DOCX and
PDF rows, persisted one `sent` ledger row, and produced Dynamics activity
`33ce6346-d89f-f111-b8db-6045bd07a06d` with Sent status, actor attribution,
and one hash-matching PDF attachment to `jgallivan@wmkeck.org`. Workbench
history surfaced the receipt and a bounded Production error-log scan was clean.
Dynamics appended its CRM tracking token after preview acceptance; inbox
delivery remains unverified.

**[CALENDAR/MATERIAL EXTENSION PRODUCTION-PROVED 2026-08-25.]** Signed-in
Request `1002379` operation `f497643a-2e9e-4032-a323-1e40874d16f1` bound the
saved Site Visit, one governed material, exact compose state, and deterministic
calendar bytes, then reached `sent` with no final error. The organizer was
included in the authoritative `To` set. Independent Dataverse readback
confirmed one active request-bound Site Visit with persisted logistics fields
and five ActivityParty rows. This closes the Production save/send proof but,
like the base proof, stops at Dynamics transport acceptance rather than
independent inbox/calendar-client delivery.

The minimum staff flow is `Create/Reuse Snapshot → Compose → Preview → Explicit
Send → History`:

1. Freeze the exact current Word row/item/version/hash under before/after
   metadata and governed-content checks. Claim or reuse the deterministic Word
   snapshot, then finalize only from a stable-ID Graph readback with native
   publication version/eTag (never an upload/path cTag substitute). When
   selected, compare the retained Word publication version/eTag immediately
   before and after Graph conversion, then retain and verify the deterministic
   PDF row/item the same way. A later metadata-only publication-version/eTag
   change may refresh a Ready snapshot row under Dataverse ETag concurrency
   only after a stable reread proves the retained bytes and hashes unchanged.
2. Accept an explicit To/CC set of known staff and consultants. Staff entry is
   authoritative; normalize and deduplicate addresses, reject invalid syntax or
   To/CC conflicts, show every final address in preview, and never send a valid
   subset after one address fails. No identity-confidence or directory-membership
   gate is part of this workflow.
3. Produce an editable subject/body draft plus selected attachments and source
   version. Preview produces a content hash over recipients,
   subject/body/template version, snapshot identity/hash, Request, and actor.
   Any change invalidates the preview and requires another confirmation.
4. Send only the exact confirmed preview under the authenticated actor. A
   non-sent attempt requires literal-enabled Dynamics impersonation before its
   lease is claimed. Under that lease, the server revalidates that the request
   pointer and native source version still match the prepared attempt. A
   recipient-validation or stale-source failure sends to nobody; the
   application does not silently send to a valid subset.
5. Record one durable Postgres distribution attempt keyed by the exact preview
   and client operation ID. At minimum it stores source and Word/PDF snapshot
   identities,
   recipient set, subject/body/template hashes, actor/time, Dynamics email ID,
   state, attempt count, last completed step, and bounded error evidence.

The send state machine is `preparing → prepared → activity_created →
attachments_added → send_requested → sent`; separate Word/PDF timestamps retain
the exact last completed attachment. The existing
`DynamicsService.createAndSendEmail` helper is not sufficient orchestration by
itself: it creates the activity, attaches, and
sends sequentially but returns the email ID only after all steps, so a failure
or lost response can leave durable partial work and a blind retry can create a
duplicate. The implementation instead persists the email ID immediately after
creation or unique correlation recovery and before exact activity-content
assertions, resumes attachment/send against that same activity, preserves
correlation ambiguity as the actionable failure, queries status before
retrying an ambiguous send response, renews the same fenced lease, and repeats
the current-source fence immediately before transport.

Exact retry of `sent` returns the existing distribution receipt. Attachment
failure reuses the existing draft; send failure never creates another activity.
Changed attachment mode, recipients, body, template, source Word version, or
selected attachment bytes require a new preview and distribution identity.
Transport acceptance is recorded as sent; it is not a claim that every inbox
delivered the message. A later Word
version marks the prior distribution `changed since sent` and offers a new
snapshot/preview/send cycle while preserving what earlier recipients saw.

## AkoyaGo publication projection

**[OWNER DIRECTION 2026-08-21; PRODUCT PURPOSE DECIDED; STORAGE, SCHEMA,
FILENAMES, AND REPRESENTATION DISCOVERY-GATED; PLANNED, NOT BUILT.]** Some staff
will continue to find important request documents through the AkoyaGo Documents
interface, and existing or future Power Automate flows may need a predictable
way to resolve them. The Workbench therefore needs a publication projection
that makes selected governed writeups discoverable from that surface without
turning the projection into a second independently authoritative document.

This direction does **not** decide that publications live at the request root,
inside a named subfolder, behind an additional SharePoint Document Location, or
as any particular kind of copy or link. It does not approve example filenames,
new Dataverse columns or entities, Word-versus-PDF output, or automatic
publication at a lifecycle transition. Those are candidate designs that require
the discovery and bounded proof below. The existing Power Automate proposal-file
contract governs `Reviewer Materials` and `AI Materials` inputs only; do not
silently extend its paths or names to writeup publications.

### Invariants that do not depend on the storage decision

- The governed Workbench artifact and its registered SharePoint item remain the
  source of truth. A publication is a one-way derived representation, never an
  independently synchronized editing peer.
- Every publication attempt identifies one exact source Request Document row,
  SharePoint item, version, and content hash before creating or updating a
  destination.
- Staff and automation receive a verified discoverability contract. They do not
  infer the current document from a generated working filename, a broad folder
  scan, or a `(1)`-style duplicate.
- Repeating an exact completed publication must not create another visible
  publication. A materially changed source requires a deliberate update or new
  publication according to the later approved contract.
- Before updating an existing destination, compare its current identity,
  version, and content with the last successfully published state. Unexpected
  staff edits or replacement fail closed for reconciliation rather than being
  silently overwritten or merged back into the working artifact.
- Workbench lifecycle completion and AkoyaGo publication are separate durable
  outcomes. A publication failure must remain visible and retryable without
  rolling back a completed handoff or falsely reporting the combined action as
  wholly successful.
- The publication record must preserve, by whatever schema is ultimately
  approved, source identity/version/hash, destination identity/version/hash,
  purpose or representation, state, actor/time, and retry/failure evidence.
- External informational distribution remains a distinct consumer contract. A
  frozen DOCX/PDF attachment may reuse publication machinery, but
  an AkoyaGo-visible copy is not automatically the exact copy sent externally.

### Required discovery before design

1. Inspect representative current and historical requests in the signed-in
   AkoyaGo Documents interface. Record which root files, subfolders, and
   additional Document Locations are actually visible and usable to staff.
2. Inventory relevant Power Automate flows and historical writeup conventions.
   Record exact path, filename, trigger, replacement, versioning, and duplicate
   assumptions; do not infer them from the proposal-input contract.
3. In an approved non-governed test location, compare the smallest viable
   destination patterns: request root, a dedicated publication folder, an
   additional Document Location, a materialized file, or a supported link-like
   representation. Verify AkoyaGo visibility and Power Automate consumption,
   not only successful Graph creation.
4. Determine the required representations for each milestone—Word, PDF, or
   both—and whether AkoyaGo users need read-only reference or an editing path.
   If a projection can be edited, define drift detection and reconciliation
   before implementation.
5. Test first publication, exact retry, changed-source republish, unexpected
   destination edit, partial failure, and recovery. Confirm whether updating a
   destination preserves the intended SharePoint item identity and version
   history.
6. Only after those results, choose the destination/path and filename contract,
   publication triggers, permission model, minimum Dataverse shape, Power
   Automate handoff, and UI status/actions. Reconcile the resulting contract
   into this plan, the SharePoint file model, the state Atlas, route-security
   matrix, service catalog, tests, and operational gates before building it.

## Failure, retry, and concurrency rules

- Claim one deterministic operation before model execution or file creation.
- Preserve failed rows and exact run/file cleanup evidence; never report partial
  success as complete.
- Use claim tokens and ETags so two staff actions cannot both activate a
  current document.
- Update prior-row supersession and the corresponding current lookup in one
  changeset.
- A retry with the same generation key reuses its row; a materially changed
  input creates a new row.
- A deterministic content-contract failure is non-retryable under the unchanged
  generation key. Staff receive its durable support reference and must wait for
  a prompt/application or input change; the browser never blindly repeats POST.
- Never overwrite a Ready staff-edited Word item during generation,
  regeneration, review refresh, or Final creation.
- Treat SharePoint native versions as the human-edit history. Do not allocate a
  second application revision counter.
- Reopen by creating an exact preserved successor, never by clearing or
  rewriting the only Review milestone. Exact retry must resolve the same
  successor; any downstream derivative or post-handoff edit fails closed.
- Persist distribution progress after each durable email step. A retry resumes
  the same activity and never infers whole success from a count or from an
  attachment/upload alone.

## Delivery slices and gates

1. **Schema review and apply — completed for Production 2026-08-17.** The
   self-test passed, the owner approved the metadata write, and post-apply
   readback reported 14 exact and 0 divergent. Other environments still require
   their own preflight/apply before runtime `$select` references these fields.
2. **Pre-Site persistence and generation — completed and Production-proved
   2026-08-17.** The durable writer generated Request `1002379` from the exact
   narrative, persisted its run/row/pointer, uploaded Word, and reused the same
   artifact on exact Ready retry.
3. **Pre-Site tab — first slice and recovery hardening deployed.**
   Generate/retry and the stable Word link are live. **[DEPLOYED TO PRODUCTION
   2026-08-17; SIGNED-IN FEATURE SMOKE OPEN]** read-only current/pending status loading and bounded GET
   polling recover a long request whose client response is lost after durable
   completion without another POST. Production template v2 fixed
   Recommendation-cell spacing under a new generation identity and created
   Ready artifact `76a0d4b2-8b9a-f111-b8db-7ced8d3d15a6`, but Word Online
   exposed a width-sensitive Recommendation-label alignment defect.
   **[INFERRED FROM SCREENSHOT + OOXML WIDTH]** implicit wrapping was the
   remaining layout variable. **[DEPLOYED TO PRODUCTION 2026-08-17; SIGNED-IN
   FEATURE SMOKE OPEN]** template v3
   makes the label explicitly non-wrapping under another generation identity.
   Ready deployment `dpl_58hstAQNBP8ATqfBXtYczC9tFziE` also includes the compact help/action panel:
   Generate before a draft exists; Edit, Download, and confirmation-guarded
   Regenerate when Ready. Signed-in current-status, action-panel, download, and
   Word Online v3 proof remain open.
4. **Site Visit Word-workspace handoff — Production-proved 2026-08-21.**
   Commit `32b16f5f` reached Ready production deployment
   `dpl_85CjVsicns1rA6VxJzsJdkXigoTw`. The Site Visit tab confirms the action,
   records the exact stable Word version/hash/time under an ETag fence, reuses
   the same item for Edit/Download, and locks Pre-Site regeneration. A clearer
   Pre-Site next-stage panel and consequence modal are deployed in commit
   `5f316a29`. After exact owner approval, signed-in Request `1002379`
   completed Draft→Review, retained the same exact SharePoint Edit/Download
   identity, returned the handoff timestamp after a fresh authenticated GET,
   and locked Pre-Site regeneration. The service's post-write reread requires
   the exact publication version, governed hash, and milestone time to match.
5. **Promoted-state receipt hardening — Production-proved 2026-08-21.**
   Commit `b3bb0ef6` first reached Production in
   Ready deployment `dpl_FkWu55fyBqSEo8q4DBcdcA3xvigi` and restricts Pre-Site working controls to
   Draft, routes Review warnings and work to Site Visit, and fails closed for
   later/unknown states. After a hard reload onto the deployed bundle, signed-in
   Request `1002379` showed the receipt with zero work controls and one Site
   Visit continuation action. Site Visit showed the expected same Word item,
   Edit/Download, and handoff time. No document or write action was invoked;
   this request had no visible warning, so warning rendering remains test-proven.
6. **Guarded correction/reopen — Production-proved 2026-08-23.** Wave 20 is 3 exact/0 divergent, the Production
   readiness flag is literal `on`, and merge `af986d92` is Ready in deployment
   `dpl_BbtmRghhSYa7EPiQkWxsmdkgRozp`. Signed-in Request `1002788` exercised
   the extended read-only status path without writes. After exact owner
   approval, Request `1002379` created one preserved Ready/Draft successor and
   distinct SharePoint copy; exact retry reused the same row/item and
   Dataverse/Graph readback proved pointer, lifecycle, audit, cardinality, and
   byte coherence. This proof now precedes Final creation so an accidental
   handoff cannot become an unexplained Final lineage source.
7. **Frozen Word/PDF informational email — Production-proved 2026-08-24.** The
   DOCX/PDF/both snapshot, exact preview, explicit send, resume-safe retry, and
   history path is implemented. After explicit owner approval, Request
   `1002379` operation `85f52fc5-fb48-4ceb-84d6-0f246af0b6fb` retained exact
   Word/PDF snapshots, previewed and sent only the selected PDF, and exposed the
   resulting Dynamics receipt in history. Independent Postgres, Dataverse, and
   Graph readbacks proved one `sent` row, a Sent activity, actor attribution,
   and exactly one 133,265-byte attachment matching SHA-256
   `574ac7b833801866c370a8056b7197933addfe3ea5dd535dcf4d29803c18f0c9`.
   Dynamics appended its CRM tracking token after transport acceptance. The
   proof stops at Dynamics Sent; recipient inbox delivery remains unverified.
8. **Site Visit logistics and calendar extension — Production-proved
   2026-08-25.** Wave 21 is exact in sandbox and Production, migration 035 is
   applied/read back, and the readiness flag is literal `on` in
   Preview/Production. Reversible sandbox proof covers nested ActivityParty
   create, ETag-fenced field edits, atomic same-ID party replacement, and exact
   sentinel cleanup. Signed-in Request `1002379` created and round-tripped one
   active Site Visit with five parties. Operation
   `f497643a-2e9e-4032-a323-1e40874d16f1` then sent one governed material plus
   the informational calendar through Dynamics with no final error. Subsequent
   Production UX fixes split date/time controls, hide the daylight-saving
   panel, enforce organizer delivery, correct false JSONB material-staleness,
   and provide a time-zone dropdown that defaults new visits to US Pacific;
   deployment `dpl_28bcFzCpxbwSVf8z5apvNrt1apDV` is Ready.
9. **Site Visit dossier.** Implement governed supporting-file listing/upload
   paths and logistics around the now-built Word-workspace handoff. Keep
   applicant upload work as its own security-reviewed slice.
10. **AkoyaGo publication discovery and contract.** Run the signed-in AkoyaGo,
   historical-convention, Power Automate, and non-governed SharePoint tests
   above. Decide paths, filenames, representations, permissions, triggers, and
   persistence only from that evidence; this slice performs no business-file
   publication or schema write.
11. **Final same-item handoff and tab — Production-proved 2026-08-30 PT /
   2026-08-31 UTC.** Request `1002788` froze the exact source version/hash,
   created/reused one Final lineage row over the same stable item, transitioned
   both pointers/lifecycles with explicit actor/time, and preserved file
   cardinality. Exact-retry behavior remains focused-test covered; no redundant
   Production write was run solely to restate the proof.
12. **Final Writeups dashboard and acknowledgement follow-on.** The focused
   review page and version-aware acknowledgement store are Production-live.
   The full neutral superuser matrix is Production-live in Ready deployment
   `dpl_Frc6fAonyFFYwiWyFJCzzE3UNune`; signed-in DOM proof showed the exact
   11-person roster and correct Request `1002788` states/actions with zero
   browser-console errors. **[PRODUCTION-LIVE + SIGNED-IN READ/WRITE PROVED
   2026-08-31]** Commit `5573bca3` is live in Ready deployment
   `dpl_5DNuc2BV76RihwuWu8ZFYBgxBXE7`. Admin publication/readback survived a
   full reload. The published Research audience contains nine current
   reviewer-role members, excludes owner-confirmed Southern California staff
   Anneli Stone and Saskia Pallais, and rendered Request `1002788` with exactly
   those nine reviewer columns and zero application-console errors. Later
   signed-in Production readback proved the stored v1 setting also contained a
   six-person Southern California audience. Explicit personal lenses are now
   Production-live from commit `213f6c34` / Ready deployment
   `dpl_HGrbWUNPJMJunVevYLVEmtn7He6a`.
   The reviewed version-2 staffing contract, consolidated Admin editor, and
   ETag tooling are Production-deployed at `84bf465b` in Ready deployment
   `dpl_41SybgPYfJXGarf7UqcMGCLMy4KS`. The dry-run-first command upgraded the
   setting once on 2026-09-01 UTC; exact readback proved v2 at
   `W/"96944113"`, 11 complete assignments, zero stale/unassigned rows, and
   unchanged 9/6 audiences. Representative Word-access proof passed
   2026-09-03, followed by the tracked enablement and a six-case read-only
   production-data persona smoke. **[OWNER-REPORTED 2026-09-04]** Program
   Coordinator Duncan Spore subsequently found Request `1002788` in History,
   saw its review-status matrix, and opened the Word document. The
   unshipped team prototype is removed and no Dataverse administrator is
   required. Keep acknowledgement distinct from document lifecycle,
   external distribution, and the AkoyaGo publication projection.

Each slice must trace caller → restriction context → registry persistence →
SharePoint bytes → current pointer → UI consumer and test partial failure,
retry, and concurrent activation. Runtime work follows the campaign release
strategy; this plan itself performs no deployment.

## Acceptance criteria

- A PD can generate one governed Pre-Site Word document whose automatically
  populated content is reproducible from Dataverse and exact AI evidence.
- Opening the Site Visit tab leads to the same Pre-Site Word item; observations
  saved in Word are preserved in SharePoint version history.
- After handoff, the Pre-Site tab is a read-only receipt; only the Site Visit tab
  exposes working-document actions, and every non-Draft lifecycle fails closed.
- A guarded reopen preserves the prior Review row/file/milestone, creates one
  exact Draft successor on exact retry, and refuses post-handoff edits or
  non-distribution downstream derivatives without explicit reconciliation;
  retained frozen-distribution snapshots remain preserved evidence and do not
  block the new editable cycle.
- An informational send attaches the exact frozen Word DOCX, PDF, or both
  approved in preview, persists stepwise attempt state, and resumes without a
  duplicate email activity after attachment, send, or response failure.
- A calendar-enabled informational send includes the server-resolved Site Visit
  organizer in the exact `To` recipients and attaches the same frozen `.ics`
  shown in preview.
- Every Site Visit supporting file appears in the correct governed category and
  has one registry row with stable Graph identity.
- Creating Final records the exact latest/selected Site Visit-stage Pre-Site
  row/version/hash while retaining the same stable SharePoint drive/item; no
  Graph upload/copy/rename/move occurs.
- Retrying an identical operation creates no duplicate current artifact.
- Later edits and recovery use the same Ready Word item and native SharePoint
  version history; first-release Final regeneration is not exposed.
- Overview and the Final writeups dashboard can derive the current Pre-Site and
  Final documents from Request lookups without filename or folder joins.
- Staff who rely on AkoyaGo and approved Power Automate consumers can resolve
  the intended published representation through a tested contract, while the
  Workbench can prove its exact governed source and detect destination drift.
