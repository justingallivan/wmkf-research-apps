# Proposal Ranking v2 — bounded sandbox rehearsal receipt

Date: 2026-10-13. Branch source: `codex/proposal-ranking-v2` at `b6676e15e`, with the local sandbox rehearsal scripts. **Saved service-persona rehearsal and a bounded saved-browser walkthrough passed; independent-user acceptance remains open.**

## Current release and next rehearsal

[VERIFIED via deployment receipt and hosted browser] Source `d1b206185` is deployed
in dedicated READY Preview `dpl_GCjqpVkTNncxSC2kRzByGLbbspyq` at
`https://wmkf-meeting-transcription-test-h2yh5pkf4.vercel.app`, with stable alias
`https://wmkf-meeting-transcription-test.vercel.app`. The compact card refinements
and expandable total Research funding are included. The release passed 179 ranking
tests and Justin's Microsoft SSO/updated-interface check. This is sandbox deployment,
not Production promotion or independent acceptance by the other three PDs.

[PLANNED — owner authorized, not yet live-verified] Enrich the rehearsal to 12
realistic fictional proposals (six MR, six SE), each with three varied saved synthetic
reviews, distinct institutions/titles, budgets, geography, award histories and clearly
labelled sample discussion. Fictional institution/history/discussion projection is
restricted to the dedicated test policy; it must not fabricate production data or
claim genuine accepted sentiment. Source preparation, deployment and a fresh opened
round must be verified separately; resets retain an existing round's frozen pool.

## Historical setup and acceptance receipts

The following sections retain their dated pools, deployment IDs and outcomes; the
current release above supersedes their deployment status, not their evidence limits.

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
establishes basic movement/save; the later manual 100-card autoscroll confirmation is recorded below.

## Additional bounded checks — 2026-10-13

[VERIFIED via the memory-only rehearsal selector and in-app browser] The local
100-proposal/12-PD fixture rendered 100 proposal headings and 12 PD assessments per
card. Find 100 scrolled to the final proposal; keyboard movement changed its position
from 100 to 99, Refresh retained that in-memory order, and collective reset restored
position 100. This is UI and in-memory state evidence, not Dataverse persistence or
maximum-capacity changeset acceptance. The later manual 100-card autoscroll confirmation is recorded below.

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

This is provisioning evidence only. The test Preview adaptation is deployed as recorded below, and the D97 source/review
fixture is saved. Justin has passed a real Microsoft sign-in; Beth, Rob and Jean
have not independently signed in. Live accepted-sentiment acceptance has not run. Do not describe full independent-user or live-sentiment acceptance as passed. The earlier zero-source result describes ordinary eligibility, not the dedicated D97 fixture.

## Dedicated D97 source fixture and authenticated Preview

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
This source probe preceded the hosted opening and Justin sign-in recorded below.

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
mismatch, so no whole-scope lint pass is claimed. Dedicated project Preview flags were configured; subsequent access preflight found
four profiles, four verified staff and zero pending migrations
(`/tmp/ranking-test-access-readback.log`). Build passed before the last small calculation/deduplication
changes, so those final changes do not inherit a fresh build claim. The later hosted evidence below supersedes the deployment/Justin sign-in gap;
other staff sign-ins and live-sentiment acceptance remain pending. Production is untouched.

## Hosted Preview acceptance — partial

[VERIFIED via Vercel deployment and normal Chrome] Initial hosted acceptance of
source commit `27e6fdc7c` used dedicated Preview `dpl_6cZM8Dfv6copEpM16gMQWx8b6eFZ`
(READY, Preview target). The preceding READY Preview
`dpl_3tG72Ytn1f41RZbttqAnHTuVXG4N` allowed Justin's real Microsoft SSO and showed
six scored proposals/four staff, but first opening returned 503 because
`PROPOSAL_RANKING_V2_SCHEMA_READY` was missing. The flag was corrected and the
second Preview successfully opened the hosted round.

Justin saved MR confidence and reset it to 0/3, completed MR/SE confidence, built
the combined order `1,4,2,3,6,5`, confirmed it and became Ready. Reopening his own
preparation returned all four to Preparing with facilitator Reveal disabled.
Anonymous root redirected 307 to sign-in; ranking and app-access returned 401;
cron maintenance returned 404. No other staff member's independent Microsoft sign-in
was tested. This is one real user's hosted acceptance, not full multiuser proof.

[USER-VERIFIED] The user confirmed smooth pointer autoscroll and a retained drop
in the 100-card memory-only fixture. This closes that fixture's manual pointer/
autoscroll check, not saved maximum-capacity Dataverse acceptance.

## Corrected roster, third Preview and sentiment consumer fixture

[VERIFIED via hosted UI and correction receipts] The canonical staff name is John
Sader (the owner initially supplied “Seder”), sandbox system user
`f2cfa564-ac8b-f111-ab10-6045bd02ed59`, enabled and matched to Microsoft object
`dc4a6b93-453d-4273-8cac-d6aea7c0a0ae`. The accepted roster is Justin, Beth, Jean and
John. Only Rob's two setup-created grants from 22:34 were removed
(`/private/tmp/ranking-rob-access-correction.json`). John's profile/grants succeeded
(`/tmp/ranking-john-access-setup.log`); the third Request's lead PD was corrected to
John (`/private/tmp/ranking-john-source-correction.json`). Earlier Rob evidence is
historical, not evidence for the accepted roster.

Round `df971530-9556-4def-8814-6e43ad81c64c` was canceled and retained by an
ETag-guarded atomic operator correction, **not the UI Restart action**. Justin opened
corrected round `f48741f0-4560-471d-b51f-ef93db48c152` through the real hosted UI;
readback confirmed six proposals/private stage and Facilitate showed Beth, Justin,
Jean and John all Preparing, with Reveal disabled
(`/private/tmp/ranking-corrected-round-readback.json`, screenshot
`/private/tmp/ranking-hosted-corrected-roster.png`). Beth, Jean and John's independent SSO
and the corrected full group walkthrough remain pending.

Dedicated Preview `dpl_AKzoUJwZZsdFhu7XVDexuceqQaq2` is READY, target Preview,
with the stable alias on deployment `liidw27y9`
(`/tmp/ranking-test-preview-inspect-3.log`). Material/transcription access is limited
to first D97 Request `c31bc841-e260-4a14-9041-8d765ddcc401`.

[VERIFIED via `/private/tmp/ranking-d97-sentiment-fixture.json` and
`/tmp/ranking-sentiment-fixture-recovery.log`] Sandbox canonical sentiment prompt v1
`a0bc2b5e-59c7-f111-aaaf-70a8a59af221` was seeded create-only. Missing additive
artifact option 13 was installed in the sandbox and verified by preflight. The
fixture created four new files in a marked TEST folder in the **shared akoyaGO
SharePoint site**, not an isolated SharePoint environment; no existing files were
modified. Missing-document recovery preserved the uploaded files and completed the
receipt. The real `getDeliberationSentiments` consumer returned `current` for the
first D97 Request, prompt version 1.

This is explicitly fictional scripted acceptance: no model call, no actual human
analysis, and no sentiment generation or full group-browser proof. The corrected
staff sign-ins and group walkthrough remain pending. The production application
and production Dataverse are unchanged; shared SharePoint received only new marked
test files.

## Evidence limits and next acceptance

- The original rehearsal used service personas; later hosted evidence establishes
  Justin’s real Microsoft SSO only. Beth, Jean and John’s independent staff sign-ins remain pending.
- Ordinary sandbox eligibility was empty. The dedicated marked D97 fixture now
  passes source preview and hosted opening; full independent-user end-to-end behavior
  remains unverified. D98 fictional frozen cards alone do not prove source eligibility.
- The original browser harness stubbed sentiment. The later real consumer read
  proved the fictional scripted fixture current; generation and full group-browser
  sentiment acceptance remain unverified.
- The retained D98 fixture originally used numeric review-distribution keys. Future
  fixture generation now uses rating labels, but frozen D98 was deliberately not
  rewritten. It is unsuitable for reviewer-badge visual proof; persistence, ordering,
  reset and export row-count checks above are unaffected.
- Saved-browser Dataverse evidence is limited to the six-card/four-persona walkthrough
  above. The separate 100/12 UI fixture is memory-only. Basic pointer movement/save
  and 100-card autoscroll/drop are user-confirmed; other independent users and live
  sentiment still need acceptance.
- The 100-proposal/12-PD supported-cap fixture has local serialization and bounded
  in-memory UI evidence; six saved proposals/four personas do not prove maximum-capacity
  Dataverse transactions.
- No production schema, flags, grants, source data, deployment or trial cleanup changed.

Local evidence: `/private/tmp/proposal-ranking-v2-sandbox-receipt.json`,
`/tmp/ranking-sandbox-walkthrough.log`, and `/private/tmp/proposal-ranking-v2-sandbox.xlsx`.
These temporary files are not portable; this receipt retains the material outcomes.
Do not rerun `--execute` or replace retained D98 data to manufacture acceptance.
