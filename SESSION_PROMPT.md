# Session 266 Prompt: Implement reviewer data-quality fixes; revert temp debug log

> **GIT.** All S265 work is on `main`. One commit (`c3e61b3d`, the data-quality design doc) is
> **unpushed as of this writing** — push at the start of S266. Two features shipped to **prod** this
> session (email tier + ORCID-promotion); a **temporary debug log is LIVE in prod and must be reverted**.

## Session 265 — what happened

Started as the S265 "reviewer email-discovery investigation" and turned into a full design→Codex→ship
loop for two features, plus diagnosis of why a known reviewer (Bucksbaum) wasn't surfacing.

### Shipped + LIVE in production
1. **Resolved-page email tier** — `ca5e54f1` (feat) + `c8078bc7` (Codex post-impl hardening).
   When a candidate has no email but a captured faculty/profile URL on their OpenAlex-**verified**
   institution domain, the server fetches + page-grounds the address. `safeFetchInstitutionPage`
   (`lib/utils/safe-fetch.js`): HTTPS-only, host = exact-or-subdomain of `verifiedInstitutionDomain`,
   DNS private/reserved-IP block (incl. IPv6), **undici IP-pinning** (closes DNS-rebind TOCTOU),
   per-hop redirect re-validation, content-type+512KB+timeout caps. Trust gate = page-grounding
   (`_selectGroundedEmail`: name-adjacency OR page-identity+URL-slug↔local-part, unique+forename-gated),
   NOT `isNameConsistentEmail`. Stamps reserved HIGH-trust `emailSource='institution_page'`.
   **Flag-gated `REVIEWER_PAGE_EMAIL_TIER_ENABLED` — set to `true` in prod (production env).** 3 Codex
   passes (design ×2 + post-impl). **Verified working in prod**: recovered Argenti/Dudovich/Pfeifer
   `institution_page` emails (2 spot-checked correct). Design: `docs/RESOLVED_PAGE_EMAIL_TIER_DESIGN.md`.
   **Reverses the S235 zero-SSRF decision as an opt-in** — reconciled enforcement contract #7 + the
   S235 design (superseded) + agent-wiki + 2 plan docs.
2. **ORCID-name-confirmed identity promotion** — `8e54a488`. Promotes a spine-verified candidate
   `unresolved→probable` when the selected OpenAlex record's ORCID cross-source-agrees AND the ORCID
   profile's full given name confirms the suggestion's forename. Recovers prominent ORCID'd reviewers
   the verifier dropped when Claude omits/mismatches the institution. **NOT flag-gated — live on deploy.**
   Codex design + Codex implementation; Claude-reviewed + verified (Bucksbaum null-inst→probable;
   "Peter Bucksbaum" wrong-forename→abstain). Design: `docs/REVIEWER_ORCID_NAME_PROMOTION_DESIGN.md`.

### Diagnosis (no code, or design-only)
3. **Email-discovery first task** — Rudenko "no email" = (a) no faculty page captured (only a Scholar
   link, which the tier skips) + (b) multi-domain institution (`ksu.edu` page vs OpenAlex `k-state.edu`
   → fetch correctly refused; documented v1 gap). Also fixed a **malformed `.env.local` CLAUDE_API_KEY**
   (stray leading quote → local 401s; backup `.env.local.prefix-quote-bak`). Prod key was fine.
4. **Bucksbaum not surfacing = GENERATION variance, not verification** — confirmed via a TEMP debug
   log (`54cc5756`): the 15 generated names (incl. 3 Nobel laureates) simply didn't include him that
   run. The ORCID-promotion fix is proven to surface him *when* generated. The real lever is generation
   coverage (count + multi-pass dedup), not the resolver.
5. **J27 filename-match framing corrected** — `c0561f6d`. The "filename-match WILL break in J27" claim
   was unsubstantiated (Justin: no evidence; Connor pushed back). Reframed across the canonical memory
   + 3 docs: filename-match is **fragile**; durable case for Dataverse legibility = structured storage,
   strongest driver = auto-generated writeups need a structured home.

### Designed, Codex-reviewed, NOT implemented
6. **Reviewer candidate data-quality fixes** — `c3e61b3d`, `docs/REVIEWER_GENERATION_DATA_QUALITY_DESIGN.md`.
   Trigger: Kitzler-Zeiler shown as **"Prof."** (he's not) with a **co-author's paper PDF** as website.
   Codex verdict **GO-WITH-CHANGES** (4 required changes — see next steps).

## Potential next steps for S266

### 1. Implement the data-quality fixes (design ready, Codex GO-WITH-CHANGES)
Fold Codex's 4 changes into a rev-2 of `REVIEWER_GENERATION_DATA_QUALITY_DESIGN.md`, then implement:
- **Fix 1:** `isUsefulWebsiteUrl` rejects document-file URLs via `new URL(url).pathname.toLowerCase()`
  ending in `.pdf/.doc/.docx/.ppt(x)/.xls(x)/...` (try/catch malformed URLs).
- **Fix 2:** sanitize the candidate website at `DiscoveryService.normalizeSuggestionSource` (the
  confirmed single chokepoint) + defensively at BOTH merge points — `mergeEnrichment` (`e.website||c.website`)
  AND `pruneCandidateForRoster` (`c.website||e.website`, opposite order). Note the suggestion `website`
  key is **unverifiable from source** (prompt is in Dataverse) — defensive coverage.
- **Fix 3:** `stripHonorifics` on the display name at `normalizeSuggestionSource` (safe — dedup +
  verify already strip). Persisted Dataverse labels change (intentional).
- **Fix 4 (Codex-found 4th leak):** `facultyPageUrl` goes through `isFacultyPageUrl`, which has NO
  doc-extension gate — and the **new email tier fetches `facultyPageUrl`**, so a PDF there = a bad
  fetch. Add the same reject. Cleanest as a shared `ContactParser.isDocumentUrl(url)` used by both.
- Then Codex post-impl review.

### 2. Revert the temp debug log (`54cc5756`) — it's LIVE in prod
The `[Discover API] S265 generated suggestion names: …` log in `pages/api/reviewer-finder/discover.js`.
Justin asked to keep it during S265; remove + redeploy when done with generation experiments.

### 3. Fix the "Run another search" slider bug
The search-config panel (count slider, sources, notes, exclusions) only renders when
`phase==='idle'||'error'` (`ReviewerSearchSection.js:1107`). "Run another search" (`:1325`) calls
`runSearch` without returning to idle, so the **slider is hidden on re-runs**, and `reviewerCount`
resets to `DEFAULT_REVIEWER_COUNT=15` on proposal reload (`:482`) — silently capping re-runs at 15
(explains the 20→15 drift). Options: (a recommended) "Run another search" → reveal config panel
(retain prior settings); (b) inline count control next to the button; (c) persist the count.

### 4. Generation coverage (the real Bucksbaum lever — bigger design)
Per-run count is one lever (diminishing returns); multi-pass dedup already accumulates new names each
"Run another search". A "comprehensive coverage" loop-until-dry mode would systematically exhaust the
qualified pool instead of relying on lucky 15-name draws. Separate design.

### 5. Group B writeup-spine build — still blocked on Connor (unchanged from S264)

## Continuity guardrails
- **`REVIEWER_PAGE_EMAIL_TIER_ENABLED=true` is LIVE in prod** (production env var). Email tier active.
- **ORCID-name promotion is LIVE and NOT flag-gated** — revert = code revert, no flag.
- **Temp debug log is LIVE in prod** (`54cc5756`) — revert it (next step #2).
- 1002794 roster: 5 `applicant_suggested` kept; Claude/proposal rows were cleared repeatedly for
  testing (use `scripts/reset-request-reviewers.mjs` or the source_kind-scoped delete pattern; don't
  hand-roll a full wipe). Applicant rows regenerate; don't drop them.
- Push `c3e61b3d` first thing (unpushed).

## Key Files Reference
| File | Role |
|------|------|
| `lib/utils/safe-fetch.js` | `safeFetchInstitutionPage` + host/IP guards (email tier) |
| `lib/services/contact-enrichment-service.js` | `_attachEmailFromResolvedPage` / `_selectGroundedEmail` |
| `lib/services/reviewer-identity-evidence.js` | spine anchors incl. new `orcid_name_confirmed` |
| `lib/services/reviewer-identity-resolver.js` | `classifySpineEvidence` promotion paths |
| `lib/utils/contact-parser.js` | `isUsefulWebsiteUrl`/`isFacultyPageUrl`/`stripHonorifics` (data-quality fixes) |
| `lib/services/discovery-service.js` | `normalizeSuggestionSource` (data-quality ingestion chokepoint) |
| `shared/components/reviewers/ReviewerSearchSection.js` | Find tab UI + the slider bug |
| `pages/api/reviewer-finder/discover.js` | has the TEMP debug log to revert |

## Testing
```bash
npm run build && npm run lint
npm test                       # FULL suite (~2584 tests as of S265)
npm run check:api-routes && npm run check:atlas && npm run check:agent-wiki && npm run check:fact-consistency
```
