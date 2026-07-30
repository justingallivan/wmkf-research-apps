---
title: "Grantee Submission Visibility — Spec"
domain: grantee-portal
kind: spec
status: draft
summary: "Proposed: a best-effort submit notification to the assigned PD, plus caption and image visibility on the staff Awardee tab."
canonical: false
cataloged: 2026-07-29
owner: product-engineering
related:
  - docs/GRANTEE_PORTAL_SPEC.md
  - docs/atlas/dataverse-wmkf-granteedeliverable.md
  - "pages/api/external/grantee/[token]/submit.js"
  - shared/components/workbench/AwardeeTab.js
  - lib/services/workbench/grantee-deliverables/abstract-service.js
---

# Grantee Submission Visibility — Spec

Status: **DRAFT / PROPOSED — nothing in this document is built.** Every as-built claim is labeled
`[VERIFIED via file:line]` against a file read while drafting this spec (2026-07-29); every proposed
behavior is `[PLANNED]`. Read `docs/GRANTEE_PORTAL_SPEC.md` first — that is the canonical as-built
contract, and this spec is strictly additive to it.

## Problem

The grantee deliverables flow collects an edited abstract, an image, and a caption, and commits all of
it atomically. What it does not do is tell anyone it happened, or show staff two of the three things
that were collected.

**A successful submission is silent.** `[VERIFIED via pages/api/external/grantee/[token]/submit.js:27,37-56,134]`
The route imports `NotificationService`, but its only call site is `alertWaiverBlock`, which fires on
a *suspicious waiver-token failure* — a blocked submit, not a completed one. The success path returns
`{ ok: true }` and notifies nobody. Disconfirming check run: grepped the submit route and
`lib/services/grantee-upload.js` for `notif|sendEmail|createEmailActivity` — the two hits are both the
waiver-block path; the writer has none.

**Status is pull-only.** `[VERIFIED via pages/workbench/awardees.js:117, awardees-service.js:78-87, AwardeeTab.js:345]`
`/workbench/awardees?cycleCode=` renders a per-award "Deliverables" column from the package status,
and the Awardee tab repeats it. A PD learns a grantee responded only by loading one of those pages.

**The caption and image are invisible in the app.** `[VERIFIED via shared/components/workbench/AwardeeTab.js:341-506, lib/services/grantee-document-html.js:14-16,48-51]`
The Awardee tab shows status and the abstract and nothing else from the deliverable row. The cycle
export emits the caption as a `<figcaption>` but reduces the image to an HTML comment —
`<!-- image: <ref> (insert image via site CMS) -->` — and that module's own header calls public image
serving "a separate follow-up." To see what a grantee uploaded, staff must open SharePoint and
navigate to `<requestNum>_<REQUESTID>/Grantee_Uploads` `[VERIFIED via lib/services/grantee-upload.js:30-35,77]`.

Out of scope: the unbuilt `Staff Review` / `Revision Requested` / `Complete` / `Closed No Response`
transitions. Those option-set values exist and are read by editability guards, but a repo-wide grep
for `STAFF_REVIEW|Staff Review|REVISION_REQUESTED` across `lib pages shared scripts` returns only
two read-side call sites and the constants file itself — no writer
`[VERIFIED via abstract-service.js:48-51, pages/api/external/grantee/[token]/context.js:39]`. That is
a separate lifecycle build, and neither feature here depends on it.

---

## Feature 1 — Submit notification to the assigned Program Director

### Behavior `[PLANNED]`

On a successful grantee submission, emit one notification whose email reaches the assigned Program
Director for that request and whose durable record lands in the alerts dashboard. It carries the
request number, project title, PI name, whether an image was included, and a deep link to the Awardee
tab.

Non-negotiable: **the notification must never fail the grantee's submit.** It fires only after
`writeGranteeDeliverables` returns `ok`, wrapped in try/catch, and a throw is logged and swallowed.
`alertWaiverBlock` is the shape to copy `[VERIFIED via submit.js:53-55]`.

### Recipient resolution `[PLANNED]`

`NotificationService.notify` emails *category* recipients, not an arbitrary address — but it unions
them with a per-event `explicitRecipients` list, and the documented example for that parameter is
literally "the Program Director on a specific `akoya_request`"
`[VERIFIED via lib/services/notification-service.js:138-148]`.

So resolve the PD email the way the reminder cron already does: read `_wmkf_programdirector_value` off
the request, then `systemUserAdapter.getByIdWithSelect(id, 'systemuserid,fullname,internalemailaddress,title,isdisabled')`,
treating a disabled user as unresolvable
`[VERIFIED via lib/services/cron/grantee-deliverable-reminders-service.js:51,54,76-81]`. Pass
`explicitRecipients: pdEmail ? [pdEmail] : []`, matching three existing callers
`[VERIFIED via lib/services/review-upload.js:583-586, reviewer-quota.js:99, reviewer-withdrawal.js:70]`.

An unresolvable PD is **not** an error — category recipients still receive it. Never make the
grantee's submit outcome depend on PD resolution.

### Notification shape `[PLANNED]`

| Field | Value |
|---|---|
| `type` | `grantee_deliverable_submitted` |
| `severity` | `info` |
| `emailAdmins` | `true` — required: `notify` emails only on `emailAdmins`, `error`, or `critical` `[VERIFIED via notification-service.js:74-75]`, and this is an `info` event |
| `category` | `grantee-deliverables` (new) |
| `explicitRecipients` | `[pdEmail]` when resolvable, else `[]` |
| `autoResolveKey` | **omit** — each submission is a distinct event, not a condition that clears |
| `title` | `Grantee deliverables submitted (<requestNum>)` |
| `metadata` | `requestId`, `requestNumber`, `title`, `pi`, `hasImage`, `captionPresent` |
| `source` | `grantee-portal` |

Add `{ key: 'grantee-deliverables', description: '...' }` to `SEED_CATEGORIES`
`[VERIFIED via lib/services/alert-recipients.js:25-34]`. That list is discoverability scaffolding for
`/admin` → Alert Recipients, not a whitelist — an unseeded category still resolves through the
default/roster fallback `[VERIFIED via alert-recipients.js:127-141]` — but seeding it is how staff find
it to configure.

`NOTIFICATION_EMAIL_FROM` must be set or the email is skipped with a log line and no error, while the
dashboard alert still persists `[VERIFIED via notification-service.js:132-136]`. Its per-environment
value is `[ASSUMED]` here — confirm against `docs/CREDENTIALS_RUNBOOK.md` before calling this shipped.

### DAL context `[PLANNED]`

The submit route is a public token-authed surface that establishes its own trusted context per
operation `[VERIFIED via submit.js:79,123]`. The notification path both reads Dataverse (PD lookup) and
sends email, so it needs its own `withDalContext('grantee-submit-notify', ...)`: `sendEmail`,
`createEmailActivity`, and `addEmailAttachment` all call `assertTrustedDalContext` first (CLAUDE.md
Universal Safety Invariants, closed S330). `alertWaiverBlock` is the precedent
`[VERIFIED via submit.js:39]`.

### Escaping `[PLANNED]`

`title`, `message`, and `metadata` flow into the email HTML, and this event carries
**grantee-controlled text** (the caption, and the uploaded filename). `_formatEmailBody` escapes via
`_escapeHtml`, whose docstring names external-uploader filenames as the motivating threat
`[VERIFIED via notification-service.js:211-231]`. Do not hand-build HTML around these values, and
prefer to keep the raw caption out of the email entirely — `captionPresent: true` is enough to tell a
PD to go look.

### Open question for review

Every submission writes a durable row to the alerts dashboard, which is today a *problem* feed (virus
detections, quota breaches, auth bypass) `[VERIFIED via alert-recipients.js:25-34 seed categories]`.
Volume is modest — the cycle-export module states a cycle is ~12–24 awards
`[VERIFIED via lib/services/workbench/grantee-deliverables/cycle-export-service.js:12]`, which bounds
submissions per cycle at that same order; I did not independently query Dataverse for an award count,
so treat the number as the source comment's claim rather than a measured denominator. Two candidate
resolutions:

- **(a)** Accept it. One `info` alert per award per cycle is low volume, and the durable record is a
  useful audit trail of who submitted when.
- **(b)** Send the PD email through the M365 path the invite and reminder already use
  (`lib/external/grantee-invite-email.js` plus the send used by `send-invite-service.js`) and skip the
  alert row entirely.

**(a) is the recommendation** — a handful of lines against an existing helper, versus a second
email-render path to maintain. But it is a product call about what the alerts dashboard is *for*, and
it should be settled before implementation, not during.

### Tests `[PLANNED]`

Extend `tests/unit/grantee-submit-route.test.js`:

- success → `notify` called once with `type: 'grantee_deliverable_submitted'` and the PD email in
  `explicitRecipients`
- `notify` rejects → route still returns 200 `{ ok: true }` (**the load-bearing test**)
- PD unresolvable or disabled → `explicitRecipients: []`, still notifies
- waiver-block path → still emits `grantee_waiver_block`, no submitted notification
- non-editable 409 and rate-limited 429 → no notification

---

## Feature 2 — Caption and image on the staff Awardee tab

### Behavior `[PLANNED]`

When a deliverable has been submitted, the Awardee tab shows, below the abstract editor: the image
caption as read-only text, and a link that opens the uploaded image in SharePoint in a new tab. With
no image, it says so rather than rendering an empty affordance.

Read-only in v1. Staff caption editing is a separate change with its own ETag concurrency story, and
the caption is not staff-editable anywhere today.

### Data path `[PLANNED]`

No new route. `loadGranteeAbstract` already reads the deliverable row for status
`[VERIFIED via abstract-service.js:85-100]`, and `GET /api/workbench/grantee-deliverables/abstract` is
already staff-guarded by `requireAppAccess(req, res, 'reviewers')`, which its header describes as
matching the other grantee-deliverable routes
`[VERIFIED via pages/api/workbench/grantee-deliverables/abstract.js:20,43]`. Extend its 200 body:

```
caption:     string|null   // deliverable.wmkf_imagecaption
imageRef:    string|null   // deliverable.wmkf_imagefileref
imageUrl:    string|null   // imageRef, ONLY when it is an absolute http(s) URL
hasImage:    boolean       // Boolean(imageRef)
submittedAt: string|null   // deliverable.wmkf_waiverackedat
```

Add `wmkf_waiverackedat` to `DELIVERABLE_SELECT`
`[VERIFIED via lib/services/grantee-deliverable-record.js:14-21]`. `wmkf_imagefileref` and
`wmkf_imagecaption` are already selected there; the waiver fields are written at submit but never read
back `[VERIFIED via lib/services/grantee-upload.js:128-133]`. That select is shared by every
deliverable reader, so the change is additive — but it *is* a shared-helper change, so trace its
callers per CLAUDE.md's high-risk-workflow rule rather than assuming additivity.

### `imageRef` is not reliably a URL — the correctness trap

`[VERIFIED via lib/services/grantee-upload.js:121]` The writer sets
``newImageRef = uploadedItem.webUrl || `${folder}/${newFilename}` ``. The Graph `webUrl` is an
absolute, clickable SharePoint URL and is the normal case — but the fallback is a **relative library
path**, which would render as a broken same-origin link if linkified blindly.

So the server derives `imageUrl` and the client trusts only that:

- absolute `https://` (or `http://`) → `imageUrl = imageRef`; render
  `<a target="_blank" rel="noopener noreferrer">`
- anything else → `imageUrl = null`; render the ref as plain monospace text with a "path in the
  grantee SharePoint library" hint

Do the scheme check server-side in the service, not in JSX — it stays unit-testable, and a
`javascript:`-shaped value can never reach an `href`.

### No submitted-date field exists

`[VERIFIED via lib/services/grantee-deliverable-record.js:14-21 and docs/GRANTEE_PORTAL_SPEC.md:137-153]`
`wmkf_granteedeliverable` has `wmkf_inviteddate` and `wmkf_remindeddate` but no submitted date.
`wmkf_waiverackedat` is stamped inside the same submit changeset
`[VERIFIED via grantee-upload.js:128-129]`, so it is an accurate de-facto submission timestamp.

Use it, and **label it honestly in the UI** — "Waiver acknowledged <date>", not "Submitted <date>".
The two coincide today because one changeset writes both, but they are semantically different fields
and a future resubmit path could separate them. Adding a real `wmkf_submitteddate` is a Dataverse
schema wave and is deliberately not proposed here.

### UI `[PLANNED]`

A new section in `AwardeeTab.js`, after the abstract section and before "Invitation"
`[VERIFIED via AwardeeTab.js:392,394]`, since it describes what came back rather than what goes out.
Render only when `hasImage || caption || submittedAt`, so pre-submit awards look exactly as they do
now.

```
Grantee submission
Waiver acknowledged 12 Jul 2026

Caption
  <caption text, read-only>                        — or "No caption provided."

Image
  Open image in SharePoint ↗                       — when imageUrl
  <ref>  (path in the grantee SharePoint library)  — when imageRef but not absolute
  No image uploaded.                               — when neither
```

The caption is grantee-authored text rendered into a staff page. React escapes text children by
default, so render it as one and **do not** reach for `dangerouslySetInnerHTML`. The server-side
`captionHtml` on the assembly model `[VERIFIED via lib/services/grantee-document-assembly.js:156]`
exists for the export document, not for this tab; ignore it here.

### Rejected alternative: proxy the image through the app

An authenticated `GET /api/workbench/grantee-deliverables/image?requestId=` streaming the bytes via
Graph would render a real thumbnail and would not depend on the viewer's SharePoint access. It also
means a new route, a new `docs/API_ROUTE_SECURITY_MATRIX.md` entry, a binary-response contract, and a
second private-material egress path to keep fail-closed.

Rejected for v1 per CLAUDE.md rule 8 (simplest thing that could work). Staff SharePoint access is
`[ASSUMED]` — it is how the files are reachable today, but I did not verify per-user library
permissions. A link answers "did they upload something, and what is it." Revisit if staff report it is
insufficient; the `imageUrl` field keeps the client contract stable if the value later becomes a proxy
path instead of a SharePoint URL.

### Tests `[PLANNED]`

Extend `tests/unit/grantee-abstract-service.test.js`:

- absolute `webUrl` ref → `imageUrl === imageRef`, `hasImage: true`
- relative-path ref → `imageUrl: null`, `hasImage: true` (**the trap test**)
- `javascript:` or other non-http scheme → `imageUrl: null`
- no deliverable row / null fields → all five fields null-or-false, no throw
- `wmkf_waiverackedat` surfaces as `submittedAt`

Extend `tests/unit/awardee-tab.test.js`:

- section hidden entirely pre-submit
- link carries `rel="noopener noreferrer"` when `imageUrl` is present
- plain text, no anchor, when `imageRef` is relative
- a caption containing `<script>` renders as literal text

---

## Sequencing and gates

The features are independent — either can ship alone. Feature 2 is lower-risk (one additive service
field, one UI section, no email, no external side effect) and is the better first landing.

Gate scope per `docs/CI_GATES_REFERENCE.md`, each run sequentially with its self-test, for the
surfaces these changes touch: `npm run check:api-routes` (a route *body* change — no new route, so no
security-matrix entry should be required, but confirm the gate agrees), the full unit suite, and
`npm run check:agent-invariants` only if instruction files change. Feature 1 touches a
Dataverse-write-adjacent email path, so DAL-enforcement and target-interlock expectations apply. The
specific gate list is `[ASSUMED]` from the reference doc's scoping rules and should be confirmed
against it at implementation time.

Tier: runtime work on a live flow → branch and deliberate promotion per
`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`, not a direct `main` landing.

On implementation, reconcile `docs/GRANTEE_PORTAL_SPEC.md` (its flow section gains a notification
step; the staff-visibility gap closes) and this file's `status:` per `.claude/rules/durable-docs.md`.
