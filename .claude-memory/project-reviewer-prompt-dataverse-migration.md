---
name: reviewer-finder-prompt-dataverse-migration-admin-per-user-editing
description: "S222 in-flight build — migrate reviewer-finder analyze + score-candidates prompts from code to Dataverse wmkf_ai_prompt, with a required superuser /admin versioned-publish editor and per-user overrides. Path A seam. 4-round Codex-reviewed plan."
metadata: 
  node_type: memory
  type: project
  status: active
  scope: prompt
  last_verified: 2026-06-04
  originSessionId: 613bb6ee-8f4b-4345-917d-032634550239
---

## Recall Rule
Read this when resuming the reviewer-finder prompt migration, or any work touching reviewer-finder prompt resolution, the /admin prompt editor, or per-user prompt overrides.

## The work
Approved, 4-round-Codex-reviewed implementation plan at `~/.claude/plans/distributed-cuddling-gizmo.md`. Branch `feat/reviewer-prompt-dataverse-migration`. Three goals: (1) resolve reviewer-finder prompt bodies from Dataverse `wmkf_ai_prompt` at runtime (no deploy to reword); (2) **required** superuser `/admin` versioned-publish editor over the prompt store; (3) per-user prompt overrides for any reviewers-grant user.

**Why:** Justin iterates on reviewer-finder prompt wording (e.g. the S222 bioRxiv per-database query fix `3f5cb60`) and each change currently needs a code deploy. Admin-editing is **core scope, not optional** (Justin corrected this explicitly).

## Locked decisions
- **Seam = Path A + shared primitives.** Resolve the body in the streaming SSE route; do NOT route through `executePrompt()` (it's non-streaming + has no per-user layer). Reuse `buildUntrustedContentPreamble` + a lifted `lib/services/prompt-store.js` (fetchCurrentPrompt/interpolate). Keep parsing/model/token code-side. Rationale: no token streaming exists today (single `client.complete()`); "streaming" = SSE progress events. Per-user override is just a body string → fits Path A, not Path B.
- Persistence: per-user override in `wmkf_appuserpreferences` via a **grant-gated** `pages/api/reviewer-finder/prompt-override.js` (NOT bare `/api/user-preferences`, which is ungated — also add a reserved-key block there). Pattern mirrors [[project-reviewer-workbench-invite-workflow]]'s email-template store.
- Scope: BOTH `reviewer-finder.analyze` and `reviewer-finder.score-candidates`.
- Admin publish = adapt `pages/api/admin/policies.js` protocol (no Dataverse `$batch`): `prompt_publish_audit` pending row, If-Match ETag flip, resume-repair, idempotency `(promptName,targetVersion,requestId)`+bodyHash, invariant = exactly one `iscurrent`. PUT clones full row (not body-only).

## Hard-won review findings (don't regress)
- A7: the untrusted-content **preamble + nonces are code-composed**, never in the editable body. Wrap `proposal_text`, `candidates_list`, AND `proposal_summary` (LLM_OUTPUT — it's prior-Claude output from the untrusted proposal). See [[project-a7-prompt-injection-hardening]].
- The seeded Dataverse `reviewer-finder.analyze` row is byte-identical to the OLD (pre-bioRxiv-fix) prompt → reconcile `reviewer-finder-dynamics.js` + re-seed BEFORE flipping reads, else the fix silently reverts.
- Resolver fallback to code template ONLY on transient/unreachable; 0/≥2 `iscurrent` rows = `PROMPT_NOT_FOUND`/`PROMPT_DUPLICATE_CURRENT` → fail loud (typed errors added when extracting prompt-store). 
- `seed-reviewer-finder-prompts.js` updates in-place at `wmkf_promptversion:1` (no bump).
- `prompt_publish_audit` must be mirrored into `scripts/setup-database.js` (fresh-install convention), not just the migration.

## Three prod-mutating steps (held for explicit confirmation while building on auto)
Dataverse re-seed `--execute`, `apply-migrations.js` to prod Postgres, push-to-main (auto-deploy). See [[project-prompt-storage-strategy]] for the wmkf_ai_prompt schema/Executor contract.
