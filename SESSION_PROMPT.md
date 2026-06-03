# Session 215 Prompt: Reviewer identity resolver — smoke PR1 + later PRs (or new work)

## ⏰ Standing context / guardrails (carried S197–S214)
- **Falsification hook is LIVE** (`.claude/hooks/scope-claim-reminder.js`). Run the *disconfirming* query before asserting scope/quantity into docs/memory. It earned its keep in S214: caught a "3 persons" claim that was really 8 (filtered on the wrong field). Authoritative lint = `npx eslint . -f json` keyed on `ruleId`/`severity`.
- **Codex via the RESCUE PATH works well** — `Agent(subagent_type: 'codex:codex-rescue')` ran 5 reviews cleanly in S214 (design ×3, post-impl, Perplexity). The **stop-time review GATE is still disabled** (broke mid-S213); re-enable with `/codex:setup` if wanted, but the rescue path is the reliable way to invoke Codex. **Deliver Codex output VERBATIM** ([[feedback-share-codex-verbatim]]).
- **`main` auto-deploys to prod.** All S214 work is pushed (`347704f`→`9da5793`).
- **CI-green ≠ correct for async/effect/UI/outward-facing code.** Manual smoke is mandatory ([[feedback-profile-context-runtime-bugs]]). **← This is the #1 open item for the identity resolver (below).**
- **Local-dev auth bypass:** `AUTH_REQUIRED=false NEXTAUTH_SECRET=dev-throwaway NEXTAUTH_URL=http://localhost:3000 ./node_modules/.bin/next dev`. Local-dev and prod hit the SAME prod Dataverse — no isolated test store.
- **Ad-hoc prod-Dataverse probes/writes:** `.env.local`-loading mjs pattern; adapters need `bypassDynamicsRestrictions(...)`. Person logical name `wmkf_potentialreviewers` (trailing s). The metadata `Attributes` endpoint **501s on `$filter startswith`** — fetch all + filter in JS.
- **Dataverse schema deploys can 429 on `0x80071151` "another [Import] running"** — that's a **Microsoft managed-solution update wave** holding the org customization lock, NOT your error. Diagnose with an `importjobs` probe (`completedon` null = running); retry `apply-dataverse-schema.js` once it clears. (S214 lost ~15 min to this.)

## Session 214 Summary

A long session: appresearcher-collapse doc reconcile → reviewer identity-resolution **Phase 1 shipped** → **Phase 2 PR1 shipped** (deterministic resolver, end-to-end through the design→Codex→impl→post-impl loop).

### What was completed
1. **Appresearcher-collapse drift reconcile** (`347704f`) — 15 docs + 3 memory + 1 comment repointed off the dropped sidecar; Codex-reviewed; caught a wrong D-AFF memory belief (org-name clamp kept, not dropped).
2. **Identity resolution Phase 1** (`40d7327`) — Scholar displayed-name guard (`scholarNameMismatch`), ORCID name-scoring (`_nameMatchesTarget`), persistence gates. Fixes the Tsai→lab-member-Nakano false-match class.
3. **Prod data-governance audit + remediation** (`5bf8d3b`/`c836f4a`) — `scripts/audit-persisted-scholar-identity.js` found the persisted-Scholar footprint is **8 pinned profiles** (not "~330" — that was the affiliation backfill); 1 wrong match (Frank Noe's URL → Cecilia Clementi's profile) cleared + 5 malformed/missing id fields fixed via `scripts/remediate-scholar-identity.js`. Re-audit clean.
4. **Phase 2 design** (`ffc2cda`/`057d258`/`a5a084c`) — `docs/REVIEWER_IDENTITY_RESOLVER_PHASE2_DESIGN.md` v1→v2→v3, two Codex pre-impl rounds (v2 NEEDS-MINOR-REVISION → v3 READY-TO-IMPLEMENT).
5. **Phase 2 PR1** (`610286f`/`1f9b3a8`/`8350551`/`19a9792`/`b6bfadc`):
   - 6 `wmkf_identity*` decision fields **DEPLOYED to prod** on `wmkf_potentialreviewers` (`lib/dataverse/schema/wave6/03_*.json`; cataloged in `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md`).
   - `lib/services/reviewer-identity-resolver.js` — pure post-enrichment classifier (`resolveIdentity`, `evidenceFromEnrichment`, `mayPersistIdentity`, `RESOLVER_SOURCED_FIELDS`). PR1 rules: lone weak→unresolved, 2 corroborating weak→probable, ORCID multi-match→ambiguous, Scholar mismatch=rejected ANCHOR; `confirmed`/`rejected` not reachable in PR1.
   - Verdict threaded through `enrichCandidate._finalize`; gates ALL identity-bearing writes in `save-candidates`, `enrich-recommended`, **and** `saveToDatabase` (the 3rd path — Codex post-impl MUST-FIX); `clearIdentityFields` null-clears on downgrade; `relevance-score` counts bibliometrics only when trusted; ORCID `findContact` returns `{status:'ambiguous'}` (was bare null).
   - 1766 tests green; lint + atlas + api-routes + doc gates clean.

### Commits (this session, newest first)
`9da5793` memory · `b6bfadc` PR1 pt3 (post-impl fixes) · `19a9792` PR1 pt2 (threading) · `1f9b3a8` schema deployed · `610286f` schema-as-code · `8350551` PR1 pt1 (classifier) · `a5a084c` design v3 · `057d258` design v2 · `ffc2cda` design v1 · `c836f4a` remediation · `5bf8d3b` audit-script fix · `40d7327` Phase 1 · `347704f` doc reconcile

## Potential Next Steps

### 1. ⭐ MANUAL WORKBENCH SMOKE of the identity resolver (do this FIRST)
PR1 is live prod code touching reviewer enrichment/persistence; CI-green ≠ correct. **Smoke it via the Workbench** with a real candidate (req **1002788** is the testbed): run a reviewer search → enrich → save, and confirm: (a) a clean match persists scholar/orcid + sets `wmkf_identitystatus`; (b) a lone-signal/mismatch candidate does NOT persist scholar/orcid (and clears stale values); (c) the `wmkf_identity*` fields populate sensibly. Watch for the resolver throwing (it's non-fatal but logs).

### 2. Phase 2 later PRs (specced in the design doc, not built)
- **PubMed-cluster + faculty-page verification** → unlocks the `confirmed` status (PR1 tops out at `probable`). Cluster invariants: recurring coauthors + stable affiliation lineage + topical coherence.
- **Postgres `identity_leads` + rejected-anchor memory table** (only needed when web leads land).
- **Perplexity Search-API lead source** (`/search`, not sonar; anchors from `results[].url` only; A7-wrap; needs a live contract test). Existing `_callPerplexity` is sonar chat (returns flat `citations`); the Search API is a new small adapter.

### 3. Carried reviewer follow-ons (from S213, still open)
- Per-user **signature** into the Workbench invite (`workbench/[requestId].js` passes only `session.profileName`; wire the `SENDER_INFO` pref).
- **Co-investigator COI parity** in `discover.js` (enrich-recommended folds co-Is; shared discover checks PI only).
- Grant `reviewers` app access to pilot PDs + validate `/workbench` with a real PD login.

### 4. Intake virus-scan EICAR e2e — STILL parked pre-cycle must-do
[[project-intake-portal-virus-scan-e2e-deferred]]. Needs deployed env + Entra applicant session.

## Key Files Reference
| File | Purpose |
|------|---------|
| `docs/REVIEWER_IDENTITY_RESOLVER_PHASE2_DESIGN.md` | The approved v3 design + staged build plan (PR1 done; later PRs §9) |
| `lib/services/reviewer-identity-resolver.js` | The deterministic classifier (resolveIdentity + gates) |
| `lib/dataverse/adapters/researcher.js` | `writeIdentityDecision` + `clearIdentityFields` (+ bibliometric writeback) |
| `pages/api/reviewer-finder/save-candidates.js`, `pages/api/workbench/enrich-recommended.js` | Gated write paths |
| `lib/services/contact-enrichment-service.js` | `_finalize` attaches the verdict; `saveToDatabase` gated |
| `scripts/{audit,remediate}-scholar-identity.js` | Read-only audit + remediation of persisted Scholar identity |

## Testing
```bash
npx jest                                    # full suite (1766)
npx jest tests/unit/reviewer-identity-resolver.test.js tests/unit/reviewer-identity-guard.test.js tests/unit/save-to-database-identity-gate.test.js tests/unit/relevance-score-identity-gate.test.js
npx eslint . -f json                        # 0 errors (warnings don't gate)
npm run check:atlas && npm run check:api-routes && npm run check:fact-consistency && npm run check:doc-currency && npm run check:drain-table-mentions
# Identity fields already DEPLOYED — do NOT re-run the wave6 deploy (idempotent, but no need).
```
