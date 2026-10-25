---
title: Suite email interfaces — Impeccable consistency audit
domain: platform
kind: audit
status: active
summary: Rendered/source audit of suite email compose, default, preview and settings interfaces. Nine prioritized findings; recommend accessible dialog/field foundations, future-only default actions, truthful sender/source summaries and consistent controls. No product UI or live data changed.
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_DEFAULTS_TODO_2026-09-20.md
  - docs/plans/PERSONAL_EMAIL_DEFAULTS_INVENTORY_2026-09-24.md
  - docs/audits/MEETING_AGENDA_DEFAULTS_BUILD_2026-10-24.md
---

# Email interface consistency audit

[CURRENT FOLLOW-UP, 2026-10-24.] The approved fixes are branch-built; see
`docs/audits/EMAIL_INTERFACE_CONSISTENCY_BUILD_2026-10-24.md` for review, checks and
remaining release verification. Findings below describe the original audited base.

## Implementation integrity verdict

**Needs a bounded consistency pass.** The suite has a recognizable operational
visual language, useful exact previews and shared outcome feedback. It does not
have one consistent contract for defaults, modal access or sender visibility.
The strongest incumbent starting point is the agenda/deadline **Your default
wording** separation, not a wholesale replacement composer. Agenda's dialog is
not a complete accessibility reference: its focus can escape to the background.

**Nine findings: P0 0 / P1 3 / P2 6 / P3 0.** These are findings against the
sampled interfaces, not an exhaustive security or WCAG conformance assessment.
No live sends, preference changes, calendar updates or product UI edits occurred.
DESIGN.md and PRODUCT.md were preserved.

## Evidence and scope

[VERIFIED via source fingerprints, real-component renders, DOM/AX measurements,
keyboard probes, focused tests and independent read-only source review.]
Base: `ad4cbac85fbbe9cfe4b3c4e823aa8a1f90f9c3c8`, after slice 6 release.
Impeccable 4.5.1: existing session context PRODUCT.md/DESIGN.md retained;
`reference/audit.md` and `reference/operate.md` applied. Contract-reconcile Mode A
was used for behavior findings; a fresh read-only agent independently traced the
contracts. No direct provider API, external agent CLI subprocess or paid review product was invoked.

Actual current components were webpack-compiled with repository Tailwind styles
into a localhost-only fixture. Auth/profile/Next shell inputs and API responses
were synthetic. The audited component markup was not replaced. External and
unknown fetches were refused; the suite fixture also refused mutations except
synthetic render/preview reads. No environment file or application server ran.
All data, links and identities in captures are synthetic. All owned localhost
audit servers were stopped and the temporary viewport override was reset. These captures prove
rendered component behavior, not live API/persistence/delivery or email-client
HTML fidelity. Existing standalone rehearsal wrappers were reused for agenda,
deadline, reminders and release. Fixture construction errors (missing context,
wrong response shapes) were repaired only in /tmp and excluded from findings.

One batched desktop/narrow inspection used **1440×1000 and 390×844**, followed by
bounded expanded/default/preview and lower-page checks. No visual-fix loop or
redesign was undertaken. DOM widths matched viewport widths in all ten suite
routes; newer modal cases also fit both widths. These are emulated browser
viewports, not physical-device or synthesized-touch tests. Full 200% text zoom,
screen readers, high contrast, all themes and all assistive-technology combinations
were not exercised. Keyboard focus was directly probed as described in F1.

| Surface | Rendered evidence | Behavior / limits |
| --- | --- | --- |
| Reviewer invitation | Desktop/narrow per-recipient compose | Timeline and editable resolved copy; server rendering mocked; no send |
| Reviewer materials release | Desktop/narrow template compose | Dates, placeholders, Save Template and preview entry; synthetic preflight unavailable notice; attachments/upload not exercised |
| Reviewer respond/review-due reminders | Respond reminder desktop/narrow; both kinds source reviewed | Raw template plus preview and independent default actions; uncertain/partial outcomes source/test reviewed, not live sent |
| Pending/accepted reviewer release | Both desktop/narrow; accepted default disclosure expanded | Optional courtesy, lifecycle note, sender-owned template; no lifecycle action invoked |
| Reviewer deadline | Desktop/narrow compose | Assigned-PD fixture, From/To, one-send Cc, optional message, separate default editor; no date write/send |
| Meeting agenda | Desktop/narrow, expanded default and exact preview | Raw token guidance, generated preview, recipient confirmation; no transport invoked |
| Deliberation distribution | Actual PreSiteDistributionPanel dialog desktop/narrow | Editable To/Cc and raw wording; history mocked; prepare/source lock/send not invoked |
| Grantee invitation | Actual AwardeeTab desktop/narrow and lower compose | Editable To/Cc, Subject/Email body, Reset and Preview/Send; abstract generation and preview-tab opening not invoked |
| Scheduled messages | Actual page desktop/narrow and lower detail | One-row Save changes/approval/stop/send and sandboxed recipient preview; no scheduled mutation |
| Personal settings | Actual Profile Settings and My email templates desktop/narrow | Signature, grantee defaults, compatibility copy, template tabs; no Save/Reset action invoked |
| Shared Admin wording | Actual section desktop/narrow, Internal group expanded | Grouping, per-key saves, bulk-save entry and placeholders; no Admin writes |

System/automatic emails without staff composers are covered by the relevant Admin
wording entry points and source distinctions. Diagnostic test email, parked
applicant-intake interfaces, restored compatibility send actions, and a census of
every outbound notification are outside this owner-selected consistency scope.
This audit does not recalculate the historical 56-case send inventory or invent
personal-default capability for unimplemented slices.

Evidence directory: [captures and receipts](email-interface-consistency-2026-10-24/).
`source-fingerprints.json` records all relevant source hashes. `measurements.json`
records ten suite routes at both widths; inactive Admin panels can retain layout
boxes, so its field count is not a visible-field count. Detector: **zero primary
findings; one advisory**, the legacy template editor's 11px type off DESIGN.md's
ramp. This does not clear the source/behavior findings below. Focused existing
contract suites: **11 suites / 120 tests passed**; see `contract-tests.log`.
No full-suite rerun/build was needed for an audit without runtime changes.

## Audit health score

Scoped human rubric, not an automated compliance or performance benchmark.

| Dimension | Score / 4 | Evidence and limit |
| --- | --- | --- |
| Accessibility | 2 | Newer labeling/semantics coexist with unnamed fields and focus escape; no screen-reader certification |
| Performance | 3 | No blocking animation/image-heavy email UI observed; existing previews bounded by workflow; no profiler/network benchmark, so provisional |
| Theming | 2 | Shared neutral vocabulary, but raw blue commitment buttons and legacy typography diverge; dark mode is not a selected product requirement |
| Responsive design | 3 | Sampled 390px layouts fit without page horizontal overflow; small secondary targets and long modal scroll remain; touch/zoom not certified |
| Implementation integrity | 2 | Related screens implement incompatible default/reset semantics and sender summaries |
| **Total** | **12 / 20** | **Acceptable; significant targeted consistency work needed** |

## Findings

### F1 — P1: Modal focus and naming are incomplete

**Category:** Accessibility. **Impact:** keyboard/screen-reader users can remain
on or navigate into the page behind a consequential email dialog.

[VERIFIED] `InviteEmailModal.js:817`, `EmailTemplatesModal.js:64`,
`RespondReminderModal.js:245`, `ReleaseEmailModal.js:324` and
`AcceptedReviewerReleaseModal.js:235` overlay markup lacks a named modal-dialog
contract. `MaterialsEmailModal.js:192` and `ReviewerDueDateEditor.js:182` have
roles/names but no local initial-focus/containment/restore contract. Agenda
`SessionAgendaPanel.js:111` sets/returns focus and handles Escape, but has no Tab
containment or inert background. **Rendered disconfirming check:** after opening
agenda, focus started on Close; Shift+Tab moved to the background **Send agenda…**
button. Deadline's open composer left focus on background **Grant extension**.
Other Escape paths are source-reviewed, not asserted from an ambiguous key probe.

**Recommendation:** `$impeccable harden`: introduce/reuse a small dialog shell
with dialog name, sensible initial focus, Tab containment, focus return, Escape,
busy locks and nested-recipient-picker ordering. Keep each workflow's controllers
and operations. WCAG concerns: 2.4.3 focus order / 4.1.2 name-role-value; these
observations do not imply every modal fails every criterion. Verify full forward/
reverse tab traversal, no background activation, nested picker Escape first,
Close during read initialization and locked Close during mutation.

### F2 — P1: Some subject/message/date fields have no accessible name

**Category:** Accessibility. **Impact:** field purpose or recipient becomes
ambiguous when navigating a batch of emails without sight.

[VERIFIED] `InviteEmailModal.js:1217` subject/textarea have no associated labels;
`EmailTemplatesModal.js:89` labels are adjacent but not associated;
`ReleaseMaterialsModal.js:899` dates and `:1043` subject/body use the same pattern.
Rendered DOM confirmed empty accessible-label sources for invitation's two
fields, templates' two fields, and reviewer-materials' four fields. Materials,
agenda, grantee and personal settings provide contrasting labeled examples.

**Recommendation:** `$impeccable harden`: visible associated labels and stable
IDs, with recipient-specific names for per-recipient drafts. Keep all visible
labels short and use descriptions for token rules. WCAG 1.3.1 / 3.3.2 / 4.1.2.
Acceptance: role/name queries identify each field uniquely; screen-reader and
keyboard smoke on a two-recipient batch, not merely one input in isolation.

### F3 — P1: Legacy placeholder instructions are too low contrast

**Category:** Accessibility / Theming. **Impact:** required template guidance is
hard to read, especially at its 11px size.

[VERIFIED] `EmailTemplatesModal.js:107` uses `text-[11px] text-gray-400` on white.
Current Tailwind gray-400 `#9ca3af` against white is **2.54:1**, below WCAG 1.4.3's
4.5:1 normal-text criterion. The narrow screenshot shows this guidance beneath a
large monospace editor. Detector independently flags the off-ramp font size;
contrast is a separate verified calculation, not a detector claim.

**Recommendation:** `$impeccable typeset`: normal helper-text size and at least
4.5:1 contrast, with a concise family-specific token list that wraps. Do not
change which placeholders are required. Re-measure actual computed color and
background in all selected themes after implementation.

### F4 — P2: Default actions mean different things, including deleting saved data

**Category:** Implementation integrity. **Impact:** staff cannot predict whether
a button affects the open email, future emails, or both.

[VERIFIED] `MaterialsEmailModal.js:116` **Use shared default** immediately DELETEs
the saved preference, then replaces current wording and clears preview without
confirming replacement. Reminder `RespondReminderModal.js:178` Clear leaves the
one-send draft unchanged; agenda/deadline isolate default editor state.
`ReleaseWordingDefault.js:127` invokes parent refresh after Save/Clear when the
acting user is the sender; `AcceptedReviewerReleaseModal.js:130` and
`ReleaseEmailModal.js:194` replace the current copy, confirming only when edits
are detected. Grantee **Reset to default** applies wording to one email, while
Profile Settings' reset deletes the corresponding personal override
(`AwardeeTab.js:1314`; `pages/profile-settings.js:302`).

**Recommendation:** `$impeccable clarify` then `$impeccable harden`: adopt explicit
future-only **Save as my default / Clear my default**, with separate raw fields
under **Your default wording**. If applying shared/saved wording to the open draft
is retained, make it a separate explicit action with replacement confirmation
when dirty. A label-only rename is insufficient; materials/release behavior
changes require owner approval and contract tests. Do not replace the legacy
field-level override store with a whole-pair store as a visual shortcut.

### F5 — P2: Actual sender is not equally visible before commitment

**Category:** Implementation integrity. **Impact:** staff may assume mail comes
from the acting user even when the workflow uses an assigned PD or PC.

[VERIFIED] Reminder and deadline show From/To. Accepted release UI shows only To
although `draft.from` exists (`AcceptedReviewerReleaseModal.js:183`, `:278`).
Pending release lists reviewer/address (`ReleaseEmailModal.js:411`). Distribution
preview lists To/Cc/subject without From (`PreSiteDistributionPanel.js:878`);
scheduled detail lists To/Cc without From (`pages/scheduled-emails.js:340`).
Agenda says “your Dynamics mailbox” but does not show an exact From address in
its preview. Materials reveal From/To/Cc only after preview, which is a justified
server-resolution point but should be consistently legible there.

**Recommendation:** `$impeccable clarify`: consistent read-only **From / To / Cc**
summary at the exact review point, explicitly showing None when applicable.
Use verified server data, never a guessed acting-user address. Some DTOs need a
small display-field addition before this can be implemented; prove provenance
per family. This audit does not authorize editable From, extra Cc permissions,
or changing assigned-PD/PC and backup rules.

### F6 — P2: Legacy template fallback can look like a successful saved-data load

**Category:** Implementation integrity. **Impact:** staff may unknowingly edit
fallback/blank copy as though it were their saved default.

[VERIFIED source/tests, failure not browser-injected] `email-template-store.js:94`
turns shared-read failure into a blank skeleton; `:106` turns personal-load failure
into Admin copy. `EmailTemplatesModal.js:31` sets ready with no origin/status
explanation. Reset copies whatever Admin layer was returned (`:45`), and Save
re-reads Admin while calculating override-only fields (`email-template-store.js:125`).
The new agenda DTO demonstrates explicit independent source/status handling;
its exact API is not automatically suitable for legacy field overrides.

**Recommendation:** `$impeccable harden`: return source/read status and explain
fallback near the editor, preserve local edits, offer Retry, and prevent a
reset/save that depends on an unavailable shared baseline from pretending it
loaded correctly. Preserve field-level inheritance. Test absent versus failed,
invalid versus unavailable, and failure after load but before Save.

### F7 — P2: Compatibility templates look like ordinary active workflows

**Category:** Implementation integrity / Copy. **Impact:** staff can spend time
editing Follow-up reminder / Thank-you believing current reminders or automatic
thank-you messages will use them.

[VERIFIED] `EmailTemplatesModal.js:76` presents all four tabs equally. Profile
Settings already explains compatibility-only use (`pages/profile-settings.js:589`),
but that explanation is absent from the actual editor and alternate entry points.
The rendered template screen reproduces the ambiguity.

**Recommendation:** `$impeccable clarify`: carry an explicit active-consumer
explanation into the editor; distinguish active invitation/materials from
retained compatibility templates. Preserve saved keys/routes and do not restore
or remove any send action. Automatic thank-you personalization remains its own
planned slice, not a copy change in this audit.

### F8 — P2: Commitment controls and field vocabulary drift across families

**Category:** Theming / Implementation integrity. **Impact:** staff relearn the
meaning of similarly placed buttons and cannot scan stages consistently.

[VERIFIED] Agenda uses the shared ink Button; deadline final action is gray-900.
Reminder/accepted release use blue-600, grantee blue-700 and distribution final
send blue-800 (`RespondReminderModal.js:283`, `AcceptedReviewerReleaseModal.js:302`,
`AwardeeTab.js:1376`, `PreSiteDistributionPanel.js:957`). These are commitment
buttons, not branded CTAs inside outgoing emails. Materials puts Save/default/
Refresh/Send together in one footer, wrapping into three rows at 390px, while
agenda/deadline group future-default actions separately. “Body”, “Message”,
“Email body” and “Opening message” appear; Opening is a justified agenda-specific
scope, not a label to flatten everywhere.

**Recommendation:** `$impeccable clarify` / `$impeccable polish`: shared Button
variants and consistent compose→preview→explicit commitment hierarchy. Use
**Message** for one-send prose; **Opening message (optional)** when generated
content follows; **Default subject / Default message** in the raw-default editor.
Keep consequence-specific verbs such as Release reviewer and Save changes.
Do not introduce a generic “Send” button for a combined lifecycle action.

### F9 — P2: Small secondary controls need a touch-target pass

**Category:** Responsive design. **Impact:** small Close/reset/directory targets
are harder to activate accurately on narrow devices even when the layout fits.

[VERIFIED rendered dimensions] Materials Close is 20px high; distribution Add
from directory and template Reset are 16px high in the sampled viewport. Screen
captures show narrow text-only targets. These dimensions alone are **not** a
blanket WCAG 2.5.8 failure: spacing exceptions and surrounding hit area must be
assessed per control. No touch gesture or physical-device claim is made.

**Recommendation:** `$impeccable adapt`: enlarge effective hit areas with familiar
Button/link controls, target about 44px where practical, and keep scrolling and
keyboard focus visible. Preserve visual restraint; don't make every secondary
control a filled primary. Confirm pointer target/spacing, modal scrolling, zoom
and nested pickers at 390px and on a touch device.

## Positive findings and justified differences

- The newer **Your default wording** disclosure makes future versus current
  editing explicit; agenda's “Started from…” label describes the loaded draft,
  not whatever was just saved for the future.
- `EmailSendFeedback.js:14` / `:60` centralizes meaningful icon/text/live-region
  feedback. Preserve sent versus failed, uncertain and partial. Reviewer release
  correctly distinguishes lifecycle success from mail failure; do not simplify
  that into a generic failure or green success.
- Exact review and freshness/recovery are family-specific safeguards, not visual
  duplication to remove. Agenda ledger recovery, deadline post-write retry,
  reminder stale preview and distribution source locks must remain intact.
- Scheduled **Save changes** persists one scheduled row; it is not a reusable
  default. Approval/stop/send scheduling must remain distinct. Its recipient
  preview is sandboxed HTML while the editor uses plain `bodyText`; a raw-HTML
  editor defect was considered and refuted from source and the corrected fixture.
- Grantee To/Cc editing is intentional, while reviewer recipient restrictions
  remain workflow-owned. Signature may be removable in deadline copy, appended
  by the server for grantee mail, and generated agenda details remain mandatory.
- Reviewer-materials **Save Template** also stores email-field/attachment scratch
  settings in localStorage before saving wording (`ReleaseMaterialsModal.js:479`).
  Harmonization must separate or explicitly preserve these settings; a wording-only
  disclosure must not silently drop this existing behavior.
- Admin shared-wording editing is correctly a separate surface with audience
  groups and per-key feedback. Its bulk save can partially succeed; do not
  promise an atomic operation or conflate it with personal Save/Clear.
- All sampled narrow screens fit the viewport. Long modal forms scroll rather
  than forcing a desktop-width canvas. No animations or decorative redesign are
  needed to solve the identified consistency problems.

## Recommended harmonization plan — owner review before implementation

1. **Foundation:** `$impeccable harden` for F1/F2; `$impeccable typeset` for F3.
   Small shared dialog shell and associated fields, not shared email business
   logic. Start with older invitation/template/materials modals; add agenda,
   deadline, reminder and release consumers with their own operation locks.
2. **Defaults contract:** `$impeccable clarify` + `$impeccable harden` for F4/F6/F7.
   Agree future-only Save/Clear, define any separate apply-to-current action,
   expose truthful source/fallback, then align materials/release behavior in
   bounded family-specific changes. Do not move all defaults to a generic API.
3. **Review surface:** `$impeccable clarify` for F5/F8. Verified sender/recipient
   summary, concise field names and one primary commitment per region. Add only
   the DTO display fields each family actually lacks. Keep Profile Settings as
   its own maintenance destination; a composer may link to it without silently
   changing where/how grantee defaults persist.
4. **Responsive finish:** `$impeccable adapt` for F9, then **`$impeccable polish`**.
   One batched desktop/narrow/keyboard pass; fix named issues together, one
   confirmation pass. Include dirty drafts, shared read failure, partial save,
   uncertain mail, actor/session changes and the nested directory picker.

### Owner decisions — agreed after the audit

[VERIFIED via subsequent conversation.] Owner approved all nine recommendations:
shared accessible dialog behavior; associated recipient-aware labels; readable
placeholder guidance; future-only Save/Clear with separate explicit apply-to-open
where retained; server-verified read-only From/To/Cc; visible fallback/Retry and
baseline-dependent write guards; clearly labeled Legacy templates; consistent
field/control vocabulary; and practical hit-area/scroll/zoom/focus improvements.

**Desktop first:** these apps are not intended for phone use. Preserve desktop
information density, useful side-by-side layouts and compact controls. Do not
make desktop compromises or force oversized controls to service phones. Narrow
screens are a regression check, not the design priority or a physical-phone UAT
requirement. This supersedes F9's original phone-oriented verification wording.

Owner requested the implementation plan, independent review and continuation
into the build after review passes. Authoritative execution contract:
`docs/plans/EMAIL_INTERFACE_CONSISTENCY_IMPLEMENTATION_PLAN_2026-10-24.md`.
Runtime remains unchanged at this documentation pass. Release requires a separate
instruction; calendar integration and missing default slices remain separate.

## Recommendation evidence and contract reconciliation

| Recommendation | Current prerequisite / execution point | Tested evidence | Disconfirming acceptance check still required |
| --- | --- | --- | --- |
| Dialog foundation | Per-family locks, picker nesting, opener available at modal mount | Real agenda Shift+Tab escaped; deadline retained background focus | Tab/Shift+Tab remain inside; Escape closes only allowed layer; opener restored; slow initialization can close |
| Associated labels/contrast | Existing field markup and token helpers | DOM labels empty in three legacy editors; 2.54:1 computed palette contrast | Every per-recipient field has unique name; computed contrast >=4.5:1; assistive-technology smoke |
| Future-only defaults | Separate raw editor state and current preview per workflow | Existing 120 contract tests plus source tracing; no write invoked in browser | Save/Clear leaves dirty draft/recipients/confirmation intact; explicit apply asks before replacement |
| Source/fallback | Status-bearing legacy preference/shared read seam | Error-swallowing helper branches inspected and existing store tests run | Shared/own failures surface distinct notices; no blank fallback mistaken for persisted value |
| Actual sender | Authoritative server DTO at preview | Accepted release already has draft.from; reminders/deadline show it | Another-actor case shows actual mailbox, not guessed session email; authorization unchanged |
| Active-template explanation | Existing compatibility keys and Profile copy | Actual template tabs and Profile copy inspected | Current invitation/materials remain available; legacy data preserved and consumers accurately named |
| Controls/targets | Shared Button vocabulary; effective hit areas | Screens/DOM dimensions at both widths | Clear hierarchy, no dark-on-dark class conflicts, target spacing/scroll/zoom and physical touch verification |

Whole-flow audit traced interface → existing request/store → response → draft/
preview → feedback for the named findings. Persistence is existing Dataverse
preferences/settings and family-specific send/queue state; no migration/new route
is proposed by this audit. Partial success and async states were source/test
reviewed, not live induced. No helper was extracted; preserve-difference list is
above. Symbol fan-out is recommendations only; any implementation must re-audit
all status/raw-key consumers. Final fresh-agent report check found no material factual defect; its two
completeness suggestions (distribution scope row and reviewer-materials local
scratch settings) were incorporated. Fresh-agent read-only findings agreed on default,
focus/labels, sender, fallback and compatibility drift; parent verified the
rendered examples and excluded fixture-only errors.

Sweep Mode A: queued review → completed audit, **harmonization approved and planned, not implemented**.
Current suite to-do, inventory and session pointer reconciled; historical release
receipts retain their dated scope. No claim of all P1 fixes or full a11y/performance
certification is made. Re-run `$impeccable audit` after approved fixes.
