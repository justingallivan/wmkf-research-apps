---
name: Prompt governance — two tiers, Dataverse source of truth, create-only seeds
description: Tier-1 system prompts (Dataverse wmkf_ai_prompts, versioned, create-only seed + version-preserving --force) vs Tier-2 per-user overrides; where a new prompt goes and how seeds behave
type: project
status: active
scope: prompts
last_verified: 2026-10-22 source and bounded metadata reconciliation; prompt bodies/execution and deployment state not inspected
---

**Dated evidence boundaries:** Publication/deployment observations below were verified on
2026-08-18. The read-only evidence artifact
`docs/audits/memory-live-state-evidence-2026-10-22.json` contains metadata for 39 distinct
prompt names with current rows (`wmkf_ai_iscurrent=true`) from a complete metadata query. The
lookup does not independently filter prompt status. It does not include prompt contents or prove
execution, and is not a deployment smoke test. Link to that dated artifact rather than
creating a mutable prompt inventory. The owner-confirmed create-only/versioning governance below
remains durable policy; individual legacy upsert seeds remain separate exceptions.

## Recall Rule

Read this before adding a new prompt, writing/editing a seed script, or touching the
`/admin` prompt panel or `lib/services/prompt-seed.js`. Canonical detail lives in the Atlas
(`docs/atlas/dataverse-wmkf-ai-run-and-prompt.md` → Write paths); this is the intent + routing.

## The decision (owner-confirmed S269)

**Two tiers — put a new prompt in the right one:**
- **Tier 1 — system/core prompts** (run by the system and/or superusers; e.g.
  `grantee-title.generate`, `grantee-abstract.generate`). **Dataverse `wmkf_ai_prompts` is the shared
  source of truth, and these are version-tracked.** Edits go through `/admin` versioned publish.
- **Tier 2 — per-user prompts/preferences** (e.g. the text of an email): a default is sourced from a
  Tier-1 base, then **overridden per-user** via the S222 user-preference store
  (`pages/api/reviewer-finder/prompt-override.js`, `PREFERENCE_KEYS`), which layers over the base and
  flags `staleOverride` when the base version advances. Versioning Tier-2 is a nice-to-have, **lower
  priority** (owner).

**Seed governance (`lib/services/prompt-seed.js`) — go-forward default for Tier-1 seeds:**
- **Create-only by default** — refuse if ANY row for the prompt name already exists (current OR
  non-current). The seed file is a **bootstrap artifact, not the live state**; after bootstrap, `/admin`
  is the governed (versioned, audited) edit path. The git file will intentionally LAG the live prompt.
- **`--force` is version-preserving** — publishes `max(version)+1` as a new current row + flips priors
  with ETag (same invariant as the admin publish path). It **never** resets version in place. (This was
  the Codex pre-impl BLOCKER — the old seeds did an in-place overwrite + `version:1` reset.)
- Duplicate-current → force refuses (resolve in Dynamics; no auto-repair). Post-create verification
  asserts exactly one current (no alternate key on `promptname` — probed S269).
- Current callers are the grantee title/abstract, Initial Assessment, Review
  Synthesis, and Pre-Site Visit proposal-core seed scripts. The Pre-Site seed
  published v1, then version-preserving `--force` published sole-current v2
  after the first controlled document failed layout acceptance. Signed-in Admin
  publication subsequently created sole-current v3 with the revised page-length
  and personnel instructions. On 2026-08-18 the audited Admin publisher created
  sole-current v4 with the tracked resilience output schema and preserved body,
  system prompt, variables, model, temperature, and token settings. Legacy upsert seeds (`phase-ii`, `reviewer-finder`,
  `peer-review-summarizer`, `phase-i-summary`) remain a separate audited sweep.

**Pre-Site resilience boundary recorded 2026-08-18:** that review reported
pre-side-effect validation of body, variables, schema and assertions, full
publication readback, and sole-current v4 matching the then-tracked schema.
The 2026-10-22 metadata artifact includes a current-row version number for each
returned prompt name, but it does not establish prompt contents or smoke status.

**Admin model/schema publication (observed 2026-08-18; current live status unknown):** the Prompt Templates editor
can select `wmkf_ai_model` and edit the validated output-schema JSON; either
change publishes a new immutable
version. The PUT requires the editor's expected version, binds request-id
retries to a canonical fingerprint of all effective content/model/execution
fields, and records prior/new model values in audit JSON. Native structured
output refuses blank/tier models and accepts only a reviewed compatible
concrete id within its max-output-token capability. Commit `f10dff3f` is an
ancestor of Production deployment commit `abfe5529`; the Admin publish route
had not received a separate post-deploy runtime smoke in that August record;
current smoke status is UNKNOWN.

**Provenance / timestamps:** Dataverse auto-stamps every version row — `createdon` (version created),
`modifiedon` (last touch — a version-flip rewrites it, so NOT authorship for history rows),
`_modifiedby_value` (seed = the app/integration identity, admin publish = the superuser). The seed +
admin publish both set `wmkf_ai_publisheddatetime` (domain publish time). The `/admin` panel surfaces
these (S269).

⚠️ **Hazard recorded 2026-08-18 (current status unknown):** the review then identified that admin `PUT` could edit a prompt's `variables`, while the file config-pin test and A7 gate did not validate the LIVE row's declarations. Do not present this as a confirmed current vulnerability without checking the current writer, consumers, and gates. The recorded source-built Pre-Site producer was an exception because it performed its own preflight; whether that version remains current is unknown.

Related: [[project-dynamics-as-prompt-ground-truth]], [[project-phaseistatus-decision-lifecycle]].
