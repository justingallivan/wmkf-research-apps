---
title: Independent Claude rereview — scheduled grantee reminder defaults plan
domain: workbench
kind: audit
status: active
summary: "Read-only OAuth Claude rereview of 69a2bd838: hold covers automatic/forced sends; READY WITH NAMED CHANGES for ordering, correlation recovery, due fairness, repair copy and tests."
owner: product-engineering
related:
  - docs/plans/PERSONAL_EMAIL_SCHEDULED_GRANTEE_DEFAULTS_PLAN_2026-10-25.md
---

[VERIFIED via host Claude Code using ordinary Claude.ai OAuth/subscription.]
Target: `69a2bd8389ed012e5c020e0fd94a8140174e58cb`. No application edits,
live operations or tests. The reviewer reports one internal advisor consult;
its limitations and disagreement are preserved in the verbatim report below.
No separate metered review product was requested or invoked by Codex.

---

# Independent Claude review: revised scheduled grantee reminder defaults plan

**Target:** commit `69a2bd8389ed012e5c020e0fd94a8140174e58cb` on `codex/scheduled-grantee-defaults-plan`. I read `docs/plans/PERSONAL_EMAIL_SCHEDULED_GRANTEE_DEFAULTS_PLAN_2026-10-25.md` in full, plus the initial review at `docs/audits/SCHEDULED_GRANTEE_DEFAULTS_PLAN_CLAUDE_REVIEW_2026-10-25.md`.

**Limits of this review:** I used only Read, Grep and Glob, plus one advisor consult inside this session. I edited no files, including the plan-mode scratch file, because the user said not to edit any files. I ran no shell commands, tests, gates or live operations. I read no secrets and launched no subagents. Live preference rows, live Admin copy, live ledger state and how the real Next.js router behaves are **UNKNOWN**. Every "current" claim below comes from reading source at this commit. Everything marked "proposed" is plan intent. All recommendations are **untested**. This verdict does not authorize implementation or release.

## Verified current behavior that matters for §5

**Claim and delivery**
- **One function does all sending.** Cron due-send (`grantee-deliverable-reminders-service.js:255-258`) and manual Send now (`pages/api/scheduled-emails/[id].js:106-112`) both call `deliverScheduledEmail`. So a guard placed inside it covers both. [VERIFIED]
- **The claim skips rows that already have send intent.** The ordinary claim requires `send_requested_at IS NULL` (`scheduled-email-store.js:301`). Rows with intent only reach the read-only lanes (`scheduled-email-service.js:626-645`, `:667-682`), which never call `sendEmail`. [VERIFIED]
- **The claim wipes the error code.** It sets `last_error_code = NULL` (`store:290`), so any persisted hold reason is erased on every claim and must be written again. [VERIFIED]
- **What `force` bypasses.** It skips the schedule and approval checks (`store:297-300`). For manual sends, the claim is filtered to the stored PD (`store:294`). [VERIFIED]

**Order of operations inside `deliverScheduledEmail`**
- claim (`:484`)
- source eligibility (`:489`)
- **Part B recipient/posture reconcile (`:498-505`), which writes**
- activity read or correlation lookup (`:520-522`)
- mint and create (`:524-556`)
- persist a recovered ID (`:557-559`)
- second eligibility check (`:563`)
- `recordSendRequested` (`:567`)
- `sendEmail` (`:570`)

[VERIFIED]

**What Part B can change.** `reconcileScheduledEmailRecipients` can bump `version` and `recipient_generation`, rewrite Cc, null `approved_at`, and set a hold-for-approval code (`store:418-454`). It does this using the posture of the **stored** PD (`service:236`). [VERIFIED]

**The catch path.** Failures before intent are persisted with `error?.code || 'scheduled_email_send_failed'`, and a persistence failure is swallowed (`service:605-610`). [VERIFIED]

**Due queue.** It orders by `scheduled_send_at ASC` with a limit of 100, and excludes only MISSING/FORBIDDEN (`store:103-117`). The A3 parity test asserts that **every** attention reason is excluded from the due queue (`tests/integration/scheduled-email-engine.pg.test.js:323-339`). The store header says the same (`store:96-101`). [VERIFIED]

**Visibility.** The inbox list and the digest are both keyed on the **stored** `pd_systemuser_id` (`store:82-93`; `service:707-741`). The digest's "Needs attention" note is written for transport problems only (`service:806`). [VERIFIED]

**Stop is terminal for that deliverable.** `createOrGet` returns the existing stopped row (`store:53-61`), and reassignment requires `status IN (scheduled,failed,sending)` (`store:648`). [VERIFIED]

**Handoff abandons orphan drafts by design.** A handoff increments the generation so a draft a crashed worker left under the old correlation key is never adopted (`store:601-615`; `service:97-107`). `sendEmail` is only ever called after intent has been persisted (`service:567-570`). [VERIFIED]

**The producer skips more than broken defaults.** It also skips handoff for:
- a disabled or missing PD (`cron:132-141,386-392`)
- PI or Liaison read failures (`:374-383`)
- review posture failures (`:414-418`)
- signature failures (`:420-477`)
- rows deferred by a capped scan (`:31-32`)

[VERIFIED]

**Action gating.** The shared helper allows only Stop on attention rows (`shared/utils/scheduled-email-attention.js:58-73`). The route (`[id].js:62-75`) and the page (`pages/scheduled-emails.js:245`) both read it. In the route, an outcome with no `message` is answered with 409 "changed" (`[id].js:113-115`). [VERIFIED]

## Closure of N1–N7

| Item | Status | Evidence / gap |
|---|---|---|
| N1 persistent handoff deferral | **Mostly closed.** The owner decision is recorded (§9). A delivery guard is added (§5.1). The new per-PD reason and grouping are specified (§5). | Remaining gaps are F1–F8 below. The cron header text "narrow accepted race, self-healed next run" (`cron:29-32`) is still not listed for update (F9). |
| N2 grammar/aliases | **Closed, with one detail to settle.** §3 rejects exactly the four strings the renderer substitutes (`grantee-invite-email.js:101-109`). Case-variant brackets like `[name]` aren't substituted (`email-placeholders.js:10` is case-sensitive), so letting them through as literal text is correct. Legacy aliases still work for shared copy (§3, §5). | The plan should say explicitly that the body allows `{`/`}` **only** inside exactly `{{token}}`: no inner whitespace (`{{ granteeName }}`), no case variants, no single braces. "Unmatched or extra brace delimiters" is open to interpretation (F11). |
| N3 shallow routing/loading | **Closed.** §6 exempts same-pathname shallow query changes (`pages/scheduled-emails.js:191`), keeps edits mounted for the same actor while identity loads, and handles cancelled navigation. §7.6 requires a real-router selection/URL/no-prompt test. | Advisory: the `beforePopState` branch (`useDistributionUnsavedChanges.js:32-38`) needs the same pathname exemption so behavior stays consistent. Selection uses `replace`, so the risk is low. |
| N4 exact owner auth | **Closed.** §4 refuses bypassed and applicant sessions explicitly after bare `requireAuth` (`auth.js:154-157,179`), requires a GUID actor and a profile, does the mapping inside DAL with a sanitized 503 (the map throws at `dataverse-identity-map.js:68-70`), and compares the GUID case-insensitively. That blocks the 6→5 remap (`:25,61-78`). | Bare `requireAuth` is the right base: `requireAuthWithProfile` accepts a `profileId` from the query or body under a non-production bypass (`auth.js:231-241`). Worth stating that reason in the plan. |
| N5 prefill | **Closed** (§4, §6). | — |
| N6 discriminating tests | **Partially closed.** The blocked-promise, foreign-row and structural "no send-time read" items are present (§7.2, §7.4, §7.5). | The four-worker test still has no signal that all four workers actually reached the lookup (F10). |
| N7 counter | **Closed** (§5). | — |

## Findings on the new delivery hold (§5.1–§5.3)

**Answer to the core question.** Yes: as designed, the hold stops the former PD's frozen message from being newly sent while the incoming PD's defaults keep failing. The guard sits inside the single delivery function and covers both cron and forced sends. `force` cannot bypass it. Unconfirmed sends are not reopened, because the claim still refuses rows with intent (`store:301`) and the hold never touches `send_requested_at`. §5.1's last paragraph states the race between the last PD read and intent honestly. I found no wording elsewhere that claims atomicity. One spot to tighten: "closes persistent known-mismatch" (§5.1) is fine as long as tests also cover a PD that changes **after** the recheck (that send is expected; see F2).

The approach holds up against the source, but the following coherence gaps need to be written into the plan.

**F1 — MEDIUM — The guard must run before Part B, not just before minting.**
- §5.1 says "after the existing send lease and source-eligibility checks, but before token minting, activity creation or sending". Part B (`service:498-505`) sits inside that window, and it writes.
- If the guard runs after Part B, a mismatched row can be readdressed and lose its approval under the **former** PD's posture (`store:434-443`; `service:236`). That contradicts step 3 ("recipients/…/approval/…/generation remain untouched").
- Or Part B returns `approvalPending` (`:502`) before the guard runs. The route then shows recipients-changed copy (`[id].js:116-124`), and the digest lists the row as "Waiting on your approval" instead of held.
- **Required:** put the first ownership read immediately after `sourceStillEligible` (`:489`) and before `reconcileRecipientsBeforeSend`. Add a test that a mismatched row with Liaison drift or tightened posture is held with recipients, approval and generation byte-identical.

**F2 — MEDIUM — Don't persist an unaccepted activity recovered by correlation on a mismatch.**
- §5.1 step 2 says a recovered unaccepted activity ID "must be persisted… so producer reassignment cannot treat it as pristine."
- At the source, that reasoning doesn't hold:
  - A row with no stored ID only reaches correlation lookup if `sendEmail` was never called for it, because intent is persisted first (`:567-570`).
  - The existing A5 design abandons exactly these drafts through the generation bump at handoff (`store:607-610`; `service:97-107`).
- Persisting the ID makes `dynamics_email_id` non-null. Handoff then refuses the row permanently (`store:649`), and a pristine, repairable row becomes F4's terminal case. The advisor read this persistence as intended. I disagree, based on the intent-before-send ordering just cited.
- **Recommendation (untested):** on a mismatch, persist a correlation-recovered ID **only if it is accepted** (then record it as sent). Leave an unaccepted draft unpersisted so the existing handoff discards it. Record the tradeoff: an unsent Dynamics draft from the former PD can linger, which is today's A5 behavior.
- A separate unavoidable case remains. If the mismatch is caught at the **recheck before intent**, the activity was just created and persisted (`:539-556`). That row cannot be rebuilt. State this as a consequence of the bounded race.

**F3 — MEDIUM — Held rows break a pinned invariant and can take all the due slots.**
- §5.2 keeps held rows eligible for the due queue while also making `pd_handoff_held` an attention reason. That contradicts the A3 parity test (`engine.pg.test.js:333-336`: every attention row is excluded from due) and the store and attention headers (`store:96-101`; `attention.js:1-11,58`).
- The due query orders by `scheduled_send_at ASC LIMIT 100` (`store:113-114`). Persistent held rows are always the oldest, so they come first in every run. With 100 or more held rows (a departing PD with broken successor defaults, or a disabled successor), they take every slot and starve fresh sends. That's the starvation A7 was written to prevent for MISSING/FORBIDDEN.
- **Required:**
  - Name the invariant split explicitly: transport attention means stop-only and not due; ownership-held means due-eligible.
  - Update the headers and retitle the parity test.
  - Bound held rows in the due queue. The smallest change is to sort held rows after ordinary due rows, for example `ORDER BY (last_error_code = held) , scheduled_send_at`. That is a store query change, so §2/§8's "no ledger query change" wording must be updated.
  - Add a test with 100+ held rows plus one ordinary due row: the ordinary row is still claimed.

**F4 — MEDIUM (owner-visible) — Who can repair, and the terminal Stop.**
- The held row is visible only to the **former** PD, in their inbox and digest (`store:82-93`; `service:710`), and they cannot repair it. The incoming PD, whose defaults are broken, gets no notice unless they open `/scheduled-emails` and see the paused editor (§6). §1 forbids new mail.
- The hold also fires for every reason the producer skips handoff, not only broken defaults: disabled or missing PD (`cron:386-392`), Liaison/PI/posture/signature failures, capped scans, and a request whose PD was cleared. In those cases, no one can fix it through defaults.
- For a held row with a saved activity, Stop is the only action. After Stop, no automatic reminder will ever exist for the new PD (`store:53-61,648`).
- **Required:**
  - The plan should enumerate every trigger for the hold.
  - The held copy should say the *current* PD or the request record must be fixed, not imply the viewer can.
  - The saved-activity guidance should say plainly that Stop ends automated reminders for that deliverable and the reminder must then be sent by hand. The existing MISSING copy at `attention.js:33` is precedent.
  - Present this to Justin as a known consequence of choosing hold. It is a scope consequence, not new scope.

**F5 — LOW-MEDIUM — Don't mislabel a read failure as a reassignment.**
- §5.1 treats a missing, unreadable or invalid current PD as "unknown ownership" and persists `PD_HANDOFF_HELD`.
- A transient Dataverse outage would then mark every due row "Held — PD reassignment needs repair" in that run's digest and inbox, and Send now would return 409 "held" instead of 502 retryable.
- **Recommendation (untested):** keep the no-send behavior for every unknown, but only persist `PD_HANDOFF_HELD` for a confirmed mismatch or a confirmed empty PD. For a read failure, throw a retryable coded error through the existing failure path. It still doesn't send, and the copy stays truthful.

**F6 — LOW — Keep the hold reason when its own write fails.**
- A thrown hold write falls into `service:605-610`, which writes again with `error?.code || 'scheduled_email_send_failed'` and swallows the failure.
- **Required:** set `error.code = PD_HANDOFF_HELD` on that path, and don't swallow the error in the held branch. §5.1 already requires "return no success".
- Also state the double-failure state: the claim cleared the code (`store:290`), so the row sits in `sending` with no reason until the lease expires. It still doesn't send.

**F7 — LOW — The result shape collides with the route.**
- §5.1 step 4 returns `{held:true, reason, message}` where `message` is copy text. Every other outcome uses `message` for the projected DTO, and the route answers a missing DTO with "changed… Reload" (`[id].js:113-115`).
- **Required:** use a different key for the copy, for example `{held:true, reason, message: projectedRow, error: copy}`. The route checks `held` before the `!outcome.message` branch.

**F8 — LOW (simplification) — Retry versus edit/approve.**
- §5.2 disables edit and approve but allows a forced Retry. So a held, unapproved row whose PD returned can only be force-sent as-is or Stopped; the former PD cannot edit it first. That is coherent and deliberate, and the plan says so (§5.2; §7.7).
- Simpler alternative (untested): treat `pd_handoff_held` as display-only in `scheduledEmailActionsAllowed`, so edit/approve/send keep the normal A4 activity rules. The delivery guard is the real authority either way.
- Whichever you choose, the edit must be made in the helper (`attention.js:58-73`) so the route and page stay in sync.

**F9 — LOW — Durable text that must change with §5.**
- Not yet listed in §8:
  - cron header `:26-32` ("narrow accepted race, self-healed")
  - store `:611-612` ("A transport-started row deliberately stays under the former PD until it resolves")
  - service B5 comment `:506-508`
  - attention header `:58` ("only Stop remains on attention rows")
  - route comment `[id].js:58-61`
  - digest Needs-attention note `service:806`, which currently says only "send status… could not be confirmed"

## Other findings

**F10 — LOW — The four-worker test needs an arrival signal.**
- "Assert before releasing" works with a promise cache. But without proof that all four workers reached the lookup, a value cache passes too.
- **Required:** wait on an upstream per-row mock (for example, the fourth `getById` resolved), flush microtasks, then assert exactly one reader call while it is still blocked.

**F11 — LOW — Pin the body grammar** as described in the N2 row above. Also note an existing hazard, unchanged by this plan: sequential substitution (`email-placeholders.js:8-11`) can substitute a proposal title containing `[Name]` or `{{dueDate}}` a second time. This affects shared copy today and is not a regression.

**Scope check:** no new tables, columns, statuses, mail or counters. The scope does grow in three places: the store query ordering (F3), the attention vocabulary split, and the Retry exception. All three trace back to the owner's choice and are bounded. I found no loophole that lets the former PD send while ownership differs.

## Recommendation evidence

| Recommendation | Current prerequisite | Available where it runs | Evidence tested | Disconfirming check | Status |
|---|---|---|---|---|---|
| F1 guard before Part B | Part B writes at `service:498-505`, `store:418-454` | Yes: request ID is on the claimed row | NOT TESTED | If Part B only read, F1 would drop to cosmetic. It writes `approved_at=NULL` (`store:435`) | VERIFIED trace |
| F2 don't persist an unaccepted correlation hit on mismatch | intent before `sendEmail` `:567-570`; A5 generation bump `store:633` | Yes | NOT TESTED | A path that calls `sendEmail` without persisting intent would make persistence necessary. None exists in `deliverScheduledEmail` | VERIFIED trace / disagrees with advisor |
| F3 bound held rows in due | `store:113-114`; parity test `:323-339` | Yes, in SQL | NOT TESTED | If held rows were excluded from due, F3 would be moot, but §5.2 forbids that | VERIFIED |
| F4 who repairs / terminal Stop | `store:53-61,82-93,648`; producer skips `cron:374-418` | N/A (copy/owner) | NOT TESTED | — | VERIFIED |
| F5 read failure ≠ held | `cron:132-141` read collapse; route mapping `[id].js:127-136` | Yes | NOT TESTED | — | ASSUMED (UX judgment) |
| F6 keep code on catch | `service:605-610`, `store:290` | Yes | NOT TESTED | — | VERIFIED |
| F7 result key | `[id].js:113-115` | Yes | NOT TESTED | — | VERIFIED |

## Seven-audit summary (Mode A)

1. **Whole-flow:** editor → strict route → exact-key preference; cron → render → ledger → guarded delivery → hold → digest/inbox → Retry/Stop. All hops traced. Gaps: F1 (ordering), F4 (repair visibility).
2. **Partial success:**
   - Save/Clear readback contract is sound.
   - The hold write is lease-fenced (`store:530-546`), but the catch path needs F6.
   - A late mismatch leaves a persisted activity (F2).
3. **Async/stale state:**
   - The last-read race is honestly bounded.
   - The claim wiping the code (`store:290`) makes a crashed hold briefly reason-less. It still doesn't send.
   - The UI generation guards are well specified.
   - F10 is about test strength.
4. **Helper semantics:**
   - The attention helper's single-predicate role is kept, but its stop-only rule and the due-exclusion parity both change meaning (F3, F8). Name that change in the helper header.
   - No renderer extraction, which is correct.
5. **Durable surfaces:**
   - No schema change. One store error constant, the shared reason map, the digest copy, the due ordering (F3) and the F9 comments.
   - Route matrix, both generic guard sets, Atlas and catalog are already listed.
6. **Doc reconcile:** the September inventory stays historical, which is fine. The cron/store/service headers must change with the code (F9).
7. **Symbol fan-out for `PD_HANDOFF_HELD` / `pd_handoff_held`:**
   - store constant; `CODE_TO_REASON` and copy
   - `scheduledEmailActionsAllowed`; route guard; page label
   - digest grouping (`service:732`) and note
   - due query (F3); A3 parity test; projection (`service:384-385`)
   - The reconciliation candidate SQL (`store:132-138`) won't pick held rows unless they're FORBIDDEN, which is correct. Assert that in the parity test.

## Final verdict

**READY WITH NAMED CHANGES**

**Required:** F1, F2 (or an explicit owner acceptance of the permanent dead-end after record), F3, F4 (copy plus disclosure to Justin), F6, F7, F9, F10.
**Advisory:** F5, F8, F11, N3 `beforePopState` consistency.

This verdict covers only the plan at `69a2bd8389ed012e5c020e0fd94a8140174e58cb`, based on a read-only source trace. It does not authorize implementation or release.
