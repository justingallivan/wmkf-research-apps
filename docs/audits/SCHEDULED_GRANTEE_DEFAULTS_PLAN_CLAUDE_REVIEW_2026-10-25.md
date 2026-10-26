---
title: Independent Claude review — scheduled grantee reminder defaults plan
domain: workbench
kind: audit
status: active
summary: "Read-only OAuth Claude review of draft 0ba91394d: READY WITH NAMED CHANGES. Persistent handoff deferral needs an owner decision; template/navigation/auth/test corrections remain required. No coding or live operations."
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_SCHEDULED_GRANTEE_DEFAULTS_PLAN_2026-10-25.md
---

[VERIFIED via host Claude Code ordinary Claude.ai OAuth/subscription.]
Reviewed fingerprint: `0ba91394dd4f3b421e1c2603fb164515d769943a`.
Review was restricted to Read/Grep/Glob, with hooks and MCP disabled; no editing,
shell, live operations or further delegation. No API-key agent authentication or
metered review product was used. The report below is preserved verbatim.

---

# Independent Claude review: scheduled grantee reminder personal defaults plan

**Target:** commit `0ba91394dd4f3b421e1c2603fb164515d769943a` on `codex/scheduled-grantee-defaults-plan` (the plan's own baseline is `c7c3ce6e…`; the only difference is the plan commit).
**Plan reviewed:** `docs/plans/PERSONAL_EMAIL_SCHEDULED_GRANTEE_DEFAULTS_PLAN_2026-10-25.md`, read in full.

**Limits of this review:** it was read-only, using only Read, Grep and Glob. I edited no files, including the plan-mode scratch file, because you said not to edit any files. I ran no shell commands, tests, gates, DB/Dataverse/cron/environment probes or sends, and launched no subagents. Live Admin copy, live preference rows and live schema are **UNKNOWN**. Everything below comes from reading source at this commit. A pass here does not authorize implementation or release.

## Step 0 — What the change touches
- **Change:** each PD gets one saved default subject/body (`scheduled_grantee_reminder_template`). It's used when the cron creates a new `grantee_abstract_reminder` row and when a row is rebuilt for a new PD. A new editor on `/scheduled-emails` manages it.
- **Entry points:** new route `/api/scheduled-emails/email-preferences`, the cron `runGranteeDeliverableReminders`, the page `pages/scheduled-emails.js`, and the generic `/api/user-preferences`.
- **Where data is stored:** Dataverse `wmkf_appuserpreferences` (new key) and the existing Postgres `scheduled_email_messages` table (no schema change).
- **What reads it:** the cron's row creation and PD handoff. Preview, delivery, digest, reconciliation and finalization only read frozen row content.
- **Prior findings being verified:** none.

## Verified current behavior (source at the target commit)

**Cron**
- If the shared Admin copy is missing, the whole scan is skipped (`skippedMisconfigured`), but the digest, due-send, reconcile, stopped-row and finalize passes still run. [VERIFIED `lib/services/cron/grantee-deliverable-reminders-service.js:155-157,217-236,238-316`]
- `processRow` fully builds the draft (subject, rendered body, signature) for **every** scanned Invited deliverable before calling `createOrGetScheduledEmail`, including deliverables that already have a row. [VERIFIED `:420-448`]
- PD handoff is triggered only by comparing the returned row's PD with the current PD, after create-or-get. [VERIFIED `:453-472`]
- The existing review-posture cache stores resolved values after an `await`, not shared in-flight promises. [VERIFIED `:400-404`]
- Any summary failure, including `preferenceFailed`, switches the run log from `console.log` to `console.error`. [VERIFIED `:318-323`]

**Store**
- Insert is `ON CONFLICT (workflow_type, source_record_id) DO NOTHING` followed by a read of the existing row, so existing rows are never overwritten. [VERIFIED `lib/services/scheduled-email-store.js:34-64`]
- `reassignScheduledEmail` only fires when: the PD differs, the version matches, status is scheduled/failed/sending, both transport fields are null and there is no live lease. It overwrites subject, body and signature, clears edits and approval, and bumps `version` and `recipient_generation`. [VERIFIED `:616-655`]
- There is no read-only lookup by source; the full list of exports is at `:34-804`.

**Delivery and preview**
- `deliverScheduledEmail` sends whatever row it claims, using `pd_email` and `pd_systemuser_id` as stored. It does **not** re-check whether the request's PD has changed. [VERIFIED `lib/services/scheduled-email-service.js:450-555`]
- It re-checks only the Liaison and the PD's review posture, and that check can only tighten approval. [VERIFIED `:266-304`]
- Preview and send both use the stored body plus the stored signature. The real link is minted only at send time; preview uses a placeholder. [VERIFIED `:338-352,525-538`]

**Renderer**
- `buildGranteeReminderDraftBodyText` always replaces the bracket aliases `[Name]`, `[title]`, `COB [date]` and `[Program Director signature]`. [VERIFIED `lib/external/grantee-invite-email.js:96-111`]
- `applyPlaceholders` is literal, sequential, global and unescaped, so a value inserted earlier can be re-substituted by a later key. [VERIFIED `lib/utils/email-placeholders.js:6-13`]
- HTML escaping happens later, when the text is rendered to HTML. [VERIFIED `grantee-invite-email.js:43-59`]

**Shared defaults**
- `readRequiredEmailDefaults` sends a `NotificationService.notify` alert on any failure. [VERIFIED `lib/services/email-defaults.js:4-45`]
- The Admin metadata documents the reminder body as mustache-only (`{{granteeName}}`, `{{proposalTitle}}`, `COB {{dueDate}}`, `{{signature}}`). Live content is UNKNOWN. [VERIFIED `shared/config/editableTextDefaults.js:253-272`]

**Identity**
- The inbox uses `requireAuthWithProfile` → `resolveProfileToSystemUser`. That is an email-based map with the legacy remap of profile 6 to profile 5. [VERIFIED `pages/api/scheduled-emails/index.js:14-22`; `lib/services/dataverse-identity-map.js:23-26,61-78`]
- `actorRefFromSession` returns the session's stored `dynamicsSystemuserId`, and that value is also on the client session. [VERIFIED `lib/utils/actor-ref.js:71-77`; `pages/api/auth/[...nextauth].js:312,361`]
- Bare `requireAuth` returns `{authBypassed:true}` with no production refusal and before the Origin check. It also lets applicant sessions through. [VERIFIED `lib/utils/auth.js:154-157,179`]

**Preferences**
- `listByOwnerAndKey` enumerates every matching row and throws if the result is capped. The owner filter puts the GUID in raw, so the GUID must be validated first. [VERIFIED `lib/dataverse/adapters/user-preference.js:18-27,67-74`]
- The distribution precedent uses the same strict status / save-then-read-back / clear-then-confirm-absent pattern. [VERIFIED `lib/services/pre-site-visit/distribution-personalization.js:11-71`]
- The generic route has two separate guard sets: `RESERVED_WRITE_KEYS` (POST/DELETE) and `PRIVATE_REMINDER_KEYS` (keyed GET returns 403; list GET removes the key). [VERIFIED `pages/api/user-preferences.js:24-49,112,133,155-158,209-213`]

**Existing row edits**
- Subject: trimmed, non-empty, ≤300 characters. Body: 10–20,000 characters. There is no single-line or brace check. [VERIFIED `pages/api/scheduled-emails/[id].js:23-24,79-81`]
- The DB columns are unconstrained `TEXT`. [VERIFIED `lib/db/migrations/036_scheduled_email_messages.sql:24-25`]

**Page**
- `chooseMessage` calls `router.replace(…, {shallow:true})`. [VERIFIED `pages/scheduled-emails.js:189-192`]
- The page has no existing navigation guard; `draftDirty` is only calculated (`:252-254`).
- The proven guard `useDistributionUnsavedChanges` fires `window.confirm` on **every** `routeChangeStart` and throws if the user cancels. [VERIFIED `shared/components/workbench/useDistributionUnsavedChanges.js:13-29,40`]

## Findings (plan claims checked)

1. **CONFIRMED — "No ledger query/helper/schema change needed; existing rows stay frozen."**
   Evidence: store `:53`; cron `:445-472`.
   Reasoning: `ON CONFLICT DO NOTHING` freezes the winning insert, and reassignment is fenced on version, transport and lease. A change to a default cannot rewrite a frozen row.
   Residual risk: see N1 (a broken default reaches existing rows indirectly by blocking handoff).

2. **CONFIRMED — "Delivery reads frozen content and must not consult defaults."**
   Evidence: service `:525-553`.
   Residual risk: the planned "no send-time defaults read" test is decorative (N6).

3. **PARTIALLY CONFIRMED — "Failed read skips this producer attempt but does not mutate that row."**
   Evidence: cron `:420-448`.
   Reasoning: the statement is true, but it hides the consequence for rows that should be handed off. See N1.

4. **CONFLICT — "Do not reinterpret ordinary bracket prose in personal wording" while also reusing the existing renderer with no renderer extraction (§3, §8).**
   Evidence: `grantee-invite-email.js:100-110`.
   Reasoning: the reused renderer always replaces the four bracket aliases. The plan can't keep both promises. See N2.

5. **CONFIRMED with a caveat — "requireAuth… Origin protection… fail closed for applicant/bypassed."**
   Evidence: `auth.js:153-205`.
   Reasoning: the Origin check does run for real sessions. But the bypass path returns before the Origin check, and applicants pass `requireAuth`. Failing closed must therefore be explicit code, not a side effect. See N4.

6. **CONFIRMED — "Shared reads without operational notifications."**
   Evidence: `email-defaults.js:4-45` vs `distribution-personalization.js:28`.
   Reasoning: this is only true if the editor calls `getSettingStrict` directly. It must not use `readRequiredEmailDefaults`.

7. **CONFIRMED — Exact-owner check (mapped profile GUID must equal the session actor).**
   Evidence: `dataverse-identity-map.js:23-26,61-78`; `actor-ref.js:71-77`.
   Reasoning: this blocks the profile-6 remap from editing profile 5's defaults. It is stricter than the inbox and the distribution precedent, and it doesn't change existing authorization. `buildMap` throws on Dataverse failure (`:68-70`), so the route must turn that into a sanitized 503.

8. **CONFIRMED — Privacy fan-out is limited to the generic route.**
   Evidence: the only HTTP routes that return a full preference map are `pages/api/user-preferences.js:121,132`. The other `getUserPreferences` callers read specific keys server-side (`email-automation-preferences.js:31`, `email-signature.js:79`, `prompt-override.js:75`, `reviewer-prompt-resolver.js:58`, `site-visit-materials/*`).
   Required: the new key must go into **both** `RESERVED_WRITE_KEYS` and `PRIVATE_REMINDER_KEYS`, and `tests/unit/user-preferences-reserved-keys.test.js` must cover keyed GET, list GET, single and batch POST, and single and batch DELETE.
   Residual risk: raw Dataverse access to `wmkf_appuserpreferences` (Explorer, etc.) is outside this route and the same for every family. [ASSUMED unchanged]

## New issues

**N1 — HIGH — A broken incoming-PD default turns a "narrow accepted race" into a lasting state where the former PD sends, and pauses new reminders indefinitely.**
- Evidence:
  - The cron builds the draft before create-or-get (`:420-448`), and handoff happens only after that (`:453-472`).
  - Delivery has no current-PD check (`scheduled-email-service.js:450-555`).
  - The cron header calls the reassignment race "narrow… self-healed next run" (`:29-32`).
  - The log escalates every run (`:318-323`).
- Under the plan:
  - A `duplicates` (which the plan admits concurrent saves can produce, §4), `invalid` (for example after a later validator tightening) or `encrypted` default for the new PD skips handoff on every run.
  - The row stays under the former PD and is sent from the former PD's mailbox, with the former PD's edits and approval, on day 12.
  - The same broken state also stops new rows for every one of that PD's Invited deliverables until someone fixes it.
  - Today, row-blocking read failures (test marker, request, contacts, Liaison, PD, posture) are other-record or transient reads. A **persistent, PD-caused** blocker is new behavior.
- Required changes:
  - (a) State this consequence explicitly in §5 as a tradeoff the owner sees: "an unreadable new-PD default defers handoff; the former PD's message may send".
  - (b) Use a distinct failure reason (for example `personal reminder default <status> for current PD`), separate from `review posture read failed`.
  - (c) Report each broken PD once per run, not once per row, and name the request numbers affected.
  - (d) In the editor's GET/UI, show non-`configured`/non-`absent` own states as "New reminders and reassignments for your grants are paused until you Clear or re-Save", with Clear always available. The Clear action already deletes duplicates (§4).
  - (e) Ask the owner whether a handoff should fall back to the shared pair when the incoming PD's default is unreadable. Recommendation: keep failing closed. Today's precedent (a posture-read failure also defers handoff, `:414-418`) shows the deferral is an accepted direction. But the owner must accept it knowingly.

**N2 — MEDIUM — Bracket aliases in personal wording.**
- Evidence: `grantee-invite-email.js:100-110`; `email-placeholders.js:6-13`.
- Required change: the personal validator, used both at save and in the cron, must reject the literal strings `[Name]`, `[title]`, `COB [date]` and `[Program Director signature]` with a clear message.
- Define "malformed mustache" concretely:
  - every `{{…}}` must be one of `granteeName`, `proposalTitle`, `dueDate`, `signature`;
  - reject any unmatched `{{` or `}}`;
  - the subject rejects any `{`/`}`.
- Do not write a new renderer. Also check the body length after rendering (≤20,000), because long titles and repeated tokens can push it over.

**N3 — MEDIUM — The copied navigation guard would hijack message selection.**
- Evidence: `pages/scheduled-emails.js:191` (shallow `router.replace`) and `useDistributionUnsavedChanges.js:24-29,40` (confirm/throw on every `routeChangeStart`).
- Effect: with a dirty default, clicking another message would prompt. If the user cancels, `setSelectedId` has already run but the URL replace throws and is left unhandled. That breaks §6 ("Selecting another message must not reset…").
- Required change: the scoped guard must let same-pathname shallow query changes through without prompting (compare the destination pathname to `/scheduled-emails`). Add a fixture/browser test that selects a message while a default is dirty: no prompt, editor text unchanged, URL updated.
- Also, "Hide/disable while identity is loading" must **disable**, not unmount, or edits for the same actor are lost when `ProfileContext` passes through `loading` (`shared/context/ProfileContext.js:25,38`).

**N4 — MEDIUM — Fail closed explicitly at the route.**
- Evidence: `auth.js:154-157,179`.
- Required change: after `requireAuth`, the route must return 403 when `session.authBypassed` is set or `userType === 'applicant'`. Then it must require `isGuid(actorRefFromSession(session))`, then a profile id, then the mapped GUID equal (case-insensitively) to the actor. The mapping lookup must happen inside `withDalContext`, and a throw must become a sanitized 503.
- Route tests must cover bypass under `NODE_ENV=production`, an applicant session, and an Origin mismatch on PUT/DELETE.

**N5 — LOW — Editor prefill vs required tokens.**
- Evidence: `editableTextDefaults.js:256,266` documents mustache-only copy, but the live shared subject/body is UNKNOWN.
- Problem: if the live shared body uses bracket aliases, or the shared subject contains `{{…}}` (which is sent literally today), a PD who seeds from "effective/shared" and clicks Save gets rejected.
- Required change: the UI shows validation errors for each field, and the plan says prefill is a starting point, not guaranteed to pass validation. Don't rewrite the Admin copy (§3 already says so).

**N6 — LOW — Tests must be able to catch a real failure.**
- **Shared in-flight read:** use a deferred mock for the preference read, released only after all four workers have called it, and assert it was called exactly once. With instantly-resolving mocks, a value cache like `overrideByPd` (`:400-404`) would also pass. Also assert that a rejected or failed snapshot is shared by every worker in that run, and that a second run reads again.
- **Partial Clear and duplicates:** put real foreign-owner and foreign-key rows in the fixture, and prove they are both present and untouched.
- **"No send-time defaults read":** drop it as evidence, or reword it as a structural assertion. `deliverScheduledEmail`'s dependencies contain no preference reader, so "not called" proves absence, not exclusion.
- **Handoff:** cover the N1 path. With a broken new-PD default, reassignment is not called, the row is unchanged, the failure reason is the new distinct one, and the due-send pass still runs.

**N7 — LOW — Clarify the counter.**
- Reusing `preferenceFailed` keeps the 200 summary shape the cron promises (`:38-41`), but it mixes posture failures with wording failures. Keep the counter (no shape change) and make the distinct reason string in N1(b) the thing that tells them apart.

## Recommendation evidence

| Recommendation | Current prerequisite | Available at the point it runs | Evidence actually tested | Disconfirming check | Status |
|---|---|---|---|---|---|
| N1 surface lasting deferral; distinct reason, reported per PD | handoff after draft build, `cron:420-472`; no PD re-check in delivery, `service:450-555` | yes: the failure is known before `createOrGet`, `cron:420` | NOT TESTED (source trace only) | Look for a current-PD check in `claimScheduledEmailSend` (`store:276`). If it refuses rows whose PD changed, N1 drops to LOW. Its signature takes `pdSystemUserId` only for manual sends; the cron passes nothing (`cron:258`). | VERIFIED trace / ASSUMED severity |
| N2 reject bracket aliases | alias replacement, `grantee-invite-email.js:100-110` | yes: save validator and cron validator | NOT TESTED | A personal body containing `[Name]` renders the surname today: substitution is unconditional, `email-placeholders.js:10` | VERIFIED |
| N3 shallow-route exemption | `pages/scheduled-emails.js:191`; guard `:24-29,40` | yes: guard callback gets the URL | NOT TESTED | If Next.js didn't emit `routeChangeStart` for shallow replace, N3 would be moot. It does emit it for shallow routing [ASSUMED from Next.js Pages-router behavior; confirm with the fixture test] | ASSUMED (framework) |
| N4 explicit bypass/applicant 403 | `auth.js:154-157,179` | yes: route right after `requireAuth` | NOT TESTED | `actorRefFromSession({user:{}})` returns null → 503 anyway (`actor-ref.js:72-76`). So this is defense in depth, not an open hole. | VERIFIED |
| Editor uses `getSettingStrict`, not `readRequiredEmailDefaults` | `email-defaults.js:4-45` | yes | NOT TESTED | Precedent `distribution-personalization.js:28` already does this | VERIFIED |
| Key in both generic guard sets | `user-preferences.js:24-49` | yes | NOT TESTED | List GET removes only `PRIVATE_REMINDER_KEYS` (`:133`); a key only in RESERVED would leak in list GET | VERIFIED |

## Seven-audit summary (Mode A)
1. **Whole-flow:** all hops traced (editor → route → service → Dataverse; cron → render → ledger → preview/send). Gaps: N1, N3.
2. **Partial success:** the save/clear read-back contract follows the distribution precedent. Cron failures already carry request numbers (`addFailure`, `cron:143-145`). N1(c) is required so a PD-wide failure doesn't flood the list.
3. **Async/stale state:**
   - The in-flight promise cache is sound if it stores a normalized status (never an unhandled rejection).
   - UI generation and actor-scope guards are well specified.
   - N3 (shallow route) and the disable-not-unmount requirement need fixing.
4. **Helper extraction:**
   - No extraction proposed, which is correct.
   - Reusing the renderer has the alias consequence (N2).
   - The generic lax preference reader is correctly avoided.
5. **Durable surfaces:**
   - The new route needs entries in the API matrix, canonical route counts, `reviewerFinderPreferences.js`, both guard sets, the service catalog and the Atlas preference page.
   - No migration is needed. Confirmed: no schema change.
6. **Doc reconcile:** the plan correctly leaves the September inventory as historical. The cron header's "narrow accepted race" text (`cron:29-32`) must be updated alongside N1.
7. **Symbol fan-out:**
   - New key: writer (new route), readers (new service, cron), generic GET/POST/DELETE guards, tests.
   - No new enum, status or ledger column.
   - Owner-filter injection is safe only with `isGuid` checked before `eqRaw` (`user-preference.js:18-20`).

## Final verdict
**READY WITH NAMED CHANGES**

**Required named changes:**
- **N1** (state the lasting handoff deferral and new-row pause; distinct reason, reported per PD; paused-state copy in the editor with Clear available; owner sign-off on failing closed vs a shared fallback for handoff; update the cron header).
- **N2** (reject bracket aliases; concrete mustache grammar; check length after rendering).
- **N3** (shallow same-path exemption in the guard plus a selection test; disable, don't unmount, while loading).
- **N4** (explicit bypass/applicant/actor/mapping fail-closed order inside DAL context, with a sanitized 503).
- **N6** (tests that can actually catch a failure, including the N1 handoff path).
- Make sure the key is added to **both** generic guard sets (Finding 8).

**Advisory:** N5, N7.

This verdict is not implementation or release authorization.
