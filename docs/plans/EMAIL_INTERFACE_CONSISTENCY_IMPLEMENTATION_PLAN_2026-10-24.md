---
title: Email interface consistency — implementation plan
domain: platform
kind: plan
status: implemented
summary: Owner-approved desktop-first email consistency pass: accessible dialogs and fields, readable guidance, future-only defaults, truthful fallback and sender summaries, legacy explanations and shared controls. Independent plan/build review required; no release authorization.
owner: product-engineering
related:
  - docs/audits/EMAIL_INTERFACE_CONSISTENCY_AUDIT_2026-10-24.md
  - docs/plans/PERSONAL_EMAIL_DEFAULTS_TODO_2026-09-20.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
---

# Desktop email interface consistency

## Status and authority

[BRANCH-BUILT; source reviewed 2026-10-24.] Owner approved all nine audit
recommendations, the implementation plan and continuation into the build.
The three passes are implemented on `codex/email-interface-consistency-build`;
verification and explicit limits are recorded in the linked build receipt.
No product question remains about dialog behavior, labels, contrast, future-only
Save/Clear, actual addressing, truthful fallback, legacy-template explanation or
shared controls. Owner explicitly requires **desktop first**: no loss of desktop
information density or useful layout to service phones. Improve small hit areas
where practical, desktop scrolling/zoom/focus; phone layout is a regression check,
not a redesign brief or requirement for 44px controls everywhere.

Base audit `7715fc6eb`; inherited runtime `ad4cbac85`. Follow-up calendar-event
integration, new personal-default slices, email transport/lifecycle policy,
shared Admin copy, identity ownership and DESIGN.md changes are excluded.
Build uses a feature branch and independent source review before release. No
Production promotion, live sends or live preference/business-record writes are
authorized by this task. Local synthetic tests and review are authorized.

## Verified prerequisites and existing boundaries

[VERIFIED via source; no new live probes.] No dialog library dependency is
currently declared. Agenda has initial/return focus and Escape but no containment;
legacy modals lack complete semantics (`SessionAgendaPanel.js:111`, audit F1).
Use the browser's native modal dialog behavior through a small shared shell;
do not introduce a new dependency or a generic email workflow framework.

Existing stores remain: Dataverse own preferences/shared settings; PostgreSQL
agenda/distribution/scheduled coordination. No schema or migration. Existing
routes retain auth/DAL/body validation. No new route is planned.

Sender display prerequisites are specific: agenda `projectAgenda` currently
omits persisted `from_email`; distribution `projectDistributionAttempt` already
returns `from`; scheduled `projectScheduledEmail` omits `pd_email` used by dispatch;
release previews already include `from`; reminder/deadline already show From/To.
Invitation/materials render DTOs currently omit From: add per-draft server
sender metadata matching the actual send resolver, with invitation From = assigned enabled PD internal email, and materials /
other non-invitation From = authenticated route fromEmail (the actual dispatch
branch at send-emails-service.js:1053). PD signature/contact fields are not
materials From; do not conflate these branches.
Grantee preview currently returns only HTML and send derives staff `azureEmail`
from auth, independently of assigned-PD signature. Expose server-derived sender on the always-used recipients GET so direct Send
also shows it, rather than relying on the optional new-tab HTML preview; never
infer it from signature or client input. Do not mint a real portal link from preview.

Legacy reviewer templates retain field-level override inheritance in existing
`reviewer_email_templates`. `email-template-store` currently swallows shared and
own failures. The shared-default route already reports `unavailable`; the generic
preference GET uses a fail-open all-preferences reader. Truthful own-load status
therefore needs a narrow strict named read for this existing non-secret key,
including identity-resolution failure distinction. Keep generic reads for other
keys unchanged, retain both private/reserved-key guards and the legacy profile
identity contract; do not extend it to new systemuser-owned template families.

Reviewer-materials Save Template also persists local email-field/attachment
scratch values (`ReleaseMaterialsModal.js:479`). Preserve this deliberately,
separate from reusable-wording Save/Clear; do not drop it when moving wording
into a disclosure. No attachment uploads or cleanup are introduced.

## Pass 1 — accessibility foundation (F1–F3)

Add a small `EmailDialog` shared shell around existing modal contents, using
`<dialog>.showModal()` for browser focus containment and inert background.
Provide accessible title/name, initial focus (normally Close; otherwise first
safe focusable or dialog), opener restoration if still connected, native Escape
cancel handling and an explicit mutation-busy close lock. Preserve each surface's
existing backdrop policy through an explicit prop; backdrop must never dismiss
while locked. Keep dialog styling/desktop width and internal scrolling.

Migrate grantee confirmation/status, invitation, reviewer materials, reminder, pending/accepted release,
legacy templates, deadline, agenda and distribution dialogs; include nested
recipient pickers so only the topmost layer responds to Escape and focus returns
to the parent control. Remove old duplicate Escape/focus handlers where replaced.
Native close/cancel must call each parent's close callback once; read-only
initialization remains closable, while writes/sends retain existing locks.
No change to operation generations, aborts, stale-result guards or transport.

Associate visible labels with subject/message/date inputs, including unique
recipient-specific IDs/names for batch drafts. Use stable React IDs, not array
positions as record identity. Standard helper text uses a normal type step and
>=4.5:1 text/background contrast; token requirements stay family-specific.

Verify native behavior in an actual browser; jsdom dialog mocks alone cannot
prove containment/inertness. Include forward/reverse Tab, outside interaction,
Escape, focus restore, busy/initialization, nested picker, unmount/actor changes,
long desktop forms and 200% zoom. Do not claim screen-reader certification from
DOM/keyboard checks alone.

## Pass 2 — defaults, load status and addressing (F4–F6)

Use collapsed **Your default wording** with independent raw **Default subject /
Default message** fields and explicit **Save as my default / Clear my default**.
Agenda retains **Default opening message (optional)**. Saving/clearing affects
only future drafts, leaving current one-send wording, recipients, reviewed
preview and confirmation intact. Ordinary reopening reloads current defaults;
frozen unresolved sends remain frozen. Preference editor read/write generations
and busy ownership remain separate from compose/preview state.

Materials gains independent raw-default state using its existing preference
route. Clear no longer replaces the open draft; successful Save/Clear updates
only its own future/default cache. Reviewer release removes its automatic parent
wording-refresh side effect; no background request may replace current copy.
Reminder's already raw compose form remains one-send wording; move reusable
Save/Clear into independent raw disclosure state. Deadline/agenda adopt the
common labels/feedback without changing their isolated semantics.

Reviewer invitation/materials and Profile template maintenance retain legacy
field-level store. Separate reusable raw template editing from per-send resolved
copy; save/reset one family while preserving other families and non-overridden
inheritance. Retain the raw saved override map and field-presence provenance.
Require a fresh successful strict OWN raw-map read before every legacy family
Save/Clear as well as the strict shared baseline; failed/invalid/duplicate own
reads must never become an empty map and overwrite sibling families.
Patch only the edited family against a fresh strict shared baseline, preserving
untouched raw fields exactly; never re-diff an entire stale resolved map against
new Admin copy, which would accidentally freeze inherited values. Existing one-send reset/apply actions may remain only when clearly
labeled **Use shared wording for this email**, with explicit dirty-replacement
confirmation and preview invalidation. Do not add a new apply-current feature
where none exists. In Profile Settings, Clear removes future overrides; there
is no open one-send draft to replace. Reviewer-materials scratch settings get a
separate explicit local-save control, not hidden coupling to wording Save.

Add status-bearing legacy reads (absent/configured/invalid/unavailable) and shared
availability, with compatibility wrappers only where existing consumers need the
old shape. Trace every caller, not only EmailTemplatesModal. A failed own load
shows notice and Retry, shared fallback is labeled, and Retry never overwrites
dirty local edits without consent. Failed shared-baseline reads block only the
save/reset operations that require that baseline; preserve local copy and leave
unrelated family behavior unchanged. Strict save rechecks baseline availability
before computing field overrides. A successful empty/absent read is not a failed
read. Narrow strict identity/preference helpers must not silently return empty on
failure or choose a duplicate row arbitrarily. Preserve explicit validation and
truthful partial/unconfirmed outcomes; no new atomic-save guarantee.

Add a reusable read-only **From / To / Cc** display at exact review. Empty Cc
shows None. Server DTOs supply agenda's persisted from_email, scheduled pd_email,
existing distribution/release sender, invitation/materials per-draft server
sender, and grantee recipients GET's authenticated sender.
For grantee, submitted To/Cc remain deliberately editable; summarize current
validated one-send recipients alongside the server-supplied sender. A stale or
failed sender read shows unavailable, never a guessed mailbox. Preserve family
permission/recipient rules, validators, preview binding, original-sender recovery,
SSE per-recipient results and no-blind-retry behavior. Display metadata does not
become new client authority or change proof/hash inputs.

## Pass 3 — vocabulary, controls and desktop finish (F7–F9)

In the legacy editor, show active invitation/materials separately from **Legacy
templates** with explicit compatibility explanation; retain all keys/routes/data.
Do not imply automatic thank-you uses these values or restore a send action.

Use **Subject / Message** for current email, **Opening message (optional)** for
agenda, **Default subject / Default message** in raw-default sections. Keep
optional labels and valid family-specific required-token instructions. Shared
Button variants provide ink primary commitment and quiet secondary actions;
retain consequence-specific verbs (Release reviewer, Send invitation, Save
changes). Scheduled Save persists one row, never a reusable default. Shared Admin
per-key and partial bulk-save semantics remain explicit. Do not add competing
background/text classes to Button defaults.

Preserve desktop widths, side-by-side fields, typography and density. Enlarge
small effective click areas when useful without forcing oversized buttons,
stacking desktop content or hiding useful information. Check desktop scroll,
200% zoom, keyboard focus and narrow regression; no phone-specific redesign,
mobile-first acceptance target or physical-phone UAT prerequisite.

## Acceptance invariants and verification

| Invariant | Surfaces | Required evidence |
| --- | --- | --- |
| Dialog focus stays in top layer | All modal consumers and recipient pickers | Real browser Tab/Shift+Tab/inert/Escape/return focus, busy and async close tests |
| Fields have unique accessible purpose | Invitation/materials/template/date fields | Role/name assertions including two recipients; visible labels remain |
| Guidance readable | Legacy tokens/shared helper classes | Computed >=4.5:1 at desktop zoom; supported token rules unchanged |
| Save/Clear changes future only | Materials/reminder/release/legacy editors | Dirty current copy + recipients + confirmed preview present in fixture; remain exact after Save and Clear; future reopen changes |
| Legacy inheritance persists | All email-template-store callers | One-family edit preserves other types/field omissions; failed shared reread prevents mutation; duplicate/identity failures explicit |
| Sender authoritative | DTO producer → review display → dispatch | Another-actor/PD case, original pending sender, grantee staff sender versus signature, no client identity authority |
| Existing workflow safety holds | All send routes/services | Existing exact-preview/stale/partial/uncertain/original-sender suites; no proof/hash/lease changes |
| Desktop remains primary | All visible controls | Before/after desktop batch, no density loss or new forced stacking; long forms/zoom; narrow regression only |

Run focused meaningful tests per pass, affected-route/service and privacy tests,
changed-file lint/types and production build. Run relevant API/Atlas/fact/
status/route-boundary/Dataverse/context gates and sequential self-tests when
those surfaces change. Full Jest only after fixture-writing gates finish.
Record one batched desktop/keyboard/zoom comparison, one named-fix batch and at
most one confirmation pass per Impeccable. Do not start new polish loops.
Independent plan review must pass before build; independent completed-build
review must pass after fixes. Release uses deliberate Tier 2 promotion and a
separate owner instruction. Existing delivery checks are not replayed by default.

## Review and execution receipts

Plan review: READY after five named corrections, independently source-reviewed
by `email_plan_review` on 2026-10-24: per-draft reviewer From, always-visible
grantee sender, raw inheritance provenance, precise invitation/materials sender
branches and strict own-map prewrite reads. Runtime implemented on `codex/email-interface-consistency-build`. Independent
build review returned READY after fixes for materials reopen loading, conflicting
preview locks and grantee dialog coverage. No outstanding source-review blockers.
See `docs/audits/EMAIL_INTERFACE_CONSISTENCY_BUILD_2026-10-24.md` for checks,
review receipt, fingerprints and untested live/assistive-technology boundaries.
