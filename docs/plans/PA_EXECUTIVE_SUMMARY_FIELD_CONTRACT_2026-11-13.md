# Executive Summary uses the existing Lay Abstract field

Owner: Codex. Current Summary integration branch:
`codex/executive-summary-generation-2026-11-16`.
Status: existing Lay Abstract storage is retained. The bounded machine integration
passed one isolated Sandbox live trial and stays default-off elsewhere; see [bounded Summary integration](PA_EXECUTIVE_SUMMARY_INTEGRATION_2026-11-16.md).
No persistent staff-edit marker is required by the accepted intake contract.
The staff editor was merged at `1037d2dbd`, deployed and live-tested on Request
1003518 with its original Summary restored; the
[editor handoff](REQUEST_NARRATIVES_HANDOFF_2026-11-09.md) retains that release evidence.

## Decision and verified connections

Justin identified Lay Abstract as the field intended for Executive Summary, then
explicitly authorized verification and reuse. **Do not create `wmkf_executivesummary`.**
The app displays **Executive Summary**, while the stable API key remains
`lay_abstract` and Dataverse logical name remains `akoya_request.wmkf_layabstract`.
The Dataverse label remains Lay Abstract for metadata parity; changing Production
labels/forms is not part of this implementation.

[VERIFIED via `scripts/probe-executive-summary-binding.cjs`, 2026-11-13 UTC]
Production metadata: `wmkf_LayAbstract`, optional plain-text Memo, 100,000 characters,
unmanaged, readable/updateable, not field-secured. Before provisioning, Sandbox
lacked the column. Neither environment contained a prompt output declaration with
the literal `wmkf_layabstract`. This census does not enumerate external flows,
Dataverse forms, tenant roles, dynamically constructed targets or existing field text.
The retained metadata evidence contains no Request or proposal content.

[HISTORICAL 2026-11-13 via git/source search] Main at `146980bc6` has no literal runtime reader or
writer for this field. The original narrative implementation at `7b5305a7c` was on
`codex/request-narratives-2026-11-09`; its docs-only handoff had reached main. It is
cherry-picked here with its history, then narrowed to an explicit one-field allowlist.
The original Initial Assessment definition remains available for future integration,
but this branch neither selects nor permits that sibling field through the editor.
Do not widen the allowlist during a later merge without checking Sandbox schema.

| Surface | Current behavior |
| --- | --- |
| Overview → RequestNarrativesCard | Separate read and explicit save/clear, staff label Executive Summary; no polling, autosave or generation |
| GET/PATCH `/api/workbench/request-narratives` | Workbench access, trusted DAL context, session-derived identity; stable `lay_abstract` key |
| `request-narratives-service.js` | Reads only the enabled narrative field plus Request/lead-PD identity; linked lead PD or superuser saves with concrete ETag and no actor fallback |
| `shared/config/requestNarratives.js` | Existing column, 100,000-character manual limit, explicit enabled-field allowlist |
| `proposal.executive-summary` | Existing `summary` output, 200-word cap; staff draft remains destination-free, exact machine Summary scope binds Lay Abstract |
| Shared Executor / Admin prompt publish | Reject configurable persistence to Lay Abstract before provider dispatch/publication; dedicated staff saves do not use this path |
| Machine endpoint/worker/store | Separate default-off Summary admission/status/policy/worker; exact Sandbox enrollment, frozen narrative/PI, audit and original-ETag publication; bounded Sandbox delivery proved |
| Legacy AI Summary / dossier / Pre-Site | Unchanged. No mapping from Executive Summary to `aiContent.summary`, dossier input or governed document sections |
| Dynamics Explorer | Source exposes read/export tools, not mutation tools. No nonexistent mutation path was added or claimed guarded |

## Invariants and verification

| Invariant | Enforcement / test |
| --- | --- |
| Stable storage and API identity | Shared constant and field allowlist; `executive-summary-field.test.js` |
| No accidental sibling field access | Service projection and explicit allowlist; rejects `initial_assessment`, `executive_summary`, and raw-column keys |
| Preserve manual text | Existing 100,000-character limit, verbatim Unicode/whitespace, empty/null clear, no-op skips PATCH |
| Concurrent changes survive | Original concrete ETag; row-wide 412 becomes 409 without reread/retry. Unrelated row edits can also cause this expected conflict |
| Correct staff identity | Fresh lead-PD comparison or superuser, linked actor, impersonation enabled, Preview-to-Production read-only, noFallback |
| No stale UI response | Request-keyed editor, generation guard on success/error/reload, dirty-navigation confirmation |
| No prompt-row bypass | Reserved-target check at Admin validation, Executor pre-dispatch and persistence; forceOverwrite and jsonPath regression tests |
| Bounded machine Summary only | Separate exact Sandbox policy; generic and Short Title admission cannot initialize Summary; one exact Sandbox enrollment tested |
| Connor unchanged | Existing Connor Preview and policies unchanged; separate Summary trial below |

## Sandbox schema

Reuse the existing `wave36-request-narratives` definition of `wmkf_LayAbstract`.
`scripts/provision-sandbox-executive-summary.cjs` selects exactly that attribute,
requires the pinned Sandbox origin and explicit target interlock, defaults to dry-run,
and calls the existing schema engine. It does not create a second schema definition,
provision Initial Assessment, create a publisher/solution, mutate records or accept a
Production target.

[VERIFIED LIVE 2026-11-13 UTC] The single Sandbox attribute was created at
04:29:38Z. Metadata initially lagged, so no create was retried. Independent later
readback confirmed schema/type/length/required/security/audit/managed/read-update/
format plus display label and description match Production. A zero-row Request
projection was accepted in both environments. No Request text was read or changed.
See [metadata and binding receipt](evidence/executive-summary-binding-2026-11-13.json).
The inherited metadata description mentions external Power Automate initialization;
it is preserved for parity and does not establish an active flow.

## Automatic delivery and accepted intake ordering

[OWNER CONFIRMED] Intake uses the Submission-Documents narrative. All required
AI/document steps must succeed before Power Automate sets `wmkf_readyforreview`;
failures halt intake and notify check-in staff. The backend does not set the flag.
Connor intends no post-intake flow writes, and staff edit through the app. Justin
accepts the rare broken-intake rerun edge case, so the proposed persistent staff-edit
Boolean is not a prerequisite.

[VERIFIED via branch source] Dedicated Summary admission freezes source, PI,
prompt/profile and policy. The worker retains permanent Request/field reservations,
protects existing nonblank text and uses the original ETag for conditional delivery.
A staff edit after capture conflicts; replay after a later clear does not refill.
There is no general overwrite, reset or automatic regeneration path. Staff drafts
remain destination-free and Short Title grants cannot select Lay Abstract.

The owner-selected bounded Sandbox test passed on 1000389 with synthetic narrative
and PI, pinned prompt/profile, one real model call, audit and field publication.
Original blank restored; replay did not refill. See the [live receipt](PA_EXECUTIVE_SUMMARY_LIVE_TRIAL_2026-11-16.md).
Connor flow upload completion and Production rollout remain separate.

## Historical evidence boundary

The review, sweep and build receipts below describe the November 13 field/editor
slice. Their branch-only release status and marker proposals are historical, not
current Summary integration prerequisites. They do not certify this new build.

## Historical review and reconciliation

Opus 5.5 reviewed the plan through Claude Code subscription OAuth with tools disabled.
Applied: reuse original implementation history and narrow with an allowlist; preserve
Production metadata names in Sandbox; defer the unused delivery adapter; inspect
live prompt bindings before reserving the field; reuse the existing schema definition.
The proposed new-field contract is superseded by the owner’s explicit reuse decision.
Older dated metadata receipts remain historical evidence, not current provisioning claims.

Sweep Mode A scope: field identity, current app readers/writers and implementation
status. Related worker plan, narrative handoff, Atlas and route inventory are updated
in the same change. Production label changes, external flows/forms/roles, field
contents and first-event activation remain unknown or open. Source intent is now
settled by the owner; the dedicated source adapter is built and synthetic-tested
offline without admission wiring. Staff-edit protection remains planned. Build review and test results are recorded after verification below.

## Historical build verification and release boundary

282 tests across 14 suites passed: field identity and draft-only scope, staff service,
route and UI, Executor/publish guards, legacy output delivery, title admission/policy,
and Overview regressions. All scoped gates/self-tests passed; scoped lint has no
errors and one pre-existing Overview effect warning. The full webpack fallback build
passed; canonical Turbopack cannot resolve this worktree's external node_modules
symlink. No claim of a deployed build follows.

Opus build packet SHA-256:
`409c3b92a47c8ef092cf3b6412d3a6279fd7d563a6b3aa94d6e9ac7484fa9a9f`.
Review found no hard blocker, with one fix before merge: a retained conflict draft
must stay copyable. Applied readOnly (not disabled) after conflicts, plus regression.
Also added malformed-output rejection, real actor-helper coverage and safe Dataverse
permission errors. Source checks confirmed synchronous Preview policy, Workbench app
key parity and target.field-only Executor persistence. Editor navigation hooks mount
on Overview; sibling hooks are on other pages/tabs, not simultaneous editors.

API preserves supplied whitespace/newlines; browser textarea editing can normalize
CRLF to LF. No claim of byte-identical browser round-trip is made. External forms,
flows, contents and role visibility must be checked before Production promotion.
No Production deployment, metadata rename, prompt update, paid application call,
record write, worker execution or Connor configuration change occurred.

Opus 5.5 follow-up verdict: **GO, no remaining blockers** for the feature branch.
Packet SHA-256 `4372f7409a272cf6e1d3c6ffd37ee6c1de5de41ffbc1408090ed35390c466bc4`.
Tool-free review verified the supplied corrections; it did not independently run tests
or probe Dataverse. Root performed those checks. Optional UX refinements are deferred;
no further design iteration is warranted before the open activation decisions.
