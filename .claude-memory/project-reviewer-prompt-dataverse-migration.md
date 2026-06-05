---
name: reviewer-finder-prompt-dataverse-migration
description: "S222 — reviewer-finder analyze + score-candidates prompts migrated from code to Dataverse wmkf_ai_prompt, with a superuser /admin versioned-publish editor + per-user overrides. Path A seam. SHIPPED on main 2026-06-04 (deploy 7dfd827)."
metadata: 
  node_type: memory
  type: project
  status: closed
  scope: prompt
  last_verified: "2026-06-04 (live smoke 1002788 — analyze resolved source=dataverse v1, bioRxiv fix present)"
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

## SHIPPED (2026-06-04, on `main` @ 7dfd827; 10-commit branch merged)
All three prod-mutating steps ran + verified: (1) `seed-reviewer-finder-prompts.js --execute` updated both rows in prod Dataverse; (2) migration `019_prompt_publish_audit.sql` applied to prod Postgres; (3) merged to main + Vercel prod deploy Ready. Post-deploy live smoke (1002788) confirmed analyze resolves `source=dataverse` v1 with the bioRxiv fix present. 1924 unit tests + all 10 CI gates green. Codex post-impl review passed (its 2 P1s — runtime body validation + reserved-key block — fixed pre-deploy).

**Live surfaces:** runtime resolver `lib/services/reviewer-prompt-resolver.js` + composer `reviewer-prompt-composer.js`; admin editor `/admin` → "Prompt Templates" (`pages/api/admin/prompts/*` + `PromptTemplatesSection.js`); per-user editor `/api/reviewer-finder/prompt-override` + the "✎ Edit prompts" panel in `ReviewerSearchSection`.

## Deferred follow-up
- `wmkf_ai_rollbackfrom` is NOT written by the admin publish (field type Lookup-vs-text unverified — a wrong write shape would fail the create). Lineage is captured by `prompt_publish_audit.prior_prompt_id`. Probe the field type, then wire it in `pages/api/admin/prompts/[name].js`.

See [[project-prompt-storage-strategy]] for the wmkf_ai_prompt schema/Executor contract.
