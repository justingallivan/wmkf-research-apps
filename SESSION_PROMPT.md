# Session 267 Prompt: Build the reviewer contact-leads layer (Slice 1 = measure first)

> **STRATEGIC PIVOT (S266).** Stop hardening reviewer *identity precision*; the headline pain is contact
> *recall* — candidates surface without emails that are web-discoverable by hand. Build the contact-leads
> layer. See `feedback-prioritize-contact-recall-over-identity-precision.md`.
> **TEMP audit log LIVE in prod** (`d0fb1ef5`, `[Discover API] S266 generation audit`) — kept intentionally;
> revert when done reviewing generation/exclusion behavior.

## Session 266 — what happened

Started as "implement reviewer data-quality fixes," shipped those, then chased reviewer enrichment
quality through several Codex loops, and ended on a deliberate **pivot to contact recall** with an
aligned design.

### Shipped to prod (all pushed)
1. **Reverted S265 temp debug log** — `e7ba970f`.
2. **Candidate data-quality fixes (Fix 1-5)** — `a07e3f0f` + `56e5368e`. Shared `ContactParser.isDocumentUrl`
   rejects document-file URLs as websites/faculty pages at every surface (website gate, faculty gate, email-tier
   fetch, capture/persist/read/render); honorifics stripped from display name at `normalizeSuggestionSource`.
   Fix 5 closed a Codex-found HIGH fan-out leak (facultyPageUrl rendered/persisted raw). Codex post-impl reviewed.
3. **Scholar label fix** — `145e0add`. "Scholar profile" only for a real `citations?user=` URL via
   `isRealScholarProfileUrl`; the search-style URLs enrichment stores now correctly read "Scholar search."
4. **ORCID author-split metrics fix** — `6dccd743` + `8c386173` (Codex MEDIUM hardening). `getRichestAuthorByOrcid`
   queries `?filter=orcid:` and picks the richest entity, so a split ORCID (Landsman: a 1-work stub + the real
   139-work record) no longer lands the stub. Codex-reviewed identity-safe.
5. **TEMP generation audit log** — `d0fb1ef5` (still live). Logs generated vs verified vs needsReview vs
   droppedByFilters per search.

### Design aligned, NOT implemented
6. **Contact-leads / scout layer** — `2e4b43b3`. `docs/REVIEWER_CONTACT_LEADS_SPEC.md` (Codex-updated) +
   `docs/REVIEWER_CONTACT_LEADS_REVIEW.md` (Claude review + Codex **GO-WITH-CHANGES**). A quarantined
   `contactLeads[]` layer: search aggressively for staff breadcrumbs, never feed safe email/website/persist/invite
   fields. **This is the S267 work.**

### Parked (deliberately deprioritized — do NOT pick up before the leads layer)
7. **OpenAlex affiliation-history widening** — Codex design review GO-WITH-CHANGES (match all of
   `last_known_institutions`, not just `[0]`). Diagnosed root cause of Olga Smirnova → needs-review: OpenAlex
   flipped her last-known institution to Technion (proposal places her at Max Born Institute), breaking the
   affiliation anchor; the ORCID-name promotion can't rescue a name that common. Required changes (matched-institution
   metadata carried through anchors, a secondary-match gate requiring forename/ORCID corroboration, tests) are in the
   S266 transcript + the agent-wiki reviewer-identity hazard note. **Parked behind recall work per the pivot.**

### Prod data operations (not commits)
- 1002794 reviewer corrections: fixed 3 misspelled applicant names in `wmkf_potentialreviewer` (Ahn-Thu→Anh-Thu Le,
  Tom→Thomas Weinacht, Alexandria→Alexandra Landsman); cleared the find roster to its 5 applicant rows; re-enriched
  them against the deployed ORCID-split fix → **Landsman now h-index 25 / 139 works** (was the 1-work stub). Le still
  abstains (no ORCID anchor + common name — expected).
- **Deleted 15 orphaned encrypted `api_key_*` prefs** from `wmkf_appuserpreferences` (3 owners × 5 keys). These were
  dead legacy data (keys are env-var-centralized; `getDecryptedApiKey` has no live callers) that produced the
  "Decryption failed" log noise. Fixed at the source.

## Potential next steps for S267

### 1. Contact-leads layer — Slice 1 FIRST (the agreed build)
Per `REVIEWER_CONTACT_LEADS_REVIEW.md` build order: **Slice 1 = measurement/audit** (classify missing-email by
reason: verified_present / withheld_by_gate / search_skipped_no_anchor / searched_no_result / has_page_no_email /
lead_found_not_persisted / namesake_ambiguous / identity_unresolved / provider_error). The dominant-bucket split is
a **measurement question, not an assumption** (Codex correction: the search gate reads `_effectiveInstitution` =
`orcidAffiliation`/`affiliation`/`institution`/`primaryAffiliation`, NOT `suggestedInstitution`). Then Slice 2a
(surface already-discarded Claude/Serp results + page URLs as `contactLeads`, no new network calls — note the
SerpAPI name-mismatch email is destroyed in place at `contact-enrichment-service.js:612`, so add a pre-null capture
hook) + faculty-page-as-lead. Then display, promotion, then (only if Slice 1 justifies) the broad paid scout.

### 2. Revert the temp generation audit log (`d0fb1ef5`) when done
`[Discover API] S266 generation audit` in `pages/api/reviewer-finder/discover.js`. Kept for now to watch generation
coverage; remove + redeploy when finished.

### 3. (Parked) affiliation-history identity fix — only after the leads layer

## Continuity guardrails
- **Pivot is set:** recall over identity-precision. Don't open another namesake/affiliation fix before the leads layer.
- TEMP audit log is LIVE in prod (`d0fb1ef5`); revert it eventually.
- 1002794: 5 applicant rows, re-enriched; non-applicant cleared. A new search re-surfaces literature candidates.
- Contact-leads safety invariant: leads stay quarantined; a wrong-person email must never reach an auto-invite.

## Key Files Reference
| File | Role |
|------|------|
| `docs/REVIEWER_CONTACT_LEADS_SPEC.md` | The scout-layer spec (Codex-updated, the S267 build) |
| `docs/REVIEWER_CONTACT_LEADS_REVIEW.md` | Claude review + Codex GO-WITH-CHANGES + verified premise |
| `lib/services/contact-enrichment-service.js` | enrich tiers; `_effectiveInstitution`/`hasIdentityAnchor` gate (:487), discard sites (:511/:593/:612) |
| `lib/services/openalex-service.js` | `getRichestAuthorByOrcid` (ORCID-split fix); `mapAuthorRecord` (only `last_known_institutions[0]`) |
| `lib/services/reviewer-identity-evidence.js` | spine `scoreRecord`/`selectRecord`/`buildAnchors` (affiliation match) |
| `pages/api/reviewer-finder/discover.js` | has the TEMP generation audit log to revert |
| `shared/components/reviewers/reviewer-search-logic.js` | `mergeEnrichment`/`pruneCandidateForRoster` (lead persistence plumbing) |

## Testing
```bash
npm run build && npm run lint
npm test                       # FULL suite (~2616 tests as of S266)
npm run check:agent-wiki && npm run check:fact-consistency && npm run check:doc-currency
```
