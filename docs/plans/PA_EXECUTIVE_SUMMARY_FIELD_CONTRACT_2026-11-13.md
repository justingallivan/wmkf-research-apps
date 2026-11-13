# Executive Summary uses the existing Lay Abstract field

Owner: Codex, branch `codex/power-automate-integration-2026-11-11`.
Status: owner-approved field reuse; Sandbox schema verified; staff implementation on this branch, not deployed.
Summary source is the owner-selected Submission-Documents project narrative.
Automatic initialization and the proposed staff-edit marker remain unimplemented. Connor’s Short Title
Preview, policy, credentials, Request and ledger are not changed by this work.

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

[VERIFIED via git/source search] Main at `146980bc6` has no literal runtime reader or
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
| `proposal.executive-summary` | Existing `summary` output, 200-word cap, destination null; staff draft only |
| Shared Executor / Admin prompt publish | Reject configurable persistence to Lay Abstract before provider dispatch/publication; dedicated staff saves do not use this path |
| Machine endpoint/worker/store | Remain Short Title-only; no Summary adapter, admission grant, prompt publication, schedule or source policy added |
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
| No machine Summary activation | Destination remains null; machine scopes rejected; existing title admission/delivery tests |
| Connor unchanged | No deployment, environment, credentials, jobs, Requests or worker calls in this slice |

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

## Automatic delivery remains gated

Source and output field are settled; first-submission eligibility and staff-edit
protection remain unimplemented.
No paid Summary call, automatic writer or new policy is enabled. The existing draft
prompt/profile is unchanged. Future delivery must:

1. Use the owner-selected project narrative in `Submission-Documents` (2026-11-13).
   The combined Narrative-Bibliography PDF is for reviewer matching, not Summary.
   No dependency on its creation, Phase I staff version or opportunistic fallback. Preserve required stored PI name unless
   separately changed. Freeze source identities/revisions/hashes and configuration.
2. Name the authoritative first-submission event and readiness ordering. Implement
   the proposed monotonic staff-edit Boolean atomically with every staff Summary
   save/clear, including explicit blank clears; missing/true marker denies machine
   initialization. Specify its schema and cover all external writers before enabling
   a new intake cohort. False/default cannot establish existing records’ edit history.
   The [worker plan](PA_EXECUTIVE_SUMMARY_AND_WORKER_PLAN_2026-11-12.md#staff-edit-protection-and-initialization-eligibility)
   owns details and remaining decisions. No tenant-wide guarantee is claimed.
3. Use a separate exact machine grant and initialize operation, with the existing
   durable per-Request/physical-field reservation and publication receipts. Preserve
   receipts across expiry and edits/clearing; no automatic refill or relocation to
   evade receipts. Keep staff draft mode destination-free and title grants separate.
4. Sequence after Short Title settles, capture original Request ETag, and stop on
   any 412. Retain uncertain provider/audit/PATCH outcomes for operator reconciliation;
   never refresh an ETag or automatically regenerate to recover.
5. Test the integrated ledger/source/writer flow with fake providers and isolated SQL,
   then obtain bounded live-trial approval. A conditional adapter alone would not
   prove one-time initialization, so it is deliberately not added now.

## Review and reconciliation

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
settled by the owner; the new source adapter and staff-edit protection are planned. Build review and test results are recorded after verification below.

## Build verification and release boundary

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
