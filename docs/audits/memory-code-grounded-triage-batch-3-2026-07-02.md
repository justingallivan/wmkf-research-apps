# Memory Code-Grounded Triage Batch 3 - 2026-07-02

Status: audit-only recommendation for Dynamics Explorer / Dataverse Power Tools
memory cluster. No `.claude-memory` files were edited in this batch because
Claude is active in a separate worktree and has been instructed not to create
durable memories in this session. Resolve the recommendations later as memory or
wiki/doc edits.

## Scope

Read and classified:

- `.claude-memory/project-dataverse-power-tools.md`
- `.claude-memory/project-dynamics-explorer-reuse-power-tools.md`
- `.claude-memory/dataverse-export-floor-scoping.md`
- `.claude-memory/project-dynamics-ai-writeback.md`
- `docs/agent-wiki/topics/dataverse-dynamics.md`

## Code-Grounded Checks

- [VERIFIED] The Track B export service exists as seven modules under
  `lib/services/dataverse-export/`: `compiler.js`, `constants.js`,
  `disclosure.js`, `fetch-client.js`, `live-taxonomy.js`, `result-token.js`, and
  `workbook.js`.
- [VERIFIED] The Track B route surface exists as four gated routes under
  `pages/api/dataverse-export/`: `metadata.js`, `preview.js`, `run.js`, and
  `download.js`.
- [VERIFIED] `/api/dataverse-export/preview` validates the QuerySpec, resolves
  the live taxonomy, computes true totals via `fetchXmlAggregateCount`, mints a
  `resultToken`, and refuses unresolved operational exclusion.
- [VERIFIED] `/api/dataverse-export/run` executes only a preview-minted token,
  revalidates the spec, pages FetchXML, writes to private Vercel Blob with
  `DVX_BLOB_RW_TOKEN`, and returns only an authenticated download URL.
- [VERIFIED] `/api/dataverse-export/download` requires the same app access gate
  plus a signed download token before streaming the private Blob artifact.
- [VERIFIED] The compiler rejects `createdon` as a business-history date field
  and requires `akoya_decisiondate` for date-basis filtering.
- [VERIFIED] The FetchXML client uses FetchXML paging cookies and aggregate
  counts, not OData `/$count`, for export totals.
- [VERIFIED] The builder page uses `/api/dataverse-export/metadata`,
  `/preview`, and `/run`; there is no natural-language AI on-ramp in the current
  page.
- [VERIFIED] Dynamics Explorer imports the shared taxonomy prompt block and
  OData validator, and `count_records` calls `DynamicsService.countRecords`.
- [VERIFIED] `buildResolvedTaxonomyPromptBlock` uses Power Tools live taxonomy
  data while omitting table-level restricted taxonomy sources.
- [VERIFIED] `DynamicsService.countRecords` uses `$apply=...countdistinct` on
  the primary key instead of Dataverse `/$count`.
- [VERIFIED] AI run writes use `wmkf_ai_Request@odata.bind` with capital `R` in
  both `DynamicsService.logAiRun` and Executor `writeRunRow`.
- [VERIFIED] Current AI run writers do not write `wmkf_ai_rundatetime`; current
  Atlas and `docs/DYNAMICS_AI_FIELDS_SPEC_v3_cn.md` say to use built-in
  `createdon` and not the vestigial custom field.
- [VERIFIED] `DynamicsService.updateIfEmpty` still exists and preserves the
  fill-only/ETag conflict contract for AI request writebacks.

## Classification

| Memory | Classification | Later action |
|---|---|---|
| `project-dataverse-power-tools.md` | `KEEP_ACTIVE_BUT_SPLIT` | Do not retire. Current code confirms Track B Phase 1/2 shape, private Blob handling, true-count behavior, and route names. Later trim the historical build diary and keep only a short active guardrail that points to source, build plan, guide, API matrix, and the floor-scoping memory. |
| `project-dynamics-explorer-reuse-power-tools.md` | `KEEP_ACTIVE_NARROW` | Do not retire. Current code confirms Path A reuse of taxonomy, validator, and count helpers. Later reduce to a compact "reuse, do not rebuild" guardrail plus any still-open soak caveat. |
| `dataverse-export-floor-scoping.md` | `KEEP_ACTIVE` | This earns active status because it captures unbuilt Phase 3 / AI-on-ramp semantics that are not fully embodied in source. Later refresh pointers to current docs and consider moving the stable semantics into a canonical guide or wiki topic. |
| `project-dynamics-ai-writeback.md` | `KEEP_ACTIVE_WITH_DOC_RECONCILE` | Do not retire. Current source and Atlas still need the nav-prop, choice-value, `createdon`, raw-output, and `updateIfEmpty` warnings. Later reconcile stale doc claims listed below. |

## Stale Doc Candidates

- Resolved in follow-up commit: `docs/EXECUTOR_CONTRACT.md` no longer lists
  `wmkf_ai_rundatetime` as caller-written; it points to built-in `createdon`.
- Resolved in follow-up commit: `docs/atlas/dataverse-wmkf-ai-run-and-prompt.md`
  and `docs/DYNAMICS_AI_FIELDS_SPEC_v3_cn.md` no longer say Justin owes the
  Dynamics Explorer exclusion pass. `pages/api/dynamics-explorer/chat.js` now
  denies direct `wmkf_ai_run` schema requests and strips `wmkf_ai_run` Dataverse
  Search hits before the tool result reaches Claude.
- `project-dataverse-power-tools.md` and
  `project-dynamics-explorer-reuse-power-tools.md` are too large for active
  recall even where their facts are current. Their later cleanup should preserve
  source pointers and demote chronological status ledgers to closed history.

## Reconciliation

- No memory files were deleted, demoted, or edited in this batch.
- Follow-up reconciliation changed the Executor contract, AI-run Atlas/spec, and
  Dynamics Explorer source/tests to resolve the two stale-doc candidates above.
- The next cleanup step should wait until Claude's worktree is merged or
  abandoned, then split/trim the two oversized active memory files while
  retaining their source-backed guardrails.

## Residual Risk

This pass did not run live Dataverse probes. All classifications are grounded in
current repository source and docs. Claims about whether `wmkf__ai_summary` still
exists in live Dataverse, or whether live Dataverse Search currently returns
`wmkf_ai_run`, remain unverified here; the route-level guard strips `wmkf_ai_run`
hits if Dataverse Search returns them.
