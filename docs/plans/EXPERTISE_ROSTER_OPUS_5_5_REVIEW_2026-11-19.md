# Expertise roster plan — Claude Opus 5.5 adversarial review

Date: November 19, 2026. Scope: documentation review only, before any build.

- Reviewed draft: `EXPERTISE_ROSTER_PRODUCTION_MIGRATION_PLAN_2026-11-19.md`.
- Draft SHA-256: `f8b08a1b2694f548659d9dce503d41c21a344017ae70708f34934cf30ad37535`.
- Model requested and returned in CLI `modelUsage`: `claude-opus-5-5`.
- Host authentication: `claude auth status` reported `authMethod: claude.ai` and
  `loggedIn: true`; API-key/provider override variables were removed from the process.
- Ordinary Claude Code review, explicitly owner-authorized OAuth. No Ultrareview,
  direct API-key usage, implementation, live probes, or production writes.
- CLI result: success, `is_error: false`, zero permission denials.
- Review line numbers refer to the initial draft, not the revised plan.

## Author disposition after checking findings against source

Verdict from reviewer: **READY WITH CHANGES**. The revised plan incorporates the
required changes below. This is author adjudication, not a second Opus approval.

| Finding | Disposition |
|---|---|
| R1: editor behavior before switch / rollback | Accepted. Explicit Postgres and Dataverse modes; original editor retained as guarded recovery path; first binding freezes legacy writes during import. |
| R2: rollback loses overrides / switches too soon | Accepted. Manual full affected-ID comparison against expected import plus later edits, before FK restore and backend switch; clear marker last. Did not choose to mutate the source before export. |
| R3: missing single-match DAL context | Accepted after reading route and restriction guard. Named context change and real-context route test with mocked transports, without a paid model run. |
| R4: changed identities invalidate saved attendees | Accepted. Pre-switch inventory includes feedback, Site Visit/meeting maps and proposal provenance; explicit selection repair and override-aware acceptance. |
| R5: migration sequencing and dotenv runner | Accepted after reading runner. Empty bridge first; separate guarded FK migration only at switch; pending-file inspection, explicit production configuration from env-file-free cwd, inverse SQL, fresh-install parity. |
| R6: direct writes through Connor's connection | Accepted. Inspect effective permissions and require read-only table access for the flow; resolve broader inherited grants before handoff. |
| Outage vs excluded author | Accepted. Preserve explicit unavailable read state, including external briefing; do not label every author as deliberately excluded. |
| Actor attribution / existing maintainers | Accepted. Resolve trusted session's Dataverse actor; no privileged fallback. Check maintainers' Admin access without automatically granting superuser. |
| Old GET exposes Admin data | Accepted in Dataverse mode. Retain legacy GET only for Postgres-mode recovery; after switch return moved response, with matching reading the shared service directly. |
| Contact uniqueness | Accepted clarification: all-profile uniqueness in the reused Dataverse schema, readable conflict and explicit unlink before reassignment. |
| Lead eligibility vs current matching | Accepted clarification: stored for later automation; existing standalone matcher remains role-based in this release. |
| Source/export comparison | Accepted in the cutover comparison. |
| Bridge described as existing | Corrected to parked-branch implementation, not main or production. |
| Rehearsal/replay reuse | Excluded from the bounded implementation. |
| ID 35 on shared briefing | Included in reference/visibility inventory and acceptance. |

Verification: source inspection only; no implementation exists for these plan changes.
The source confirms the route-context, migration-runner, strict recipient resolution,
and briefing-unavailable behaviors cited above. Current production state remains
an execution-time check. No concurrency or sandbox subsystem was added.

## Verbatim reviewer output

I'm Claude Opus 5.5 (`claude-opus-5-5`). I reviewed in read-only mode against main `90ae93864`, using Read/Grep and read-only git commands, plus `git show` on the parked branch. I wrote no files and ran no tests. I did not call the advisor tool because you ruled out other model calls.

# Review: Expertise roster production migration plan

## Verdict: READY WITH CHANGES

The basic approach holds up: Dataverse as the store, Admin as the editor, the numeric bridge for existing IDs, one operator, and no concurrency machinery. Nothing requires reworking the plan. However, R1–R3 should block the production cutover until the plan text fixes them. R4–R6 are required but smaller. The fixes are plan or runbook wording, not new subsystems.

## Required changes (priority order)

**R1 — The plan doesn't say what the editor does while the setting is still Postgres, so rollback can leave no editor at all.**
- Plan lines 26–27 turn the old Roster tab into a link to Admin. Line 130 sets the setting and redeploys. Lines 159–165 roll back by setting it back to Postgres.
- Nothing says how the Admin editor or the old tab behave between deploy (step 2) and switch (step 5), or after a rollback.
- **Scenario:** step 2 ships the link. Admin is either useless or edits the wrong store. After rollback, the "known-good path" is the new code in Postgres mode, which has no working editor.
- **Fix:** tie both surfaces to the `EXPERTISE_ROSTER_BACKEND` setting.
  - Postgres mode: today's Expertise Finder editor, with writes guarded by the cutover marker. The Admin view says it becomes available at cutover.
  - Dataverse mode: the Admin editor, the tab becomes a link, and legacy writes return 409.
- Also state that the first binding row written by the importer freezes legacy writes (parked `roster-cutover-marker.cjs`). That freeze is intended between import and switch.

**R2 — Rollback brings back the pre-import roster, undoing the owner's decisions, and runs in the wrong order.**
- Lines 160–161 only copy "post-cutover additions/changes" back to Postgres. But the import itself changes the roster:
  - ID 1 (John E. Sader) moves from Consultant to Research Program Staff.
  - ID 13 (Kevin) becomes inactive.
  - ID 35 is excluded.
  - Amy Rowat is added.
- **Scenario:** after rollback, ID 35 "TBD specialist" is an active, selectable consultant again (current check at `consultant-feedback-service.js:396-411`), and Kevin is active.
- The order is also wrong: flip the setting first, then copy. Until the copy finishes, Postgres-mode readers miss post-cutover IDs and changes.
- **Fix (simplest):** before the export, apply the overrides Postgres can express (ID 35 and Kevin inactive, John's category change). The import then needs no override bookkeeping except Amy and the User links, and rollback stays consistent.
- **Otherwise:** make rollback a full field comparison, Dataverse to Postgres, for every bound ID.
- **Rollback order:** reconcile into Postgres → restore the feedback foreign key → flip the setting and redeploy → remove the marker.

**R3 — The single-match route would fail in Dataverse mode, and the plan wouldn't catch it.**
- On main, `pages/api/expertise-finder/match.js` has no `withDalContext` (lines 40–81 read the roster directly with SQL).
- A Dataverse read without that context fails: `lib/services/dynamics/restrictions.js:43-46` throws "Restrictions not initialized".
- Batch matching does set up the context.
- Line 133 rules out paid matching runs, and line 134 relies on fixture tests. Fixtures that mock the adapter won't catch a missing context.
- **Fix:** list "wrap match.js in `withDalContext`" as a named change. Add a route-level test that uses the real context helper and only mocks HTTP, or an acceptance check that builds the roster block without calling Claude.

**R4 — The owner overrides change how existing saved references resolve, but acceptance says they resolve the same.**
- The directory only includes Board and Consultant rows (`recipient-directory-service.js:31`).
- Any saved roster reference that doesn't resolve throws a 409 (`recipient-directory-service.js:176-182`). Site Visit saves re-resolve every saved attendee (`logistics-service.js:268-275`). The meeting tracker is lenient: it reports issues but doesn't fail (`attendee-service.js:108-143`).
- After cutover, IDs 1, 13 and 35 drop out of the directory, so a saved Site Visit that includes them fails to re-save.
- Step 4 (line 126) only checks feedback references. Line 144 says recipients "resolve the same numeric identities".
- **Fix:** before the switch, list the stored references to IDs 1, 13 and 35 in:
  - the Site Visit identity map in Dataverse (`wmkf_sitevisit_logistics`)
  - meeting attendee maps
  - proposal-list provenance (`expertise_roster:N`)
  - feedback

  Record the expected changes and reword line 144 to "same identities, except the owner overrides".

**R5 — How and when the feedback foreign key is retargeted isn't specified, and the migration runner doesn't fit the plan's assumptions.**
- `scripts/apply-migrations.js:118-137` applies every untracked migration in order. Lines 32–46 load `.env` and `.env.local` from the current directory. There is no check on which database it targets.
- If the foreign-key change is a migration file in the step 2 deploy, it gets applied at step 2, before any IDs exist in the bridge.
- Running the script from the main checkout loads `.env.local`, which conflicts with plan line 46.
- **Fix:**
  - Make the foreign-key change its own migration, committed and applied only at step 5. Inside the SQL, refuse (raise an error) if any `consultant_roster_id` is missing from `expertise_roster_identity`.
  - Put the inverse SQL in the rollback runbook.
  - Say how the runner is pointed at production: explicit environment, run from a directory with no `.env` files.
  - Check the list of pending migrations before running.
  - Update `setup-database.js` (line 1123 still references `expertise_roster(id)`) so fresh installs match production.

**R6 — "Connor only reads" is assumed, not enforced.**
- Lines 77–79 rely on Connor's connection being read-only.
- The parked `roster-binding.js` refuses to bind any profile whose creation key isn't `app_`. So a profile created directly in Dynamics stays unbound for good: consumers skip it and the Admin editor can't fix it.
- Direct edits would also skip the app's checks (lead-eligibility rules, Contact uniqueness).
- **Fix:** give his connection read-only access to `wmkf_expertiseprofile` and verify that in step 6. Otherwise, document the repair path.

## Smaller required clarifications

- **Hiding a Dataverse read failure:** the parked `hydrateFeedbackAuthors` catches read errors and labels every author "Unavailable consultant". That's the same label used on purpose for ID 35, and it contradicts plan lines 100–101. It also shows up on the external board briefing (`consultant-feedback-service.js:739-799`). That function already has an `unavailable` status, so a failed read should return that instead of relabeling everyone.
- **Who the edit is attributed to:**
  - `requireSuperuser` returns only `{ profileId }`, or `{ profileId: null }` when auth isn't required (`lib/utils/auth.js:461-476`).
  - Dataverse writes made as the user need that user's Dataverse system-user ID from the session. The Admin route has to look that up and refuse if it's missing.
  - Also confirm that today's roster editors (anyone with an Expertise Finder grant, `roster.js:98`) are superusers. Otherwise the change quietly takes editing away from them.
- **Old read route:** after cutover, `GET /api/expertise-finder/roster` still works for anyone with the Expertise Finder grant. The parked `listRoster` also returns every enabled system user's email. Retire the GET along with the tab, not just the write methods.

## Optional suggestions

- **Contact uniqueness changes:**
  - In Postgres, a Contact can be linked to only one active row (`050_expertise_roster_contact_link.sql:12-14`).
  - The parked Dataverse key on `wmkf_contactguid` applies to inactive profiles too, so a deactivated profile keeps the Contact reserved.
  - The parked `validateLinks` doesn't check for conflicts, so a key violation surfaces as a generic error.
  - Either state the new rule or map the error to today's 409 message.
- **Lead eligibility has no effect on matching in this release.** `buildRosterContext` presents everyone in Research Program Staff as "eligible for primary/secondary PD assignment", including Beth, who isn't lead-eligible. Say the flag is stored only for now. Also reword line 134 to "parity except the owner overrides", since the overrides change the matching input on purpose.
- **Cheap data-loss check:** in step 4, compare against live Postgres as well as the saved export.
- **Wording:** line 62 calls the bridge "existing". It exists only on the parked branch; main's migration list skips from 099 to 101.
- **Trim what you reuse:** when taking the parked feedback-service changes, leave out the rehearsal and replay code (`findCompletedFeedback`, the lifecycle lease).
- **ID 35 on the board briefing:** if feedback row 1 (ID 35) is shared, the board will see "Unavailable consultant" there. Check before cutover.

## Brief assessment by area

- **Whole flow:** the order (provision → import → compare → switch) is right, apart from what editors and migrations do during the step 2–5 window (R1, R5).
- **Partial success:** stable creation keys plus resume handle partial imports. Freezing legacy writes at the first binding is acceptable but should be stated (R1).
- **Identity:** the numeric bridge keeps feedback and saved recipient IDs intact, including ID 35 with no profile. The gaps are the override side effects (R4) and profiles created directly in Dynamics (R6).
- **Authorization:** superuser-only on the server plus no write path that needs only an app grant is sound. The attribution plumbing and the old GET route need to be spelled out.
- **Rollback:** not correct as written (R2): wrong order, and it undoes the owner overrides. It is fixable without automated reconciliation.
- **Complexity:** the plan stays within the owner's scope. I'm not asking for any concurrency or synchronization work.

No implementation was tested.
