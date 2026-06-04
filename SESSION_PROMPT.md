# Session 217 Prompt: Build reviewer ORCID back-propagation (PR1) — or new work

## ⏰ Standing context / guardrails (carried S197–S216)
- **Falsification hook is LIVE** (`.claude/hooks/scope-claim-reminder.js`). Run the *disconfirming* query before asserting scope/quantity into docs/memory. It earns its keep — S216 it caught an action-breakdown that summed to 1,531 not 1,532 (email-dedup), and forced the "contact is email-only" assumption to be falsified (contact HAS native `wmkf_orcid`). Authoritative lint = `npx eslint . -f json`, **but eslint is NOT installed locally** — lint runs in CI only; rely on jest + `node --check` locally.
- **Codex via the RESCUE PATH works well** — `Agent(subagent_type: 'codex:codex-rescue')`. S216 ran 2 clean passes (pre-impl 24 findings + confirmation 6). **Codex has no outbound network** — feed it captured data, tell it not to fetch. **SendMessage to continue an agent is NOT available in this harness** — spawn a fresh rescue agent for follow-ups (it shares the filesystem, reads the doc directly). The stop-time review GATE is still disabled. **Deliver Codex output VERBATIM** ([[feedback-share-codex-verbatim]]).
- **`main` auto-deploys to prod.** Commit/push only when asked ([[CLAUDE.md git policy]]).
- **CI-green ≠ correct for async/effect/UI/outward-facing code.** Manual smoke is mandatory ([[feedback-profile-context-runtime-bugs]]).
- **Local-dev auth bypass:** `AUTH_REQUIRED=false NEXTAUTH_SECRET=dev-throwaway NEXTAUTH_URL=http://localhost:3000 ./node_modules/.bin/next dev`. Local-dev and prod hit the SAME prod Dataverse — no isolated test store.
- **Ad-hoc prod-Dataverse probes/writes:** `.env.local`-loading pattern (CommonJS `require` works; the S216 probes use it). Adapters need `bypassDynamicsRestrictions(...)`. Person logical name `wmkf_potentialreviewers` (set `wmkf_potentialreviewerses`). Metadata `Attributes` endpoint **501s on `$filter startswith`** but **DOES accept `$filter LogicalName eq '…'`** (used S216). `queryRecords` caps at one page; raw `@odata.nextLink` paging avoids the 5000 cap (S216 probes do this).
- **ORCID/NCBI creds SET in prod + `.env.local`.** Vercel marks new secrets "Sensitive" → `vercel env pull` returns them EMPTY ([[project-vercel-sensitive-env-pull-empty]]).

## Session 216 Summary

Carried-over next-step #1 ("probe how many cross-store matches ORCID resolves") → grew into a full probe → spec → 2× Codex-review design loop for **reviewer ORCID back-propagation**. **Design is build-ready; no code written yet (stopped at design per request). All S216 commits are LOCAL — not pushed.**

### What was completed
1. **Three read-only cross-store probes** (`a24f807`, `fff1895`) measuring ORCID's cross-store reach:
   - Pool: 4,269 reviewers, 1,533 with ORCID (1,532 `probable`, 1 null-status); only 2 promoted to a contact, 0 ORCID-bearing.
   - **Within-pool dedup**: 24 ORCIDs on >1 row (48 rows → 24 humans); **23 of 24 email would miss** (ORCID's cleanest win).
   - **reviewer→contact**: 183 email matches; direct ORCID↔ORCID only 18 (+2 beyond email).
   - **honorarium akoya_request**: 49/87 paid reviewers in pool (all by email), 18 ORCID-resolved.
   - **Falsified assumption**: `contact` HAS a native `wmkf_orcid` (423 populated, 14 malformed) — but it's a GOapply *applicant* population (100% created by "# BCO akoyaGO Integration", 52% are PIs via `wmkf_projectleader`), largely disjoint from reviewers. **Provenance settled**: ORCID is captured at GOapply intake.
2. **Design doc** `docs/REVIEWER_ORCID_BACKPROPAGATION_DESIGN.md` (`ee99393`→`63bd94d`, rev1→rev3): push the 1,532 resolver-gated reviewer ORCIDs onto matched `contact.wmkf_orcid` so it becomes a durable join key. De-fragmentation = a FLOW problem, not a one-shot collapse.
3. **Two Codex passes** (rescue path): pre-impl (24 findings) + confirmation (3 resolved / 3 partial / 0 new arch). Both folded.
4. **Gated action breakdown measured**: 162 WRITE / 14 noop / **0 conflict** / 0 malformed / 7 ambiguous / 1,348 no-contact → backfill yield **162 writes**.
5. **Audit-capability probe** settled provenance WITHOUT new schema: `contact.wmkf_orcid IsAuditEnabled=true`, `RetrieveRecordChangeHistory(contact)`=200 (bulk `/audits`=403). Native audit = durable provenance/rollback.
6. Memory `reviewer-identity-fragmentation` updated with the S216 measurement.

### Commits (this session, newest first; ALL LOCAL/UNPUSHED until you push)
`63bd94d` design rev3 (confirmation pass) · `65cd092` design rev2 (24 findings) · `cd0b0c9` design + §8 decisions · `ee99393` design rev1 · `fff1895` provenance probe · `a24f807` cross-store probes · (+ this session-doc commit)

## Potential Next Steps

### 1. ⭐ Build PR1 — the runtime back-prop forward-flow
Per `docs/REVIEWER_ORCID_BACKPROPAGATION_DESIGN.md` §12. **Gating work item (Codex confirmation pass §13, HIGH): the caller field-hydration contract** — the shared helper reads `wmkf_orcid`/`wmkf_identitystatus`/`_wmkf_contact_value` but NO call site loads all three today. Do that plumbing first:
- `send-emails.js` person `$select` (~L145) — add `wmkf_orcid,wmkf_identitystatus`.
- honorarium path: `verify-suggestion-token.js` select (~L77) — add the three fields (flows via `respond.js`).
- `enrich-recommended.js` — retain the fetched person (it's discarded after affiliation ~L149→L251).
Then: centralized ORCID normalizer (+checksum) · NEW separate `resolveForBackprop` (top:2; leave `findByEmail`/`findOrCreateByEmail` UNTOUCHED) · `contactAdapter.setOrcidIfAbsent` (re-read by contactid; data-states return status, operational errors throw; conditional `If-Match` PATCH — `updateRecord` supports `options.ifMatch`) · shared `backPropReviewerOrcidToContact` helper wired to all 3 sites · tests (§10).

### 2. PR2 — one-shot historical backfill (162 writes)
`scripts/backfill-contact-orcid.js`, mirroring `backfill-orcid-identity.js` (resolve/summary/apply, group-by-contactId, `status_null` exception). Then verify by `(contactId, reviewerId)` (§9). Run it.

### 3. PR3 (later) — close the flow at intake
Carry ORCID through the intake portal applicant-suggested-reviewer capture.

### 4. Carried reviewer follow-ons (from S213, still open)
- Per-user **signature** into the Workbench invite (`workbench/[requestId].js` passes only `session.profileName`; wire `SENDER_INFO`).
- **Co-investigator COI parity** in `discover.js`.
- Grant `reviewers` app access to pilot PDs + validate `/workbench` with a real PD login.

### 5. Intake virus-scan EICAR e2e — STILL parked pre-cycle must-do
[[project-intake-portal-virus-scan-e2e-deferred]]. Needs deployed env + Entra applicant session.

### 6. ORCID capture residual (from S215)
- Lone ORCID + clean Scholar (~4.4%) — a second backfill pass running Scholar would catch them (SerpAPI cost), or let normal enrichment pick them up.
- Special-character names that 500 ORCID's SOLR search — sanitize the query in `searchByName`.

## Key Files Reference
| File | Purpose |
|------|---------|
| `docs/REVIEWER_ORCID_BACKPROPAGATION_DESIGN.md` | rev3, build-ready; §5 call sites + hydration contract, §11/§13 Codex dispositions |
| `scripts/probe-orcid-cross-store-matches.js` | Pool/dedup/contact-bridge/honorarium cross-store measurement |
| `scripts/probe-orcid-contact-direct-join.js` | Direct ORCID↔ORCID join + contact-side population |
| `scripts/probe-contact-orcid-provenance.js` | 423 contact ORCIDs = GOapply applicant population |
| `scripts/probe-dataverse-audit-capability.js` | Confirms `contact.wmkf_orcid` is audited (provenance source) |
| `lib/dataverse/adapters/contact.js` | `setOrcidIfAbsent` goes here; keep findByEmail/findOrCreateByEmail intact |
| `lib/dataverse/adapters/potential-reviewer.js` | `setContactLink` (L182); FIELD_SELECT |
| `pages/api/review-manager/send-emails.js` | PR1 call site #1 (promotion ~L300) + Candidates path |
| `lib/bill/honorarium-onboard-orchestrator.js` | PR1 call site #2 (ensureContact ~L142) |
| `pages/api/workbench/enrich-recommended.js` | PR1 call site #3 (identity writeback) |

## Testing
```bash
npx jest                                    # full suite (eslint NOT local; lint is CI-only)
node --check scripts/<probe>.js             # syntax
npm run check:atlas && npm run check:api-routes && npm run check:fact-consistency && npm run check:doc-currency
# Re-run a cross-store probe (read-only): node scripts/probe-orcid-cross-store-matches.js
# S216 probe artifacts are gitignored (scripts/.orcid-*.json — contain person data).
```
