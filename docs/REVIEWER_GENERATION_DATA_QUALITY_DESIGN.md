# Reviewer Candidate Data-Quality Fixes — Design Plan

**Status:** IMPLEMENTED (S266). Codex design review verdict was **GO-WITH-CHANGES** (4 changes,
folded in as Fix 1–4); Codex post-implementation review then returned **NEEDS-FIX** on display/
persistence fan-out, closed as Fix 5. Shipped.
**Author:** Claude (S265 design; S266 implementation; Codex implemented Fix 5)
**Scope:** `lib/utils/contact-parser.js` (shared `isDocumentUrl` + `isUsefulWebsiteUrl`),
`lib/services/serp-contact-service.js` (`isFacultyPageUrl`), the email tier's fetch chokepoint
(`lib/services/contact-enrichment-service.js` `_orderCandidateUrls`; + Claude-tier `facultyPageUrl`
capture and the side-save), the suggestion-ingestion path (`DiscoveryService.normalizeSuggestionSource`),
the candidate→roster merge (`shared/components/reviewers/reviewer-search-logic.js` `mergeEnrichment` /
`pruneCandidateForRoster`), and the `facultyPageUrl` persist/read/render surfaces
(`pages/api/reviewer-finder/save-candidates.js`, `pages/api/reviewer-finder/my-candidates.js`,
`shared/components/reviewers/CandidatesPanel.js`).
**Trigger:** Markus Kitzler-Zeiler surfaced as **"Prof."** (he is not — `seniorityEstimate: Mid-career`) with a **website pointing at a co-author's paper PDF** (`repositum.tuwien.at/bitstream/…/Treiber-2022-…-vor.pdf`).

## 1. Problem (grounded, verified)

Two independent data-quality leaks, both = **untrusted generated/scraped data reaching the card without validation**:

### A. A document-file URL passed as the "website"
`[VERIFIED]` The stored candidate has `website` = a `.pdf` of a paper whose first author is "Treiber", not Kitzler-Zeiler. It passed both website gates:
- `isUsefulWebsiteUrl` (`contact-parser.js:439`) filters only generic *directory* patterns (`/people`, `/faculty`, …) and name-consistency — **it has no document-extension rejection**, so a `.pdf` is "useful".
- `isNameConsistentWebsiteUrl` (`contact-parser.js:417`) calls `profileSlugForUrl(url)`; for a `/bitstream/…/Treiber-2022….pdf` path there is no profile slug → returns `null` → the guard **returns `true`** (lenient-when-undeterminable, line 419). So a paper URL bearing a *different* author's name was accepted.

Origin `[ASSUMED]`: most likely the Claude/SerpAPI website tier (`contact-enrichment-service.js:539/629`, each gated only by `isUsefulWebsiteUrl`); the value then merges to the top level (`reviewer-search-logic.js:54` `website: e.website || c.website`). The Claude *generation* suggestion may also carry a website that bypasses validation entirely — see Open Q1.

### B. An unverified honorific shown as fact
`[VERIFIED]` The stored `name` is `"Prof. Markus Kitzler-Zeiler"` — the title comes from Claude's generation output and is rendered verbatim, while `seniorityEstimate` independently says "Mid-career". We never verify titles, so asserting "Prof." is a fabricated-credential risk. `stripHonorifics` exists but is applied only for search/match/email paths, never the display name. (`normalizeReviewerName` already strips `dr|prof|professor|mr|mrs|ms` for the dedup key — so stripping the display name does NOT change dedup behavior.)

## 2. Goals / Non-goals

**Goals:** stop a non-profile/document URL from being shown as a reviewer's website; stop an unverified honorific from being shown as fact. Both at the right (single, canonical) layer.

**Non-goals:** verifying a reviewer's *actual* title (we have no source); building a real homepage discoverer; reworking the website tiers' capture logic beyond the validator.

## 3. The fixes

### Fix 1 — reject document-file URLs in `isUsefulWebsiteUrl` (`contact-parser.js`)
Reject, early in `isUsefulWebsiteUrl`, URLs whose **path** (ignoring query/fragment) ends in a document/media extension via the shared `isDocumentUrl` (list in §4.4). A file is never a profile page. This is the **canonical website catch** — it covers every `isUsefulWebsiteUrl` caller (`contact-enrichment-service.js:437/539/629`, `serp-contact-service.js` website tier) at once, killing the PDF regardless of which website tier produced it. (The faculty-page callers use `isFacultyPageUrl`, not `isUsefulWebsiteUrl` — covered separately by Fix 4.)

### Fix 2 — validate the candidate website at ingestion, not just in enrichment
The Claude-*suggested* `website` (top-level `candidate.website`) currently reaches the card/merge without ever passing `isUsefulWebsiteUrl`. Route it through `ContactParser.sanitizeWebsiteForCandidate(url, name)` (`contact-parser.js`) at the suggestion-ingestion chokepoint (`DiscoveryService.normalizeSuggestionSource` — the `website` key; see §4.1), so an unvalidated generated URL is nulled before storage. Defense-in-depth: also sanitize at **both** merge points — `mergeEnrichment` (`e.website||c.website`) and `pruneCandidateForRoster` (top-level `c.website||e.website` **and** the render-safe `contactEnrichment.website` subset) — so a bad URL can't ride through the merge. With Fix 1 in place, this also rejects the PDF.

### Fix 3 — strip the honorific from the display name at ingestion
Apply `ContactParser.stripHonorifics(name)` to the candidate's **stored display name** at the same suggestion-ingestion point, so the card shows "Markus Kitzler-Zeiler" and seniority is conveyed only by the verified-ish `seniorityEstimate`. Safe for dedup (`normalizeReviewerName` already strips honorifics). **Tradeoff (accepted):** this also drops *correct* "Dr./Prof." titles — but since we never verify them, not asserting a title is the safer default than asserting a possibly-wrong one. (Strip once at the source so the clean name propagates to search/verify/display/dedup; downstream honorific-strippers are then no-ops.) **Persisted Dataverse labels change (intentional)** — `discovery-verification-status.test.js` updated to expect the stripped name.

### Fix 4 — reject document URLs on the faculty-page path too (Codex-found 4th leak)
`facultyPageUrl` is captured via `SerpContactService.isFacultyPageUrl`, which had **no** document-extension gate, and the **resolved-page email tier fetches `facultyPageUrl`** (`contact-enrichment-service.js` `_orderCandidateUrls` → `safeFetchInstitutionPage`). So a PDF in `facultyPageUrl` would be fetched. Implemented as one shared catch — `ContactParser.isDocumentUrl(url)` (path-only, query/fragment ignored, malformed → non-document) — applied at:
- `isUsefulWebsiteUrl` (Fix 1's canonical website catch),
- `SerpContactService.isFacultyPageUrl` (capture-time faculty-page catch),
- `_orderCandidateUrls` (defensive: the Claude tier captures `facultyPageUrl` *without* `isFacultyPageUrl`, so the email tier re-guards right before the fetch).

### Fix 5 — close the `facultyPageUrl` display/persistence fan-out (Codex post-impl review, HIGH)
Codex's post-implementation review (verdict NEEDS-FIX) refuted "fan-out completeness": the email-tier *fetch* was gated, but a document `facultyPageUrl` could still be **persisted and rendered as a clickable link** (the Candidates panel shows `wmkf_facultypageurl` as an href), and the Workbench render fallback `c.website || enr.website` read the **raw** `contactEnrichment.website` that `mergeEnrichment` attached (only the promoted top-level `website` had been sanitized). Closed by applying `isDocumentUrl` / `sanitizeWebsiteForCandidate` at the capture/persist/read/render surfaces:
- **Capture:** Claude-tier `facultyPageUrl` gated in `contact-enrichment-service.js` (`!isDocumentUrl`), so persisted rows are clean.
- **Persist:** `save-candidates.js` (Dataverse write) and the `contact-enrichment-service.js` side-save both null a document `facultyPageUrl`.
- **Read:** `my-candidates.js` nulls a document `facultyPageUrl` on hydration from Dataverse.
- **Render:** `CandidatesPanel.js` `candidateContactPageUrl()` keeps a document `facultyPageUrl` from becoming the clickable fallback href.
- **Workbench website fallback:** `mergeEnrichment` now sanitizes the website on the **attached `contactEnrichment` object** too (not just the promoted top-level), so the `enr.website` render fallback can't surface a document URL.

(Codex's review also rated `isDocumentUrl`'s query-only / malformed-URL false-negatives as acceptable-LOW and confirmed the honorific strip has no name-keying consumer break — only an invite salutation that now defaults to "Dr." instead of inferring "Professor".)

## 4. Codex review resolutions (GO-WITH-CHANGES → implemented)

1. **Exact ingestion point — confirmed.** `DiscoveryService.normalizeSuggestionSource` is the single chokepoint: it runs before `verifyClaudeSuggestions` and feeds both the verify path and the display/roster path, so cleaning the `name` + `website` there propagates everywhere. The generated website lands under the `website` key. Cleaning is applied across **all three** source branches (applicant-recommended / proposal-named / claude-suggestion), not just the default one.
2. **Name-strip blast radius — safe.** Dedup `normalizeReviewerName` already strips honorifics; OpenAlex/ORCID verification re-strips via its own forename logic; the roster `normalized_name` already strips. No surface keys on the titled raw name. The one test that asserted the titled name (`discovery-verification-status.test.js`) is updated — the intentional persisted-label change.
3. **`isNameConsistentWebsiteUrl` leniency — left as is.** Fix 1's document-extension rejection is the minimal catch; the "return `true` when no slug extractable" branch is unchanged to avoid over-rejecting legit personal sites with odd paths.
4. **Document-extension list.** `.pdf .doc .docx .ppt .pptx .xls .xlsx .ps .rtf .txt .csv .zip` (path-only; query/fragment ignored). A page at `…/profile.html` or no extension is unaffected; a personal site at `…/cv.pdf` is rejected as a *website* — accepted.
5. **Rejected website → null** (no fallback). The card renders ORCID/Scholar links separately.
6. **4th leak (Codex-found):** the faculty-page path. Resolved via the shared `ContactParser.isDocumentUrl` — see Fix 4.

## 5. Testing (implemented)

- `tests/unit/contact-parser-website-gate.test.js`: `isDocumentUrl` flags all listed extensions (uppercase + query string), spares navigable pages / malformed / empty input; `isUsefulWebsiteUrl` rejects the Kitzler-Zeiler `Treiber-2022….pdf` and a candidate-named `…/cv.pdf`; `sanitizeWebsiteForCandidate` nulls a doc URL, keeps a real profile page.
- `tests/unit/reviewer-suggestion-data-quality.test.js`: `normalizeSuggestionSource` strips single + stacked honorifics, leaves a title-less / absent name intact, nulls a doc website, keeps a real one, and cleans across all three source branches; `SerpContactService.isFacultyPageUrl` rejects a name-matching faculty-pattern PDF, keeps a real faculty page.
- `tests/unit/reviewer-search-logic.test.js`: `mergeEnrichment` + `pruneCandidateForRoster` defensively null a doc-file website (top-level and the render-safe `contactEnrichment` subset) and keep a real one; the `enr.website` fallback (attached `contactEnrichment.website`) is sanitized.
- `tests/unit/discovery-verification-status.test.js`: updated to expect the stripped name.
- Fix 5 fan-out (`facultyPageUrl`): `tests/unit/contact-enrichment-affiliation-pin.test.js` (nulled at capture), `tests/unit/reviewer-route-identity-gate.test.js` + `tests/unit/save-to-database-identity-gate.test.js` (not persisted through the two save paths), `tests/unit/my-candidates-faculty-page-url-gate.test.js` (nulled on read hydration), `tests/unit/candidates-panel-faculty-page-url-gate.test.js` (not rendered as a clickable link).
- Gates: full `npm test` (2606 green), `lint` (0 errors), `build` OK. No schema/route surface; `check:api-routes`/`check:atlas`/`check:agent-wiki`/`check:fact-consistency` all green.
