# Resolved-Page Email Tier — Design Plan

**Status:** PROPOSED (pre-implementation; awaiting Codex design review)
**Author:** Claude (S265)
**Scope:** `lib/services/contact-enrichment-service.js`, a new guarded fetch helper, `lib/utils/contact-parser.js`

## 1. Problem (grounded, verified)

Good Claude-discovered reviewers come back with **no email** even when the address is trivially
findable by hand. Verified concrete case — **Prof. Artem Rudenko** (request `423eee92-…`,
ORCID `0000-0002-9154-8463`), prod roster row enriched 2026-06-09:

- `email=null`, `emailSource=null`, but `identityStatus=confirmed`, `hIndex`/`citations` populated
  → the identity anchor + bibliometrics resolved; **the miss is email-specific**.
- His published address `rudenko@phys.ksu.edu` lives in the **body of his faculty/lab page**
  (`jrm.phys.ksu.edu/Faculty/rudenko.html`), which was *captured as a URL* by the paid tiers but
  **never fetched and parsed**.

Why each existing tier misses it:

| Tier | Behavior on Rudenko | Why it misses |
|---|---|---|
| ORCID | resolves identity, no email | ORCID doesn't expose his email |
| PubMed | no recent corresponding-author email | not the corresponding author recently |
| SerpAPI (T4) | returns `office@phys.ksu.edu` | reads **search snippets only**, grabbed a dept role inbox; guard correctly rejected it |
| Claude web_search (T3) | non-deterministic; returned nothing in prod, `rudenko@k-state.edu` locally | Anthropic returns page content **encrypted** → the returned email is **unverifiable** against the source, and can be a pattern-constructed/wrong-domain variant |

**The gap:** when a faculty/profile page URL *is* resolved (it was, in both runs), nothing fetches
that page and extracts a name-consistent, domain-validated email from its body — which is exactly
what a human does by hand. This tier closes that gap **deterministically** (no LLM, verifiable).

## 2. Goals / Non-goals

**Goals**
- Recover the published institutional email for candidates where a faculty/profile/lab page URL was
  captured but no email surfaced.
- Be **deterministic and verifiable** (we read the actual page bytes), unlike web_search.
- Add **no new SSRF surface** beyond what is tightly bound to the candidate's verified institution.
- Respect the reviewer-search time budget (abort signal / deadline) and add minimal latency.

**Non-goals**
- Crawling/following links beyond the single captured URL(s) (no spidering in v1).
- Weakening `isNameConsistentEmail` (it behaved correctly — `office@` is genuinely not Rudenko).
- Replacing T3/T4. This is an additive tier that consumes the URLs they capture.

## 3. The hard part: SSRF

Faculty pages live on arbitrary university hosts (`phys.ksu.edu`, `mit.edu`, `ox.ac.uk`, …). We
**cannot** add them to `lib/utils/safe-fetch.js`'s static `ALLOWED_HOSTS`. Fetching a
dynamically-discovered URL is the precise risk that allowlist exists to prevent.

**Resolution — bind the fetch to the candidate's already-verified institution domain.** We already
compute `verifiedInstitutionDomain` in `_attachOpenAlexMetrics` (re-sourced from the OpenAlex
author's institution homepage, ORCID/spine-anchored — e.g. Rudenko → `k-state.edu`). The new fetch
is permitted **only** when the captured URL's host is label-boundary-related to that verified domain
(reusing the exact subdomain logic already in `_validateEmailAgainstVerifiedDomain`:
`host === verified || host.endsWith('.'+verified) || verified.endsWith('.'+host)`). This:

1. Shrinks SSRF surface to "a real public university domain that OpenAlex returned for this person."
2. Doubles as identity grounding — an email from `phys.ksu.edu` is provably on Rudenko's institution.

**Defense in depth** in a new helper `lib/utils/fetch-institution-page.js` (does NOT live in
safe-fetch.js, because it intentionally allows dynamic hosts under a per-call constraint):

- HTTPS only.
- Host must satisfy the verified-domain relation above (passed in per call) — this is the per-call
  allowlist.
- **Block private/reserved IPs:** resolve the hostname (`dns.lookup`, all addresses) and reject any
  RFC1918 / loopback / link-local / unique-local / CGNAT / `169.254.169.254` metadata target.
  (safeFetch does not do this; we add it here because the host is not statically trusted.)
- **Validate every redirect hop** against BOTH the domain relation and the private-IP check (mirror
  safeFetch's manual-redirect loop; `MAX_REDIRECTS=3`).
- Caps: `timeoutMs` (≤8s, and ≤ remaining deadline budget), response size cap (≤512 KB, streamed/
  truncated), `Content-Type` must be `text/html` or `text/plain`.
- No credentials/cookies; `redirect: 'manual'`; a descriptive `User-Agent`.

> **Open question for review:** is per-call-domain-bound dynamic fetch acceptable in this codebase's
> threat model, or should it be gated behind a config flag / a curated academic-TLD allowlist
> (`.edu`, `.ac.uk`, `.edu.au`, …) as an additional coarse filter? See §8.

## 4. Where it runs (sequencing)

It must run **inside `_finalize`**, AFTER `_attachOpenAlexMetrics` (so `verifiedInstitutionDomain`
is known) and BEFORE `_validateEmailAgainstVerifiedDomain` (so a found email still passes the
existing domain cross-check). New private method `_attachEmailFromResolvedPage(result, {signal, deadlineAt, onProgress})`:

```
_finalize:
  await _attachOpenAlexMetrics(...)               // sets verifiedInstitutionDomain (existing)
  await _attachEmailFromResolvedPage(...)         // NEW — only if still no email
  _validateEmailAgainstVerifiedDomain(...)        // existing; now also vets the page email
  resolveIdentity / _applyAffiliationOverride / saveToDatabase  (existing)
```

`_attachEmailFromResolvedPage` logic:
1. Return immediately if `ce.email` is already set (any prior tier won).
2. Collect candidate URLs in priority order: `ce.facultyPageUrl`, then `ce.website` (skip the Google
   Scholar search link / `buildGoogleScholarUrl` output — those aren't faculty pages).
3. For each URL whose host is verified-domain-related (and `verifiedInstitutionDomain` is known):
   - `fetchInstitutionPage(url, { allowedDomain: verifiedInstitutionDomain, signal, deadlineAt })`.
   - Extract emails from the body (§5). Pick the first that is BOTH `isNameConsistentEmail(email, name)`
     AND domain-related to `verifiedInstitutionDomain`.
   - On a hit: set `ce.email`, `ce.emailSource='faculty_page'`, `ce.emailIsRecent=true`,
     `ce.emailPersistAllowed=true`; record `ce.tierResults.faculty_page = { url, email }`; stop.
4. Best-effort: any fetch/parse/DNS error is caught, recorded as
   `ce.tierResults.faculty_page = { url, skipped|error }`, never throws (except a deadline abort,
   which must propagate like the other tiers).
5. Honor `signal.aborted` → rethrow `abortError(signal)`.

> **Gating note:** because it only runs when `verifiedInstitutionDomain` is known and `ce.email` is
> empty, it is a narrow subset of candidates → bounded latency. It needs NO new opt-in toggle: it
> consumes URLs the existing paid tiers already captured. (Confirm with review — see §8.)

## 5. Parsing (`lib/utils/contact-parser.js`)

Add `static extractEmailsFromHtml(html)`:
- Pull `mailto:` hrefs (`/mailto:([^"'?>\s]+)/gi`) first — most reliable.
- Strip tags (`replace(/<[^>]+>/g, ' ')`) and decode common entities (`&#64;`→`@`, `&commat;`,
  `&period;`).
- De-obfuscate the most common patterns conservatively: ` [at] `/`(at)`→`@`, ` [dot] `/`(dot)`→`.`
  **only** within a token that otherwise looks like an email — avoid rewriting prose.
- Run the existing `extractEmails()` on the result; return the deduped list (order preserved).

Selection stays in the service: `isNameConsistentEmail` + verified-domain relation. Reuse, don't
duplicate, the guard.

## 6. Persistence / provenance

- New `emailSource` value: `'faculty_page'`. Treated as a **trusted** source (page bytes on the
  verified institution domain) — it is NOT added to the `['claude_search','serp_search']`
  search-sourced set in `_fieldPersistAllowed`/`_validateEmailAgainstVerifiedDomain`, so a verified-
  domain match keeps it and it persists like ORCID/PubMed. (It still passed the domain check by
  construction.)
- Stats: add `faculty_page` to `enrichCandidates` `stats.bySource`.
- Roster: `emailSource` already persists via `pruneCandidateForRoster`; no schema change.

## 7. Latency / cost

- **No LLM, no paid API** — one HTTPS GET per still-missing-email candidate that has a captured URL.
- Bounded by `min(8s, remaining deadline)`; runs for a subset only.
- Net effect can REDUCE cost: a faculty-page hit can let us drop reliance on the unverifiable
  web_search email (future: could even run before paying for T3/T4 if a URL is otherwise known —
  out of scope for v1).

## 8. Open questions for Codex review

1. **SSRF model:** Is per-call domain-bound dynamic fetch + private-IP blocking acceptable here, or
   do we additionally want a coarse academic-TLD allowlist and/or a feature flag for first rollout?
2. **DNS rebinding:** `dns.lookup` then `fetch` is TOCTOU-racy (resolve→connect may differ). Is
   pinning the resolved IP (custom `lookup`/agent) warranted in v1, or is the domain-relation + the
   text/html content-type cap sufficient given the host must already be a real university domain?
3. **No-verified-domain candidates:** when OpenAlex yields no `verifiedInstitutionDomain` (the
   abstain/unanchored path), the tier does nothing. Acceptable, or should it fall back to the
   candidate's discovery-affiliation domain (weaker grounding)?
4. **URL quality:** the captured `facultyPageUrl` can be a non-profile page (Rudenko's was a
   colloquium event page); his email was on the `website` (JRM lab) URL. Is "try facultyPageUrl then
   website" the right order, and should a generic/event-looking URL be deprioritized?
5. **Selection ambiguity:** if a page yields multiple name-consistent, domain-valid emails, take the
   first, or abstain? (Abstain is safer for an invitation tool.)
6. **`faculty_page` as trusted source:** is it right to exempt it from the search-sourced drop set,
   given it is domain-validated by construction — or should it still be subject to the same
   contradiction drop for symmetry?

## 9. Testing

- Unit (`contact-parser`): `extractEmailsFromHtml` — mailto hrefs, entity/obfuscation decode, tag
  strip, false-positive rejection.
- Unit (service, mocked `fetchInstitutionPage`): hit on verified-domain page → email set, source
  `faculty_page`, persist allowed; off-domain host → skipped; multiple emails → name-consistent one
  chosen; deadline abort → propagates; fetch error → best-effort skip.
- Unit (`fetch-institution-page`): rejects non-HTTPS, off-domain host, private-IP target, redirect to
  private host, oversized/non-HTML body.
- Regression: the `office@phys.ksu.edu` case stays rejected; the `rudenko@phys.ksu.edu` page case is
  recovered (fixture HTML).
- No live network in tests (fixture HTML + mocked fetch/DNS).
- Gates: `npm test`, `npm run lint`, `npm run build`, and (new util/route surface) re-run
  `check:api-routes`/`check:atlas` as applicable.
```
