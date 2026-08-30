# Atlas: `wmkf_ai_run` + `wmkf_ai_prompt` (Dataverse)

**Last verified:** 2026-08-30 in source/tests for Executor-budget damaged-row
recovery, reserved-revision concurrency, Dataverse paging/provenance, and Admin
draft reconciliation (no production budget revision claimed); 2026-08-27 for sole-current
`pre-site-visit.proposal-core.generate` v5 (unattributed content-identical
republish of v4; runtime exact-match preflight passed during the governed
Request `1002852` smoke generation, run
`c3143de2-77a2-f111-b8db-6045bd0a1ac2`); 2026-08-18 for the Production-live admin publish/model/schema
contract, then-sole-current `pre-site-visit.proposal-core.generate` v4 exact readback, completed
governed Request `1002379` v3 run `ba0f42b9-849a-f111-b8db-6045bd008868`,
the earlier governed runs/direct QA, and 24 prompt rows;
2026-07-30 for governed `initial-assessment.generate` v1 production
provisioning; 2026-07-28 for governed
`review-synthesis.generate` v3 and its successful controlled production execution; 2026-07-12 for the broader entity inventory via
`scripts/reconcile-memory-claims.js`
**Source spec:** `docs/DYNAMICS_AI_FIELDS_SPEC_v3_cn.md` (canonical; v2 archived)

## `wmkf_ai_run` (mutable row count; probe before quoting)

**Source of truth:** Dataverse-only. Append-only audit ledger for AI
invocations. Request linkage is present only when the Executor caller supplies
`requestId`; the Initial Assessment pilot exposed one live caller that did not.

**Entity set:** `wmkf_ai_runs`

**Schema (per v3 spec):**
- `wmkf_ai_runid` (Uniqueidentifier, PK)
- `wmkf_ai_runnum` (auto-number, primary name attr)
- `wmkf_ai_request` (Lookup → `akoya_requests`) — **nav-prop is `wmkf_ai_Request` (capital R)** — discoverable only via `EntityDefinitions(...)?$expand=ManyToOneRelationships`. Do not guess case.
- `wmkf_ai_tasktype` (Picklist) — Summary=682090000, Report=682090001, Check-in=682090002, PD Assignment=682090003
- `wmkf_ai_status` (Picklist) — Completed=682090000, Failed=682090001, Needs Review=682090002
- `wmkf_ai_model` (String) — model id (e.g. `claude-opus-4-7`)
- `wmkf_ai_promptversion` (Integer)
- `wmkf_ai_rawoutput` (Memo, **1,000,000 char cap** per Connor 2026-04-14)
- `wmkf_ai_notes` (Memo, 2000 char default — keep notes short)
- `wmkf_ai_runsource` (Picklist) — written by `execute-prompt.js` `writeRunRow()` from `RUN_SOURCE` map (which surface invoked the prompt)
- `wmkf_ai_promptoverridden` (Boolean) — true when caller passed an override payload at runtime; written by `writeRunRow()`
- `wmkf_ai_promptoverride` (Memo, 4000 char truncation) — JSON of the override redacted; written by `writeRunRow()`
- Built-in `createdon` is the run timestamp. **Do not write `wmkf_ai_rundatetime`** — vestigial.

**Privileges:** App registration `d2e73696-537a-483b-bb63-4a4de6aa5d45` has `prvCreate`/`prvUpdate` (no `prvDelete` — append-only by design). [VERIFIED 2026-04-14]

**Read paths:**
- `lib/services/prompt-resolver.js` — **NOTE:** the v2 prompt-resolver reads `wmkf_ai_runs` (not `wmkf_ai_prompts`) — specifically a single scratch row at GUID `a03f77d9-913a-f111-88b5-000d3a3065b8`, with `wmkf_ai_notes`=system prompt and `wmkf_ai_rawoutput`=user-prompt template. This is a Session 103 holdover; the resolver header comment says "When the real table ships, swap `_fetchFromDynamics()` to read from there." See `wmkf_ai_prompt` section below for the v3 (Executor) path.
- Admin / monitoring tooling (no production user-facing reader for the audit ledger yet)

**Write paths:**
- `lib/services/dynamics-service.js` `logAiRun` — canonical writer. Truncates `wmkf_ai_rawoutput` with `…[truncated N chars]` marker as safety valve.
- `lib/services/execute-prompt.js` `writeRunRow()` — Executor contract; logs
  every prompt run with `wmkf_ai_Prompt@odata.bind` and, when the caller passes
  `requestId`, `wmkf_ai_Request@odata.bind` (both capital — see nav-prop case
  warning above)
- `pages/api/phase-i-dynamics/summarize.js` — Phase I summarization
- `pages/api/grant-reporting/extract.js` — Grant Reporting writeback
- `scripts/probe-impersonation-resmoke.js`, `scripts/probe-impersonation-as-user.js` — write sentinel rows during impersonation testing (S135). Filter `wmkf_ai_model='impersonation-resmoke'` to find them.
- `scripts/seed-phase-i-prompt.js` — `DynamicsService.updateRecord('wmkf_ai_runs', SCRATCH_GUID, ...)` to seed the v2 prompt scratch row (the one `prompt-resolver.js` reads)

**Cross-system links from `wmkf_ai_run`:**
- `wmkf_ai_Prompt@odata.bind` → `wmkf_ai_prompt` (which prompt was used)
- `wmkf_ai_Request@odata.bind` → `akoya_request` (which grant request was processed)
The prompt link is always written for governed prompt execution; the request
link is caller-supplied and must be passed by request-bound producers.
Migration plans touching either entity must preserve these foreign keys.

**Migration disposition:** stays in Dataverse. No Postgres counterpart. Dynamics Explorer treats `wmkf_ai_run` as an operational log, not business data: `pages/api/dynamics-explorer/chat.js` denies direct schema requests for the table and strips `wmkf_ai_run` hits from Dataverse Search results before tool output reaches Claude.

## `wmkf_ai_prompt`

**Source of truth:** Dataverse-only. Holds prompt rows for the Executor v3 contract.

**Entity set:** `wmkf_ai_prompts`

**Schema (verified 2026-05-07 via `fetchCurrentPrompt`, now in `lib/services/prompt-store.js` — moved out of `execute-prompt.js` in S222):** `wmkf_ai_promptid`, `wmkf_ai_promptname`, `wmkf_ai_systemprompt` (Memo), `wmkf_ai_promptbody` (Memo), `wmkf_ai_promptvariables` (Memo, JSON), `wmkf_ai_promptoutputschema` (Memo, JSON), `wmkf_ai_model` (String — per-prompt model override), `wmkf_ai_temperature` (Decimal), `wmkf_ai_maxtokens` (Integer), `wmkf_promptversion` (Integer — note: NO `_ai_` infix), `wmkf_ai_iscurrent` (Boolean — `fetchCurrentPrompt` filters on this), `wmkf_ai_promptstatus` (Picklist — seed scripts write `PROMPTSTATUS_PUBLISHED`). Full attr list deferrable; probe `EntityDefinitions(LogicalName='wmkf_ai_prompt')` if more fields surface.

**Read paths (verified 2026-05-07; updated S222):**
- `lib/services/prompt-store.js` `fetchCurrentPrompt` — the canonical fetch (a dependency-free leaf extracted from `execute-prompt.js` in S222 so the streaming reviewer routes can resolve bodies without importing the non-streaming Executor). Reads via direct `DynamicsService.queryRecords('wmkf_ai_prompts', { filter: \`wmkf_ai_promptname eq '...' and wmkf_ai_iscurrent eq true\`, top: 2 })`; throws typed `PROMPT_NOT_FOUND` / `PROMPT_DUPLICATE_CURRENT` on 0/≥2 current rows. **Does NOT go through `prompt-resolver.js`.**
- `lib/services/execute-prompt.js` — imports `fetchCurrentPrompt` from `prompt-store.js` (Executor v3 path; behavior unchanged, covered by the Executor regression test).
- `lib/services/reviewer-prompt-resolver.js` `resolveReviewerPrompt` (S222) — runtime resolver for the two `reviewer-finder.*` prompts: per-user override (`wmkf_appuserpreferences`) → Dataverse `iscurrent` row (via `prompt-store`) → in-repo code template fallback. Called by `ClaudeReviewerService.analyzeProposal` / `generateDiscoveredReasoning`; the A7 preamble is composed in code (`reviewer-prompt-composer.js`), never in the editable body. Fails loud on structural corruption.

**Write paths:**
- Connor edits in Dynamics directly (per `project_dynamics_as_prompt_ground_truth.md` — staff-readable/editable prompts).
- `scripts/seed-phase-i-summary-prompt.js`, `scripts/seed-phase-ii-prompts.js` (4 `phase-ii.*` rows), `scripts/seed-reviewer-finder-prompts.js` (2 `reviewer-finder.*` rows), `scripts/seed-peer-review-summarizer-prompts.js` (2 `peer-review-summarizer.*` rows) — **upsert** prompt rows keyed on `wmkf_ai_promptname` + `wmkf_ai_iscurrent` (update-in-place when current). LEGACY pattern; not yet converted (a separate audited sweep — S269 Codex review).
- **Seed governance (S269) — `lib/services/prompt-seed.js`, the GO-FORWARD default for Tier-1 system prompts.** The grantee title/abstract, Initial Assessment, Review Synthesis, and local Pre-Site Visit proposal-core seeds use it: **create-only by default** (refuses if ANY row for the name exists — admin's versioned history is never clobbered; the file is a bootstrap artifact, not the live state), and **`--force` is version-preserving** (publishes `max(version)+1` as a new current row, flips priors with ETag — same invariant as the admin publish path). Stamps `wmkf_ai_publisheddatetime` on every version. **Dataverse `wmkf_ai_prompts` is the source of truth; after bootstrap, `/admin` versioned publish is the governed edit path.** Admin publish can change body, system prompt, validated output-schema JSON, and `wmkf_ai_model` only by creating a new immutable version. It checks the editor's expected version, validates the complete template/schema, and rejects unreviewed models; native-structured prompts additionally require a reviewed compatible concrete model whose output limit covers the stored token budget. Provenance is legible via `createdon` (version created) / `wmkf_ai_publisheddatetime` (domain publish) / `modifiedon` (last touch) / `_modifiedby_value` (seed = app identity, admin = superuser). Rationale: [[project-prompt-governance]].
- **Pre-Site Visit proposal core (Production-live durable app slice and prompt,
  2026-08-17):**
  `shared/config/prompts/pre-site-visit-proposal-core.js` defines the reviewed
  eight-field, pass-through native-JSON contract and
  `scripts/seed-pre-site-visit-proposal-core-prompt.js` provides a create-only
  bootstrap with concrete `claude-sonnet-4-6`. The proposal helper lives
  at `lib/services/pre-site-visit/proposal-core-service.js`: it selects the exact
  AI Materials narrative, supplies the authoritative Dataverse roster, passes
  the exported `REQUIRED_SYSTEM_ASSERTIONS` as `assertSystemIncludes`, and sets
  `requireNoPersistence:true` at the Executor target boundary. The durable
  `pre-site-visit/artifact-service.js`, paired template renderer, authenticated
  Workbench tab, and registry-returning route are Production-live. The route
  accepts no model override; the current Admin-published prompt version owns
  the concrete Claude model. Create-only bootstrap published v1
  `cbf1bc38-ec99-f111-b8db-6045bd008868`; after its completed controlled run
  failed rendered-layout acceptance, version-preserving publication created
  sole-current v2 `1d276948-ed99-f111-b8db-70a8a59cded0` with tighter overview
  limits on reviewed `claude-sonnet-4-6`. Controlled Request `1002379` run
  `5bd65180-ed99-f111-b8db-7ced8d6e2f44` then produced a four-page DOCX that
  passed structural and rendered-page QA. Signed-in Admin publication then
  created sole-current v3 `f2c9ce97-f499-f111-b8db-7ced8d6e2f44`, preserving
  the v2 variables, schema, model, temperature, and token budget while adding
  the revised page-length and personnel instructions. A direct exact-v3
  Request `1002379` model/render QA produced a 145-word degree-free Personnel
  paragraph with only the two Dataverse roster names underlined. Its 574-word
  Background/Methodology pair spilled the final sentence to page 4, so the
  soft one-page target remained a pre-deployment tuning follow-up. Because local production
  writes are correctly denied by the target interlock, this direct transport
  QA intentionally created no `wmkf_ai_run`. All three prompt versions and the
  earlier runs remain as governed history. **[VERIFIED IN PRODUCTION
  2026-08-17]** signed-in Request `1002379` completed governed v3 run
  `ba0f42b9-849a-f111-b8db-6045bd008868` and linked it to Ready Request
  Document row `aeb223a2-849a-f111-b8db-70a8a59cded0`. The row persists the
  eight named business fields, immutable source/output snapshots, stable
  SharePoint item `01G4GVMS3Q5BJ65S7DDZDKFTSQLIQAIPER`, and current request
  pointer. Its input manifest contains the exact Proposal Narrative and no
  bibliography. Exact Ready retry reused the same run/row/item. The rendered
  Production document fits Background and Methodology on page 3 and passes the
  agreed personnel rules.
  **[VERIFIED IN PRODUCTION 2026-08-18]** Application commit `46903bc4` reached
  Ready deployment `dpl_HGogbJnprevoYKLaxevamxdajtC4`; the audited Admin
  publisher then created sole-current v4
  `74409f95-509b-f111-b8db-6045bd008868`. Readback selected exactly one current
  row and matched the tracked body, system prompt, variables, complete output
  schema, `claude-sonnet-4-6`, temperature `0.3`, and token budget `16384` with
  zero mismatches. No request generation or SharePoint write was used for this
  release verification.
  **[VERIFIED IN PRODUCTION 2026-08-27]** The prompt was later re-published as
  sole-current **v5** — unattributed (the owner does not recall doing it;
  Admin publisher audit trail unchecked), content-identical to the tracked
  contract per the runtime exact-match preflight. The owner-approved signed-in
  smoke on Request `1002852` closed the generation proof: an 08-18 owner-run
  v4 generation (run `ea2f6d9c-5d9b-f111-b8db-70a8a5ae4225`) plus a fresh
  2026-08-27 v5 generation (artifact `c0a211b1-77a2-f111-b8db-70a8a5b16486`,
  run `c3143de2-77a2-f111-b8db-6045bd0a1ac2`) both reached Ready with the two
  durable editorial warnings, and an unchanged second retry returned the
  identical artifact/run/file (exact no-duplicate). The prompt-version bump
  correctly changed the generation key (fresh generation rather than reuse of
  the 08-18 row).
- **Two-tier prompt/preference model (S269):** *Tier 1* — shared **system/core** prompts here in `wmkf_ai_prompts`, versioned. *Tier 2* — **per-user** overrides that LAYER over a Tier-1 base: the S222 reviewer-finder override (`pages/api/reviewer-finder/prompt-override.js`, the `PREFERENCE_KEYS` user-preference store), default sourced from the Tier-1 base, `staleOverride` when the base version advances. A new prompt goes in Tier 1 if system/superuser-run; Tier 2 if per-user (e.g. email text).
- **`initial-assessment.generate` production bootstrap (2026-07-30):**
  create-only seed published version 1
  `fc8a4c3b-5e8c-f111-ab0f-7ced8d3d15a6` with the exact tracked
  system/body/variables/output schema and hash-only raw-output retention. A
  repeat dry-run refused to overwrite the existing name, confirming the
  version-history guard. The production entity held 20 prompt rows after this
  seed. The controlled Request `1002788` pilot created completed run
  `b7ae9b17-628c-f111-ab0f-000d3a31c468` against this prompt with
  `claude-sonnet-5`. The run used an old Phase I proposal, so it is mechanics
  evidence rather than approved Phase II semantic evidence. Its
  `wmkf_ai_request` lookup is null because the Initial
  Assessment producer deployed for that rehearsal omitted `requestId` from
  `executePrompt()`; the registry still links the exact run to the exact
  request artifact. Production commit `9c88a1fa` now passes the request GUID
  and asserts it in focused tests. The canonical-input Request `1003109`
  production run `528b97af-768c-f111-ab0f-7ced8d3d15a6` subsequently proved
  the live `_wmkf_ai_request_value` equals
  `b2a683cb-ec6f-f111-ab0d-000d3a306d45`. The historical `1002788` pilot run
  remains null and append-only. The later controlled interrupted-finalization
  retry reused the same Request `1003109` run; the request still had exactly
  one Initial Assessment AI run after recovery.
- **`review-synthesis.generate` production publication (2026-07-26):** the
  authenticated superuser admin route published current v2
  `7423049a-3f89-f111-ab0f-7ced8d3d15a6` and retired v1
  `d97a4a17-6977-f111-ab0f-000d3a306da2` under request
  `codex-review-synthesis-multiselect-2026-07-26`. The final
  `prompt_publish_audit` row is `completed` with no warnings. Only the system
  prompt changed; v1's complete body/system/variables rollback payload and all
  before/after hashes remain in the owner-only archived publication receipt
  (SHA-256
  `50b7a4974e6bcd5e7dd1135bf1edd228f300fe42de406d5951c3ca10dbdbe428`).
  Its redundant ignored source copy was disposed under
  `docs/audits/local-operational-data-retention-audit-2026-07-27.md`.
- **Controlled v2 executions (2026-07-26 and 2026-07-27):** three Request
  #1002788 synthesis attempts failed before writeback with
  `Claude output not valid JSON: Unexpected end of JSON input`. All resolved
  the current v2 prompt (`wmkf_ai_maxtokens=8000`); the first two required
  failed audit rows are `f5aa3712-4789-f111-ab0f-6045bd018a07` and
  `04805a39-4789-f111-ab0f-6045bd018deb`. The 2026-07-27 bounded follow-up
  created failed run `be61f383-f289-f111-ab0f-70a8a59cded0`
  (`2026-27-07-1355`) with `claude-sonnet-5`, prompt version 2,
  `wmkf_ai_runsource=682090003` (Vercel Interactive), both request and prompt
  lookups, and a redacted 2,825-character `reviews_digest` override. The API
  returned HTTP 500; the request synthesis memo remained byte-for-byte at its
  pre-smoke 1,709-character value and prior modified timestamp. The synthetic
  review was fully restored while this append-only audit row intentionally
  remained.
- **Reliability change and production proof (2026-07-28):** the Executor
  preserves complete joined response text and stop
  metadata, rejects every non-`end_turn` result before persistence, and applies
  failure-output retention inside the audit diagnostic envelope.
  `review-synthesis.generate` is configured to opt into capability-gated
  Anthropic native JSON-schema output, and its service performs at most one
  semantic retry only for the typed `max_tokens` termination, with a bounded
  larger budget. Each invocation independently attempts its own append-only
  `wmkf_ai_run` row; a successful second attempt records
  `semanticAttempt=2` and `retryOf=<first run GUID>` in notes when the first
  audit write returned an id. Version-preserving publication created governed
  v3 `660d7e3f-9e8a-f111-ab0f-000d3a31c468` as the sole current row with exact
  tracked system/body/variables/schema/model/settings. The controlled Request
  `1002788` smoke completed on the first semantic attempt with `end_turn`,
  persisted valid synthesis, and wrote completed AI run
  `20aec518-9f8a-f111-ab0f-6045bd018deb` against prompt version 3 with the
  redacted override and latency/token/boundary diagnostics. Exact cleanup
  removed the 11 staged answers and restored four parent fields while
  preserving the synthesis and append-only audit.
- **Controlled automatic lifecycle proof (2026-07-28):** with
  `REVIEW_SYNTHESIS_AUTOMATION_ENABLED=true` in Production, the bounded drain
  found exactly one eligible request, enqueued and completed job `2` in one
  attempt, and wrote completed AI run
  `1b882cf6-bf8a-f111-ab0f-7ced8d3d15a6` against prompt version 3 using
  `claude-sonnet-5`, `end_turn`, and `semanticAttempt=1`. The automatic
  invocation uses the existing `PowerAutomate Auto` run-source option; the
  initial `Vercel Cron` label was rejected by Dataverse before any model call
  and was corrected in PR #98. Exact cleanup removed only the 11 staged answer
  rows and restored the four parent review fields while intentionally
  preserving the new request synthesis and append-only run/job/maintenance
  audit records. The post-cleanup census returned to zero eligible requests,
  and a post-PR-#99 production drain again scanned 25 requests with zero
  eligible, claimed, completed, cancelled, or failed jobs.
- **Executor budget settings (Production-deployed / owner-viewed 2026-08-30;
  first publication open):** the Production Admin panel reported no published
  revision and the reviewed code fallback, without performing a write.
  `lib/services/executor-budget-service.js` resolves the Pre-Site
  standing output/transport budget and review-synthesis retry range from the
  highest valid append-only `wmkf_appsystemsettings` row keyed
  `executor.budgets.vNNNNNN`. The superuser-only
  `/api/admin/executor-budgets` publisher accepts one complete closed schema,
  requires the highest reserved numeric revision as `expectedVersion` plus a UUID request id, checks code-owned numeric
  bounds and both current prompts' resolved model output ceilings, creates the
  next alternate-key row, and verifies that exact row before success. Prefix
  reads page to completion; alternate-key create races reread current state;
  canonical request-id replay is idempotent only for the same payload and returns
  the actual current revision alongside its publication receipt. Prompt
  publication performs the inverse strict budget/model check before changing a
  governed prompt's model, including seed/recovery writes. The final Executor
  seam caps server-owned overrides to the resolved model ceiling, covering the
  remaining concurrent-publication interleaving; review synthesis additionally
  requires the final capped retry budget to exceed its first attempt before the
  provider call. Existing revisions are immutable. A malformed row is reported
  in `storageWarnings`, excluded from the valid-publication set, and still
  reserves its well-formed numeric key; repair therefore publishes at the next
  unused revision without losing idempotency checks over every parseable row.
  Unknown future schema versions block publication with a typed 409. The Admin
  keeps a conflicting local draft separate from current server state and
  requires an explicit field-level reapply or reset before another publish.
  Runtime reads are server-owned and use the highest valid revision, falling
  back to the reviewed S466/S467 code values on a settings outage or when no
  valid revision exists; strict Admin reads fail closed only on the backend
  read failure.
  `pre-site-visit/proposal-core-service.js` reads the standing pair before its
  Executor call, and `review-manager/synthesize-reviews-service.js` reads the
  retry pair only after a typed `claude_output_truncated` first attempt. No
  runtime request body accepts budget authority. The Dataverse entity's own
  table-level audit remains disabled, so history is supplied by the immutable
  revision rows themselves rather than claimed platform audit events.
- Production prompt writes occur through controlled admin publication or seed
  operations; ordinary prompt execution remains read-only on this entity.

**The two prompt paths (important):**

1. **v2 path (`prompt-resolver.js`)** — reads from a single scratch row on `wmkf_ai_runs`. **Used only by scripts** (no live API route uses it). Bundled-`.js` fallback when Dynamics is unreachable. Holdover from S103.
2. **v3 path (`execute-prompt.js`)** — reads from `wmkf_ai_prompts` directly. The Executor contract destination. The `phase-i-dynamics-v2` route (`pages/api/phase-i-dynamics/summarize-v2.js`) calls `executePrompt`, NOT `prompt-resolver.js`.

These are independent. Don't conflate them.

**Migration disposition:** strategic destination for staff-facing prompts (per memory: *"all staff-facing prompts (content readable/editable by non-technical staff). New prompts default there; migrate user-driven apps when touched"*). This remains a light-adoption surface; expand as Executor-mode apps land.

## `prompt_publish_audit` (Postgres — append-only)

**Source of truth:** Postgres-only. Append-only audit trail for superuser-initiated `wmkf_ai_prompt` versioned publishes from the `/admin` prompt editor (S222). Modeled on `policy_publish_audit` (see `docs/atlas/dataverse-wmkf-policy-and-policy-version.md`): Dataverse has no `$batch` transaction, so the publish (create new `iscurrent` row → flip the prior row's `iscurrent=false`) is non-atomic; a `pending` row is written before the first mutation and a `final` row after, paired by a route-minted `request_id`. As of the 2026-08-16 local contract, idempotency is bound to a versioned canonical fingerprint of body, system prompt, variables, output schema, model, temperature, and max tokens. Reusing a request id for a changed payload is a 409, and recovery compares that full fingerprint rather than body text alone.

**Schema:** migration `019_prompt_publish_audit.sql` (mirrored into `scripts/setup-database.js` V34). Columns: `request_id`, `prompt_name`, `target_version`, `new_prompt_id`, `prior_prompt_id`, `body_hash`, `profile_id` (→ `user_profiles`), `phase` (`pending`/`final`), `status` (incl. invariant statuses `no_current_row` / `duplicate_current_rows`), `outcome_json`, `warnings_json`, `created_at`. The legacy-named `body_hash` column now stores fingerprint version 2's canonical publish-payload hash; `outcome_json` records `fingerprintVersion`, `priorModel`, and `newModel`. No schema migration was required.

**Write path:** `pages/api/admin/prompts/[name].js` (superuser) — the versioned-publish route. Prompt content is not stored here (it lives on the `wmkf_ai_prompt` row); only hashes and audit metadata.

**Migration disposition:** stays Postgres. Parallels `policy_publish_audit`; no Dataverse counterpart.

## Naming gotcha

The spec calls these `wmkf_ai_*` (single underscore between `wmkf` and `ai`); the entity set names use the same plural pattern (`wmkf_ai_runs`, `wmkf_ai_prompts`). The cruft `wmkf__ai_summary` field on `akoya_request` (double underscore) is unrelated and should be ignored — it's been flagged for deletion.
