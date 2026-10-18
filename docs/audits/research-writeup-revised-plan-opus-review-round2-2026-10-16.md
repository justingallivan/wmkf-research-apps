# Research writeup plan — second Opus review

Date: 2026-10-16. Requested model opus through authenticated subscription CLI; runtime models claude-opus-5-5 and auxiliary claude-fable-5-1. Reviewed owner-confirmed plan before implementation. Reviewer edited only the requested SESSION_PROMPT.md handoff; plan/source review was read-only. No runtime edits or live probes.

## Disposition of findings

Verdict **READY WITH NAMED CHANGES**. Named changes incorporated in the [plan](../plans/RESEARCH_WRITEUP_RELEASE_AND_BOARD_ARCHIVE_PLAN_2026-10-16.md); bounded disposition edits have not had a third independent review. Implementation remains unstarted.

1. Accepted: documentation-only transport; never merge superseded feature branch. No cherry-pick/publication performed.
2. Accepted and strengthened: serialize release claims and archive start on cycle/program row; refuse start while release intent is unresolved; reject new release after start. This closes the in-flight race as well as later clicks.
3. Accepted: admin means enabled authenticated superuser; notification recipient grants no authority and is revalidated.
4. Accepted: scoped Grants Manager navigation and APIs require reviewers app access (superuser branch separately allowed), role assignment validates access, unrelated Admin remains restricted.
5. Accepted: CSO exception on shared viewing path; no expansion of change/regeneration rights; consumer tests required.
6. Accepted with clarification: unreleased expected members require release or explicit audited roster correction before closure; original counts/reasons remain visible. Beth reminders normally stop when all expected are released, not only via roster change as the review wording could imply.
7. Accepted: changed-file/needs-confirmation archive states alert as failures; no resumed daily confirmation requests.
8. Accepted: separate digest switch, preserve shared PD-mail allowlist.
9. Accepted: activity-level accepted-send receipt, To/cc snapshots, unresolved required recipients hold/alert, no cc promotion. No per-recipient delivery proof claimed.
10. Accepted: unique initial run and conditional start timestamp in the same locked transaction; repeated starts return the same run.

Evidence checked by parent: shared draft-visibility helper, auth superuser/app-access branches, Admin navigation, scoped facilitator-route pattern, Dynamics email To/cc construction, shared program allowlist dependencies. The new mechanisms are PLANNED, not tested implementations. Source paths in the reviewer output are abbreviated; auth.js means lib/utils/auth.js. Production schema/identities, full recipient list, real DOCX round-trip and future implementation acceptance remain preflight checks.

## Original reviewer result

I've added the handoff to the top of `SESSION_PROMPT.md` and finished the review. My verdict is **READY WITH NAMED CHANGES**: five gaps need a sentence or two in the plan before implementation starts, and none needs a redesign.

## Part 1 — Handoff edit (`SESSION_PROMPT.md` only)

- I read all 2,520 lines and added a new section at the top. Everything that was there before sits unchanged below a "Prior handoffs — preserved verbatim" line; the diff removes no lines. Nothing is committed.
- The new section covers:
  - the plan link and its planning-only status (implementation not started, nothing deployed);
  - all seven of your decisions, in short form;
  - your carry-forward reminder about the D26 dates, word for word;
  - that staff still need to confirm the 23 request identities, and that rules for future single-phase cycles are still open.
- I made one extra wording change after the review. The handoff now says not to merge `codex/sarah-board-writeups` into main, and to move the plan documents over by cherry-picking documentation-only commits (see finding 1).
- I ran no gates on the edit, since you asked for no tests.

## Part 2 — Review (Mode A)

**Prior review:** all eight of its fixes now appear in the plan (§5 lines 71–73, §6 line 83, §7 line 94, §10.2 line 133). I re-read the old service's on/off check at `board-copy-service.js:33-38`: it does require Production, the feature flag and a registered Production host, and the plan now says so accurately.

### Must be added to the plan before building

1. **Merging this branch would put the old build on main** (high). Commit `2a38dba86` adds the 15-minute schedule in `vercel.json`, the cron route, and migration 084 in the migrations manifest. The plan says not to port the old cron, but it never says how the plan documents reach main. A routine merge would deploy that schedule and use up number 084. The flag keeps the old service from copying anything, but the cron and dead code would still deploy. *Change:* say the documents land by cherry-pick only (`e0ae252db` touches only the three documentation files) and that the branch is never merged.

2. **Nothing stops a release after archiving has started** (medium). The release worker rechecks authority, destination, test status and the approved file (§6 step 2, line 85), but not whether archiving has begun. A release Beth makes after the start would fall outside the frozen file list, yet the completion email could still go out. *Change:* once archiving has started, a release is refused or held for a separately authorized correction (§8), and Beth's dashboard says so.

3. **"Authorized admin" is never defined** (medium). In this codebase, admin authority means the superuser role (`requireSuperuser`, `auth.js:447-462`), which skips every app-access check (`auth.js:367-369`). *Change:* state that admin authority means superuser. Also state that the configured admin who receives the email is a separate setting that grants no permissions, and say what happens when that person is no longer eligible.

4. **The Grants Manager has no way into Admin** (medium). The Admin link appears only for superusers (`Layout.js:115-116`), and the existing Admin pages call superuser-only APIs (for example `final-writeup-matrix-audiences.js:32`). There is a precedent for something narrower: `proposal-ranking-facilitator.js` combines an app-access check with a role check. *Change:* say which app access the Grants Manager's pages require, check that the assigned person has it when the role is assigned, and show those pages to superusers or the assigned Grants Manager only. The navigation must mirror the server checks.

5. **How Beth's early-draft access works is unspecified** (medium). Every surface that returns a draft file goes through `resolveWriteupViewer` / `canSeeDraftWriteup` (`writeup-visibility.js:41-74`). Separately, `canSeeDraftWriteup` relies on `canChangeDraftWriteup`, which also governs editing and regenerating drafts. *Change:* add Beth's exception as a viewing permission on the same path, failing closed like the coordinator check (`:47-57`). It must not widen `canChangeDraftWriteup`, and `tests/unit/pre-site-writeup-visibility.test.js` should cover it. Otherwise Beth would see a draft on the Board page but not in the Workbench.

### Smaller changes to fold in

6. **Expected vs. released.** Completion counts released files (lines 27, 63), but expected requests can outnumber them. The completion email should show released against expected and list the expected requests that were never released. It should also say that Beth's reminder ends only through an audited roster change (line 23). This isn't a new decision; the plan just needs to name the existing way out.
7. **Stuck archive files.** An archive file blocked by a later edit needs fresh confirmation (§8). Because confirmation reminders don't restart, that blocked state has to trigger the failure alert, or the run could sit silently.
8. **Turning off the old digest.** Its only current off switch is the program list it shares with the PD handoff email (`leadership-digest-service.js:80,382`; `handoff-email-service.js:123`). Clearing that list would also stop PD mail, which you decided to keep. The new switch must be a separate check inside the digest code.
9. **Delivery tracking for To and cc.** The email code already supports cc (`dynamics/email.js:175-212`). However, delivery is confirmed once for the whole email, not per recipient (`leadership-digest-service.js:57,114-116`), so the plan should promise one confirmed status per email, not per person. It should also say what happens when the To person can't be resolved: send nothing and raise an alert, rather than quietly promoting the cc.
10. **Two people starting the archive at once.** The plan's claim that this creates only one run has no mechanism behind it yet. Name one: either record the start only if none is recorded, or allow only one run per cycle and program.

### Checks for implementation time, not plan blockers

- Register every new route in the security matrix. The route-auth gate has no rule for superuser-only checks (`requireSuperuser` doesn't appear in `check-route-lifecycle-auth.js`), so routes that mix "superuser" with "superuser or Grants Manager" need a deliberate matrix entry and gate review.
- Whether migration 084 was applied anywhere, and the fact that main's next migration number is also 084.
- The full current Leadership recipient list.
- Whether a real Word file survives upload to SharePoint intact.
- How Beth's sign-in is matched to her Dynamics user for the release check.
- The Research program GUID, the 23 identities, and size limits on the new settings.

### Evidence summary

| Recommendation | Evidence | Status |
|---|---|---|
| Never merge the branch | `git show --stat 2a38dba86`; plan line 133 | VERIFIED |
| Block release after archive start | plan lines 85, 106–108 | VERIFIED as missing |
| Admin authority means superuser | `auth.js:367-369, 447-462` | VERIFIED |
| Grants Manager entry point | `Layout.js:115-116`; `proposal-ranking-facilitator.js:1,13` | VERIFIED |
| Draft exception on the shared viewing path | `writeup-visibility.js:41-74`; 12 files use it | VERIFIED; the test's coverage of all surfaces is NOT TESTED |
| Separate digest off switch | `leadership-digest-service.js:80,382`; `handoff-email-service.js:123` | VERIFIED |
| Delivery tracked per email | `dynamics/email.js:175-212`; `leadership-digest-service.js:114-116` | VERIFIED |

This was source and plan reading only. I didn't change runtime code, run tests or gates, touch the network or live data, commit, or use any paid review product.
