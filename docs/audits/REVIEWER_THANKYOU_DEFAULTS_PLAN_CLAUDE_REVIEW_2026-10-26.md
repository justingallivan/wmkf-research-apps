---
title: Automated reviewer thank-you defaults — independent plan review
domain: reviewers
kind: audit
status: active
summary: "Historical draftdc9e65a5c: ordinary OAuth Claude READY WITH NAMED CHANGES; R1–R5 require plan clarification. Verbatim report; no implementation/release authorization."
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_REVIEWER_THANKYOU_DEFAULTS_PLAN_2026-10-26.md
---

# Independent Claude plan review — 2026-10-26

[VERIFIED via host Claude CLI output.] Ordinary subscription OAuth, Read/Grep/Glob
only, no edits/scratch plan/tests/live data/advisors/delegation/metered product.
Target `dc9e65a5c`; no other checkout/database work touched. Report below verbatim.
Subsequent plan revisions address required R1–R5; the N1 assertion about no manual
marker writer is independently refuted by recordDeliveredEmail → updateLifecycle
in the compatibility send path, with evidence in the revised plan. No runtime
change is authorized by this report.

## Verbatim report

# Review: automated reviewer thank-you defaults plan

**Target:** `docs/plans/PERSONAL_EMAIL_REVIEWER_THANKYOU_DEFAULTS_PLAN_2026-10-26.md` at `dc9e65a5c` on `codex/reviewer-thankyou-defaults-plan`, in the worktree `/Users/gallivan/.codex/worktrees/session-start-2030/WMKF_Apps`. Runtime baseline is `448ed17d1`.

**Method:** I read the whole plan and checked it against source with Read/Grep only, using contract-reconcile Mode A by hand. I did not run any shell commands, tests or gates, made no edits (including no plan file, scratch notes or memory), touched no live systems, and used no subagents or advisors.

**Limits:** Live tenant state, including the stored shared thank-you copy, is UNKNOWN. I did not check the logic of `check:api-routes`, how `ScheduledGranteeReminderDefaults.js` compares identity, or how the installed Next version handles a bodyless GET. The test and gate results are root's, not mine.

**Verdict: READY WITH NAMED CHANGES.** Approving the plan does not authorize implementation or release.

---

## Required changes (resolve in the plan before coding)

### R1 (P1). The new shared-copy check is a new refusal on today's production path
- **Evidence:** Today the sweep sends shared copy without checking its tokens (`reviewer-thankyou-sweep.js:197-198`). The renderer only replaces the placeholders it knows; `applyPlaceholders` is a plain split/join (`lib/utils/email-placeholders.js:6-13`), so any other `{{x}}` goes out as literal text. I found no server-side token check for `email.reviewer_thankyou.*` anywhere in `pages/api` or `lib`. The live value is UNKNOWN.
- **The change:** Plan §3 (lines 99-104) makes an unknown mustache token in shared copy fail before claim. Every PD without their own wording could stop receiving thank-yous on the first run after release. Plan §1 doesn't count this as a behavior change.
- **Two precedents point opposite ways:**
  - The reminder sweep does check shared copy (`reviewer-reminder-personalization.js:82-83`).
  - The scheduled-grantee code explicitly does not (`scheduled-grantee-reminder-personalization.js:30`).
- **Required:**
  - **(a)** Say this is an owner-approved behavior change, or drop it.
  - **(b)** Pin down the exact shared grammar:
    - subject: `{{proposalTitle}}` and `[proposal title]`
    - body: `{{greeting}}`, `[greeting]`, `{{proposalTitle}}`, `[proposal title]`, `{{signature}}`, `[Program Director signature]`, and `{{honorariumNote}}` (stripped)
    - say whether `{{ greeting }}` or an unbalanced `{{` fails.
  - **(c)** Say where the check runs. My recommendation: evaluate it once per run, and refuse only the rows that fall back to shared copy, with a distinct reason. Today's presence check (`readRequiredEmailDefaults`) stays the batch-level prerequisite. As written, "batch prerequisite" (line 67) plus "fail before claim" leaves it unclear whether a PD with valid own wording is blocked by bad shared copy.
  - **(d)** Make a post-deploy dryRun the first observation, which means dryRun must run this check (see R4).

### R2 (P1). Bounds on the rendered subject and body depend on request data, and nothing defines them
- **Evidence:** The proposal title goes into the subject (`reviewer-reminder-email.js:196-200`). The plan wants the final subject "nonempty/bounded/single-line" and the body "bounded" (lines 107-110) but gives no rendered limits.
- **Problem:** A long or multi-line `akoya_title` would refuse the same row on every run. That row adds to `skippedMisconfigured`, and because `send-review-thankyous.js:54-59` counts it, every Maintenance run is marked failed. The PD can't fix it through the wording unless they drop the title token.
- **Required:**
  - Give numbers for both rendered limits.
  - Say whether a title-driven refusal gets its own reason (recommended), and whether a newline is refused or normalized. Refusing avoids editing the renderer, which the plan forbids.
  - Say whether the final subject is trimmed before sending. The current code sends it untrimmed.

### R3 (P1, decision record). The route's auth rationale is sound, but its location contradicts its sibling routes
- **Evidence:** All three existing `pages/api/review-manager/*-email-preferences.js` routes (reminder, release, deadline) use `requireAppAccess(req,res,'review-manager','reviewers')` at line 25. The precedent the plan cites, `requireAuth` with exact-owner matching, lives at `/api/scheduled-emails/email-preferences.js:12-29`.
- **The rationale holds:** the sweep picks the sender only from the request (`reviewer-reminder-sweep.js:111-123`), so a PD without the reviewers grant still sends automatic thank-yous, and editing your own future wording grants no send authority.
- **Required:**
  - Either move the route out of `review-manager/`, or record it in `API_ROUTE_SECURITY_MATRIX.md` as a deliberate exception within that directory.
  - State the resulting asymmetry: the same PD can edit thank-you wording without the reviewers grant but can't edit their reminder wording.
  - Check that `check:api-routes` doesn't infer guards from the directory. I did not verify this.

### R4 (P2). Sweep counting and order are not fully specified
These are the gaps an implementer would otherwise guess at:
- **Order:** Say where the preference lookup sits relative to `result.eligible++` and `if (dryRun) continue` (`reviewer-thankyou-sweep.js:192-195`).
  - The reminder precedent counts the row as eligible first, then counts a refusal as a plain `skipped`, not `skippedMisconfigured` (`reviewer-reminder-sweep.js:208-223`).
  - The plan chooses `skippedMisconfigured`, which I agree with, but must say whether refused rows still count as eligible.
- **dryRun:** Say whether dryRun also does the per-row render checks. If it doesn't, R2 refusals never show up in dryRun. Also state that dryRun refusals mark the run failed. That already happens for missing shared copy today (cron `:54-59` doesn't depend on dryRun).
- **Error entries:** Say whether they are per row or grouped per PD and status, with an affected count (the grantee precedent groups, `grantee-deliverable-reminders-service.js:436-442`). Also say whether a new counter such as `preferenceFailed` is added (additive to the response) or only `skippedMisconfigured` is used.
- **maxBatch:** Rows past the batch cap are skipped before any preference read (`:177`). State this so tests pin it.

### R5 (P2). Profile Settings has two copy sites, and the identity check is underspecified
- **Copy:** The plan only mentions "legacy help copy". These places need changing:
  - `EmailTemplatesModal.js:18` (not a drop-in claim; it's the modal's help text)
  - `pages/profile-settings.js:600-603`, which says "Automatic reviewer thank-yous use the Admin default"
  - the code comment at `profile-settings.js:92-96`
  - `profile-settings.js:592-593`, which tells staff their saved Email Signature fills `{{signature}}`. For the automatic thank-you, the signature is the one resolved server-side for the request's PD (`resolveSignatureForRequest` → `normalizeSignatureText`, `reviewer-reminder-email.js:34-36`). The editor should say that.
- **Identity:** Profile Settings lets you switch profiles on the client (`profile-settings.js:730-735`, `selectProfile`). The route uses the session's actor and profile (`scheduled-emails/email-preferences.js:15-29`), and its response only echoes `ownerSystemId`. Plan §6 ("strict identity match before enabling writes") must say exactly what the client compares, for example the session-bound profile id echoed in the response versus `currentProfile.id`. It must also say what happens when they differ: disable writes and show a notice, or refuse. I did not check what the scheduled component does.

---

## Non-blocking notes

- **N1. A third stale header claim.** The sweep header at `:25-29` says the manual `send-emails.js` thank-you branch also stamps `wmkf_thankyousentat`. In source, `claimThankYou` is called only by the sweep (`:87`). The only other writer is synthetic seeding (`seed-synthetic-review.js:223`). Add this to the header fixes in §2. Also narrow "historical manual-send races" (§5) and "compatibility/manual paths" (§2): the legacy `thankyou` template type is still accepted for rendering (`render-emails-service.js:63`), but I found no live manual path that writes the marker. Overlapping sweeps are the only concurrent claimant in source.
- **N2. The validator differs from its sibling.** The reminder validator allows 500/12000 characters and rejects `http(s)://` and `www.` links (`reviewer-reminder-personalization.js:43-57`). The plan uses 300/20000 and has no URL rule. Choose deliberately and say whether literal URLs are allowed in personal thank-you prose.
- **N3. List the exact legacy aliases to refuse** in personal copy: `[greeting]`, `[proposal title]`, `[Program Director signature]`. The renderer's split is case-sensitive, so `[Greeting]` is plain prose; say that it is allowed, which matches the plan's "ordinary bracket prose" rule.
- **N4. Generic preference guard.** The alias canonicalizer only knows the scheduled key (`user-preferences.js:55-58`). Either generalize it to a small set or add a second function. The new key must go into both `RESERVED_WRITE_KEYS` (`:24`) and `PRIVATE_REMINDER_KEYS` (`:42`), so the changes cover the keyed GET (`:121`), the list filter (`:142-144`), POST (`:167`) and DELETE (`:221`). Other server-side readers of `getUserPreferences` only read specific keys (for example `email-automation-preferences.js:31-32`); I found no other client leak.
- **N5. The body is built twice.** `renderThankYou` already calls `buildThankYouBodyText` internally (`:207`), so the separate check renders the body a second time. That's safe because both are deterministic with no clock or randomness. A test should assert both calls get the identical input object.
- **N6. Already true today.** The DOCX `generatedAtIso` already reuses the claim timestamp (`nowIso`, `:62,77,87`). The plan's step 6 keeps existing behavior rather than adding new behavior.
- **N7. Reusable pieces confirmed:**
  - `listByOwnerAndKey` exists and refuses capped enumeration (`user-preference.js:67-74`).
  - The scheduled service's save/readback/clear pattern (`scheduled-grantee-reminder-personalization.js:44-74`) fits the "reference, not extraction" posture.
  - The scheduled hook really does hard-code a `/scheduled-emails` shallow exemption (`useScheduledDefaultsUnsavedChanges.js:15`), which confirms the plan's reason not to reuse it unchanged.
  - Profile Settings registers no other `beforePopState`/route guard, so the new guard won't collide with one.

---

## Contract-reconcile Mode A audits (scoped)

1. **Caller → persistence → consumer:** The chain cron → `withDalContext` → sweep → `loadRequestContext` (PD from request, must be enabled) → (new) strict own read → render → DOCX → If-Match claim → send is traced correctly. One gap: whether the shared-compatibility check applies per batch or per row (R1).
2. **Partial success:** Refusals before claim leave the marker null and the row retries next run. Failures after claim stay at-most-once. Partial Clear and "mutation confirmed but refresh failed" are defined. Rows refused because of their title would retry forever, which needs a decision (R2).
3. **Stale async state:** The per-run promise cache keyed by PD, with no cache across runs, is sound. ETag concurrency is preserved. On the client, the profile-switch case needs a decision (R5).
4. **Helper semantics:** The renderer's alias and `honorariumNote` behavior is confirmed (`reviewer-reminder-email.js:173-200`). The two exact-owner precedents treat shared copy differently, so the plan must pick one explicitly (R1).
5. **Durable surfaces:** No schema change. One new preference key. Maintenance details may gain a counter (R4). The route matrix needs its exception recorded (R3). There are four copy/comment sites (R5) and a third header correction (N1).
6. **Deduplication / fan-out:** Duplicate rows block for that PD only. One read per PD per run. No new parallelism.
7. **Docs:** Planned, not built, is labeled correctly. The Atlas, catalog and matrix are updated only after build. Fix the §2 and §5 manual-path wording (N1).

## Checks that could overturn this review

Run these before or during implementation:
- An owner-authorized read of the live shared thank-you subject and body, or a post-deploy dryRun that runs the shared-compatibility check. Unknown tokens there would make R1 urgent.
- The logic of `check:api-routes`, for R3.
- How `ScheduledGranteeReminderDefaults.js` compares identity, for R5.
- The maximum length of `akoya_title` and whether it can contain newlines, for R2.
- Whether the Admin client editor checks thank-you tokens. I only searched the server.

None of these require changing the overall architecture. With R1–R5 resolved in the plan text, it is ready to implement once the owner separately authorizes implementation.
