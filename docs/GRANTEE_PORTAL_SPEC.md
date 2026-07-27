---
title: "Grantee Deliverables Portal — Spec"
domain: grantee-portal
kind: spec
status: active
summary: "As-built grantee deliverables contract: abstract text on akoya_request; package state, image, caption, and waiver evidence on the child row."
canonical: true
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/atlas/dataverse-akoya-request.md
  - docs/atlas/dataverse-wmkf-granteedeliverable.md
  - "pages/workbench/[requestId].js"
  - lib/services/grantee-upload.js
---

# Grantee Deliverables Portal — Spec

Status: **BUILT + LIVE.** The Awardee-tab trigger, abstract/title generation, external grantee
portal, SharePoint image upload, server-side document assembly, and cycle outputs are implemented.
The current data contract is split across two Dataverse rows: `akoya_request` owns the generated and
approved abstract text; one related `wmkf_granteedeliverable` row owns package lifecycle, image,
caption, invite/reminder dates, and versioned waiver evidence. The Atlas pages linked above are the
field-level authority; the dated S268/S269 chronology below explains how the design arrived here.

## Purpose

At the **last stages of a grant cycle**, a **staff member** initiates collection of publication/impact
deliverables from a recent grantee: we generate a style-guide-conforming abstract from the
applicant's own submitted abstract, email the grantee a magic-link to edit/approve it, and collect a
graphical image + caption + a versioned publication-consent acknowledgment, then capture the returned
materials into Dataverse (binaries to SharePoint). The client acknowledgment gates submit, and the
server verifies the signed waiver-render token and persists the exact version, timestamp, and body
hash. Reuses the external **reviewer-portal** primitives
(magic-link, token lifecycle, M365 email, SharePoint upload, fail-closed external auth) — but as a
**parallel grantee variant**, not by mutating the reviewer code (see Reuse).

## Deliverables collected (owner-confirmed)

Per grantee, exactly:

1. **One edited/approved abstract** — we generate a style-guide version from the applicant's own
   submitted abstract; the grantee reviews, **edits in-portal (text, not a file upload)**, and
   **approves**. (NOT two documents.)
2. **One image file** — a graphical/visual upload (graphical abstract). JPEG/PNG/WEBP, ≤10 MB (S278;
   client-side check + server magic-byte/size enforcement).
3. **One image caption** — free text.
4. **Publication-consent waiver** — a single checkbox granting permission to publish the abstract,
   project title, grantee name + institution, and the image + caption in award-announcement materials
   (print + online), and confirming the grantee has the right to share the image. The checkbox remains
   a UI submit-gate (submit stays disabled until it is checked).
   - **UPDATED 2026-07-09 — the waiver is now VERSIONED and the acknowledged version IS persisted**
     (reverses the original S278 "no consent fields persisted" decision, at owner request). The
     wording lives in the versioned `grantee-waiver` policy slot (same `wmkf_policy`/`wmkf_policyversion`
     machinery + admin Policies section as the reviewer COI/AI-use policies), editable by staff.
     On submit, the deliverable row records the exact acknowledged version via the
     `wmkf_WaiverPolicyVersion` lookup + `wmkf_waiverackedat` timestamp — "what the grantee saw",
     bound by a signed render token so submit records the displayed version, not a client-chosen one.
     See `docs/GRANTEE_WAIVER_VERSIONING_PLAN.md`.

## Resolved design decisions (S268)

- **D1 — Abstract chain (3 fields, 2 added).** Source is the **existing** `wmkf_abstract` (the
  *applicant-drafted* abstract captured at proposal submission — `docs/atlas/dataverse-akoya-request.md:47`).
  We generate a **style-guide-conforming** version into a **new** field
  (`wmkf_abstractformatted`). The grantee's **edited/approved** version
  lands in a **separate** field (`wmkf_abstractapproved`) so we preserve provenance:
  *what we generated* vs *what the grantee signed off on*. The AI-formatted field is NOT overwritten
  by the grantee edit.
- **D2 — Storage split.** Abstracts are Dataverse `Memo` fields on `akoya_request`. Lifecycle,
  caption, and the SharePoint image reference live on the related `wmkf_granteedeliverable` row;
  image bytes live in SharePoint. This child-row cutover superseded the original flat request-field
  design and is authoritative in `docs/atlas/dataverse-wmkf-granteedeliverable.md`.
- **D3 — Eligibility is STAFF-INITIATED. No proposal-status keying.** Staff know when to run the
  workflow; we do NOT filter on the messy/polymorphic `akoya_requeststatus`. This removes the
  status-probe work Codex flagged — it does not apply.
- **D4 — Trigger surface = the Awardee tab.** The live Workbench Awardee tab launches and manages
  the workflow.
- **D5 — Scope = RESEARCH only; recipients = TWO contacts (owner-confirmed S268).** The portal runs
  on research grants only (the deliverable is a research output), so there is NO program-family
  branching. The invite addresses the **PI** (`akoya_request.wmkf_projectleader` → `contact`) in **`To`**
  and **Cc's the liaison** (`akoya_request.akoya_primarycontactid` → `contact` — the institution's WMKF
  foundation liaison / grant steward, NOT the PI). Both are auto-resolved (`emailaddress1` + name); staff
  confirm/override and preview the email before send. The earlier program-aware SoCal/Discretionary
  mapping is superseded. (`docs/atlas/dataverse-akoya-request.md:135-160`.)
- **D6 — Schema home: split text from package state.** `akoya_request` retains the two abstract
  fields. A one-per-request `wmkf_granteedeliverable` child row owns package state and evidence,
  enforced by its alternate request key. This is the shipped replacement for the original inline
  status/image/caption fields.

## Flow (as built)

1. **Trigger:** staff opens a grant's **Awardee tab** and starts the grantee-deliverables workflow.
2. **Draft:** Claude generates a style-guide abstract from `wmkf_abstract` via the Executor/prompt
   pipeline into `wmkf_abstractformatted`.
3. **Invite:** staff confirm the two auto-resolved recipients (PI + liaison) and preview/edit the email,
   then email the PI (`To`) and Cc the liaison (PD mailbox via Dynamics 365 / M365) a magic-link to
   `/external/grantee/...` (one link per request — both share it), asking them to edit & approve the abstract and upload image +
   caption, and check the publish-image box (which enables submit). Reuse the "Start …" button +
   copy-paste fallback link (`19bd446e`).
4. **Collect:** in the portal the grantee returns the **edited abstract (in-portal text)**, one
   **graphical image** (upload), and an **image caption** (free text), with the **publish-image box
   checked** (the box gates the submit button). The client echoes the signed waiver render token so
   the server can record the acknowledged version (2026-07-09).
5. **Store (atomic):** upload the image to SharePoint, then commit BOTH Dataverse rows — the
   `akoya_request` approved abstract and the `wmkf_granteedeliverable` caption/image-ref/status +
   waiver version/timestamp — in a single **Dataverse changeset** (per-op If-Match; a stale ETag on
   either row rolls back the whole changeset). SharePoint is outside the changeset: on a non-412
   failure the writer re-reads the deliverable before deleting the upload, so it never deletes an
   image a committed row references (`lib/services/grantee-upload.js`). Virus-scan the image on intake.
6. **Cadence:** a daily cron selects packages still in `Invited` whose first
   `wmkf_inviteddate` is at least 12 days old. It sends one reminder from the
   assigned Program Director to the PI, Cc'ing the liaison, with a day-14 COB
   deadline. The service conditionally claims the package as `Reminder Sent`
   before email delivery so the next run cannot select it again; after a
   successful send it stamps `wmkf_remindeddate`.

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

## Dataverse schema — as built

The existing applicant source `akoya_request.wmkf_abstract` is unchanged.

| Owner | Field | Purpose |
|---|---|---|
| `akoya_request` | `wmkf_abstractformatted` | AI style-guide draft; staff may refine it before invitation. |
| `akoya_request` | `wmkf_abstractapproved` | Grantee-approved body; post-submit staff corrections preserve it as the published version. |
| `wmkf_granteedeliverable` | `wmkf_deliverablestatus` | Package lifecycle. |
| `wmkf_granteedeliverable` | `wmkf_imagefileref` / `wmkf_imagecaption` | Private SharePoint reference and caption. |
| `wmkf_granteedeliverable` | `wmkf_WaiverPolicyVersion` / `wmkf_waiverackedat` / `wmkf_waiverbodyhash` | Exact consent version, acknowledgment time, and SHA-256 of the displayed body. |
| `wmkf_granteedeliverable` | invite/reminder date fields | Delivery cadence and reminder state. |

The old flat request fields `wmkf_granteedeliverablestatus`, `wmkf_granteeimagefileref`, and
`wmkf_granteeimagecaption` are retired from application reads/writes. See the two Atlas pages and
`lib/services/grantee-upload.js` for the atomic two-row write contract.

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
- **Image validation is fail-closed.** `validateGranteeImage` enforces JPEG/PNG/WEBP signatures,
  extension agreement, and size before virus scanning and storage.
- **Atomic submit + rollback** across SharePoint and Dataverse (see Flow step 5).
- **Status constants symmetric** — wave JSON option set and `shared/config/granteeDeliverableStatus.js`
  must stay aligned (triage precedent: `shared/config/triageStatus.js`).
- **Waiver proof crosses the trust boundary.** The client must echo the signed render token for the
  displayed policy version. The submit route rejects a missing, invalid, mismatched, or unbound token;
  the successful changeset persists the exact version, acknowledgment timestamp, and body hash.

## Edited title + server-side document assembly (S269 — design)

S269 extended the portal's scope after reviewing a real PD-built artifact (`Oregon State University
Abstract Draft.docx`). The deliverable isn't just "an abstract field" — it's the PD's **hand-built
award document** (institution + PI + award amount + a one-line edited title + the house-style body),
which today is assembled manually in DOCX and then re-coded by hand into website HTML by a staff
member. The goal is to move that assembly **server-side**. Two new design decisions plus a generation
lifecycle.

**Cross-cutting constraint — RESEARCH PROGRAM ONLY.** The entire S269 scope (edited-title generation,
document assembly, and the cycle export) is gated to research-program grants via
`GRANTEE_RESEARCH_PROGRAM_IDS` (`shared/config/granteeResearchPrograms.js`, GUID-keyed), exactly like
the S268 grantee flow. No program-family branching; non-research grants never enter any of these paths.

**The just-finished cycle is a one-off.** Its research proposals flipped to `Invited` before this
feature existed, so their edited titles must be generated by a **one-time backfill** for that cycle
(an explicit `cycleCode` invocation), not by widening the go-forward cron. Detail: build-plan chunk 7.

### Grant decision lifecycle (the generation timing) — `[VERIFIED S269 via live probe]`

Full detail + the verified `wmkf_phaseistatus` option set live in the
`project-phaseistatus-decision-lifecycle` memory and `docs/atlas/dataverse-akoya-request.md`. Summary:

Phase I in → staff winnow → slate to **committee chairs (de facto decision; their packet keeps the
ORIGINAL `akoya_title`)** → **`wmkf_phaseistatus` flips to `Invited` (100000003)** → **Board Book**
prepared for the board meeting (uses the EDITED title) → board votes → **award (`akoya_requeststatus
= 'Active'`)** → staff generate the **abstract materials** (the existing S268 grantee flow).

⚠️ `wmkf_phaseistatus = Invited` (100000003) means **invited into the competition, NOT awarded** —
consistent with the Awardee-discovery section (award = `Active` + research + PI). The staff
recommendation that precedes the board is `Recommended Invite` (707510005) on the same field.

### D7 — Edited title: generated once at the `Invited` flip, reused twice. `[RESOLVED, owner S269]`

- The italic one-line title/objective (DOCX line 5, e.g. *"To determine whether marine viruses store
  iron in the surface ocean"*) is **not** `akoya_title` (that's the original, kept by the committee
  packet). It is a **new, AI-edited** house-style title.
- **Generate once at `wmkf_phaseistatus → Invited`** (cron-poll predicate `wmkf_phaseistatus eq
  100000003` AND `wmkf_wmkfprojectdescription` empty; idempotent — the slate can reshuffle, so it must
  be re-runnable). **Model: Sonnet (temp 0.1)**, source = applicant **title + abstract**
  (`akoya_title` + `wmkf_abstract`). **Research grants only.** (Sonnet over Haiku: validated S269.)
- Stored in the **EXISTING `wmkf_wmkfprojectdescription` field** (Memo 2000, "WMKF Project Description")
  — staff curate it manually today; the cron writes it **only when empty**, staff edit afterward. **No
  new schema wave** (supersedes an earlier new-field plan; `[VERIFIED S269 via live probe]`). The
  sibling `wmkf_projecttitle1` (String 500) is a different, unrelated field — leave it. **Reused twice**:
  the Board Book first (an external/manual consumer — we only need the field populated and legible),
  then the award-stage abstract assembly. It is *not* needed for the committee packet.
- This is generated **independently of, and earlier than, the abstract materials** — they are two
  separate moments (Invited flip vs. post-award), not one step.

### D8 — Formatting is structural (template), not inline; storage = plain memo + light markdown. `[RESOLVED, owner S269]`

The artifact showed the formatting load is **structural**, determined by *which field* a value is —
institution → bold, location/PI/title → italic, amount → plain currency, body → plain prose — and
applied by the **assembly template**, not authored as rich text. The **body itself carried no inline
formatting** in the example.

- **Structured header fields** (institution, location, PI + co-PIs, award amount, edited title) are
  pulled from existing Dataverse data and **styled by the server-side template** — no rich-text
  storage. (Award amount = `akoya_grant` / `akoya_originalgrantamount`; **never** `akoya_request`,
  which is the migration-backfilled requested amount — Atlas: "never export as a real amount.")
- **Body + caption** are the only fields needing *inline* formatting (the occasional italic
  species/gene name, the occasional bold caption). Keep them **plain memo with a light markdown
  convention**; no `FormatName=RichText` flip on the live prod columns, stays legible in Dataverse,
  and renders to clean controlled HTML on export. A light WYSIWYG (bold/italic/super-sub buttons
  serializing to the convention) keeps friction near zero for the grantee.
  - **Optional enhancement (NOT in the current prompt — Codex pre-impl catch):** the abstract prompt
    *could be extended* to pre-italicize binomial species names / gene symbols so the grantee rarely
    touches markup ("they won't know to proofread for missing italics"). The live S268 prompt
    (`shared/config/prompts/grantee-abstract.js`) emits **bare house-style prose only** — it does NOT
    do this today. If adopted, it's a prompt-contract change (re-seed + A7 re-review), tracked
    separately from chunks 7–8.
- **Security:** this is a high-trust, magic-link, post-award population (owner S269), so untrusted-HTML
  risk is small — but if any inline HTML is ever accepted, sanitize server-side with a tight allowlist
  (`em/strong/sub/sup/p/br`) as cheap defense-in-depth. Markdown-convention storage avoids the HTML
  sink entirely.

### D9 — Server-side assembly replaces the manual DOCX + manual web HTML. `[RESOLVED direction, owner S269]`

A server-side template assembles the structured header + edited title + body (+ caption/image for the
website) into multiple outputs: **(a) the grantee portal review preview, (b) website-ready HTML**
(replaces the staff member's manual HTML coding), and **(c) a cycle-level export** so staff can pull
all of a cycle's awarded abstracts at once (replaces today's manual "compile all abstracts into one
PDF and post it"). Header fields are **display-only** in the portal (Foundation-owned; the grantee
complains case-by-case rather than editing institution/PI/amount). Build detail + open questions:
`docs/GRANTEE_PORTAL_BUILD_PLAN.md` chunks 7–8.

**Build status (S270–271):** the shared assembly model + renderer and all three outputs are BUILT —
**(b) website HTML** and **(c) cycle export** (format = combined HTML, owner decision) at S270; **(a)
portal preview** at S271. The S270 decisions: inline markdown subset = bold/italic (CommonMark) +
super/subscript (pandoc `^x^`/`~x~`); award amount = full-number USD, no cents. The S271 decision: the
edited title is **staff-owned/display-only, NOT PI-editable** — so output (a) renders ALL header fields
(including the title) display-only above the editable body, with no title write-back path. See the
build-plan chunk-8 "BUILT" blocks for modules, the canonical owner template, and route paths.

## Current production boundary (verified 2026-07-27)

The implementation questions about prompt wiring, storage fields, image
validation, and waiver evidence are closed by the as-built contract above:

- abstract generation uses the live grantee-abstract prompt/Executor path;
- waiver wording comes from the versioned `grantee-waiver` policy slot rather
  than hard-coded checkbox copy;
- accepted images are JPEG, PNG, or WEBP up to 10 MB, enforced client- and
  server-side; and
- field/schema literals are recorded in the two canonical Atlas pages.

The reminder policy is implemented, deployed, and no longer an open product
decision. The deployed Vercel configuration registers
`/api/cron/grantee-deliverable-reminders` at `0 8 * * *` (08:00 UTC). The
route accepts only a valid cron secret, and the service implements the day-12
selection/day-14 deadline and once-only claim described above.

A dated production probe found three `wmkf_granteedeliverable` rows, all in
`Drafted`: zero day-12-eligible rows, zero past-day-14 rows, zero claimed
`Reminder Sent` rows with a missing final timestamp, and zero exact-subject
reminder email activities. This proves the current workload is empty; it does
not prove a successful live cron delivery. No execution receipt was available
from the bounded Vercel runtime-log query.

The production `email.grantee_reminder.subject` and `.body` settings each have
exactly one row and match `lib/seed/email-defaults/grantee-reminder.js`. On
2026-07-27 the owner authorized restoring `Thank you,` before the Program
Director signature; the guarded update changed only that setting row and the
post-write probe rendered all tokens without leftovers.

The separate `grantee-waiver` policy slot is also live and resolvable. Its
active version is `2026-07-09`, and its exact body matches the tracked seed in
`scripts/seed-grantee-waiver-policy.mjs`. See
`docs/GRANTEE_WAIVER_VERSIONING_PLAN.md` for the historical rollout record.

## Pointers

- Reviewer portal / external token / SharePoint: `docs/agent-wiki/topics/external-reviewer-portal.md`
- Intake upload / virus scan: `docs/agent-wiki/topics/intake-portal.md`
- Prompt/Executor: `docs/EXECUTOR_CONTRACT.md`
- Dataverse schema-as-code: `lib/dataverse/schema/`, `lib/dataverse/schema-apply.js`, `docs/APPLICATION_STATE_ATLAS.md`
- akoya_request entity facts: `docs/atlas/dataverse-akoya-request.md`
- Schema wave precedent (single-field add): `lib/dataverse/schema/wave2-triagestatus/`
- Workbench Awardee tab: `pages/workbench/[requestId].js:41`
