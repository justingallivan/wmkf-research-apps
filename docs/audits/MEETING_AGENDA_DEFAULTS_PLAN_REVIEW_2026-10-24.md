---
title: Meeting agenda defaults — OAuth Opus plan review
domain: meeting-tracker
kind: audit
status: active
summary: Historical read-only OAuth Opus review of the original slice 6 plan; READY WITH NAMED CHANGES. Findings incorporated into the linked revised plan, which has not been re-reviewed.
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_MEETING_AGENDA_DEFAULTS_PLAN_2026-10-24.md
---

The receipt below is historical: statements about unchanged plan text describe
review completion before the subsequent owner-authorized plan revision.

# Slice 6 Opus plan review — 2026-10-24 PDT

Authentication: host `claude auth status` verified loggedIn=true, authMethod=claude.ai, subscriptionType=team. Ordinary Opus 5.5 CLI review; API-key/provider override variables removed; no external MCP connections; tools limited to Read/Grep/Glob. No API-key authentication or metered review product used. CLI list-price usage estimates are not a billing receipt.

Reviewed HEAD: f36ca94feb3d96f2e2429da369483d1d607eff8f.
Plan SHA256: 7909e44f14496df700db5d87710ff5dde369fc4aefe82a115fd96ec40465d6ba.
Parent rechecked HEAD, hash and clean tracked diff after completion: unchanged.
Parent verified the narrow existing drift comparison, resolved GET defaults versus literal POST, missing agenda Admin validation, generic key guard names and fail-open briefing lookup against source. Other findings remain the independent reviewer's source analysis. No tests or live probes were run by the reviewer. No plan corrections have been applied in this review task.

## Opus report

**SLICE6_OPUS_PLAN_REVIEW_2026_10_24**
HEAD f36ca94fe · plan SHA256 7909e44f…5d6ba (I took both from your prompt; I can't hash files with Read/Grep/Glob)

## Verdict: READY WITH NAMED CHANGES

The product decisions hold up against the source. But the plan's own baseline overstates how much session drift the send path currently detects. Several mechanisms are also left open: where the draft's starting wording comes from, what Save/Clear does to it, and how shared wording is validated. These need pinning down before building. This was a read-only review using Read/Grep/Glob only. I ran no tests or probes, and the reported 47-test baseline doesn't cover any of the new behaviour.

## Findings (highest priority first)

**1. HIGH — the send path doesn't catch most session changes, contrary to the plan's baseline.**
- **Plan sections:** "Verified baseline" (L107–112, "rejects changed agenda facts"), decision 10, acceptance row "Fresh session data needs review" (L172).
- **Source:** the send-time check `assertAgendaCurrent` (`lib/services/meeting-tracker/agenda-service.js:543-553`) uses `agendaScheduleChanged`/`scheduleSignature` (`:298-319`). That compares only the start instant and each slot's request ID and minutes.
- **Not compared:** end time, time zone, location and meeting link. The client's `scheduleKey` has the same gap (`SessionAgendaPanel.js:61-68`).
- **Why it matters:** if only the time zone changes, the start instant is identical. A `{{sessionDate}}` frozen into the subject could then be the wrong day and still go out. The same applies to the session line, which includes end time and zone.
- **Required change:** add a send-time freshness comparison covering start, end, zone, location, meeting link, slot order and minutes, and test each field. Decide separately whether the "Schedule changed" badge in GET (`:462`) uses the same comparison or keeps the narrower one.
- **Briefing links need an explicit rule.** They're read fail-open, so a transient failure becomes `null` (`session-service.js:349-358`). Comparing them naively would make sends fail on read noise. This doesn't reopen the owner's "links" decision; it only defines how to compare.
- **Residual risk:** the second freshness check (`:688`) runs after the Dynamics activity is created (`:661`). Wider drift detection therefore makes orphaned Draft activities more likely. This is existing behaviour.

**2. HIGH — keeping raw `{{sessionDate}}` versus resolved text conflicts with the current GET and isn't specified concretely.**
- **Plan sections:** decision 7, Implementation contract bullet 2.
- **Source:** GET returns *resolved* defaults (`agenda-service.js:464-465`), and a test asserts this (`tests/unit/meeting-tracker-agenda-service.test.js:395-410`). POST never resolves tokens; `composeInput` (`:385-396`) sends submitted text literally.
- **Why it matters:** once someone edits the text freely, a resolved date can't be traced back to its token. The only workable reading is that the one-send Subject and Opening fields hold the raw template, including `{{sessionDate}}`.
- **Required plan text:**
  - GET returns raw templates (intentionally changing that test).
  - The one-send fields show raw tokens, with a short guidance line.
  - `prepareAgendaEmail` validates the raw tokens, then resolves them from the freshly computed snapshot (`scheduledStartIso`/`ianaTimeZone`, after `computeAgenda` at `:422`), so the frozen date and agenda come from the same read.
  - Resolution happens on plain text before `renderAgendaEmail` escapes it.
  - The ledger stores only resolved text. `exactPreparedRow` (`:398-409`) already pins it.

**3. HIGH — shared Admin agenda wording is not validated at all.**
- **Plan sections:** Implementation contract bullet 2 ("reject unknown/malformed tokens", single-line subject).
- **Source:** `pages/api/admin/email-defaults.js:59-62` validates only `reviewer_extension.*`. The agenda entries (`shared/config/editableTextDefaults.js:343-362`) have no validator or required placeholders. The shared read only trims (`agenda-service.js:180-189`).
- **Why it matters:** with the new rejection rules, a shared subject that is multi-line, has an unknown token or exceeds 500 characters would start a draft that can never be previewed.
- **Required change:** add one shared agenda validator, modelled on `shared/config/reviewerDeadlineEmail.js`. Use it in four places: Admin PUT, the shared read (invalid wording becomes a new `shared_invalid` status, handled like unavailable with a notice), personal save/load, and prepare.

**4. MEDIUM-HIGH — where the draft's starting wording comes from, and how Save/Clear updates it, is unspecified.**
- **Plan sections:** decisions 3, 6 and 9; Implementation contract bullets 1 and 3.
- **Source:** the panel starts every draft from the `defaults` state that the agenda GET sets. That happens in three places: `openComposer` (`SessionAgendaPanel.js:213-218`) and both reset paths for an unresolved send that turns out stale or terminal (`:329-334`, `:345-351`). The plan doesn't say whether the agenda GET merges in the personal pair or the panel calls the new route.
- **Effect 1:** after Save/Clear, closing and reopening in the same mounted panel would start from the *old* wording.
- **Effect 2:** a status reload that started before the save could overwrite the new starting wording when it finishes (`:176`).
- **Required changes:**
  - The agenda GET returns the sender's effective raw defaults plus `source` and separate `personalStatus` / `sharedStatus`.
  - The personal read never depends on shared status, and vice versa. An unlinked actor falls back to shared with a notice.
  - Define what happens when only one shared field fails (recommend treating subject and opening as a pair).
  - A successful Save/Clear updates the panel's starting wording through a callback guarded by a generation counter, without touching the form or preview.
  - The status reload applies defaults only if no newer defaults-generation exists.

**5. MEDIUM — closing the composer mid-save loses the result.**
- **Source:** the dialog locks only on the panel's own `busy` (`SessionAgendaPanel.js:228-232`, `:431`). The incumbent disclosure discards results after unmount (`DeadlineWordingDefault.js:43-47`, `:95`). Closing during a save therefore loses the outcome and the update to the starting wording.
- **Required change:**
  - While a save is in flight, lock Close, Escape, Create preview and Send via `onBusyChange` (the incumbent pattern).
  - While a prepare or send is in flight, disable Save/Clear.
  - The disclosure uses its own generation counter and AbortController, never the panel's `sequence`/`controllerRef`.
- **Existing bug (not a blocker):** the status-reload effect aborts the shared controller (`:183`) that prepare/send also use. Their `finally` then skips `setBusy(null)` (`:288`, `:390`), so busy stays stuck. It only triggers if the `session` or `slots` props change while the composer is open. SessionEditor changes those only through editor actions (`SessionEditor.js:359-361, 490, 545, 553`), so it's unlikely.

**6. MEDIUM — the generic preference route's guards must be named, not "as appropriate".**
- **Plan section:** Implementation contract bullet 1.
- **Required change:** add the new key to both `RESERVED_WRITE_KEYS` and `PRIVATE_REMINDER_KEYS` (`pages/api/user-preferences.js:24-45`; reason at `:36-38`). Extend `tests/unit/user-preferences-reserved-keys.test.js`.
- **Name the deadline route as the model** (`deadline-email-preferences.js:33-53`: systemuser identity, `sharedUnavailable` flag, invalid personal returns 409 with shared). Explicitly forbid copying three incumbents:
  - materials uses profileId identity (`materials-email-preferences.js:40`);
  - materials returns 503 for every method, including PUT/DELETE, when shared fails (`:37-38`), which would break decision 6;
  - release's GET returns 503 when shared fails (`release-email-preferences.js:41`).

**7. MEDIUM — the list of guards that must accept an empty opening is incomplete.**
- **Plan sections:** decision 4; "Verified baseline" names only `composeInput` (`agenda-service.js:392`) and the panel guards (`:253`, `:496`).
- **Also needed:**
  - The composer's warning (`SessionAgendaPanel.js:433`) fires on `!defaults.message`, so it would wrongly warn about an intentionally empty opening. Limit it to unavailable, invalid or blank-subject cases, with source-specific wording.
  - The HTML always emits `<p></p>` (`agenda-service.js:278`); omit it when the opening is empty.
  - Shared reads collapse whitespace to `''` (`:184`) while a personal whitespace-only opening is kept. State that both render identically after trimming.

**8. LOW-MEDIUM — length and size limits are underspecified.**
- **Plan section:** Implementation contract bullet 2.
- **Required change:** state the limits for saved raw text separately from final resolved text. `{{sessionDate}}` grows from 15 to up to about 23 characters per use, so apply 500 and 20,000 to the final text and also cap the raw text.
- **Body parser:** the agenda route allows 64kb (`pages/api/meeting-tracker/sessions/[id]/agenda.js:15`), but 20,000 non-ASCII characters can need about 60KB of UTF-8 before JSON escaping. Set explicit limits for both routes (the deadline route uses 128kb, `deadline-email-preferences.js:68`).

## Plan claims I could confirm or refute from source
- **Confirmed:**
  - The route uses the session's identity under `requireAppAccess('meeting-tracker')` and the DAL context (`agenda.js:47, 62-68`).
  - Sender and recipients are frozen in the ledger. Pending sends reconcile before the freshness check (`agenda-service.js:584-633`), and an actor mismatch returns 403 (`:613-615`, `:635-638`).
  - An unresolved send reopens as the exact frozen preview (`SessionAgendaPanel.js:199-211`). An ordinary reopen starts fresh (`:213-225`).
  - The ledger's `body_text NOT NULL` is still satisfied with an empty opening, because generated details are always added (`041_deliberation_agenda_sends.sql:12`, `agenda-service.js:276`). No migration is needed.
  - The preference value is a Memo of 100,000 characters (`wmkf_app_user_preference.json:21`).
  - Personal reads are filtered by owner (`user-preference.js:18-38`).
- **Refuted:** "rejects changed agenda facts" (Finding 1).

## Optional nits
- Say whether the "Your default wording" section shows during unresolved-send recovery and after a send is accepted.
- Consider refetching defaults when the composer opens, so changes from another tab are picked up.
- Save does a find-then-create, and uniqueness is enforced only in the app (`wmkf_app_user_preference.json:35`). Two concurrent saves could create duplicate rows that Clear only partly removes. The incumbent has the same risk; consider deleting every match on Clear.
- Decide whether the new route checks `isMeetingTrackerSchemaReady` like the agenda route does.
- `{{{sessionDate}}}` passes the deadline-style regex and renders as `{date}`.

## Contract audit coverage
- **Whole-flow:** traced from UI → route → service → ledger and settings → response → panel. The new route isn't built yet.
- **Partial-success:** each Save/Clear and each prepare/send stands alone.
- **Async/stale state:** Findings 4 and 5, plus the existing bug.
- **Helper extraction:** copy only the incumbents' look and interaction pattern, not their family-specific validators or endpoints (Finding 6).
- **Durable surfaces:** route matrix, counts, Atlas and the two key sets are PLANNED; no migration.
- **Doc reconcile:** the baseline claim in Finding 1 needs correcting.
- **Symbol fan-out:** checked every reader of `deliberation_agenda` and the deadline key. `defaults.message` is read only by the panel and the service tests.

## Assumptions I couldn't verify
- Briefing-link URLs change only when the underlying link changes.
- Dynamics accepts 500-character subjects. The adapter enforces nothing, and I didn't check the 500 limit against Dynamics.
- Actor changes always come with a full page reload.
