# Proposal Ranking v2 — bounded sandbox rehearsal receipt

Date: 2026-10-13. Branch source: `codex/proposal-ranking-v2` at `b6676e15e`, with the local sandbox rehearsal scripts. **Saved service-persona rehearsal and a bounded saved-browser walkthrough passed; independent-user acceptance remains open.**

## Target and setup

[VERIFIED via `apply-dataverse-schema.js --target=sandbox --wave=33-proposal-ranking-assessments --execute` and subsequent readiness metadata readback]
Additive wave33 fields `wmkf_workflowjson` (65,536) and `wmkf_assessmentjson`
(524,288) were applied to the registered sandbox `https://orgd9e66399.crm.dynamics.com`.
Beth Pruitt was saved and reread as that sandbox's default facilitator. Production
was untouched; deployed readiness flags were unchanged. This supersedes the earlier
same-day absent-fields/default-setting probe, not the dated Production v1 receipts.

## Saved rehearsal and retained records

[VERIFIED via `scripts/rehearse-proposal-ranking-sandbox.mjs`, its saved JSON receipt,
and the 13 PASS lines in the execution log] Six fictional D98 proposals and four
enabled sandbox identities (Beth Pruitt, Justin Gallivan, Rob Harrison, Jean Kim)
were exercised through trusted service personas and actual sandbox Dataverse persistence.
No source proposal was created or changed. The receipt completed at 2026-10-13
21:08:08 UTC (2:08:08 p.m. Pacific).

- Initial round: `db817cce-62de-43bd-878d-9b606ab177ca`.
- Retained restart rounds: `2e5be300-40b0-41dc-8faf-49bee03e12ab`,
  `6d08102d-af65-4166-bee1-28438b56b0a2`, `aa6d7109-9fbd-43d8-b59e-888ea0cf0373`.
- Final round: `a616a60d-2694-4d12-8d44-f274dac5317a`.
- Final reveal: `fe3733b0-7549-407f-b9df-e706bf9c2cdc`.

Thirteen saved checks passed: restart at initial private stage; each PD's two program
resets; owner/facilitator filtering and outsider denial; own reopen blocking reveal;
restart when all ready; source reset preserving the combined draft until explicit
rebuild; collective stale-write rejection/reset/replay preserving revealed inputs;
restart after reveal/editing; two-sheet workbook with six proposals and 24 individual
assessments; collective reset after export; private reopen hiding active group context
while preserving readable history and allowing a fresh reveal; full restart after
export; and fresh completion after those resets. Prior rounds/reveals remain retained.

## Final readback and local checks

[VERIFIED via `/tmp/ranking-sandbox-final-readiness.json`] The final read-only probe
confirmed exact identities/attributes and Active alternate keys for all three ranking
entities, and a present default-facilitator setting with a valid GUID. Source selects
succeeded, but the ordinary eligible proposal pool remained empty. No roles changed.
Search exclusion was explicitly **not verified by entity metadata**; the October 7
search-exclusion receipt remains dated evidence, not a fresh check.

The pre-browser saved readback showed the then-current retained round revealed with all four participants
ready. Local HTTP harness checks loaded that saved revealed view for all four trusted
personas and rejected foreign Origin, missing rehearsal header, and cross-site POST
requests with 403. This tests the rehearsal harness boundary, not production SSO or
app-grant enforcement. The earlier focused local suite rerun passed 19 suites / 134 tests; after the
browser fixes, the final rerun passed 135 tests, scoped lint, types and the current
production build (exit 0).

## Later saved-browser walkthrough — 2026-10-13

[VERIFIED via normal Chrome against saved D98 sandbox state] Four separate browser
persona tabs exercised the actual assessment UI with persisted Dataverse state.
The earlier port-3136 `ERR_BLOCKED_BY_CLIENT` observation was resolved by accessing
the surface in normal Chrome; it is historical, not a remaining browser blocker.
The persona harness is still not independent Microsoft SSO.

- Keyboard movement across the collective funding separator changed two awards to three
  ($60,000), survived reload, and collective reset returned two awards/$30,000.
- Reopening exposed a private-list rendering crash: totals incorrectly used a program
  subset against the full pool. Totals are now calculated only for the collective list.
  Saving confidence on SE also used to switch back to MR; the fallback now applies
  only when an unavailable combined tab is selected. A populated regression was added.
- A fresh restart cleared confidence and combined preparation. MR and SE resets were
  each exercised after an actual confidence edit. All six confidence choices were
  entered in each of four persona tabs. Combined paired order was 1–6; explicit
  rebuild restored it after an order change. Confirm, ready, own reopen and reready
  were exercised. Jean reopening disabled facilitator reveal until all four were ready.
- Justin's different A boundary produced a visible “Grades differ” on proposal 2 and
  unanimous A of one award/$10,000. Collective movement produced two/$30,000; a stale
  Justin edit was rejected with recovery controls.
- Browser workbook download completed; filesystem inspection confirmed two sheets
  with 9 and 27 rows (including headers). Collective reset after export returned
  one award/$10,000. Expanded saved history preserved read-only individual inputs.
  Reopen after export rendered private preparation successfully, with all four Preparing.

The final continuation prepared all four preserved combined lists after the post-export
reopen and marked everyone Ready again. Justin's stale save was rejected; discard/load
recovery followed by Ready succeeded. A second reveal retained Justin's B disagreement
and the unanimous A cutoff of one award/$10,000. Full “Restart walkthrough” from that
revealed UI then succeeded: private MR showed 0/3 confidence choices, combined creation
was disabled, the initial grade separators were at 1/2, and Facilitate showed all four
Preparing with reveal disabled. This reset private state is the final retained browser
state, not a ready/revealed final state. The final read-only probe
`/tmp/ranking-sandbox-browser-final-readback.json` confirms round
`afaccafb-844e-4624-809f-f447796843d8`, stage `private`, and all four not ready.
“Open previous run” displayed historical round `7b572dca-6fbf-48a6-8ba6-7645716c771f`
read-only with one award/$10,000 and frozen disagreement; “Open replacement run”
returned to the fresh private round with all four Preparing. Screenshot: `/tmp/proposal-ranking-sandbox-final-reset.png`.

Keyboard dragging persisted as described above. Automated pointer dragging visibly
moved the item but did not produce an observed drop/save, including in active Chrome;
automation alone does not prove pointer behavior. The later user confirmation below
establishes basic movement/save; long-list autoscroll remains pending.

## Additional bounded checks — 2026-10-13

[VERIFIED via the memory-only rehearsal selector and in-app browser] The local
100-proposal/12-PD fixture rendered 100 proposal headings and 12 PD assessments per
card. Find 100 scrolled to the final proposal; keyboard movement changed its position
from 100 to 99, Refresh retained that in-memory order, and collective reset restored
position 100. This is UI and in-memory state evidence, not Dataverse persistence or
maximum-capacity changeset acceptance. Long-list autoscroll remains unaccepted.

The fresh read-only `/tmp/ranking-remaining-readiness.json` probe again returned zero
ordinary eligible proposals. Focused API/workflow-service/sentiment-reader tests passed
(3 suites / 49 tests), and rehearsal fixture lint passed. No runtime app code or
Production state changed in this continuation.

Pointer automation remains inconclusive: native automation dropped back at the original
position; CDP movement visibly moved the item but produced no observed completed drop.
This does not establish an app defect. [USER-VERIFIED via the supplied conversation]
The user confirmed basic pointer behavior: “It moves and saves.” This is human
confirmation of basic movement/save, not automated proof or long-list autoscroll
acceptance. The overall acceptance task is not complete.

## Test access provisioning — partial follow-up

[VERIFIED via `scripts/setup-ranking-test-access.cjs --env-file <private-file> --execute`
and `/tmp/ranking-test-access-setup.log`] The dedicated test Neon database at
`ep-aged-dew-b7gtigyy-pooler.c-13.us-east-1.aws.neon.tech` applied 21 pending migrations
and skipped 61 already applied migrations (82 total). Four real Microsoft-linked
profiles are configured: Justin's existing profile plus Beth, Rob and Jean. Explicit
`proposal-ranking` and `meeting-tracker` grants were created in the registered
Dataverse sandbox `orgd9e66399.crm.dynamics.com`. No Production database, grants or
deployment changed.

This is provisioning evidence only. The test Preview adaptation is not deployed,
the D97 source/review fixture is now saved as described below; independent Microsoft sign-ins have not
been tested, and live accepted-sentiment acceptance has not run. Do not describe the
test environment as ready or the independent-user acceptance as passed. The earlier zero-source result describes ordinary eligibility, not the dedicated D97 fixture.

## Dedicated D97 source fixture — deployment pending

[VERIFIED via `/private/tmp/ranking-d97-proposal-setup.json`,
`/private/tmp/ranking-d97-review-setup.json` and `/tmp/ranking-d97-preview-probe.log`]
Six sandbox Requests with IDs `c31bc841-e260-4a14-9041-8d765ddcc401` through
`c31bc841-e260-4a14-9041-8d765ddcc406` are saved under test run
`c31bc841-e260-4a14-9041-8d765ddcc497`. They carry Phase II, MR/SE, four staff and
USD amounts $100,000–$600,000; per-request email and payment counts were zero at
readback. One synthetic reviewer (`c31bc841-e260-4a14-9041-8d765ddcc410`) and six
suggestions (`c31bc841-e260-4a14-9041-8d765ddcc421` through
`c31bc841-e260-4a14-9041-8d765ddcc426`) supply ratings `[5,4,3,5,2,3]`.
The dedicated preview probe returned `canOpen: true`, six rated proposals and four
roster members, with Justin as test facilitator. The actual default remains Beth.
This proves source preview, not deployed Preview opening or independent SSO.

Fixture creation exposed the factory's `$top=5` activation truncation on the fifth
Request: creation returned 201 but workflow restoration verification failed. Complete
Dataverse readback found exactly one active activation among seven; recovery is in
`/tmp/ranking-workflow-recovery.log`. The helper now removes that limit and refuses
an incomplete next-link response; 27 factory tests passed. No blind recreation occurred.

Dedicated test policy binds the explicit test flag to the exact project, Preview
profile/origin, sandbox, test Neon database, required authentication and interlocks,
and six fixture IDs/run/cycle. Synthetic-review inclusion is test-only; its production
default remains false. The final scoped ranking/identity/factory run passed 230 tests in 24 suites
(`/tmp/ranking-final-scoped-tests.log`), as did DAL, reviewer-boundary and API
gate/self-test pairs. JavaScript lint passed (`/tmp/ranking-final-lint.log`); the CJS
setup script passed `node --check`, while CJS ESLint hit an existing plugin/config
mismatch, so no whole-scope lint pass is claimed. Dedicated project Preview flags
are being configured; their completion and deployment are not yet verified. Build passed before the last small calculation/deduplication
changes, so those final changes do not inherit a fresh build claim. Preview deployment
and independent SSO/live-sentiment acceptance remain pending. Production is untouched.

## Evidence limits and next acceptance

- These are service-persona checks, **not independent Microsoft SSO, app-grant or
  authenticated-route acceptance**. Service actor filtering does not prove those layers.
- Ordinary sandbox eligibility was empty. The dedicated marked D97 fixture now
  passes source preview; deployed opening and independent-user end-to-end behavior
  remain unverified. D98 fictional frozen cards alone do not prove source eligibility.
- No live sentiment acceptance occurred. The browser harness stubs empty enrichment;
  the stale supplement rejection proves stage fencing, not sentiment access/currentness.
- The retained D98 fixture originally used numeric review-distribution keys. Future
  fixture generation now uses rating labels, but frozen D98 was deliberately not
  rewritten. It is unsuitable for reviewer-badge visual proof; persistence, ordering,
  reset and export row-count checks above are unaffected.
- Saved-browser Dataverse evidence is limited to the six-card/four-persona walkthrough
  above. The separate 100/12 UI fixture is memory-only. Basic pointer movement/save
  is user-confirmed; independent users, long-list autoscroll and live sentiment
  still need acceptance.
- The 100-proposal/12-PD supported-cap fixture has local serialization and bounded
  in-memory UI evidence; six saved proposals/four personas do not prove maximum-capacity
  Dataverse transactions.
- No production schema, flags, grants, source data, deployment or trial cleanup changed.

Local evidence: `/private/tmp/proposal-ranking-v2-sandbox-receipt.json`,
`/tmp/ranking-sandbox-walkthrough.log`, and `/private/tmp/proposal-ranking-v2-sandbox.xlsx`.
These temporary files are not portable; this receipt retains the material outcomes.
Do not rerun `--execute` or replace retained D98 data to manufacture acceptance.
