---
title: "Grantee Submission Visibility — Spec"
domain: grantee-portal
kind: spec
status: active
summary: "Built: a best-effort submit notification to the assigned PD, plus caption and image visibility on the staff Awardee tab."
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

Status: **BUILT (2026-07-29), unpromoted.** Both features are implemented on
`claude/grantee-submit-visibility-spec` with unit coverage; neither has been exercised against live
Dataverse/M365, and the branch has not been promoted. The `[PLANNED]` labels below record the design
intent this was built to — they are retained deliberately, since the shipped code follows them.
Deltas between spec and code are called out in **Implementation notes** at the end.

Every as-built claim about *pre-existing* code is labeled `[VERIFIED via file:line]` against a file
read while drafting (2026-07-29). Read `docs/GRANTEE_PORTAL_SPEC.md` first — that is the canonical
as-built contract for the surrounding flow, and this work is strictly additive to it.

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

**The request object in hand does not carry the fields this needs — do not read them off `verified.request`.**
`[VERIFIED via lib/external/verify-grantee-token.js:22-31]` The token verifier's `REQUEST_SELECT` is
`akoya_requestid, akoya_requestnum, akoya_title, wmkf_meetingdate, wmkf_abstract,
wmkf_abstractformatted, wmkf_abstractapproved` — it contains **neither**
`_wmkf_programdirector_value` **nor** `_wmkf_projectleader_value`. An implementation that reaches for
`verified.request._wmkf_programdirector_value` gets `undefined`, silently falls back to
`explicitRecipients: []`, and the PD never receives the email — the feature's whole point, failing
quietly. The PI name for `metadata` is missing for the same reason.

Resolution: **do a fresh request read inside the notification path** for
`_wmkf_programdirector_value,_wmkf_projectleader_value`, rather than widening the verifier's
projection. That projection is a minimal read on a *public token-authed* surface and widening it would
pull staff-assignment fields into the external grantee request path for every portal page load; keeping
the extra read on the notification path confines it to the staff-facing side effect. Two reads on a
best-effort path that already cannot fail the submit is the right trade.

Either way the null path stays live: an unresolvable PD still notifies category recipients. A test
must pin this specifically — see the tests below.

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
| `message` | `<pi> submitted deliverables for <title>. Review them on the Awardee tab: <awardeeTabUrl>` |
| `metadata` | `requestId`, `requestNumber`, `title`, `pi`, `hasImage`, `captionPresent`, `awardeeTabUrl` |
| `source` | `grantee-portal` |

### The deep link needs an explicit origin `[PLANNED]`

`notify` renders only `title`, `message`, and `metadata` into the email
`[VERIFIED via notification-service.js:79-84,231]` — there is no separate link or action field, so the
deep link has to travel in `message` (and in `metadata` for the dashboard row). Both are listed above.

The path is `/workbench/<requestId>?tab=awardee`, matching the link the awardees list already builds
`[VERIFIED via pages/workbench/awardees.js:119]`. It must be made **absolute** for an email, and the
origin is not obvious:

- Use `process.env.NEXTAUTH_URL` (trailing slash stripped) — the staff app origin.
- Do **not** use `getGranteePortalBaseUrl()`. It prefers `GRANTEE_PORTAL_BASE_URL`, which is
  documented as the *public grantee portal* base and explicitly independent of other branded domains
  `[VERIFIED via lib/external/grantee-token-lifecycle.js:32-38]`. Pointing a staff deep link at the
  grantee-facing origin would produce a URL that either 404s or lands external users on a staff route.

If `NEXTAUTH_URL` is unset, emit the notification with a **relative** path rather than a malformed
absolute URL, and never interpolate an empty origin into `https:///workbench/...`. Whether
`NEXTAUTH_URL` is set in every environment is `[ASSUMED]` — confirm against
`docs/CREDENTIALS_RUNBOOK.md` at implementation time.

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
`[VERIFIED via submit.js:39]`. As built, this wrapper lives inside
`lib/services/grantee-submit-notification.js` rather than the route — see the implementation notes.

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
- **PD email is non-empty when the request has a PD** — this is the regression test for the
  `verified.request` trap above. Assert on the actual address, not merely that `notify` was called;
  a test that only checks the call would pass with `explicitRecipients: []`.
- `notify` rejects → route still returns 200 `{ ok: true }` (**the load-bearing test**)
- PD unresolvable or disabled → `explicitRecipients: []`, still notifies
- `message` and `metadata.awardeeTabUrl` contain `/workbench/<requestId>?tab=awardee`; with
  `NEXTAUTH_URL` unset the value is relative, never `https:///workbench/...`
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

Extend `tests/unit/grantee-abstract-workbench-service.test.js` — **not**
`tests/unit/grantee-abstract-service.test.js`, which covers the unrelated LLM generator
(`generateGranteeAbstract` via `executePrompt`)
`[VERIFIED via tests/unit/grantee-abstract-service.test.js:13-14; grep for loadGranteeAbstract across tests/unit matches only the workbench suite]`:

- absolute `webUrl` ref → `imageUrl === imageRef`, `hasImage: true`
- relative-path ref → `imageUrl: null`, `hasImage: true` (**the trap test**)
- `javascript:` or other non-http scheme → `imageUrl: null`
- no deliverable row / null fields → all five fields null-or-false, no throw
- `wmkf_waiverackedat` surfaces as `submittedAt`

`tests/unit/grantee-deliverables-abstract-route.test.js` **will fail and must be updated in the same
change**: it pins the GET body with `expect(res.body).toEqual({...})` over the exact eight-key envelope
`[VERIFIED via tests/unit/grantee-deliverables-abstract-route.test.js:93-107]`, so adding five fields
breaks it. That is the envelope pin doing its job — update it deliberately; do not loosen `toEqual` to
`toMatchObject` to make it pass.

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

`docs/GRANTEE_PORTAL_SPEC.md` has been reconciled: its flow section now carries the notification step
and the staff-visibility surface.

---

## Implementation notes (2026-07-29)

Where the shipped code differs from, or resolves, the plan above:

- **The open question was decided as (a).** The notification goes through `NotificationService.notify`,
  so each submission also writes a durable `info` alert row. If the alerts dashboard turns out to be
  the wrong tenant for routine successes, option (b) is still the fallback and nothing else has to
  change.
- **The notification lives in a service, not the route.** `lib/services/grantee-submit-notification.js`
  owns it. The spec above implied route-local code like `alertWaiverBlock`, but a route may not import
  `lib/dataverse/adapters/*` and the PD lookup needs two adapter reads — `check:route-service-boundary`
  is a law-mode gate and failed on the first attempt. The route calls
  `notifyGranteeSubmission()` and nothing else.
- **It is awaited but cannot throw.** Awaited before the 200 so a serverless invocation cannot be
  frozen mid-send; the service catches everything internally — recipient resolution and `notify` each
  have their own swallow. Test: `notify throws → submit still 200`.
- **Two reads, as specified.** `grantRequestAdapter.getById` for
  `_wmkf_programdirector_value,_wmkf_projectleader_value`, then `systemUserAdapter.getByIdWithSelect`
  for the PD's `internalemailaddress` + `isdisabled`. The PI name comes from the
  `_wmkf_projectleader_value_formatted` annotation on the first read rather than a third contact read.
- **`hasImage` describes the package, not the upload.** `REVISION_REQUESTED` is an editable status
  `[VERIFIED via shared/config/granteeDeliverableStatus.js:74-79]`, and the writer patches
  `wmkf_imagefileref` only when it uploaded something
  `[VERIFIED via lib/services/grantee-upload.js:134]` — so a resubmit with no new file retains the
  existing image. The flag is `Boolean(imageFile || deliverable?.wmkf_imagefileref)`; checking only the
  multipart file would have reported `hasImage: false` for a package that has one.
- **`toStaffImageUrl` uses `new URL()`** rather than a string prefix test, so `JavaScript:` and other
  case-variant or exotic schemes are rejected by protocol, not by pattern.
- **Gate results.** `check:route-service-boundary`, `check:api-routes`, `check:trust-boundary-guid`,
  `check:dataverse-access-layer`, `check:dynamics-context-boundary`, `check:odata-escape`,
  `check:atlas`, `check:doc-symbol-refs`, `check:doc-currency`, `check:fact-consistency`,
  `check:agent-wiki`, and `check:docs-catalog` all exit 0. Unit suite: 6052 passing. Two suites fail
  (`signin-server-props`, `dependency-security-compat`) — both fail identically on a stashed clean tree,
  so they are pre-existing and unrelated. ESLint adds no new warnings (`AwardeeTab.js` carries the same
  four pre-existing `react-hooks/set-state-in-effect` warnings before and after).
- **Not yet verified live.** No Dataverse or M365 round-trip, and `NOTIFICATION_EMAIL_FROM` /
  `NEXTAUTH_URL` per-environment values remain `[ASSUMED]`. A submitted-package smoke test is the
  promotion gate.
