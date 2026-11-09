# Task brief: J27 Initial Assessment scenarios for the Test Request Factory

From: Claude Fable 5.1 on behalf of Justin Gallivan. Date: 2026-11-08.
This file is untracked. Move it to `docs/plans/` and commit it if you want it as the plan record; otherwise leave it.

## Where you are

You are in `/Users/gallivan/Code/WMKF_Apps-codex-j27-factory` on branch `codex/j27-factory-scenarios`, cut from `origin/main` at `53066edc1`. Run `/start` first (note: HEAD is intentionally not `main`; stay on this branch). Another agent is working in the main checkout and in `/private/tmp/wmkf-j27-workbench-reports`. Do not check out other branches, do not touch those directories, do not push to `main`.

## Goal

Extend the Test Request Factory so it can create synthetic J27 Research requests in the **sandbox** Dataverse that land at each point of the J27 Initial Assessment flow, with the flags set so the redesigned Workbench can use them as fixtures. Today the three rehearsal fixtures (#1000369, #1000370, #1000372) were set up by hand outside the Factory and are visible only because the legacy Advancing triage value was set. We need Factory-produced rows that need no hand edits and never use Advancing.

## Owner decisions that shape this work (recorded 2026-11-08)

- J27 Workbench discovery will be readiness-only: linked cycle J27, program in scope, `wmkf_readyforreview = true`. The legacy `wmkf_triagestatus` Advancing value is not part of J27 admission. **Never set `wmkf_triagestatus` on these rows.**
- Phase I mapping, confirmed by the owner: First Cut Yes/No writes Scored (100000004) / Not Scored (100000005); Semi-finalist Yes/No writes Recommended Invite (707510005) / Recommended Do Not Invite (707510006); after the Chairs approve, the Grants Manager sets Invited (100000003) plus request status `Phase II Pending`. The app never writes Invited, Not Invited, or request status.
- Reviewer identification has no gate. Reviewer invitations require Phase I Invited plus request status `Phase II Pending`.
- The offramp representation is still open with Connor and Sarah. Do not invent a stopped status.

## Scenarios to produce

One Factory-created request per scenario, each with a legible synthetic title, institution, and PI so Workbench rows read sensibly. Prefix titles with `TEST:` as the existing fixtures do.

| # | Scenario | Phase I value | Readiness | Other |
|---|---|---|---|---|
| 1 | Intake, nothing recorded | unset (or Pending Committee Review, whichever the Factory's clone leaves; document which) | true | |
| 2 | Rationale saved, no First Cut | unset | true | `wmkf_initialassessmentrationale` populated with synthetic text |
| 3 | First Cut Not Scored | Not Scored | true | rationale populated |
| 4 | First Cut Scored, Semi-finalist unset | Scored | true | rationale populated |
| 5 | Semi-finalist No | Recommended Do Not Invite | true | rationale populated |
| 6 | Semi-finalist Yes, no reviewers | Recommended Invite | true | rationale populated |
| 7 | Chairs approved, slate ready | Invited, plus derived request status `Phase II Pending` via the existing status setter | true | rationale populated; 2 or 3 reviewer suggestion rows on the roster, not invited |
| 8 | Unready control | unset | **false** | must stay invisible to J27 discovery |

If a scenario cannot be produced through the existing guarded contracts without a new write path, stop and report which contract blocks it rather than bypassing a guard.

## Where to look first

- `docs/plans/J27_TEST_REQUEST_FACTORY_FINISH_PLAN_2026-11-02.md` and `docs/TEST_REQUEST_FACTORY_FORM_RUNBOOK.md` (especially "Prepared J27 reviewer fixtures" and "Repeatable prepared-fixture rehearsal"). These describe the Production prepared-reviewer path. This task is sandbox only.
- `lib/services/test-requests/` — `status-change-runner.js` and `status-transitions.js` (allowed Phase I transitions; you will likely need to extend the allowlist for Scored, Not Scored, Recommended Invite, Recommended Do Not Invite as sandbox targets), `readiness-finalizer.js`, `sandbox-clone.js`, `prepared-fixture-contract.js`, `fixtures/initial-assessment-synthetic.js`, `run-ledger.js`.
- `shared/config/testRequestFactory.js`, `shared/config/requestReadiness.js`, `shared/config/j27FirstCut.js`.
- `lib/services/workbench/initial-assessment-rationale-service.js` for the rationale memo contract (J27 linked cycle, ETag, actor). The memo field `wmkf_initialassessmentrationale` exists in sandbox via schema wave 40 on the `codex/j27-workbench-reports` branch; confirm whether it is provisioned in the sandbox you target before relying on it, and if the wave is not on `main`, say so and set the memo only where the field exists.
- `scripts/rehearse-test-request-sandbox.mjs` for the CLI shape.
- `docs/atlas/postgres-test-request-runs.md` and `docs/atlas/dataverse-akoya-request.md` for ledger and field facts.

## Guardrails

- Sandbox target only. No Production reads or writes. Do not add or widen any production write fence.
- Keep the Dataverse target interlock and DAL enforcement on. Every write goes through existing adapters inside a trusted DAL context.
- Derive every field name and option value from source or the Atlas. Do not fabricate identifiers or option values.
- No email, no screening, no AI generation, no workflow dispatch. Test isolation must keep the rows out of reminders and ordinary automation.
- Do not modify shared Workbench components or the visibility predicate; that is the other agent's surface. Your surface is `lib/services/test-requests/`, `scripts/rehearse-test-request-sandbox.mjs` or a sibling script, `shared/config/testRequestFactory.js`, the Factory tests under `tests/unit/`, and the two Factory docs above plus the Atlas pages you touch.
- Record every scenario run in the Factory ledger as the existing contract requires. If a scenario needs a new ledger column or state, that is a migration under `ledger:apply` rules; propose it and stop before applying.
- Run the gates for the surfaces you changed, sequentially, each with its self-test: at minimum `check:atlas`, `check:api-routes` if any route changes, `check:dataverse-access-layer`, `check:dynamics-context-boundary`, `check:route-service-boundary`, `check:status-enum-parity`, `check:factory-ledger`, `check:types`, plus the Factory unit tests.
- Commit with descriptive messages and push the branch: `git push -u origin codex/j27-factory-scenarios`. Do not merge.

## Deliverable

1. Working scenario creation for the eight rows above, runnable from the CLI against sandbox with a dry-run preview and an explicit confirm.
2. Unit tests covering the new transitions and the readiness outcomes.
3. A short section added to the Factory runbook describing the J27 Initial Assessment scenarios and how to run them.
4. A closing report in your final message: what was built, what was verified by running it against sandbox (or that it was not run and why), which guards or contracts blocked anything, exact commits, and the branch push confirmation. Label state claims as verified or assumed.

Do not run the scenarios against sandbox until the preview passes and you have reported the preview. Creating the rows is authorized for sandbox once the preview is clean; say in the report exactly which request numbers were created.
