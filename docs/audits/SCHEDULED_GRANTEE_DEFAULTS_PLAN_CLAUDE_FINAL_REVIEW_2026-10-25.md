---
title: Independent Claude final review — scheduled grantee reminder defaults plan
domain: workbench
kind: audit
status: active
summary: "Read-only OAuth Claude delta review of 1ece224d3: READY TO IMPLEMENT; F1–F11 closed, no blocking findings. Two non-blocking documentation/robustness notes; not coding or release authorization."
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_SCHEDULED_GRANTEE_DEFAULTS_PLAN_2026-10-25.md
  - docs/audits/SCHEDULED_GRANTEE_DEFAULTS_PLAN_CLAUDE_REREVIEW_2026-10-25.md
---

[VERIFIED via host Claude Code ordinary Claude.ai OAuth/subscription.]
Target: `1ece224d325a3ba4e0c4c57209ec31880856533d`.
Final delta review used Read/Grep/Glob only, no edits, live operations, tests,
advisor, subagents or metered review product. No provider API-key authentication.
Report preserved verbatim below. The plan subsequently records this receipt and
clarifies the two non-blocking limits without changing planned runtime behavior.

---

I did not write the plan-mode scratch file, because you said no edits. I'm returning the report here instead.

# Final delta review: scheduled grantee reminder defaults plan at `1ece224d3`

**Scope and limits.** This is a contract-reconcile Mode A review, limited to whether the F1–F11 corrections hold together. I used only Read, Grep and Glob. I made no edits and ran no shell commands, tests or live operations. I used no advisor, subagents or paid tools. I read the full plan, the verbatim rereview, and these sources:
- `scheduled-email-service.js:470-612`
- `scheduled-email-store.js:90-149, 280-306, 530-546, 601-655`
- `shared/utils/scheduled-email-attention.js`
- `pages/api/scheduled-emails/[id].js:55-144`
- a check for any JavaScript-side due filter

Every recommendation below is **untested**. Live state is **UNKNOWN**.

## Closure table

| Finding | Plan location | Source prerequisite checked | Status |
|---|---|---|---|
| **F1** guard runs before Part B | §5.1 ¶2 (L180-185); §7.7 drift fixture (L404-405) | Part B runs at `service:498-505`, after `sourceStillEligible` (`:489`) and before any activity lookup. The second check matches the `:563` position, before `recordSendRequested` (`:567`). | **Closed** |
| **F2** don't save an unaccepted draft found by correlation | §5.1 step 2 (L190-198); §5.1 L224-226; §7.7 (L402-404) | Today the code saves a recovered ID *before* checking acceptance (`:557-559`, then `:562`). The mismatch branch therefore has to be its own read-only path that saves only if accepted. The plan says exactly that. A handoff bumps the generation (`store:633`) and needs `dynamics_email_id IS NULL` (`:649`), so leaving the ID unsaved keeps the A5 repair path open. | **Closed** (see note a) |
| **F3** due-queue order and 100+ held rows | §5.2 L265-277; §7.7 L408; §8 L446-451 | The due SQL already includes `failed` rows (`store:107`). The hold write sets `status='failed'` (`:534`), so held rows stay due-eligible. A NULL error code makes `CASE WHEN … = held` take the ELSE branch, so ordinary rows sort first. The cron has no JavaScript attention filter on due rows (`cron:255`, grep). Updating the parity test and headers is named. | **Closed** (see advisory b) |
| **F4** trigger list, who can see it, terminal Stop | §5.2 L286-295; §5.1 L227-232 | Stop is terminal (`store:53-61`; `:648`). The inbox and digest are keyed on the stored PD. The copy no longer suggests the viewer can repair it. You've already been told Stop ends automatic reminders for that deliverable. | **Closed** |
| **F5** (advisory) read failure vs reassignment | §5.2 L251-252, L288-289; §9 F5 row | You chose to keep the fail-closed hold with neutral "verification unavailable" copy. That's a valid option; the advisory only required honest copy. | **Closed by your choice** |
| **F6** keep the reason code if the hold write fails | §5.1 step 3 (L203-209) | The outer catch writes `error?.code \|\| …` (`service:608`). The claim clears the code (`store:290`). The state where both writes fail is documented. | **Closed** |
| **F7** result shape | §5.1 step 4 (L210-214) | The route treats `!outcome.message` as "changed" (`[id].js:113-115`). The plan keeps `message` as the projected row, moves the copy to `error`, and checks `held` first. | **Closed** |
| **F8** (advisory) Retry | §5.2 L256-263 | The helper currently sets `sendNow: openStatus && !reason` (`attention.js:70`), and the route guards on it (`[id].js:62-64`). The exception lives in the shared helper, so the route and page stay in sync. Forced sends skipping approval is disclosed. | **Closed** (deliberate choice) |
| **F9** comments and copy to update | §8 L446-451 | All six items from the rereview are listed (cron header, store handoff/due headers, B5 comment, attention header, route comment, digest note), plus the parity test. | **Closed** |
| **F10** four-worker arrival signal | §7.4 L377-381 | The test now waits for upstream per-row completions, drains microtasks, and must fail with a resolved-value cache. | **Closed** |
| **F11**/N3 brace grammar and `beforePopState` | §3 L86-93; §9 L493 | Brace grammar is pinned (exact case-sensitive tokens only, no whitespace, no single or triple braces). The same-pathname exemption is extended to `beforePopState`. | **Closed** |

## Non-blocking notes

**a. Late correlation recovery is a second way into the manual-recovery case.** If ownership still matches at the first guard, the existing code finds an unaccepted draft by correlation and saves its ID (`:558`). If the second check then finds a mismatch, the row carries a saved activity, so a handoff can't reset it (`store:649`). It ends up in the same manual-recovery case as the persisted-create case that L224-226 already describes.
- **Suggestion (untested):** widen L225 from "created and persisted" to "created or correlation-recovered and persisted".
- **Disconfirming check:** look in `deliverScheduledEmail` for a code path between `:558` and `:567` where the second ownership check runs *before* the recovered ID is saved. If one exists, this note doesn't apply. I found none.

**b. Held rows can crowd out other held rows.** Within the held group, rows still sort by `scheduled_send_at ASC`. With more than 100 held rows, the same oldest ones fill the leftover slots every run, so younger held rows never get an automatic recheck. This only delays the case where the PD switches back to the original owner. The main repair path (the producer handoff, driven by the cron scan) and manual Retry are unaffected.
- **Suggestion (untested):** add a secondary sort `CASE WHEN held THEN updated_at END ASC` before `scheduled_send_at`, so claimed held rows rotate to the back. This works because the claim updates `updated_at` (`store:292`).
- **Disconfirming check:** if the producer handoff and manual Retry cover every repair case you care about, plain oldest-first is acceptable and no change is needed.

## Mode A summary (delta only)

- **Whole flow:** the two guards now bracket Part B and intent, which closes F1.
- **Partial success:** a failed hold write keeps its reason code (F6); a correlation-recovered draft is saved only if accepted (F2).
- **Async:** the remaining race is honestly scoped as bounded (L239-243).
- **Helper semantics:** the stop-only rule and due-queue exclusion are split explicitly in the shared helper and tests.
- **Durable surfaces and doc text:** the due-ordering change is now admitted (§8 L450-451), and the F9 list is complete.
- **Symbol fan-out** for `pd_handoff_held` is unchanged from the rereview and is listed in §8.

I found no remaining blocking finding, and no plan text that lets the former PD send while ownership differs or can't be checked.

## Verdict

**READY TO IMPLEMENT.** Notes a and b are optional wording and robustness changes, not conditions. This covers only the plan at `1ece224d325a3ba4e0c4c57209ec31880856533d`, based on reading the source without running anything. It does not authorize coding or release.
