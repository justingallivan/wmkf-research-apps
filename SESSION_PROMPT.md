# Session 251 Prompt: SerpAPI→free-stack migration — plan converged + Slice 1a shipped; Slice 1b is next

> **GIT.** All S250 work is on `main`. ⚠ At S250 stop the branch was **13 commits ahead of
> origin** (this session's 6 + the S249 set the S249 prompt wrongly marked "pushed"). `/stop`
> pushed them — confirm `git status` shows up to date at S251 start; if not, `git push origin main`.
> Working tree clean at handoff.

## Session 250 — what happened

Worked **item 1 from the S249 next-steps**: the **SerpAPI → free-stack migration** (the carryover
— SerpAPI is the largest monthly expense, ~$150/mo, value eroded). Justin steered it as a careful
plan-first, Codex-gated effort. **Scoped → planned → Codex-reviewed the design twice → shipped +
hardened Slice 1a → Codex-reviewed the impl twice.** No endpoint has been swapped yet; Slice 1a is
purely additive (no production behavior change).

### What was completed

1. **Migration plan — `docs/REVIEWER_FINDER_SERPAPI_MIGRATION_PLAN.md` (the central artifact).**
   Verified all **7 SerpAPI engine call-sites** across 3 services (`serp-contact-service`,
   `literature-search-service`, `integrity-service`). **KEEP** #1 contact `google` + #7
   `google_news` (irreplaceable); **REPLACE** the rest. Locked two decisions (both verified live):
   - **Metrics → OpenAlex, not Semantic Scholar** — OpenAlex `summary_stats` gives h_index **+
     i10_index** + cited_by_count (S2 lacks i10); already in-repo + SSRF-allowlisted.
   - **Verified-email-domain guard re-sourced from OpenAlex** institution `homepage_url`
     (ROR-resolved, ORCID-anchored) — better than Scholar's self-reported domain. Email *sourcing*
     (PubMed/ORCID/Claude/SerpAPI Tier-4) is **untouched** by the whole migration.

2. **Slice 1a — OpenAlex-author identity contract in the resolver — SHIPPED + Codex-converged
   (`395294e`, hardening `8a7ce2e`).** Codex's pre-impl HIGH: the enrichment path has **no**
   OpenAlex author evidence today (resolver sees only scholar+orcid anchors; `_attachScholarMetrics`
   gates on Scholar's own mismatch flags), so removing Scholar removes the trust gate — the
   contract must land first. Built it in `reviewer-identity-resolver.js`:
   `evidenceFromEnrichment` reads `tierResults.openalex_author`; new `openAlexAuthorAnchor` is an
   **allowlist** (prove-good) — passes ONLY on a proven ORCID match (`orcid`==`claimedOrcid`) or a
   persist-worthy + non-contradicted spine verdict; everything else → rejected anchor → abstain.
   Codex post-impl caught the gate was originally **fail-OPEN** on unknown shapes (BLOCKED verdict)
   — fixed. 3rd Codex pass: **CLEAN-TO-BUILD-1B**.

### Commits (6)
`a134d2e` plan · `885e577` fold pre-impl review · `1c5d05c` fold re-review ·
`395294e` Slice 1a · `8a7ce2e` Slice 1a hardening · `066daa7` 3rd-pass disposition + 1b constraints.

## Potential Next Steps

### 1. Slice 1b — metrics + domain endpoint swap (THE next task; depends on 1a, now clean)
Rewrite `ContactEnrichmentService._attachScholarMetrics` to: resolve the OpenAlex author
(`getAuthorByOrcid` on the ORCID path; the `reviewer-identity-evidence` spine on the no-ORCID
path), fetch metrics from OpenAlex (extend `mapAuthorRecord` to surface h/i10/cites + institution
ref), re-source the domain via a new `OpenAlexService.getInstitution`, **write the
`tierResults.openalex_author` DTO**, and retire the Scholar calls (`findScholarProfileViaGoogle` +
`fetchScholarMetrics`) in `serp-contact-service.js`. `findContact` (#1) stays.
- **⚠ Two 1b producer authoring constraints (Codex 3rd-pass LOWs — in the plan):**
  (a) source `orcid`+`claimedOrcid` only from the real `getAuthorByOrcid` lookup (the resolver
  compares but does NOT checksum-validate — the upstream validation is the guard); (b) pass only
  the canonical `mapAuthorRecord.openAlexId`, never an assembled URL.
- Field/provenance reconcile (durable, in the plan): `affiliationSource` gains `openalex_current`;
  decide explicitly on the `scholarVerifiedEmail`→`verifiedInstitutionDomain` rename (spans
  code+tests+smoke+docs) or keep the name; expand the consumer checklist.

### 2. Slices 2 & 3 (after 1b)
- **Slice 2:** literature/PI-pubs `google_scholar` → OpenAlex works (reuses `getWorksByAuthor`);
  explicit `googleScholar` key/`source`-string compatibility decision.
- **Slice 3:** PubPeer `site:pubpeer.com` → PubPeer Developer API — **gated** on verifying the API
  exists/terms; needs SSRF-allowlist add + `PUBPEER_API_KEY`; scope includes `screenApplicants`
  source gating + `sources.pubpeer` shape compat. `searchNews` (#7) stays.
- **Post-migration:** confirm real SerpAPI call volume in the billing dashboard → decide on the
  Hobby-tier downgrade (~$100/mo saved; Justin, out-of-repo).

### 3. Older carryover (verify-before-acting — unchanged)
- Recall padding-ceiling live check before raising count >15 (needs API key + real proposal).
- Reviewer COI **Chunk 2b** (retire `POTENTIAL_CONCERNS`) — ⚠ destructive, deferred.
- Trim the analyze prompt's dead Stage-1 `searchQueries`.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_FINDER_SERPAPI_MIGRATION_PLAN.md` | The migration plan — slices, DTO, 1b constraints, 3 Codex disposition logs |
| `lib/services/reviewer-identity-resolver.js` | Slice 1a: `openAlexAuthorAnchor` + `evidenceFromEnrichment` openalex_author read |
| `tests/unit/reviewer-identity-resolver.test.js` | 44 tests incl. the 1a allowlist/fail-closed/canonicalization cases |
| `lib/services/contact-enrichment-service.js` | `_attachScholarMetrics` (the 1b rewrite target) + `_validateEmailAgainstVerifiedDomain` |
| `lib/services/serp-contact-service.js` | Scholar calls to retire in 1b (#2 `findScholarProfileViaGoogle`, #3 `fetchScholarMetrics`); `findContact` (#1) stays |
| `lib/services/openalex-service.js` | `getAuthorByOrcid` (exists); 1b adds metrics to `mapAuthorRecord` + new `getInstitution` |
| `lib/services/reviewer-identity-evidence.js` | The OpenAlex/ORCID spine 1b's no-ORCID path reuses (`evaluateSuggestion`) |

## Gotchas
- **`git commit -m "…"` with backticks corrupts the message** — backticks inside double quotes are
  command-substituted by bash (ate `orcid`/`claimedOrcid` this session; amended `8a7ce2e`). Use
  single-quoted `-m '…'`, or `-F <file>`.
- **Slice 1a is additive — nothing writes `tierResults.openalex_author` yet**, so live behavior is
  unchanged until 1b lands the producer. The agent-wiki / D26 flowchart reconcile happens at
  migration *completion*, not now (resolver behavior in production is unchanged).
- **`grep`/`rg` may still corrupt identifiers+digits** (`project-rtk-grep-output-corruption`) — use
  Read for exact content/line numbers; trust grep only for *which files* match.
- Reviewer-finder is access-locked to Justin only.
</content>
