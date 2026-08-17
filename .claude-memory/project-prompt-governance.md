---
name: Prompt governance — two tiers, Dataverse source of truth, create-only seeds
description: Tier-1 system prompts (Dataverse wmkf_ai_prompts, versioned, create-only seed + version-preserving --force) vs Tier-2 per-user overrides; where a new prompt goes and how seeds behave
type: project
status: active
scope: prompts
last_verified: 2026-08-16 — local prompt-model publication safeguards folded; live promotion not performed
---

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
  Synthesis, and Pre-Site Visit proposal-core seed scripts. The pre-site script
  is local and unexecuted. Legacy upsert seeds (`phase-ii`, `reviewer-finder`,
  `peer-review-summarizer`, `phase-i-summary`) remain a separate audited sweep.

**Admin model publication (local 2026-08-16):** the Prompt Templates editor
can select `wmkf_ai_model`; a model-only change publishes a new immutable
version. The PUT requires the editor's expected version, binds request-id
retries to a canonical fingerprint of all effective content/model/execution
fields, and records prior/new model values in audit JSON. Native structured
output refuses blank/tier models and accepts only a reviewed compatible
concrete id within its max-output-token capability. These changes are not yet
promoted or live-probed.

**Provenance / timestamps:** Dataverse auto-stamps every version row — `createdon` (version created),
`modifiedon` (last touch — a version-flip rewrites it, so NOT authorship for history rows),
`_modifiedby_value` (seed = the app/integration identity, admin publish = the superuser). The seed +
admin publish both set `wmkf_ai_publisheddatetime` (domain publish time). The `/admin` panel surfaces
these (S269).

⚠️ **Open hazard (separate from this work):** the admin `PUT` can edit a prompt's `variables`, and
neither the file config-pin test nor the A7 gate validates the LIVE row's untrusted declarations — so a
superuser edit could weaken the A7 boundary on the live path undetected. Tracked as a follow-up, not
fixed here.

Related: [[project-dynamics-as-prompt-ground-truth]], [[project-phaseistatus-decision-lifecycle]].
