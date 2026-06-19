# Grantee Deliverables Portal — Spec

Status: **DESIGN RESOLVED + SCHEMA DEPLOYED (S268).** Owner-confirmed decisions folded in from the
S268 Codex design review + owner clarifications. The **Dataverse field wave is LIVE in prod** (5/5
fields created 2026-06-18, re-probe shows 5/5 EXACT). The **portal application is NOT built** —
Awardee-tab trigger, abstract generation, external grantee portal, SharePoint upload/return, and the
status write-path all remain to build. Label new state claims `[VERIFIED]`/`[ASSUMED]` as
implementation lands.

## Purpose

At the **last stages of a grant cycle**, a **staff member** initiates collection of publication/impact
deliverables from a recent grantee: we generate a style-guide-conforming abstract from the
applicant's own submitted abstract, email the grantee a magic-link to edit/approve it, and collect a
graphical image + caption + a publish-my-image checkbox (a client-side submit gate), then capture the returned
materials into Dataverse (binaries to SharePoint). Reuses the external **reviewer-portal** primitives
(magic-link, token lifecycle, M365 email, SharePoint upload, fail-closed external auth) — but as a
**parallel grantee variant**, not by mutating the reviewer code (see Reuse).

## Deliverables collected (owner-confirmed)

Per grantee, exactly:

1. **One edited/approved abstract** — we generate a style-guide version from the applicant's own
   submitted abstract; the grantee reviews, **edits in-portal (text, not a file upload)**, and
   **approves**. (NOT two documents.)
2. **One image file** — a graphical/visual upload (graphical abstract). Format/size TBD.
3. **One image caption** — free text.
4. **Image-publication waiver** — a single checkbox granting permission to publish their image.
   Low-stakes / non-controversial (owner: never been refused). **Implemented as a UI submit-gate,
   NOT a stored field:** the submit button stays disabled until the box is checked, so a submission
   existing *is* the consent record. **No consent fields are persisted to Dataverse** (no boolean,
   timestamp, IP/UA/version/hash, snapshot, or contact lookup).

## Resolved design decisions (S268)

- **D1 — Abstract chain (3 fields, 2 new).** Source is the **existing** `wmkf_abstract` (the
  *applicant-drafted* abstract captured at proposal submission — `docs/atlas/dataverse-akoya-request.md:47`).
  We generate a **style-guide-conforming** version into a **new** field
  (`wmkf_abstract_formatted` — owner's suggested name). The grantee's **edited/approved** version
  lands in a **separate new** field (`wmkf_abstract_approved`) so we preserve provenance:
  *what we generated* vs *what the grantee signed off on*. The AI-formatted field is NOT overwritten
  by the grantee edit.
  - ⚠️ Dataverse logical-name caveat: a schemaName's logical name is lowercased and the publisher
    underscore is the only safe underscore. Confirm at preflight whether `wmkf_abstract_formatted`
    (mid-name underscore) is accepted, or use schemaName `wmkf_AbstractFormatted` →
    `wmkf_abstractformatted`. Honor owner naming intent; resolve the exact literal at build.
- **D2 — Storage split.** Abstracts and caption are Dataverse `Memo`/text on `akoya_request`;
  the image binary lives in SharePoint with a Dataverse text reference field. (Dataverse file
  columns are not supported by the current `schema-apply` type switch — `lib/dataverse/schema-apply.js:45-152`.)
- **D3 — Eligibility is STAFF-INITIATED. No proposal-status keying.** Staff know when to run the
  workflow; we do NOT filter on the messy/polymorphic `akoya_requeststatus`. This removes the
  status-probe work Codex flagged — it does not apply.
- **D4 — Trigger surface = the Awardee tab.** Launched from the currently-empty **Awardee tab** in
  the workbench (`pages/workbench/[requestId].js:41` — `{ key: 'awardee', label: 'Awardee' }`,
  defined with no render branch today). This tab gets populated as part of the build.
- **D5 — Scope = RESEARCH only; recipients = TWO contacts (owner-confirmed S268).** The portal runs
  on research grants only (the deliverable is a research output), so there is NO program-family
  branching. The invite addresses the **PI** (`akoya_request.wmkf_projectleader` → `contact`) in **`To`**
  and **Cc's the liaison** (`akoya_request.akoya_primarycontactid` → `contact` — the institution's WMKF
  foundation liaison / grant steward, NOT the PI). Both are auto-resolved (`emailaddress1` + name); staff
  confirm/override and preview the email before send. The earlier program-aware SoCal/Discretionary
  mapping is superseded. (`docs/atlas/dataverse-akoya-request.md:135-160`.)
- **D6 — Schema home: extend `akoya_request` inline.** One staff-run package per grant, no
  resubmission rounds planned, so add fields directly to `akoya_request` (matches Atlas "lifecycle
  additions stay merged into the vendor entity" — `docs/atlas/dataverse-akoya-request.md:11-15,144-147`).
  Revisit a child entity only if resubmissions/version history become first-class.

## Flow (intended)

1. **Trigger:** staff opens a grant's **Awardee tab** and starts the grantee-deliverables workflow.
2. **Draft:** Claude generates a style-guide abstract from `wmkf_abstract` via the Executor/prompt
   pipeline into `wmkf_abstract_formatted`. *(Concrete prompt/template TBD — see Open items.)*
3. **Invite:** staff confirm the two auto-resolved recipients (PI + liaison) and preview/edit the email,
   then email the PI (`To`) and Cc the liaison (PD mailbox via Dynamics 365 / M365) a magic-link to
   `/external/grantee/...` (one link per request — both share it), asking them to edit & approve the abstract and upload image +
   caption, and check the publish-image box (which enables submit). Reuse the "Start …" button +
   copy-paste fallback link (`19bd446e`).
4. **Collect:** in the portal the grantee returns the **edited abstract (in-portal text)**, one
   **graphical image** (upload), and an **image caption** (free text), with the **publish-image box
   checked** (the box gates the submit button; nothing about consent is persisted).
5. **Store (atomic):** upload the image to SharePoint, then PATCH Dataverse with the approved
   abstract + caption + image ref + status. **On Dataverse failure, clean up the
   SharePoint upload** (follow the review-upload rollback pattern — `lib/services/review-upload.js:176-227`).
   Virus-scan the image on intake.
6. **Cadence:** once per cycle, with an optional reminder for non-responders.

## Reuse — shared primitives vs parallel grantee variant

**Share safely (true primitives):** HMAC token primitive (`mintToken`/`verifyToken`/`hashToken`,
`lib/services/external-token.js`), external rate-limit/IP helper (`lib/external/rate-limit.js`),
Cloudmersive `scanBytes` (`lib/services/cloudmersive-scan.js`), the Graph/SharePoint upload pattern,
and the external-route fail-closed structure.

**Build a parallel grantee variant (do NOT mutate reviewer code):** token lifecycle/verifier,
portal pages/routes, status machine, upload writer, form validation, SharePoint folder naming, and
Dataverse field writes. `lib/external/token-lifecycle.js` is hard-coded to
`wmkf_appreviewersuggestions` + `/external/review/...` (`:19-21,42-60,179-181`); `writeReviewFiles`
writes `wmkf_review*` fields, uses the `Reviewer_Uploads` folder, validates reviewer form data, and
tightens reviewer-token expiry (`lib/services/review-upload.js:106-120,172-175,203-238`). Copying
either as-is is the copy-paste-drift trap.

## Dataverse field schema (wave JSON) — DEPLOYED S268

File: `lib/dataverse/schema/wave2-grantee-deliverables/akoya_request-grantee-deliverables.json`,
`kind: "extensions-on-existing"` on `akoya_request`, publisher prefix `wmkf`. Isolated wave so
`apply-dataverse-schema --wave=2-grantee-deliverables` creates ONLY these fields. **Applied to prod
2026-06-18** (`--execute`); preflight re-probe confirms 5/5 EXACT.

New fields (the existing `wmkf_abstract` is the source and is NOT created):

| schemaName (resolve underscore at build) | type | purpose |
|---|---|---|
| `wmkf_abstract_formatted` | Memo (~32k) | AI style-guide abstract drafted from `wmkf_abstract`. Not overwritten by grantee edit. |
| `wmkf_abstract_approved` | Memo (~32k) | Grantee-edited/approved abstract (in-portal text). |
| `wmkf_GranteeImageFileRef` | String/Url (1000) | SharePoint reference for the graphical image. |
| `wmkf_GranteeImageCaption` | Memo (4000) | Free-text image caption. |
| `wmkf_GranteeDeliverableStatus` | Picklist | Package lifecycle (below). Mirrors `shared/config/granteeDeliverableStatus.js`. |

**No consent fields** — the image-publication waiver is a client-side submit gate (checkbox enables
submit), not stored. The existence of a submitted package is the consent record. So the new schema
is just **4 content fields + 1 status picklist** (5 total): the two abstract fields, the image ref,
the caption, and the status.

Status picklist option set (mirror in `shared/config/granteeDeliverableStatus.js` — keep symmetric):
`Drafted` (100000000), `Invited` (100000001), `Reminder Sent` (100000002), `Submitted` (100000003),
`Staff Review` (100000004), `Revision Requested` (100000005), `Complete` (100000006),
`Closed No Response` (100000007). Null/unset = not started.

## Implementation hazards / ordering (from Codex, owner-relevant subset)

- **Preflight before apply.** `schema-apply` is CREATION-ONLY — it checks existence before create
  and will NOT reconcile a divergent pre-existing field (`schema-apply.js` header + `ensureAttribute`).
  Write `scripts/preflight-grantee-deliverables-fields.mjs` (pattern:
  `scripts/preflight-triagestatus-field.mjs` — absent OK, exact match OK, divergent existing aborts).
- **No Power Automate trigger.** Verify post-deploy that writes limited to these new fields fire no
  AkoyaGO/PA flow (`docs/atlas/dataverse-akoya-request.md:63`).
- **Image magic-byte validation is a GAP.** The shared validator handles PDF/DOCX/XLSX, not images
  (`lib/utils/file-magic.js:15-20,132-160`) — add image-format magic-byte checks before storing.
- **Atomic submit + rollback** across SharePoint and Dataverse (see Flow step 5).
- **Status constants symmetric** — wave JSON option set and `shared/config/granteeDeliverableStatus.js`
  must stay aligned (triage precedent: `shared/config/triageStatus.js`).
- **Waiver is a UI gate, not server-validated state** — the submit button is disabled until the box
  is checked. Since nothing is persisted, the gate lives in the portal form; the submit route does
  not (and need not) record or re-check consent.

## Open items (resolve during implementation)

- Exact abstract-generation **prompt/template** and Executor wiring (Q1 partially open).
- Exact **publish-image checkbox wording** (the UI label shown by the submit button).
- Image **accepted formats/size**.
- **Reminder cadence/deadline** specifics (count, window, who's notified).
- Final **schemaName literals** (underscore caveat in D1).

## Pointers

- Reviewer portal / external token / SharePoint: `docs/agent-wiki/topics/external-reviewer-portal.md`
- Intake upload / virus scan: `docs/agent-wiki/topics/intake-portal.md`
- Prompt/Executor: `docs/EXECUTOR_CONTRACT.md`
- Dataverse schema-as-code: `lib/dataverse/schema/`, `lib/dataverse/schema-apply.js`, `docs/APPLICATION_STATE_ATLAS.md`
- akoya_request entity facts: `docs/atlas/dataverse-akoya-request.md`
- Schema wave precedent (single-field add): `lib/dataverse/schema/wave2-triagestatus/`
- Workbench Awardee tab: `pages/workbench/[requestId].js:41`
