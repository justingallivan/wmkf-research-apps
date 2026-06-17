# Reviewer Candidate Data-Quality Fixes — Design Plan

**Status:** PROPOSED (pre-implementation; awaiting Codex design review)
**Author:** Claude (S265)
**Scope:** `lib/utils/contact-parser.js`, the suggestion-ingestion path (`DiscoveryService.normalizeSuggestionSource` / reviewer-finder mapping), and the candidate→roster merge (`shared/components/reviewers/reviewer-search-logic.js`)
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
Add, early in `isUsefulWebsiteUrl`, a rejection of URLs whose **path** (ignoring query/fragment) ends in a document/media extension: `.pdf .doc .docx .ppt .pptx .xls .xlsx .ps .rtf .txt .csv .zip` (+ images if cheap). A file is never a profile page. This is the **canonical catch** — it covers all 5 callers (`serp-contact-service.js:89/155`, `contact-enrichment-service.js:437/539/629`) at once, killing the PDF regardless of which tier produced it.

### Fix 2 — validate the candidate website at ingestion, not just in enrichment
The Claude-*suggested* `website` (top-level `candidate.website`) currently reaches the card/merge without ever passing `isUsefulWebsiteUrl`. Route it through `ContactParser.sanitizeWebsiteForCandidate(url, name)` (already exists, `contact-parser.js:427`) at the suggestion-ingestion point (`DiscoveryService.normalizeSuggestionSource` — confirm exact field; Open Q1), so an unvalidated generated URL is nulled before storage. Defense-in-depth: also sanitize in the roster prune (`reviewer-search-logic.js:232`/`:54`) so a bad URL can't ride through the merge. With Fix 1 in place, this also rejects the PDF.

### Fix 3 — strip the honorific from the display name at ingestion
Apply `ContactParser.stripHonorifics(name)` to the candidate's **stored display name** at the same suggestion-ingestion point, so the card shows "Markus Kitzler-Zeiler" and seniority is conveyed only by the verified-ish `seniorityEstimate`. Safe for dedup (`normalizeReviewerName` already strips honorifics). **Tradeoff (accepted):** this also drops *correct* "Dr./Prof." titles — but since we never verify them, not asserting a title is the safer default than asserting a possibly-wrong one. (Strip once at the source so the clean name propagates to search/verify/display/dedup; downstream honorific-strippers are then no-ops.)

## 4. Open questions for Codex

1. **Exact ingestion point.** The reviewer prompts live in **Dataverse** (not files), so the suggestion schema isn't greppable. Is `DiscoveryService.normalizeSuggestionSource` the right single chokepoint to (a) sanitize the website and (b) strip the name, such that BOTH the verify path and the display/roster path see the cleaned values? Or is there an earlier map (analyze.js → `reviewerSuggestions`) that's safer? Confirm the field name the generated website lands under (`website`? `url`? `profileUrl`?).
2. **Name-strip blast radius.** Does stripping the honorific from `candidate.name` at ingestion perturb anything that *keys on the raw name* — OpenAlex/ORCID verification (`forenameFullyAgrees` re-strips, so fine?), COI/coauthor matching, `suggestionId`, or the roster `normalized_name` (already strips, so stable)? Any place that displays the raw name expecting a title?
3. **`isNameConsistentWebsiteUrl` leniency (line 419).** Should we ALSO tighten the "return `true` when no slug extractable" branch, or is Fix 1's document-extension rejection the right, minimal catch (avoid over-rejecting legit personal sites with odd paths)? Recommendation: Fix 1 only; leave leniency.
4. **Document-extension list.** Right set? Any false-positive risk (e.g. a legit profile page that ends in `.html`/no extension is unaffected; a personal site at `…/cv.pdf` *should* be rejected as a website even though useful — acceptable?).
5. Should a rejected website fall back to anything (ORCID URL, Scholar link) or just null? Proposal: null (the card already renders ORCID/Scholar links separately).

## 5. Testing

- `contact-parser`: `isUsefulWebsiteUrl` rejects `.pdf/.docx/.pptx/.xlsx` (incl. with query strings + uppercase), accepts a normal faculty/profile URL; the Kitzler-Zeiler `Treiber-2022….pdf` fixture → rejected. `sanitizeWebsiteForCandidate` nulls a doc URL, keeps a good one.
- Ingestion: a suggestion with `name:"Prof. X Y"` + `website:<pdf>` → stored `name:"X Y"`, `website:null`; a suggestion with a real profile site keeps it.
- Regression: existing enrichment website-capture tests (orcid/serp/claude) still accept legit profile URLs; dedup/`normalized_name` unaffected by the name strip.
- Gates: `npm test`, `lint`, `build`. No schema/route surface; no atlas/api-routes gate.
