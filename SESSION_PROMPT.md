# Session 223 Prompt: reviewer-finder improvements — timeout, recency-weighted ID, Perplexity

## ⭐ Top of the agenda — three topics Justin flagged EOD S222 (discuss/scope first)
Full notes: [[project-reviewer-finder-next-topics]] (read it). Summary:
1. **Extend / make-configurable the Claude reviewer-call timeout.** Justin nearly lost a search to a timeout. All reviewer routes are at `maxDuration: 300` (5 min); **`discover.js` is the long pole** (DB searches + per-batch Claude + enrichment). Wrinkle: `maxDuration` is a STATIC build-time export — not per-request runtime-configurable. Realistic levers: raise to the Vercel plan's hard cap (verify it; Fluid Compute on Pro can exceed 300s) and/or make the `llm-client.js` 120s-timeout+3-retry budget tunable. Decide the value + mechanism.
2. **Recency-weighted reviewer identification.** Candidates have a long digital tail (grad → postdoc → current). The footprint is dominated by the *postdoc* (more papers/presence) but we want the *current* role (e.g. a new professor — sparse but correct). Use dated signals you already pull (ORCID employment history + Scholar publication years) to pin + up-weight the current affiliation over the historical tail. Touches `contact-enrichment-service.js`, the identity resolver, and `rankByRelevance`. Hard part: "most evidence wins" picks the wrong (postdoc) affiliation.
3. **Perplexity's role in reviewer finding/disambiguation.** Confirmed S222: Perplexity is wired ONLY into the Virtual Review Panel (`vrp-providers.js`, `multi-llm-service.js`) — NOT reviewer-finder, no `PERPLEXITY_*` key set. Discussed before in [[project-reviewer-identity-resolution-phase1]]. Decide its role (web-grounded "where are they now" disambiguation dovetails with #2) vs. the existing SerpAPI/Scholar/ORCID path.

## ⏰ Standing context / guardrails (carried S197–S222)
- **`main` auto-deploys to prod on push. Feature branches do NOT deploy.** Commit/push only when asked. One-shot operator scripts + SQL migrations hit prod directly when run locally (`.env.local` → prod Dataverse + prod Postgres).
- **`rtk` is FULLY UNINSTALLED** on both machines (S221). Do NOT prefix commands with `rtk`. See [[project-rtk-grep-output-corruption]].
- **THREE reminder hooks LIVE** (`.claude/settings.json`, all machines): PreToolUse `scope-claim-reminder.js`; PreToolUse `doc-edit-reconcile-reminder.js` (on any `docs/`/`.claude-memory/`/`CLAUDE.md`/`SESSION_PROMPT.md`/`AGENTS.md` edit: read the WHOLE file + grep repo + fix every instance); PostToolUse `codex-verbatim-reminder.js` (paste Codex output VERBATIM before acting).
- **Memory frontmatter gotcha (S222 incident):** the harness auto-memory reformatter strips/re-nests frontmatter; a colon inside an unquoted `last_verified` value broke YAML → `memory-router` red on main. Valid `status:` values are **active / stale / closed / superseded** only. Keep memory values colon-free or quoted; verify `npm run check:memory-router` after any memory edit.
- **Local-dev hits prod.** jest live-harness pattern (proven S220/S222): `@jest-environment node` + manual `.env.local` load + real `fetch` via `undici` + `loadModelOverrides()` before `analyzeProposal`. Throwaway harnesses only — delete after.

## Session 222 Summary — SHIPPED: reviewer-finder prompts → Dataverse (admin + per-user editable)
The headline: migrated the reviewer-finder analysis + score-candidates prompts from code into the Dataverse `wmkf_ai_prompt` store, runtime-resolved (per-user override → Dataverse → code fallback), with a superuser `/admin` versioned-publish editor and an in-app per-user override editor. **Deployed to prod + live-verified** (analyze resolves `source=dataverse` v1, bioRxiv fix present). 4-round Codex design review pre-build + a post-impl Codex pass; built "on auto" via remote control. 1924 tests + all 10 gates green. See [[project-reviewer-prompt-dataverse-migration]] (status: closed) + DEVELOPMENT_LOG.

Earlier in the session (the original S222 task that surfaced this): fixed the reviewer-search "Analysis returned no result" — `analyze` `maxDuration` 90→300 (`503c77e`), SSE heartbeat + clearer message (`701fbce`), and a **bioRxiv per-database query fix** (broadened from methods-only to PubMed parity, `3f5cb60`). Also saved a Dataverse custom-table reference doc (`02d1ee7`).

### Commits (18 this session)
- `503c77e`/`701fbce`/`3f5cb60` — analyze timeout + heartbeat + bioRxiv query fix
- `118d64f`→`5f8400c` — migration foundation: prompt-store leaf, resolver, validators, audit table, runtime flip, Codex-review fixes
- `b46edd8`/`a40130c` — admin versioned-publish API + UI
- `91b26b3` — per-user override endpoint + editor UI
- `7dfd827` — (merge to main = deploy)
- `c5337da` — admin panel lists ALL prompts incl. drafts
- `02d1ee7` — Dataverse 143-table reference doc
- `2b89b77`/`20d2754`/`5a8dada` — memory docs (+ the frontmatter gate-red fix)

## Other open items (lower priority than the three top topics)
1. **Deferred from the migration:** `wmkf_ai_rollbackfrom` is NOT written by admin publish (field type Lookup-vs-text unverified). Probe the field type, then wire it in `pages/api/admin/prompts/[name].js`. Lineage currently captured by `prompt_publish_audit.prior_prompt_id`.
2. **Connor's prompts (pending his reply):** `wmkf_ai_prompt` is the sole Dataverse prompt store (143-table dump confirmed). His "other" prompts are likely PA-embedded; if so, lift them into `wmkf_ai_prompt` rows → the admin panel administers them automatically.
3. **Reviewer-workflow validation walkthrough** (Find→Invite→Track→Completed) — still never completed end-to-end (carried since S220).
4. **Reviewer-app consolidation (destructive — grep first):** retire legacy `reviewer-finder`/`review-manager` keys now Workbench has parity. [[project-reviewer-apps-redesign-direction]].
5. **Intake virus-scan EICAR e2e** — parked pre-cycle must-do. [[project-intake-portal-virus-scan-e2e-deferred]].

## Key Files Reference (S222 migration)
| File | Purpose |
|------|---------|
| `lib/services/prompt-store.js` | Dependency-free leaf: `fetchCurrentPrompt`/`interpolate` + typed error codes |
| `lib/services/reviewer-prompt-resolver.js` | Three-tier resolve (override→Dataverse→code) + runtime body validation |
| `lib/services/reviewer-prompt-composer.js` | `[code A7 preamble] + [interpolated body]`; byte-parity with `createAnalysisPrompt` |
| `lib/utils/prompt-validators.js` | Browser-safe generic + per-prompt parse-contract validators |
| `pages/api/admin/prompts/{index,[name]}.js` | Superuser list + versioned publish (policies.js protocol) |
| `pages/api/reviewer-finder/prompt-override.js` | Grant-gated per-user override (sole write path) |
| `shared/components/admin/PromptTemplatesSection.js` / `reviewers/ReviewerPromptOverridePanel.js` | Admin + per-user editor UIs |
| `lib/db/migrations/019_prompt_publish_audit.sql` | Audit table (mirrors policy_publish_audit) |
| `docs/DATAVERSE_CUSTOM_TABLES_2026-06-05.md` | 143-table reference snapshot |

## Testing
```bash
npx jest reviewer prompt-store prompt-validators reviewer-prompt admin-prompts prompt-override  # the S222 suites
npx jest                                                        # full suite (1924 green at S222)
# live harness pattern (throwaway, hits prod): @jest-environment node + .env.local + undici; see project-reviewer-finder-next-topics
# full gate set (matches /start):
for g in migrations-manifest api-routes atlas doc-currency fact-consistency canonical-pointers drain-table-mentions prompt-storage-mentions prompt-injection-tagging memory-router; do npm run check:$g; done
```
