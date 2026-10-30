---
agent_wiki: topic
status: active
last_verified: 2026-10-22
verification_scope: "Scoped 2026-10-22 local-source and focused-test verification of invitation authorization/fingerprint and first-manual-invitation COI paths; not deployed, no hosted behavior or whole-topic recertification"
stale_after_days: 90
owner: reviewers
title: "Reviewer Invitation and Email Delivery"
source_files:
  - shared/components/reviewers/InviteEmailModal.js
  - shared/components/reviewers/EmailTemplatesModal.js
  - shared/components/reviewers/email-template-store.js
  - shared/components/reviewers/render-preview-failure.js
  - lib/services/review-manager/send-emails-service.js
  - lib/services/review-manager/render-emails-service.js
  - lib/services/reviewer-engagement/record-invitation.js
  - lib/services/reviewer-manual-reminder.js
  - lib/services/reviewer-reminder-sweep.js
  - lib/utils/invitation-link-validator.js
  - lib/services/review-manager/draft-fingerprint.js
  - lib/services/reviewer-request-authorization.js
  - lib/services/reviewer-first-manual-invitation-coi.js
  - pages/api/review-manager/review-due-extension.js
  - lib/services/reviewer-due-extension.js
  - shared/components/reviewers/ReviewerDueDateEditor.js
  - shared/components/reviewers/ReviewerManagePanel.js
canonical_docs:
  - docs/REVIEWER_ENGAGEMENT_SPEC.md
  - docs/REVIEWER_LIFECYCLE_STAGE6D_BUILD_PLAN.md
  - docs/REVIEWER_MANUAL_RESPOND_NUDGE_BUILD_PLAN.md
watch_paths:
  - shared/components/reviewers/InviteEmailModal.js
  - shared/components/reviewers/EmailTemplatesModal.js
  - shared/components/reviewers/email-template-store.js
  - lib/services/review-manager/send-emails-service.js
  - lib/services/review-manager/render-emails-service.js
  - lib/services/reviewer-request-authorization.js
  - lib/services/reviewer-first-manual-invitation-coi.js
  - lib/utils/invitation-link-validator.js
  - pages/api/review-manager/review-due-extension.js
  - lib/services/reviewer-due-extension.js
  - shared/components/reviewers/ReviewerDueDateEditor.js
  - shared/components/reviewers/ReviewerManagePanel.js
update_triggers:
  - "Invitation template, preview, or send behavior changes"
  - "Invitation timing, secure-link, or email-default contracts change"
extracted_from: docs/agent-wiki/topics/reviewer-workbench-lifecycle.md
extraction_source_sha256: fdccedfe393f7ae7db7afa04b5b48297080b5c269290637bbf70e192f68888e7
extraction_segments:
  - "343-359"
  - "755-795"
  - "1847-2012"
---

# Reviewer Invitation and Email Delivery

> The source page mixed current guidance with dated history and owner decisions; those distinctions are preserved in the extracts. The 2026-10-22 recheck below is scoped to local invitation authorization/fingerprinting and first-manual-invitation screening, verified in local source and focused tests; it is not deployment or hosted verification. It does not recertify the rest of this topic.

**Invitation authorization and draft freshness (local source and focused tests verified 2026-10-22; not deployed).** Version 2 of `draftFingerprint` applies to invitations only and adds the assigned Program Director ID; request/date inputs were already present in version 1, and other template types remain on version 1. It does not bind the request ID or sender mailbox/name/details. The route authorizes the complete batch and passes a server request→authorized-PD snapshot into the send service. The service computes the send-time fingerprint once from batch hydration; separate fresh-PD checks compare current request assignment with the authorization snapshot before mint and again before dispatch. These checks do not rerun all fingerprint inputs. If drift is found at the later check, dispatch is withheld even when the token has already been minted. The separate assignment reads and later transport cannot atomically prevent an external Program Director change after the final read; a token minted earlier is not rolled back. Observed drift stops the affected and subsequent unsent effects, but cannot erase an effect that already occurred. This describes current local source only; no deployment or hosted invitation was checked for this update.

**First invitation for a staff-manual reviewer (local source and focused tests verified 2026-10-22; not deployed).** The shared `reviewer-first-manual-invitation-coi.js` helper fresh-reads the suggestion, linked person, and proposal institution context before a normal first send, copyable-link regeneration, or recording a manually sent first invitation. The generic `correctResponse` path is a fourth entry point when the requested lifecycle includes `invited: true` or a non-empty `emailSentAt`. Only server-persisted `wmkf_maininstitution` is trusted as the person's current institution. A blank value is unknown; `wmkf_primaryaffiliation`, `wmkf_organizationname`, or source text alone does not establish current institution. Only a known COI decision of `dropped` blocks; the Broad HHMI exemption remains exempt. Unavailable required context fails closed. The separate correction guard rejects a combined `mainInstitution` edit plus first-invite stamp before either write. For email sends, `send-emails-service.js` emits `manual_invitation_changed` when its fresh suggestion read finds that the row no longer qualifies as a first-manual-invitation row. This additional read can withhold non-manual invitation or regeneration when unavailable, so it has an availability cost. This is limited to first-invitation actions for a `staff_manual` suggestion with no invitation/engagement history: there is no new schema or acknowledgement, no recheck for each edit, and no recheck for an already-engaged reviewer. No hosted behavior is claimed.

<!-- source-lines: 343-359 -->
**Per-reviewer extension workflow (Wave 18 production-live 2026-08-11; current source contract checked 2026-10-22):** eligible accepted rows in **Track Reviewers** expose Grant/Change extension. The dedicated `/api/review-manager/review-due-extension` route freshly enforces accepted/non-terminal/no-receipt state. A non-null date must be strictly after the request default and current/future in Foundation-Pacific time; there is no fixed calendar maximum. Before a non-null override save, a present stored token hash must pass expiry and revocation preflight: a revoked hash or an expiry shorter than the proposed cover date fails with `token_recovery_required` before the date write. No stored hash means that preflight is skipped, and clearing the override to null to restore the original date also skips it. These checks do not rotate a token. The route validates the admin body, Dynamics impersonation setting, assigned sender, confirmed recipient, signature, and calendar. Confirmed engagement snapshot name/email take precedence; legacy missing values fall back field-by-field to the server-read linked reviewer person, and absence from both sources still fails before the write. It then ETag-saves and automatically dispatches the fixed-subject message with the assigned-PD signature and stable-UID calendar update. Only an actual Dynamics dispatch failure preserves the date without the notice. The open modal offers a server-fresh retry, and an existing extension always offers Resend deadline email without another date write; there is no durable notification-owed marker for a failed restore send. Invite Reviewers and generic `my-candidates` PATCH cannot write the field. The 90-day accepted-token cushion remains intentional and saving does not rotate a delivered token. [VERIFIED via production create/publish/exact/runtime-select probes, the non-clobbering admin-body seed, main `8647af33`, Vercel `dpl_AbTvWvMYb5inwPnYKTK2mkrkNXZz`, and live HTTP checks on 2026-08-11 / 2026-08-12 UTC] the column and runtime are live. [VERIFIED via the exact read-only production Request `1002788`/Test Homer row probe, main `ccb7e0c8`, Vercel `dpl_DjRmd4axNpUUpHAo6ZmeoBgumxTe`, and live HTTP checks] the legacy identity fallback is live. [VERIFIED via owner production smoke on Request `1002788`] the retry saved the extension and delivered the automatic deadline email. Its `Dear Test Homer,` greeting exposed the last copy defect. The admin body now requires `{{greeting}}`, the shared reviewer honorific helper renders `Dear Dr. Homer,`, and the live Dataverse setting matches the source default. [VERIFIED via main `6526a934`, Vercel `dpl_33KVRu3WmQhWBztd7RqDd2X6LBCr`, 610 suites / 7,717 tests, webpack build, and live HTTP 200] that correction is production-live; no second test email was sent.

**Editable manual respond-nudge preview (local branch, 2026-08-13):** active
unanswered rows in **Invite Reviewers** open `RespondReminderModal` instead of a
browser confirmation. `action:'preview'` on
`/api/review-manager/send-review-reminder` performs only fresh reads and returns
plain-text subject/body plus server-derived From/To identity; Cancel therefore
claims no marker, mints no token, and sends no email. Explicit Send echoes those
identities only as expected-value guards, while the service re-reads the actual
PD/reviewer destinations and reauthorizes the suggestion immediately before the
existing ETag-bound marker-plus-token PATCH. The edited body is escaped and the
fresh secure action link is injected server-side after minting. Recipient/sender
drift fails closed before persistence. The omitted-kind Track Reviewers
review-due action and both cron branches are unchanged. [VERIFIED via focused
modal, panel, route, renderer, and service tests; not yet production-promoted or
live-send smoked.]

<!-- end-source-lines: 343-359 -->
<!-- source-lines: 755-795 -->
## Invitation timeline validation (S422, production-live `4dd4a31d`)

**The rule that governs this surface: never block Send on a condition involving
`respondBy`.** `respondBy` is computed as today + `respondOffsetDays`
(`InviteEmailModal.js` `addDaysToTodayYmd`), so any rule reading it starts failing on
its own as the calendar moves, with nothing having changed. Blocking rules compare
FIXED dates; drifting conditions warn.

| Condition | Behavior |
|---|---|
| `reviewDue <= proposalSendDate` | **Blocks** (`validateInvitationTimeline`) — two fixed dates, genuinely misconfigured |
| `reviewDue <= respondBy` | **Warns only** (`invitationTimelineWarning`), Send stays enabled |
| `proposalSendDate < respondBy` | Not checked at all |

The third row was a block until S422 and broke late-cycle invites: `respondBy` drifted
past an already-fixed release date purely because time passed, disabling Send with the
explanation hidden inside a default-collapsed panel (absent from the DOM, so
`role="alert"` never announced either). Owner decision 2026-08-12, on three verified
grounds: proposal release is never automatic (`wmkf_materialssentat` has exactly one
writer, in `send-emails-service.js`'s materials branch, reachable only via the
staff-guarded `/api/review-manager/send-emails`; no cron sends materials);
`proposalSendDate` is email-only copy, rendering as a template token in
`email-generator.js:496`; and no server-side mirror of this validation exists.

**Standing hazard — the warning must name the EXTENSION, never "edit the due date".**
**Superseded in part (2026-10-29, D48; PR 2 of `docs/plans/REVIEWER_INVITATION_CALENDAR_BUILD_PLAN_2026-10-29.md`, PR #552, merge `54070863f`, deployed to Production 2026-10-29 per Vercel commit status):** the request's
`wmkf_reviewduedate` is no longer seeded from the browser after send. Before an
invitation is dispatched, `lib/services/review-due-date-service.js`
`ensureRequestReviewDueDate` fills a blank date from the cycle calendar's Reviews Due
Date (the Grant Cycle row the request links to, `akoya_request.wmkf_grantcycle`; no link
refuses; never the meeting date), ETag-conditionally; a stored date never
moves. Render fills `{{reviewDue}}` server-side and the invite modal shows the date
read-only, so there is no due-date edit left to diverge. Historical behavior: request
campaign config was seeded *set only if unset* after delivery, so a later due-date edit
in the invite modal changed only that email's copy while the request, portal, reminder
sweep, and token math kept the original date. The per-reviewer
override (`wmkf_reviewduedateoverride`) is the only authoritative remedy — it is what
`resolveEffectiveReviewDueDate` (`lib/external/reviewer-due-date.js`) reads everywhere.
Codex adversarial review caught an earlier version of the warning string walking a PD
straight into that mismatch.

**Related open asymmetry (found, not fixed).** The modal interpolates timeline tokens
CLIENT-side by design (module docblock), substituting one campaign date for the whole
batch, while `render-emails-service.js:272-274` resolves the effective per-reviewer due
date server-side. A reviewer already carrying an override can therefore receive an
invitation stating a different date than the portal and reminders use.

<!-- end-source-lines: 755-795 -->

## Due-date editor request and UI lifetime (source inspected 2026-10-22; deployment unknown)

The route independently authorizes the suggestion and takes `expectedRequestId` from the authorized request (`pages/api/review-manager/review-due-extension.js`). Both save and notification retry pass that value to `lib/services/reviewer-due-extension.js`; its fresh suggestion read compares the persisted request lookup with the expected id and returns `request_mismatch` before loading the request or writing when they differ.

On the UI branch, `ReviewerManagePanel` passes `proposal?.proposalId` as `requestContextId`. `ReviewerDueDateEditor` scopes transient state to the suggestion, request context, permission, and original/current date props. Its layout-effect invalidation increments the operation generation and closes/resets the dialog when that context changes; stale success, partial-success, and error responses are ignored. The relevant source tests are `tests/unit/reviewer-due-extension-route.test.js`, `tests/unit/reviewer-due-extension.test.js`, and `tests/unit/reviewer-due-date-editor.test.js`; they were not run for this note. This records repository source only—the deployed implementation and current live configuration were not verified.

<!-- source-lines: 1847-2012 -->
## Email templates (admin org default + per-PD override)

- **Two-layer interactive template store (S297; UI narrowed 2026-09-01).** The
  four stored reviewer template records (`invitation`, `materials`, `followup`,
  `thankyou`) resolve as **per-PD override → admin org default** for the shared
  render/send compatibility contract. The current interactive UI consumes
  `invitation` in `InviteEmailModal` and `materials` in
  `ReleaseMaterialsModal` (its own module since Stage 6C); the generic post-acceptance
  type selector and batch **Send Email** action are retired. Review-due follow-up
  uses the dedicated row-level reminder service, and thank-you uses the daily
  fire-once sweep, each with its own server-side renderer.
  - **Admin org default:** edited in `/admin` → **Email Defaults**
    (`EmailDefaultsSection`), stored in Dataverse `wmkf_appsystemsetting` under
    `email.reviewer_<type>.{subject,body}`, read by PDs via
    `GET /api/email-defaults/reviewer-templates`. Shipped copy is **seeded** from
    `lib/seed/email-defaults/reviewer-templates.js` (the single source of the
    default text; init data, NOT a runtime fallback) via
    `scripts/seed-email-defaults.mjs --execute` / `rebaseline-email-defaults.mjs`.
    **Deploy step:** the seed must run or every reviewer template renders blank.
  - **Per-PD override:** still `shared/components/reviewers/email-template-store.js`
    (`loadEmailTemplates`/`saveEmailTemplates`, `PREFERENCE_KEYS.EMAIL_TEMPLATES` in
    `wmkf_appuserpreferences`), edited in **Profile Settings** OR the Workbench
    Reviewers tab's "✎ Email templates" (same `EmailTemplatesModal`). `saveEmailTemplates`
    now persists **override-only** (fields differing from the admin default), so later
    admin edits flow through to non-overridden fields; "reset to default" clears the
    override back to the admin org default. The store no longer holds `DEFAULT_TEMPLATES`;
    `EMPTY_TEMPLATES` is the blank skeleton used until a load completes.
  - **Recovery of a fat-fingered blank** is parked for Connor: enable Dataverse
    table-level auditing on `wmkf_appsystemsetting` — see
    `project-dataverse-settings-audit-enablement`.
  - **Invitation paired response actions (2026-07-24).** At SEND time,
    `send-emails-service.js` replaces the editable body's first secure-link position
    with one table-based, inline-CSS `Yes, I Can Review` / `No, Not This Time` action
    pair. Accept deep-links to the existing Stage 2a form with `?action=accept`;
    decline deep-links to the existing decline/referral form with `?action=decline`.
    Those query values only choose the initial view: GET never records a response, and
    the existing portal POST remains the mutation boundary. The structural button
    labels/footer are fixed; subject/body and per-recipient preview edits remain
    editable. The assigned active Program Director must have an email address:
    invitation transport sends as that PD and otherwise fails closed with
    `program_director_sender_unavailable`. The footer renders the PD name and clickable
    email plus the generic secure-link fallback.
  - **Other secure-link button labels remain stage-aware (S311).** Materials and
    the legacy follow-up compatibility branch use the admin settings `email.reviewer_<type>.button_label`
    (`materials`→"Start Review", `followup`→"Go to Review") with non-empty
    stage fallbacks. A type with no fallback (`thankyou`) keeps a review URL as a
    plain link. The former invitation button-label setting may remain in existing
    Dataverse baselines but is no longer exposed or consumed as editable invitation
    copy because invitations require the fixed paired labels.
  (The `hold` + `finalize` templates were **REMOVED in S279** along with the rest of
  the hold path — see `project-reviewer-hold-step-decouple`.)
- **Invitation send-safety semantics (S340, `send-emails.js`).** First-external-send hardening,
  invitation templateType only: (1) `wmkf_invited`/`emailSentAt`/`respondReminderSentAt` is stamped
  INLINE per-recipient right after each successful send (not a post-loop pass), so a mid-batch
  timeout can't leave sent invites unstamped and exposed to a duplicate re-send via the
  `shouldSkipDuplicateInvitation` guard. (2) A send that THROWS goes to a new `unconfirmed[]` bucket
  + `email_unconfirmed` SSE event ("possibly sent — verify before retry"), never `failed[]`, because
  a thrown SendEmail may still have dispatched. One exception since S463: invitations send with
  `noFallback:true`, and `createAndSendEmail` (`lib/services/dynamics/email.js`) tags every throw
  from before the SendEmail POST (env preflight `impersonation_disabled`, create-activity,
  attachment stage) with `dispatched: false` — provably never sent — so those take plain `failed[]`
  instead of poisoning the verify-before-retry set. Only SendEmail-stage throws stay `unconfirmed[]`. (3) A successful send whose inline stamp fails is
  recorded `inviteRecorded:false` on the sent record (surfaced, not a scrolling warning). (4) A
  send-time body-integrity gate skips an invitation whose body lacks a `/external/review/` secure
  link (`missing_secure_link`) or carries an unresolved `{{token}}` (`unresolved_placeholder`) rather
  than ship a broken first-contact email. `InviteEmailModal` renders the "verify before retry" set
  and lists who was sent/failed/skipped; a terminal error no longer shows green success. Re-sendable
  templates keep their prior `failed[]` send semantics. Materials/followup/thankyou retain the
  post-loop best-effort bookkeeping. **[VERIFIED in source at `c51fa34d`;
  Stage 1B shipped in Production at `c19a16d8` per the
  [release receipt](../../audits/REVIEWER_LIFECYCLE_RELEASE_2026-09-05.md)]** each bookkeeping attempt freshly
  verifies the Request/reviewer bindings and exact ETag. Materials/followup
  refuse closed/unknown/completed source state; manual thank-you records only
  the courtesy timestamp, including after closeout, and never changes status,
  completion, or eligibility. Only numeric 412 permits a bounded bookkeeping
  retry (three attempts maximum); transport is never retried here.
  Durable per-dispatch deadline evidence is not part of the terminal-status branch and requires a
  separate design around ordered Dynamics email activities or an append-only dispatch entity.
  **This invitation-only gate now runs through the shared
  `lib/utils/invitation-link-validator.js`** (reviewer-invite-vip branch, 2026-08-26): it keeps the
  established `missing_secure_link` (linkless body, regardless of `externalLinkExpected`) and
  `unresolved_placeholder` skip reasons and adds `invalid_secure_link` for a malformed or unexpected
  hardcoded `/external/review/` path. Repeated IDENTICAL copies of one token stay a tolerated input
  (dedupe → send; only DISTINCT tokens are `external_link_ambiguous`), and trailing prose
  punctuation after a token is fine while an extended/four-segment token is rejected. The same
  validator drives `InviteEmailModal` collapse routing and invitation-template save validation
  (`{{externalLink}}` required to save; legacy templates still load — this gate protects them). It
  runs before recipient/attachment resolution and is layered
  UNDER, not replaced by, the ALL-TEMPLATE send-time token-authority gate added in S404 (see above):
  that gate runs later, immediately before dispatch, applies to every templateType whose draft
  carries `externalLinkExpected`, and mints/substitutes the final recipient-bound JWT after
  defense-in-depth verification of any real legacy/edited token.
  **Post-send roster repaint (S401, fix for S400 finding 2):** `InviteEmailModal.onSent` now passes
  `{ invitedSuggestionIds, sentAt }` — only rows the send stream confirmed BOTH dispatched and
  lifecycle-stamped (`inviteRecorded !== false`) — through `ReviewerInvitePanel.afterSent` →
  `ReviewersTab.refreshAll`, which paints those rows `invited` on top of the `my-candidates`
  refetch (server-confirmed fact, not optimism; an `inviteRecorded:false` row deliberately keeps
  showing its true unstamped state). `refreshAll` validates the payload shape because it is handed
  around as a bare callback. Codex adversarial review (S401, medium): the overlay asserts a past
  fact, so a concurrent lifecycle reset landing inside the refresh window — remove → restore
  clears `wmkf_invited` via `ENGAGEMENT_STAMP_RESET` — would be repainted invited. Resolved by
  time-bounding the overlay: when an overlay-carrying response actually PAINTS (passes the
  generation/request guard), it schedules one plain reconciling `loadCandidates()` after
  `OVERLAY_RECONCILE_MS` (4s), so server truth unconditionally reasserts for every resetting
  writer, current or future, without version-plumbing the send stream/DTO. Paint-time (not
  schedule-time) anchoring matters: a second Codex adversarial pass found that starting the clock
  at schedule-time let a >4s overlay fetch be superseded by its own reconciler and never paint. ReviewersTab's three loaders also gained a same-request newest-wins
  generation guard (the S213-era `currentRequestIdRef` guard only covered cross-request
  navigation), so an older in-flight response can no longer repaint over a newer one. Tests:
  `tests/unit/reviewers-tab-post-send-refresh.test.js`, `tests/unit/invite-email-modal-capture.test.js`.
  NB the S400-suspected "onSent fires before the SSE stream / stamps complete" race was not found
  [VERIFIED via S401 source trace of every hop: in-loop awaited stamp PATCH → `email_sent` →
  `result` → `res.end()` → client `readSseStream` resolves at stream close → `onSent`]; the exact
  production mechanism of the S400 observation therefore remains unattributed, and the shipped fix
  hardens every client-side class regardless (stale-response clobber, read lagging the write).
  Rendering quality (also S340, `lib/utils/email-generator.js`): the greeting drops trailing
  name suffixes (Jr./Sr./III/PhD/MD) for the surname and falls back to "Dear Reviewer" on an empty
  name; `{{proposalAbstract}}` is soft-unwrapped (`softUnwrapProse`) so a fixed-column hard-wrapped
  abstract reflows to the email width instead of rendering a `<br>` at every stored newline. The
  unwrap is calibrated against 40 real abstracts (S340): it joins only lines that look auto-wrapped
  (long + not ending at a sentence/clause boundary), so single-newline paragraph separators and
  short header lines are PRESERVED, not merged; blank-line paragraph breaks always stay.
  `proposalDetails` is NOT unwrapped — its single newlines are intentional. Detector + reflow now
  live in `lib/utils/abstract-format.js` (`hasAbstractWrapArtifacts` / `reflowAbstract`).
- **Abstract-edit gate (S340).** `render-emails` surfaces per-draft `abstractFlagged` +
  `currentAbstract` + `reflowedAbstract` + `requestId`. **The flag is `abstractNeedsReflow` — true
  exactly when the reflow would change the stored text** (not merely "has a mid-sentence newline"),
  so the banner's "auto-cleaned for these emails" claim always holds and a header-style intentional
  break is not flagged. When flagged, `InviteEmailModal` shows a non-blocking amber banner with an
  "Edit abstract" editor (seeded with the reflowed text). Save requires a `window.confirm` (durable,
  no undo — mirrors the send path) and **clears per-recipient body/subject overrides** (`setEdits({})`)
  so a manually-edited draft can't keep the pre-fix abstract; it then POSTs
  `/api/review-manager/update-abstract` → overwrites the canonical `wmkf_abstract` on `akoya_request`
  via `updateById` (auth `requireAppAccess('review-manager','reviewers')`, GUID-validated requestId,
  trusted DAL context, PD attribution; optimistic compare-and-set — the modal posts the
  `expectedCurrent` abstract it rendered from and the service 409s if the live `wmkf_abstract`
  changed since, targeted on the abstract field so an unrelated concurrent write to the request
  does not spuriously conflict), then
  re-renders (flag clears). `wmkf_abstract` is GoApply write-once (NOT re-synced), so a PD edit is
  durable and fixes these reviewer invites plus any later read that starts from `wmkf_abstract`. It
  does NOT retroactively rewrite an already-generated derived version (`wmkf_abstractformatted`/
  `wmkf_abstractapproved`, consumed by grantee/board exports via `grantee-document-assembly.js`),
  which live behind their own approval-status gates. The reflow remains the send-time safety net for
  un-edited flagged abstracts.
- The shared route/service recognizes all four stored template types for compatibility.
  The current UI sends `invitation` (first contact, via ReviewerInvitePanel →
  `InviteEmailModal`, hardcoded `templateType:'invitation'`) and `materials` (via
  `ReviewerManagePanel`, hardcoded `templateType:'materials'`). Follow-up is a
  dedicated row-level reminder action; thank-you is the daily sweep. The reviewer onboards
  (COI/AI acks + honorarium/address; honorarium request creation is config-gated
  and BILL remains deferred this cycle) at the single Accept on the portal;
  an acceptance-confirmation email with a review-due `.ics` ships from `respond.js` on
  first accept. There is no hold/agree-in-principle view.
- The invitation default now surfaces proposal context for **early COI flagging**:
  `{{proposalDetails}}` (Title / Principal investigator / Co-investigators /
  Institution — empty lines dropped, composed in `lib/utils/email-generator.js`) and
  the full `{{proposalAbstract}}`. Co-PI names come from the `wmkf_apprequestperson`
  junction (`fetchCoPIs`); PI is `_wmkf_projectleader_value_formatted` ONLY (never the
  applicant org). Respond-by and proposal-delivery tokens are client-substituted from
  the existing campaign system; `{{reviewDue}}` is server-filled from the request date or
  the cycle calendar (D48); the modal blocks a send only when the review due date is not after the proposal release date; response-deadline conditions do not block Send. It loads timing in this order:
  built-in fallback, per-user sticky `reviewer_invite_timing`, admin cycle defaults,
  then request campaign config (response days and release copy only; the due date
  comes from the render response). The redesigned seed is init data, not a runtime
  fallback: promotion must deliberately rebaseline the admin default, and existing
  per-PD subject/body overrides remain intact until reset or edited.

<!-- end-source-lines: 1847-2012 -->
