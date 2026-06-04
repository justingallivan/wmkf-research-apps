# Session 216 Prompt: Reviewer ORCID de-fragmentation + later resolver PRs (or new work)

## ⏰ Standing context / guardrails (carried S197–S215)
- **Falsification hook is LIVE** (`.claude/hooks/scope-claim-reminder.js`). Run the *disconfirming* query before asserting scope/quantity into docs/memory. It earns its keep — S214 caught "3 persons" that was really 8; S215 the pool was "300+" but really 4,269. Authoritative lint = `npx eslint . -f json` keyed on `ruleId`/`severity`, **but eslint is NOT installed locally** (npx tries to fetch it) — lint runs in CI only; rely on jest + `node --check` locally.
- **Codex via the RESCUE PATH works well** — `Agent(subagent_type: 'codex:codex-rescue')`. S215 ran 5 reviews (1 design + 4 review/rounds) cleanly; one early run stalled because **Codex has no outbound network** (its live ORCID probe failed) — feed it captured data, tell it not to fetch. The **stop-time review GATE is still disabled**; rescue path is the reliable way. **Deliver Codex output VERBATIM** ([[feedback-share-codex-verbatim]]).
- **`main` auto-deploys to prod.** All S215 work is pushed (`9e14291`→`84e4d06`) and verified deployed (build Ready, prod site 200).
- **CI-green ≠ correct for async/effect/UI/outward-facing code.** Manual smoke is mandatory ([[feedback-profile-context-runtime-bugs]]). S215's whole arc started from one such smoke surfacing a latent bug CI couldn't see.
- **Local-dev auth bypass:** `AUTH_REQUIRED=false NEXTAUTH_SECRET=dev-throwaway NEXTAUTH_URL=http://localhost:3000 ./node_modules/.bin/next dev`. Local-dev and prod hit the SAME prod Dataverse — no isolated test store.
- **Ad-hoc prod-Dataverse probes/writes:** `.env.local`-loading mjs pattern; adapters need `bypassDynamicsRestrictions(...)`. Person logical name `wmkf_potentialreviewers` (entity set `wmkf_potentialreviewerses`). The metadata `Attributes` endpoint **501s on `$filter startswith`**; `queryAllRecords` requires a `$filter`.
- **ORCID + NCBI creds are now SET in prod + `.env.local`** (Preview+Production scope). Vercel marks new secrets "Sensitive" → `vercel env pull` returns them EMPTY; paste by hand ([[project-vercel-sensitive-env-pull-empty]]). ORCID public-API search uses SOLR; special-character names can 500 (caught → null).

## Session 215 Summary

Started as the carried-over **manual Workbench smoke** of the S214 resolver; it surfaced that **ORCID had never actually worked**, which cascaded into a fix + a new resolver rule + a prod backfill.

### What was completed
1. **Found + fixed a latent ORCID parser bug** (`9e14291`) — `searchByName` read `family-name` but ORCID's expanded-search returns **`family-names`** (plural), so every record's familyName was undefined → name-match gate rejected all → `findContact` always returned null → ORCID never contributed an anchor → resolver `probable` unreachable → all reviewer ORCID/bibliometric persistence was blocked + cleared on re-enrich. Creds were also unset in prod (now set), masking it. Regression test exercises the raw-response mapping (prior tests mocked *above* it).
2. **Corroborated-ORCID strong-anchor rule** (`5693a80`, design §3.1) — an ORCID matched on **name AND institution** is now a STRONG anchor → `probable` on its own (the design's "one strong anchor" rung, previously unimplemented). Bare name-match stays weak → unresolved. Auditable anchor `orcid_public_institution_corroborated` + matched institution in `parserOutput`; `RESOLVER_VERSION` 1.0.0→1.1.0-pr1.
3. **Measured the real ORCID rate** (read-only) — random sample of 250 of **4,269** reviewers: ~42% resolve to an unambiguous ORCID (32.8% institution-corroborated, 8.8% lone). ORCID×Scholar cross-tab: `probable`-today 30%, +7.2% new-unlock from corroborated-alone, ~4.4% kept-gated (common-name risk). Scripts: `measure-orcid-resolution-rate.js`, `measure-scholar-orcid-crosstab.js`.
4. **Codex review ×3 rounds → SHIP-READY** (`f5729db`/`59465bb`/`84e4d06`) — folded test-gap + doc-reconcile fixes, then route-handler clear-on-downgrade coverage (a must-fix for the two live write paths), then the final nice-to-haves. 1781 tests green.
5. **Prod ORCID backfill** (`scripts/backfill-orcid-identity.js`) — resumable two-phase (`--resolve` read-only → audit JSONL; `--apply` writes eligible). Wrote **1,532 corroborated ORCIDs** to `wmkf_potentialreviewers` via the same gated adapter path production uses. Pool went **1 → 1,533** rows with an ORCID, 0 failed, independently re-counted in Dataverse.

### Commits (this session, newest first)
`84e4d06` Q5 cleanup + backfill tooling · `523e63e` memory · `59465bb` route-handler coverage · `f5729db` Codex test/doc fixes · `5693a80` corroborated-ORCID strong anchor · `9e14291` family-names fix

## Potential Next Steps

### 1. ⭐ ORCID as a cross-store join key (the strategic payoff)
1,533 reviewers now carry an authoritative ORCID. Use it to start **de-fragmenting the disjoint reviewer identity stores** ([[reviewer-identity-fragmentation]]): match `wmkf_potentialreviewers.wmkf_orcid` against `contact` / honorarium `akoya_request` / GOapply objects to collapse duplicate humans onto one identity. Probe first (how many cross-store matches does ORCID actually resolve?), then design.

### 2. Finish ORCID capture coverage (the residual)
- **Lone ORCID + clean Scholar (~4.4%)** — these reach `probable` via 2 weak anchors in the *normal* enrichment flow but were skipped by the ORCID-only backfill. A second backfill pass that also runs Scholar would catch them (cost: SerpAPI ×~4k). Or let normal enrichment pick them up.
- **Special-character names** that 500 ORCID's SOLR search — sanitize the query in `searchByName` and re-run `--resolve` (resumable; it'll only re-touch un-checkpointed rows if you clear them).

### 3. Phase 2 later resolver PRs (specced in the design doc, not built)
- **PubMed-cluster + faculty-page verification** → unlocks the `confirmed` status (resolver tops out at `probable`). Cluster invariants: recurring coauthors + stable affiliation lineage + topical coherence.
- **Postgres `identity_leads` + rejected-anchor memory** (only needed when web leads land).
- **Perplexity Search-API lead source** (`/search`, not sonar; anchors from `results[].url` only; A7-wrap; needs a live contract test).

### 4. Carried reviewer follow-ons (from S213, still open)
- Per-user **signature** into the Workbench invite (`workbench/[requestId].js` passes only `session.profileName`; wire the `SENDER_INFO` pref).
- **Co-investigator COI parity** in `discover.js` (enrich-recommended folds co-Is; shared discover checks PI only).
- Grant `reviewers` app access to pilot PDs + validate `/workbench` with a real PD login.

### 5. Intake virus-scan EICAR e2e — STILL parked pre-cycle must-do
[[project-intake-portal-virus-scan-e2e-deferred]]. Needs deployed env + Entra applicant session.

## Key Files Reference
| File | Purpose |
|------|---------|
| `docs/REVIEWER_IDENTITY_RESOLVER_PHASE2_DESIGN.md` | Design + §3.1 corroborated-ORCID strong anchor (shipped) |
| `lib/services/reviewer-identity-resolver.js` | Deterministic classifier; `orcidEval` (strong/weak), `resolveIdentity`, gates |
| `lib/services/orcid-service.js` | `searchByName` (family-names), `findContact` (+ `institutionCorroborated`/`matchedInstitution`) |
| `lib/dataverse/adapters/researcher.js` | `upsertByPotentialReviewer` + `writeIdentityDecision` + `clearIdentityFields` |
| `pages/api/reviewer-finder/save-candidates.js`, `pages/api/workbench/enrich-recommended.js` | Gated write paths (route-handler tested) |
| `scripts/backfill-orcid-identity.js` | Resumable two-phase ORCID backfill (`--resolve`/`--summary`/`--apply`) |
| `scripts/measure-orcid-resolution-rate.js`, `scripts/measure-scholar-orcid-crosstab.js` | Read-only ORCID/Scholar rate measurement |

## Testing
```bash
npx jest                                    # full suite (1781)
npx jest tests/unit/reviewer-identity-resolver.test.js tests/unit/reviewer-identity-guard.test.js tests/unit/reviewer-route-identity-gate.test.js tests/unit/save-to-database-identity-gate.test.js
node --check lib/services/orcid-service.js  # eslint NOT installed locally; lint is CI-only
npm run check:atlas && npm run check:api-routes && npm run check:fact-consistency
# ORCID backfill is DONE (1,532 written). Do NOT re-run --apply; checkpoints are gitignored/local.
```
