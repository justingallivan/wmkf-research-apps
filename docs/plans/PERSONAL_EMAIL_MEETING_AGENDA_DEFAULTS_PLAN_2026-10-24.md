---
title: Personal meeting agenda email defaults — slice 6
domain: meeting-tracker
kind: plan
status: built-in-branch
summary: Owner-agreed personal subject and optional opening message for pre-discussion agenda emails, with sender-owned defaults, separate one-send edits, familiar default-wording disclosure and unchanged exact-send recovery.
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_DEFAULTS_INVENTORY_2026-09-24.md
  - docs/plans/PERSONAL_EMAIL_DEFAULTS_TODO_2026-09-20.md
  - docs/plans/AGENDA_EMAIL_DEFAULTS_BUILD_BRIEF_2026-09-10.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - docs/audits/MEETING_AGENDA_DEFAULTS_PLAN_REVIEW_2026-10-24.md
---

# Personal meeting agenda email defaults — slice 6

## Status and scope

[BUILT IN BRANCH; owner decisions agreed 2026-10-24.] This is the implementation plan
for personal defaults for the agenda of the pre-discussion before the site visit /
research presentation. Product decisions are settled. Implementation is built on
`codex/meeting-agenda-email-defaults`; build review and final verification are
in progress. No deployment or live agenda delivery is claimed.
OAuth Claude Opus 5.5 reviewed the earlier plan at `f36ca94fe` and returned
READY WITH NAMED CHANGES. This revision incorporates those findings; it has
not itself been re-reviewed by Opus.
The September Admin-defaults build brief describes earlier shared-default work;
it is not the personal-default implementation plan.

Change surface: agenda composer, sender-owned preference read/save/clear,
optional opening validation and fresh preview rendering. Entry points:
`shared/components/meeting-tracker/SessionAgendaPanel.js` and
`pages/api/meeting-tracker/sessions/[id]/agenda.js`. Persistence: existing
Dataverse `wmkf_appuserpreferences` for personal defaults and
`wmkf_appsystemsettings` for shared defaults; existing PostgreSQL
`deliberation_agenda_sends` for exact email snapshots and recovery. Consumers:
composer, preview, Dynamics transport and unresolved-send reconciliation.
No new table, migration, cron or generalized email-editor framework is proposed.

## Agreed owner decisions

1. **PC normally sends; backup staff permitted.** PCs primarily handle these
   emails. Keep Meeting Tracker access as the permission boundary so another
   authorized staff member can cover illness or absence. Send from the acting
   user's own Dynamics mailbox and use that user's defaults. No assigned-PD-only,
   PC-only or on-behalf-of restriction is introduced.
2. **Personal scope is subject and opening only.** Save a reusable subject and
   opening message. Session date/time, time zone, meeting link, location, ordered
   proposals, durations, lead PDs and briefing links remain generated from current
   session/slot data. Show the full exact email for review before sending.
   Generated content is not part of the saved template or editable opening.
3. **Explicit own-user Save/Clear.** Editing or sending changes only that email.
   Save changes only the acting user's future drafts. Clear removes that override
   and restores shared Admin wording for future drafts. Neither operation changes
   recipients, session data, the open one-send draft or a frozen pending email.
4. **Empty opening allowed.** Require a nonblank subject; opening may be empty or
   whitespace-only for one send and as a saved default. A saved empty opening is
   a configured preference, not Clear. Sending with no introduction still includes
   all generated session details and agenda. Never silently insert deleted prose.
5. **Recipients belong to one send.** Initially populate To from current session
   attendees and start Cc empty. Both remain editable, validated and visible in
   the exact preview. Never store To/Cc in personal defaults. Keep existing
   recipient validation and transport safety; slice 2's synthetic-request Cc ban
   is not automatically imported into this distinct session workflow.
6. **Fallback with notice.** If personal defaults are unreadable or damaged, show
   shared Admin wording with a visible notice, without modifying the saved row.
   Missing override normally uses Admin wording and is not an error. If shared
   wording also cannot load, show empty fields and a notice; staff may enter a
   subject and optionally an opening, preview and send. Shared failure must not
   prevent using a valid personal pair or repairing/clearing personal settings.
7. **Reusable placeholders.** Support optional `{{sessionDate}}` in subject and
   opening, resolved to the current session date in its time zone. Saved defaults
   retain the raw token, not a concrete date from the current email. Literal copy
   without a placeholder is allowed. No additional placeholders are selected.
8. **Unresolved sends retain original content.** Reopen the original frozen
   recipients, subject, rendered body and agenda. Changes to defaults apply only
   to new drafts, never alter a pending email, create a replacement automatically
   or cause an automatic resend. Retain original-sender recovery and transport
   reconciliation against the same Dynamics activity.
9. **Fresh on reopen.** Closing an ordinary unsent composer discards one-send
   edits. Reopen with current defaults, current attendees in To and empty Cc.
   An unresolved send is the exception and reopens its original frozen email.
   No additional durable draft store is introduced.
10. **Session drift requires new review.** If time, zone, proposal order,
    durations, location or links change before sending, retain one-send wording
    and recipient edits, regenerate agenda and any retained `{{sessionDate}}`,
    and require a fresh exact preview and confirmation. Literal dates manually
    entered by staff are their copy; do not guess or rewrite them. Never reload
    defaults over open edits during this refresh.
11. **Adopt the newer default-wording interface.** Beneath the one-send fields
    and above preview, use a collapsed **Your default wording** section, matching
    reviewer release/deadline emails. It has separate **Subject** and
    **Opening message (optional)** template fields, optional `{{sessionDate}}`
    guidance, **Save as my default**, and **Clear my default** when configured.
    Explain: “Used for future agenda emails. Edits to the email above are not
    saved here.” Confirm that Save/Clear leaves the current email unchanged.
    Quietly identify personal/shared wording when loaded; use warning treatment
    for failed-load fallback. Preference actions stay secondary to preview/send.
    No separate Profile Settings destination or additional modal is needed.

## Pre-build baseline and gaps — historical source review

[VERIFIED via source and 47 passing tests in two agenda suites during this review.]
`agenda-service.js` reads shared `email.deliberation_agenda.subject` and `.body`,
resolves `{{sessionDate}}` in GET, validates compose input, appends generated
session/agenda details and persists exact text/HTML before sending. Current
`composeInput` and panel preview guards require a nonempty opening: those must
change. There is no agenda personal-default key in the current preference
registry. Baseline tests are not coverage of the planned additions.

The agenda route derives sender email and Dynamics actor from the authenticated
session under `requireAppAccess('meeting-tracker')` and DAL context. The send
service freezes sender/recipients/copy, compares only session start instant and
ordered slot request IDs/minutes before dispatch, keeps original-sender dispatch
and reconciles pending activity status before resuming. It does NOT currently
compare session end, time zone, location or meeting/briefing links. The panel
schedule key has the same narrower scope. Widening freshness is required work,
not an existing guarantee (`agenda-service.js` scheduleSignature /
assertAgendaCurrent; `SessionAgendaPanel.js` scheduleKey).
The existing ledger is load-bearing; retain it rather than copying slice 2's
short-lived preview-proof mechanism.

[VERIFIED via read-only agent source inspection and successful Impeccable context.]
The suite has multiple incumbent patterns, not one universal component. Reviewer
release/deadline use a separate raw-template disclosure; materials/reminder flows
use footer actions; grantee defaults use Profile Settings. Owner chose the newer
disclosure for agenda. This was a source-based consistency review, not a rendered
visual or live-delivery audit. Preserve DESIGN.md and the established Operate
hierarchy: familiar controls, restrained state feedback, clear send commitment.

## Implementation contract

[IMPLEMENTATION CONTRACT; branch source implements this target. Final verification
and independent build review are recorded separately, not inferred from this text.]

1. **Exact-owner preference route and namespace.** Add an agenda-only raw
   `{ subject, body }` pair using the existing preference registry/store; `body`
   means opening only, never generated agenda. Add
   `GET/PUT/DELETE /api/meeting-tracker/agenda-email-preferences`, with
   `requireAppAccess('meeting-tracker')`, `isMeetingTrackerSchemaReady`, DAL context,
   strict session-derived Dynamics systemuser identity and exact body allowlists.
   No owner/profile/systemuser selector from input. Model identity and independent
   repair on `pages/api/review-manager/deadline-email-preferences.js`, not the
   materials route's profile-ID lookup or shared-read-dependent PUT/DELETE, nor
   release GET's shared-failure hard block. Missing/unlinked identity disables
   personal reads/writes; agenda GET can still expose shared wording with an
   identity notice, but existing prepare/send identity requirements remain.
   Add the key to BOTH `RESERVED_WRITE_KEYS` and `PRIVATE_REMINDER_KEYS` in
   `pages/api/user-preferences.js`, with reserved/private read and write tests.
   Update route matrix/counts/Atlas/catalog only when the route is implemented.
2. **One validator at every boundary.** Add an agenda-specific pure validator,
   used by Admin PUT for `email.deliberation_agenda.subject` / `.body`, strict
   shared read, personal Save/load and prepare. Subject: string, nonblank,
   single-line, maximum 500 characters raw AND resolved. Opening: string,
   0–20,000 characters raw AND resolved. Only exact optional `{{sessionDate}}`
   tokens are recognized in either field. Reject unknown/malformed/doubled/triple
   brace token syntax, including `{{{sessionDate}}}`; do not copy the deadline
   regex's partial-match hole. Literal text without tokens remains valid.
   A present null shared opening normalizes to empty (Dataverse text semantics);
   absent key, nonstring data or invalid subject is not a configured empty pair.
   Preserve stored whitespace as explicit personal data; personal/shared/one-send
   whitespace-only openings all render identically after trimming. Validate Admin
   fields independently on PUT and the complete pair on read; no sibling family
   placeholder/required-body rule changes.
3. **Explicit independent read contract.** Agenda GET receives the session-derived
   actor and returns effective RAW `defaults: { subject, message, source,
   personalStatus, sharedStatus }`; `message` maps to the pair's `body`.
   `source` is `personal`, `shared`, `shared_fallback` or `empty`.
   Personal status distinguishes configured, absent, invalid, unavailable and
   identity-unavailable; shared status distinguishes available, missing,
   `shared_invalid` and unavailable. Read personal/shared independently; neither
   failure suppresses the other. Treat shared subject/opening as one pair: a
   failure in either yields empty fallback fields when no valid personal pair
   exists, with a specific notice. Valid personal always wins even if shared fails.
   New preference GET exposes raw own/shared pairs, configured state and independent
   statuses; damaged own row offers 409 repair with readable shared data, failed
   own read is explicit, and PUT/DELETE do not require successful shared reads.
4. **Raw compose fields; resolved frozen preview.** Intentionally change current
   GET's resolved-default contract and its tests. Both one-send fields and the
   separate default editor show raw tokens with short guidance: the session date
   is filled into the preview. Do not try to infer token provenance from a
   rendered date after arbitrary edits. POST carries the raw one-send subject /
   opening. `prepareAgendaEmail` validates raw input, computes one fresh agenda
   snapshot, resolves tokens from THAT snapshot's scheduledStartIso / ianaTimeZone,
   checks expanded limits and renders/escapes plain text into final text/HTML.
   Invalid date/zone cannot leak a raw token into send. The ledger stores only
   resolved copy and generated agenda, retaining `exactPreparedRow` comparison.
   Refresh uses the retained raw form, preserving all literal edits and recipients.
   Send uses only the reviewed snapshot and never reloads defaults.
5. **Future-draft defaults refresh without rebasing the open draft.** Maintain a
   separate defaults-generation counter from the agenda operation sequence.
   Successful Save/Clear returns or re-reads effective raw defaults and updates
   the panel's future-draft defaults via a generation-guarded callback. It must
   not replace current form, recipients, preview or confirmation. Status loads
   apply defaults only if their captured defaults-generation is still current;
   they may independently update receipt state when valid for the session.
   Re-fetch on ordinary composer open to pick up another tab's changes, apply
   only to that opening generation, and block editing until initialization
   finishes; a late response never overwrites user input. Pending recovery opens
   directly from the frozen snapshot. Define all three current reset paths:
   ordinary open and stale/terminal pending reset must use current effective raw
   defaults, while drift of an ordinary open preview preserves that draft.
6. **Separate controllers and busy ownership.** Disclosure loads/writes use their
   own AbortController and generation, never the panel's sequence/controller.
   Use `onBusyChange` to lock Close, Escape, Create preview and Send during
   Save/Clear. During prepare/send disable Save/Clear. Lock conflicting edits
   while operations are in flight. Status reads, defaults initialization and
   prepare/send have separate controllers and busy ownership; a status refresh
   must not abort an operation and leave busy stuck because its finally was
   skipped. Session/actor changes invalidate all generations and deliberately
   reset their owned busy state; do not assume actor changes always reload the
   page. Test every success, failure, abort and finally after context changes.
7. **Optional opening end-to-end.** Remove nonempty-opening checks in compose
   validation, prepare's early return and Create preview's disabled condition.
   Do not warn on `!defaults.message`; an intentionally empty opening is valid.
   Show notices only for missing/invalid/unavailable source or blank subject as
   appropriate. Omit the introductory HTML paragraph entirely when trimmed
   opening is empty, rather than emitting `<p></p>`. Generated details and agenda
   remain in text/HTML, satisfying existing ledger NOT NULL constraints.
8. **Complete session freshness and link-read semantics.** At both existing
   pre-dispatch freshness points, compare fresh start, end, time zone, location,
   validated meeting URL and ordered proposal snapshot facts (request identity,
   minutes, displayed title/number/institution/lead PD and briefing-link identity /
   URL). Reuse the semantic scope for GET's changed-since-last-agenda indication;
   the client invalidation key covers every locally available session/slot field
   in that scope. The send-time server check remains authoritative.
   Use an agenda-scoped STRICT briefing lookup, leaving the general session-page
   fail-open reader unchanged. `getLiveBriefingLink` returns the same sealed-token
   URL for a live row; include its stable row ID and exact URL in the snapshot.
   Confirmed absent/expired/disabled link yields the normal no-link snapshot;
   a thrown read or unreadable live token yields a retryable read-unavailable
   outcome before dispatch, not false drift or a fabricated absent link.
   Changed live identity/URL requires a refreshed preview; do not mint/reissue
   links from agenda reads. Any extra snapshot metadata fits existing JSON.
   Add tests for absence versus failure and same row versus replaced/revoked link.
   Wider checks may leave an unsent Draft activity if data changes after creation;
   retain its known identity/audit and require new review, never blindly dispatch
   or automatically delete/reuse mismatched content. Pending send intent always
   reconciles transport before applying freshness, as it does today.
9. **Explicit size and persistence boundaries.** Set agenda and new preference
   route bodyParser limits to 256kb, covering worst-case JSON escaping of bounded
   Unicode raw copy plus existing bounded recipient lists. Retain field-level
   limits and recipient normalization/caps; validate expanded copy separately.
   Recheck the underlying Dynamics subject maximum before implementation/release
   and align limits if the 500-character candidate exceeds it; current service
   acceptance is not proof of the external column maximum. No new key/seed is
   required for shared defaults; do not overwrite existing Admin copy. Live
   readback or delivery still requires the repository's explicit authorization.
10. **Incumbent reuse, duplicates and recovery display.** Reuse disclosure look /
    interaction, not reviewer-family identity, validators, routes or refresh
    callbacks. Hide the disclosure during frozen unresolved-send recovery and
    after transport acceptance; manage future defaults from the next fresh
    compose. No new Profile destination/modal. Existing preference persistence
    is find-then-create with no verified uniqueness guarantee: do not claim
    atomic concurrent Save. Detect multiple exact-owner/key rows on reads as
    invalid (visible fallback); Clear must enumerate/remove all exact matches,
    reporting partial/unknown failure truthfully and confirming absence before
    success. Never delete another key/owner or silently choose one duplicate.
    Test duplicate reads, partial Clear, and concurrent-save residual; no broad
    deduplication or migration. Preserve existing send lease, original-sender
    binding, correlation recovery and definite/uncertain/terminal outcomes.
    Keep suite-wide interface harmonization in the separate queued review.

## Acceptance and contract verification

| Invariant | Required evidence before completion |
| --- | --- |
| PCs and backup staff use their own identity | Meeting Tracker app gate retained; session actor/mailbox; user A cannot read/write B's private defaults or send B's prepared draft |
| Only wording persists as personal settings | Explicit Save/Clear; no recipient/session/agenda data in preference; send never saves; empty saved opening differs from Clear |
| Raw tokens remain reusable | Save/load retains `{{sessionDate}}`; different sessions/zones and changed date resolve correctly; literals unchanged; unknown/malformed/triple-brace tokens rejected; raw and resolved length limits; date/agenda from same snapshot |
| Optional opening remains optional | Empty/whitespace personal, shared and one-send cases; no false missing-default warning or empty HTML paragraph; generated details/agenda still present; nonblank final subject required |
| Fallback preserves work | Missing/invalid/unavailable personal and shared reads; visible notice; valid personal usable; own repair works; failed field invalidates shared pair; source/status DTO fan-out; no silent writes |
| Independent default editor | Save/Clear/deferred load leaves one-send wording, To/Cc and frozen preview unchanged; future-draft cache refreshes after Save/Clear and ordinary reopen; stale status load cannot undo it; labels/feedback match adopted pattern |
| Fresh session data needs review | Start/end/zone/order/duration/location/meeting+briefing-link and displayed-proposal drift refuses stale send, preserves raw wording/recipient edits and requires new confirmation |
| Unresolved send remains exact | Changed defaults and close/reopen never rebase pending snapshot; original sender, same activity, no blind duplicate or automatic resend |
| Async and reopen behavior | Session/actor change, unmount, close, late responses and failures cannot leak old state; fresh ordinary reopen versus frozen unresolved reopen; separate controller/busy lifecycle and close locks |
| Private preference namespace | New key in both generic private-read and reserved-write sets; exact-owner route only; no caller identity |
| Persistence and size | Duplicate-row fallback and complete/partial Clear; raw/resolved bounds; 256kb parser Unicode/escaping cases |

Trace UI → app/identity validation → strict preferences/shared templates →
raw one-send draft → fresh session rendering → frozen PostgreSQL preview →
confirmation → existing Dynamics transport/reconciliation → truthful UI result.
Partial success is per preference action or exact agenda operation, never a
blanket success after an unconfirmed write/send. Schema migration is N/A unless
implementation proves an existing-store incompatibility; shared-helper changes
must preserve sibling families. Audit raw preference key, DTO/status/reason
consumers, both generic preference guards and every agenda reset path.

Extend agenda service/route/panel tests and add preference validation/isolation
coverage. Run scoped lint/types and affected route, Atlas, fact, lifecycle,
Dataverse/context, status and documentation gates with sequential self-tests.
Use Impeccable for bounded desktop/narrow UI verification, then independent
implementation review. Follow the Tier 2 branch/promotion procedure. No live
seed, migration, email or deployment is authorized by this planning task.

## Documentation reconciliation — 2026-10-24

Sweep Mode A, scope: the agreed personal agenda-default product contract and
separate suite email-interface review task. Authority: owner decisions in this
conversation, with source/agent inspection for baseline and compatibility.
Updated the inventory's slice-6 row/description, suite to-do and session pointer.
September inventory case rows remain explicitly historical. Earlier Admin build
brief remains its own completed shared-default work. Unrelated slice numbers,
email-family permissions and old release receipts are outside this change.
Product intent was PLANNED at the original documentation pass. Branch build
status now supersedes that implementation status; no deployment is claimed.
No product decision remains open. Independent build review and final verification
are recorded separately from the plan review.

## OAuth Opus plan review — incorporated 2026-10-24

[VERIFIED via ordinary Claude Opus 5.5 host CLI review using Claude.ai Team OAuth.]
Receipt `SLICE6_OPUS_PLAN_REVIEW_2026_10_24`; reviewed HEAD `f36ca94fe`, original
plan SHA256 `7909e44f14496df700db5d87710ff5dde369fc4aefe82a115fd96ec40465d6ba`.
Parent confirmed unchanged HEAD/hash after review. API-key/provider overrides
were removed, tools were Read/Grep/Glob only, external MCP disabled. No API-key
agent authentication or metered review product was used. Full historical report:
`docs/audits/MEETING_AGENDA_DEFAULTS_PLAN_REVIEW_2026-10-24.md`.

Verdict was READY WITH NAMED CHANGES for the original plan, not approval of this
revision. The original 47-test baseline does not prove planned functionality.

| Opus finding | Requirement in this revision |
| --- | --- |
| 1: narrow current drift detection | Corrected baseline; contract 8 defines full freshness, strict link reads, GET/client semantics and leftover-Draft risk |
| 2: raw versus resolved date provenance | Contract 4 explicitly changes GET and compose to raw templates and resolves from the same fresh snapshot at prepare |
| 3: no shared Admin validator | Contract 2 applies one agenda validator at Admin/shared/personal/prepare boundaries |
| 4: unspecified starting wording / stale refresh | Contracts 3 and 5 specify effective raw/status DTO and generation-guarded future-draft cache |
| 5: close-mid-save / shared controller interference | Contract 6 specifies mutual busy locks and separate controllers/generations |
| 6: generic privacy guard ambiguity | Contract 1 names both key sets, deadline identity/repair pattern and forbidden incumbent assumptions |
| 7: incomplete empty-opening guards | Contract 7 names validation, both client guards, warning and HTML behavior |
| 8: raw/resolved/parser limits | Contracts 2 and 9 define both limits and explicit 256kb parser bounds |

Optional points are resolved in contracts 2, 5, 9 and 10: recovery disclosure
visibility, refetch on open, schema-ready gate, duplicate handling, triple braces
and external subject-limit verification. No new schema uniqueness guarantee is
asserted. The same-snapshot comparison still cannot atomically lock all Dataverse
session/slot/link records through transport; compare as late as possible and keep
that remaining race explicit in the implementation review. No destructive cleanup
or new live action is authorized by this plan update.

## Branch build — verification in progress

Implementation source now includes exact-owner agenda defaults, shared/personal/
prepare validation, raw date templates, optional opening, independent preference
editor, separate async controllers and full snapshot freshness with strict
briefing reads. Existing ledger/recovery is retained. No schema or seed change.
Initial focused run passed 134 tests; final focused/full verification and OAuth
Opus build review remain in progress. Production-mode build and scoped gates
passed before the bounded browser focus correction; final build is required.
Microsoft's current Email entity reference documents Subject MaxLength 800;
the agenda's stricter 500 raw/resolved bound fits that published contract
(https://learn.microsoft.com/en-us/power-apps/developer/data-platform/reference/entities/email#subject).
This is published provider metadata, not a new tenant metadata probe.
