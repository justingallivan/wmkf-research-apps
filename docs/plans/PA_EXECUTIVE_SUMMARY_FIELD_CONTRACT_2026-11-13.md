# Executive Summary: proposed Request field contract

Status: proposed for owner approval; no schema, prompt, permission, workflow or record
writes. Document selection remains OPEN. Connor’s Short Title test is untouched.
Owner: Codex, branch `codex/power-automate-integration-2026-11-11`.

## Recommendation

[PROPOSED] Add one dedicated optional Request Memo, display name **Executive Summary**,
schema name `wmkf_ExecutiveSummary`, logical name `wmkf_executivesummary`, maximum
10,000 characters, plain text. Initialize once from the shared Executor and thereafter
preserve staff edits and clearing. Do not repurpose AI Summary or a governed Pre-Site
section. This names a candidate, not permission to provision it. No new table,
database, queue, generalized mapper or security role is proposed.

## Verified column and consumer inventory

[VERIFIED 2026-11-13 UTC via `scripts/probe-executive-summary-columns.cjs`]
Complete metadata responses for Request and Request Document were searched by logical
name and localized display label for summary/abstract/assessment/narrative candidates.
Typed Memo/String reads supplied lengths. The retained metadata-only
[evidence](evidence/pa-executive-summary-columns-2026-11-13.json) contains no Request
content. Both Sandbox and Production were queried read-only; no field named
`wmkf_executivesummary` or Request field labeled Executive Summary appeared.
This is a targeted candidate census, not proof that no synonym exists elsewhere.
Reproduce from the repository with Node 26 and the normal private environment file:

```sh
DYNAMICS_URL=https://orgd9e66399.crm.dynamics.com DATAVERSE_TARGET_INTERLOCK=on node --require=./scripts/rehearsal/pa-factory-node-loader.cjs --env-file=/absolute/private.env scripts/probe-executive-summary-columns.cjs sandbox
DYNAMICS_URL=https://wmkf.crm.dynamics.com DATAVERSE_ALLOW_PROD_READS=yes DATAVERSE_TARGET_INTERLOCK=on node --require=./scripts/rehearsal/pa-factory-node-loader.cjs --env-file=/absolute/private.env scripts/probe-executive-summary-columns.cjs production
```

The probe accepts only these pinned targets and reads metadata, never Request rows.
Its GET-only behavior is source-inspectable; the live run additionally used a local
fetch guard rejecting every non-token write.

| Existing column | Live shape | Why not silently reuse it |
| --- | --- | --- |
| `akoya_request.wmkf_ai_summary` | Both environments: optional Memo 1,000,000; updateable, not field-secured | Legacy summarizer writes; Workbench and dossier generation consume it. Reuse would change existing meaning and downstream inputs. |
| `wmkf_requestdocument.wmkf_presiteexecutivesummary` | Both: optional Memo 32,000; updateable, not field-secured | Governed Pre-Site document section, versioned with its artifact; not a Request-wide intake output. |
| `akoya_request.wmkf_layabstract`, `wmkf_initialassessment` | Production: optional Memo 100,000; absent from Sandbox census | Existing separate narrative contract; not interchangeable with an Executive Summary. |
| `wmkf_abstract` | Production 5,000; Sandbox 2,000 | Applicant source abstract, not generated Executive Summary. Approved/formatted abstract variants are separate 32,000-character fields. |
| `wmkf_staffreviewsummary`, `wmkf_initialassessmentrationale` | Sandbox-only candidates, Memo 10,000 | Not in Production census; no direct runtime references found on this branch. Their labels do not establish ownership or safe reuse; external consumers remain unknown. |
| `wmkf_summaryscientificquestion`, `wmkf_summarypotentialimpact` and six sibling `wmkf_summary*` sections | Production, Memo 2,500 each | Distinct scientific-question/impact/risks/etc. sections; no direct runtime references on this branch. No consolidation or replacement proposed. |
| `wmkf__ai_summary` | Sandbox only, label TRASH, Memo 1,000,000 | Label is not deletion or reuse authorization. Leave unchanged. |

[VERIFIED source at branch commit `557df880e`]
- `lib/services/phase-i-dynamics/summarize-service.js`: reads AI Summary at lines
  74–100 and writes it at 168–184; explicit overwrite mode differs from the proposed
  permanent initialization contract. `scripts/seed-phase-i-summary-prompt.js` also
  binds the Executor legacy prompt to that field. Both API generations must remain intact.
- `lib/services/workbench/resolve-request-service.js`: selects the field and projects
  `aiContent.summary`; `shared/components/workbench/ProposalTab.js` renders AI Summary;
  `OverviewTab.js` reports its presence. New text must not be injected into that DTO key.
- `lib/services/cycle-dossier-generation.js`: selects AI Summary and freezes it as
  `priorAiContext.summary`. The new field is not an approved replacement or extra input.
- `lib/services/pre-site-visit/artifact-model.js`: `SECTION_FIELDS` and
  `proposalCorePatch` map the Pre-Site section onto the governed document row;
  the document adapter, reopen flow and Final transition model also select it.
- `lib/services/prompt-jobs/capabilities.js`: `proposal.executive-summary` currently
  produces `summary`, capped at 200 words, with `destinationField:null`. Existing
  staff `generate-draft` behavior must remain unchanged.
- `request-field-delivery.js` and the machine pilot are explicitly Short Title-only.
  They are not a generic Summary writer; a prompt-row edit cannot enable this contract.

Search scope included lib/shared/pages/scripts/tests and configuration by raw field
names, then DTO consumers by `aiContent`/`summary`. Generic Explorer and configurable
Executor writes can access fields without literal references. Dataverse forms,
external flows, all tenant roles and unpublished work in other branches were not
inventoried. No claim of exclusive ownership, no existing content, or guaranteed
staff-only visibility follows from this inspection. Production metadata is current;
branch source is not a claim about what is deployed on main.

## Proposed contract for approval

| Item | Proposed contract |
| --- | --- |
| Business owner | Justin designates the owner; lead PD reviews/edits the text. Connor owns the eventual PA trigger, not a parallel provider implementation. |
| Destination | `akoya_request.wmkf_executivesummary`, optional plain-text Memo, 10,000 chars. No default, calculation or rich-text HTML. Schema collision/managed-property check before provisioning. Recommend column auditing, but verify entity-level audit separately; audit is not the initialization fence. Keep the new field off general Dataverse forms until eligibility ordering and external writers are reviewed. |
| Task/output | Reuse `proposal.executive-summary` / `summary`. Keep current 200-word cap for the pilot; add an explicit 10,000-character ceiling at validation and write. The new character ceiling applies only to machine Summary delivery and its editor; do not change the shared staff draft capability. Invalid/over-cap output fails without publication or automatic paid retry. Wording optimization deferred. |
| Machine mode | Separate default-off Summary policy/scope plus `operation: initialize`; exact task, Request, event, prompt/profile, database and target pins. Existing staff draft mode remains destination-free. |
| Prompt delivery | Dataverse prompt output target remains `none`; validated ledger result feeds the one-field backend writer. No second direct Executor/PA PATCH. |
| Document | OPEN: Submission-Documents project narrative versus AI Materials combined narrative/bibliography. No Phase I staff version, no fallback choice or assumed cache savings. No live Summary dispatch until selected and reviewed. |
| Other input | Preserve current required stored Project Leader name (`pi_name`) unless separately changed. Freeze it with document identity/revision/hash, extraction version and configuration. |
| Initialization event | Proposed first accepted full-proposal submission; Connor/owner must name the authoritative event ID and eligibility predicate before activation. No update-trigger-on-every-edit or backfill. |
| Existing text | Null or empty string can be eligible only with first-event authorization and no retained initialization receipt. Any other string, including whitespace, is protected. |
| Concurrency | Capture concrete Request ETag before generation; use that original ETag for the sole PATCH. Sequence Summary after Short Title has settled, then capture Summary’s ETag. Do not dispatch both initializers concurrently. Any later row edit can still cause 412. Stop on conflict; never refresh ETag and retry. |
| Repeat/clear | Retain per-Request/physical-field initialization and publication receipts across events, prompts, deployments and content expiry in the same database. An initialized then cleared field stays cleared. No relocation to evade receipts. |
| Uncertain outcome | Preserve durable intent and validated result; unknown provider/audit/PATCH outcomes require operator reconciliation, no automatic second call/write. |
| Staff access | Proposed Workbench-authorized staff read, lead PD or superuser edit through the existing request-bound authorization/actor pattern. Explicit save/clear with ETag; no autosave/regenerate. This is app policy, not a proven Dataverse-wide confidentiality boundary. |
| Other audiences | No new Chairs, applicant, external-token, report, dossier or document-distribution reader. Approve audience and inspect actual Dataverse roles/forms/flows before activation. If strict field confidentiality is required, choose and verify field security separately. |
| Provenance/retention | Existing job/prompt/profile/source hashes and AI-run audit identify generation. Field is durable Request content; temporary ledger content follows existing expiry and receipts survive. Audit flags alone do not prove tenant audit capture. |

A blank field cannot reveal a human edit-and-clear that occurred before the first
initialization reservation. Therefore historical Requests and ambiguous event/history
are ineligible for automatic fill; route them for review. For new submissions, the
accepted event must establish eligibility before staff editing opens, or a shared
receipt/tombstone must be written by all authorized editors. That ordering is an
activation prerequisite, not a guarantee from ETag alone. External direct writes
remain outside an app-only enforcement claim.

### Failure and reservation semantics

[PROPOSED] Acquire the durable per-Request/field initialization reservation before
provider dispatch. Repeated keys replay the same job; another event/key must not
silently bypass an outstanding or consumed reservation. Retained publication
success permanently prevents automatic refill even if a staff member clears text.

| Outcome | Eligibility and handling |
| --- | --- |
| Failure before reservation | No side effect or entitlement consumed; ordinary policy/event eligibility still required. |
| Reservation then known provider/validation failure | No automatic new generation or reservation release. Report failure and require an explicitly approved recovery design/action. |
| Validated result then known publication conflict | Keep reservation and validated result within retention; report conflict for staff review. Do not update ETag or publish automatically. |
| Unknown provider, audit or PATCH outcome | Preserve durable intent and block redispatch/republication until operator reconciliation. |
| Result expires before successful publication | Keep durable reservation/receipts; surface expired content as attention using existing ledger/status semantics. Do not fabricate output or silently release eligibility. Any new generation needs separate approval. |

No new terminal enum or recovery API is introduced by this contract. Implementation
must map these outcomes to the existing store/status combinations and test them;
operator recovery remains intentionally unavailable until separately reviewed.
This is an explicit fail-closed hold, not a claim of implemented recovery machinery.

## Minimal implementation and acceptance boundaries

1. Owner approves field/audience/initialization semantics. Confirm name/type/length,
   required/security/managed properties, external flow ownership and permitted reader
   access in each target. Confirm the owner/purpose of Sandbox-only Staff Review
   Summary before creating a potentially competing field; its lack of literal
   source readers does not establish that it is abandoned. Do not copy or delete it. Provision only the approved additive field through the
   existing schema process; no Production provisioning is included in this plan.
2. Add one explicit Summary delivery binding and exact machine policy, reusing the
   shared Executor/ledger/authentication. Preserve Short Title and staff draft grants.
   Do not add Summary to the live Connor pilot or reconfigure its deployment.
3. Reserve the physical field from generic in-app writes: Explorer mutation and
   configurable Executor destination resolution must reject it; a prompt row cannot
   select it directly. Trace and gate those actual dispatch seams before claiming
   exclusive app writers. Test a real prompt-row target naming this field and the
   Explorer write path, alongside the allowed dedicated writer/editor.
   Add a dedicated Request text projection/editor only after its access contract is
   approved. Do not overload `aiContent.summary` or auto-feed dossier/Pre-Site readers.
   Use a separate field query/projection, never add the column to the general
   Request resolver’s unconditional select. Missing schema yields a scoped error.
4. Source selection remains a separate gate. After selection, verify frozen source
   manifests, freshness and pre-dispatch authorization against that policy. No build
   may infer a document path from this field contract.
5. Test with fake provider/DAL and isolated SQL: first eligible fill; existing null,
   empty, whitespace and text; same/conflicting keys; different event after delivery;
   clearing after initialization; ambiguous pre-initialization history; concurrent
   staff edit/row-wide 412, including edit-then-clear; ordered Short Title/Summary
   initialization; uncertain provider/audit/PATCH; content expiry; cross-scope
   denial and retained receipt; old title/staff/dossier readers unchanged. Test both
   word and character boundaries without clipping output.
6. Only after those gates, obtain approval for one isolated paid Sandbox Summary
   trial with exact source/field/prompt/event pins. Production and unattended schedules
   remain separate approvals. Connor’s existing test requires no changes.

Contract-reconcile: PA event → authenticated submit → exact Summary policy → frozen
source/config → shared Executor → validated retained result → content-free audit →
conditional one-field publication → content-free status and authorized staff reader.
Unit of success is one job/field; delivered audit alone is not successful publication.
Partial success is reported by durable stage. Async results remain bound to Request,
job and original ETag; unknown states fail closed. No new persistence table, generic
helper extraction or batch delivery is proposed. Changed-field fan-out is additive;
all old readers remain explicitly unmapped. This is a plan, not implemented evidence.

## Remaining owner decisions

Approve or revise the proposed dedicated field, staff audience/editors and initialize-once
policy. Confirm event eligibility with Connor. Leave document selection open until the
owner selects it with input from the caching work. No permission, schema or live generation change follows merely
from accepting this document as a useful draft.

## Opus 5.5 review and adjudication

Reviewed through Claude Code subscription OAuth, tools disabled; no Request content
or credentials included. Packet SHA-256
`ed5db7858ee541e18bd92dc0d946727aaee0774e31ef77220f76fb434b9c1fe2`.
Verdict: approve the draft direction with named contract changes before owner sign-off.
Applied: explicit Short Title sequencing; deny generic app writer bypasses; defined
reservation/failure/expiry handling; machine-only character ceiling; Sandbox field
ownership check; audit/form prerequisites; explicit separate reader projection.

Rejected the suggested new-ETag retry after 412: null does not prove no intervening
human edit-and-clear, and the retained reservation also already exists at that stage.
Sequencing avoids predictable initializer conflicts without weakening concurrency.
No new expired-state enum was accepted; existing attention/expiry semantics must be
reused and verified during implementation. The reviewer’s date objection was a timezone
mismatch: the probes recorded 2026-11-13T04:04:44Z and 04:05:15Z (November 12 locally).
Dates now explicitly say UTC. No second design iteration is needed for these bounded
text corrections; implementation still needs its own review and regression evidence.

Review limits: tool-free plan review, not independent live probing or implementation
certification. Metadata availability and writer/reader evidence support the proposed
separation; actual new-field security, external writers, initialization eligibility and
document source remain activation prerequisites. No schema or permissions changed.
