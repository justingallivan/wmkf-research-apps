# Atlas: `wmkf_ai_run` + `wmkf_ai_prompt` (Dataverse)

**Last verified:** 2026-07-30 for governed `initial-assessment.generate` v1
production provisioning and the 20-row prompt count; 2026-07-28 for governed
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
- **Seed governance (S269) — `lib/services/prompt-seed.js`, the GO-FORWARD default for Tier-1 system prompts.** The two grantee seeds (`seed-grantee-title-prompt.js`, `seed-grantee-abstract-prompt.js`) use it: **create-only by default** (refuses if ANY row for the name exists — admin's versioned history is never clobbered; the file is a bootstrap artifact, not the live state), and **`--force` is version-preserving** (publishes `max(version)+1` as a new current row, flips priors with ETag — same invariant as the admin publish path). Stamps `wmkf_ai_publisheddatetime` on every version. **Dataverse `wmkf_ai_prompts` is the source of truth; after bootstrap, `/admin` versioned publish is the governed edit path.** Admin publish clones the prior row's Executor metadata, and rejects an unreviewed concrete Claude `wmkf_ai_model` before writing a new version. Provenance is legible via `createdon` (version created) / `wmkf_ai_publisheddatetime` (domain publish) / `modifiedon` (last touch) / `_modifiedby_value` (seed = app identity, admin = superuser). Rationale: [[project-prompt-governance]].
- **Two-tier prompt/preference model (S269):** *Tier 1* — shared **system/core** prompts here in `wmkf_ai_prompts`, versioned. *Tier 2* — **per-user** overrides that LAYER over a Tier-1 base: the S222 reviewer-finder override (`pages/api/reviewer-finder/prompt-override.js`, the `PREFERENCE_KEYS` user-preference store), default sourced from the Tier-1 base, `staleOverride` when the base version advances. A new prompt goes in Tier 1 if system/superuser-run; Tier 2 if per-user (e.g. email text).
- **`initial-assessment.generate` production bootstrap (2026-07-30):**
  create-only seed published version 1
  `fc8a4c3b-5e8c-f111-ab0f-7ced8d3d15a6` with the exact tracked
  system/body/variables/output schema and hash-only raw-output retention. A
  repeat dry-run refused to overwrite the existing name, confirming the
  version-history guard. The production entity held 20 prompt rows after this
  seed. The controlled Request `1002788` pilot created completed run
  `b7ae9b17-628c-f111-ab0f-000d3a31c468` against this prompt with
  `claude-sonnet-5`. Its `wmkf_ai_request` lookup is null because the Initial
  Assessment producer omitted `requestId` from `executePrompt()`; the registry
  still links the exact run to the exact request artifact. This is a verified
  lineage defect, not a claim that the run belongs to no request.
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
- Production prompt writes occur through controlled admin publication or seed
  operations; ordinary prompt execution remains read-only on this entity.

**The two prompt paths (important):**

1. **v2 path (`prompt-resolver.js`)** — reads from a single scratch row on `wmkf_ai_runs`. **Used only by scripts** (no live API route uses it). Bundled-`.js` fallback when Dynamics is unreachable. Holdover from S103.
2. **v3 path (`execute-prompt.js`)** — reads from `wmkf_ai_prompts` directly. The Executor contract destination. The `phase-i-dynamics-v2` route (`pages/api/phase-i-dynamics/summarize-v2.js`) calls `executePrompt`, NOT `prompt-resolver.js`.

These are independent. Don't conflate them.

**Migration disposition:** strategic destination for staff-facing prompts (per memory: *"all staff-facing prompts (content readable/editable by non-technical staff). New prompts default there; migrate user-driven apps when touched"*). This remains a light-adoption surface; expand as Executor-mode apps land.

## `prompt_publish_audit` (Postgres — append-only)

**Source of truth:** Postgres-only. Append-only audit trail for superuser-initiated `wmkf_ai_prompt` versioned publishes from the `/admin` prompt editor (S222). Modeled on `policy_publish_audit` (see `docs/atlas/dataverse-wmkf-policy-and-policy-version.md`): Dataverse has no `$batch` transaction, so the publish (create new `iscurrent` row → flip the prior row's `iscurrent=false`) is non-atomic; a `pending` row is written before the first mutation and a `final` row after, paired by a route-minted `request_id` (also the idempotency key, with `body_hash` dedup).

**Schema:** migration `019_prompt_publish_audit.sql` (mirrored into `scripts/setup-database.js` V34). Columns: `request_id`, `prompt_name`, `target_version`, `new_prompt_id`, `prior_prompt_id`, `body_hash`, `profile_id` (→ `user_profiles`), `phase` (`pending`/`final`), `status` (incl. invariant statuses `no_current_row` / `duplicate_current_rows`), `outcome_json`, `warnings_json`, `created_at`.

**Write path:** `pages/api/admin/prompts/[name].js` (superuser) — the versioned-publish route. The prompt BODY is not stored here (it lives on the `wmkf_ai_prompt` row); only audit metadata.

**Migration disposition:** stays Postgres. Parallels `policy_publish_audit`; no Dataverse counterpart.

## Naming gotcha

The spec calls these `wmkf_ai_*` (single underscore between `wmkf` and `ai`); the entity set names use the same plural pattern (`wmkf_ai_runs`, `wmkf_ai_prompts`). The cruft `wmkf__ai_summary` field on `akoya_request` (double underscore) is unrelated and should be ignored — it's been flagged for deletion.
