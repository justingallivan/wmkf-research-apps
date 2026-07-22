---
title: "Resolved-Page Email Tier — Design Plan (rev 4)"
domain: email
kind: spec
status: active
summary: "Guarded page fetch plus deterministic mailbox ranking; only a unique grounded winner receives the invitation-ready institution_page source."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - lib/utils/safe-fetch.js
  - lib/services/contact-enrichment-service.js
  - lib/utils/contact-parser.js
  - lib/utils/reviewer-invite.js
---

# Resolved-Page Email Tier — Design Plan (rev 4)

**Status:** IMPLEMENTED and enabled in Production as of the dated 2026-07-03 configuration
attestation. Environment configuration is external mutable state: re-verify the live flag before a
new rollout or incident diagnosis rather than treating this document as a permanent guarantee.
**Author:** Claude (S265)
**Scope:** guarded fetch, contact parsing, mailbox ownership selection, roster evidence, and candidate-card explanation

## 0. Revision history

**Rev 4 (2026-07-19, page-email ownership redesign):**
- Replaced the primary 100-character association heuristic with deterministic mailbox classes:
  full name, initials+surname, surname+initials, and exact surname. Initial-based and
  bare-surname forms require the candidate in the page title or sole H1.
- Kept exact URL-slug ownership and narrow directional adjacency as lower-ranked fallbacks for
  opaque mailboxes. Adjacency now requires the full forename and the nearest surname mention, so
  a nearby same-initial namesake does not qualify.
- Selection is rank-first and fail-closed: one best address wins; an equal-best tie abstains.
  Domain-only acceptance, global same-surname page scans, and the broad
  `isNameConsistentEmail` helper remain excluded.
- `emailEvidence` now records the ownership proof, match class, official source URL, and bounded
  alternatives. That compact evidence survives `reviewer_find_roster` reload and is shown on the
  candidate card; the Dataverse/send gate still relies on the binary `institution_page` source.
- A saved-search replay made zero SerpAPI calls, preserved every existing correct ready result,
  and added four manually verified correct people across the 17-subject/view Stage-1 cohort.
  The live Philip Hemmer TAMU page selected `prhemmer@tamu.edu` and rejected the footer address.

**Rev 3 (after Codex review #2 — folded in, design now APPROVED):**
- **Fetch host predicate is exact-or-subdomain ONLY** — dropped the reverse relation
  `d.endsWith('.'+host)` and the email-style hyphen-stripping normalization from *fetch
  authorization* (those belong to email-domain *validation*, not URL gating). Use plain
  lowercase/IDNA host comparison (§3).
- **Private-IP block covers IPv6** (`::`, `0.0.0.0`, IPv4-mapped incl. hex-form, `fe80::/10`, AAAA
  records); the `dns.lookup`→connect TOCTOU window is CLOSED via undici IP-pinning (S265 post-impl, §3).
- **Page-grounding requires candidate-email *association*, not just candidate-identity-on-page** — a
  single email on a "Philip Bucksbaum Lab" page that belongs to a lab admin must NOT be trusted (§5).
- New §9 negative fixture: PI-named lab/group page with one non-PI admin email → abstain.

**Rev 2 (after Codex review #1 + live verification of two real cases) changed the design materially:**

- **Reuse the existing `institution_page` email source** — it's already defined and **already HIGH
  trust** in `lib/utils/reviewer-invite.js` (`HIGH_TRUST_EMAIL_SOURCES`), and **nothing currently
  sets it** (verified: zero writers). Do NOT invent a new `faculty_page` source. (Codex #7)
- **Extend `safe-fetch.js` with a dynamic per-call host predicate** rather than building a parallel
  outbound-fetch helper, so there is one outbound policy. (Codex #1)
- **Trust gate is PAGE-GROUNDING, not the local-part `isNameConsistentEmail` heuristic.** Verified:
  `isNameConsistentEmail('phbuck@stanford.edu', 'Philip Bucksbaum') === false` — the guard that
  correctly rejects `office@phys.ksu.edu` *also* rejects Bucksbaum's real address (truncated
  surname). The local-part heuristic is for *ungrounded* (snippet/search) emails; a *fetched* page
  that is provably the person's is itself the grounding. (empirical; supersedes rev-1 §5 gate)
- **Regression target is Bucksbaum, not Rudenko.** Verified domains:
  - Bucksbaum → OpenAlex `stanford.edu`; email `phbuck@stanford.edu` on `web.stanford.edu/~phbuck`
    (a `*.stanford.edu` host, label-related) → **recoverable**.
  - Rudenko → OpenAlex `k-state.edu` (ROR lists no alias domains); email `rudenko@phys.ksu.edu` on
    `ksu.edu` — NOT label-related to `k-state.edu` → **unreachable under strict domain binding**.
    Multi-domain institutions are a **documented v1 limitation** (§10), not a target.
- **Thread `deadlineAt` through `_finalize`** (it is currently destructured in `enrichCandidate` but
  not accepted by `_finalize`); compose abort+timeout the way `openalex-service.js` does. (Codex #3)
- **A low-trust search-sourced email must not silently block the tier** — it may be replaced by a
  page-grounded `institution_page` email. (Codex #8)

## 1. Problem (grounded, verified)

Good Claude-discovered reviewers come back with **no email** even when the address is trivially
findable by hand. The identity anchor + bibliometrics resolve fine; the miss is email-specific.
The published address lives in the **body of a faculty/profile/lab page** that the paid tiers
*captured as a URL* but **never fetched and parsed** (verified: no code fetches a faculty-page body
— SerpAPI reads search *snippets* only; Claude web_search returns the email **unverifiably**,
encrypted, and non-deterministically). This tier closes that gap deterministically.

| Tier | Behavior | Why it misses |
|---|---|---|
| ORCID | identity, no email | ORCID doesn't expose it |
| PubMed | no recent corresponding-author email | not recent corresponding author |
| SerpAPI (T4) | `office@…` (dept role inbox) | reads snippets only; guard correctly rejects |
| Claude web_search (T3) | non-deterministic, unverifiable | page content encrypted; can be wrong-domain/constructed |

## 2. Goals / Non-goals

**Goals:** recover the published institutional email when a profile/lab page URL was captured;
deterministic + verifiable (we read the page bytes); **no new SSRF surface** beyond a fetch tightly
bound to the candidate's OpenAlex-verified institution domain; respect the reviewer-search deadline.

**Non-goals:** crawling/spidering beyond the captured URL(s); weakening `isNameConsistentEmail` for
the other tiers; recovering multi-domain-institution cases in v1 (§10); replacing T3/T4.

## 3. SSRF (the hard part) — extend `safe-fetch.js`

> **S321 update (gating redesign):** the live bound is now the identity-anchored
> institution-domain **set** (`ce.anchoredInstitutionDomains` — OpenAlex verified
> domain + ORCID disambiguated-org RORs resolved via `getInstitution`, only on a
> confirmed/probable identity), falling back to the single
> `verifiedInstitutionDomain` when the set is empty. Same per-domain
> `safeFetchInstitutionPage` mechanism, N anchored domains instead of 1; the
> name-resolved "plausible" domains are deliberately EXCLUDED from the fetch bound.
> See `docs/REVIEWER_GATING_STRATEGY_REDESIGN.md` §3.5 and Contract 7 in
> `docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md`. The single-domain description
> below is the original v1 design.

Faculty pages are on arbitrary university hosts; they cannot go in the static `ALLOWED_HOSTS`.
Resolution: **bind the fetch to the candidate's already-verified institution domain**
(`ce.verifiedInstitutionDomain`, sourced from the OpenAlex author's institution homepage eTLD+1 via
PSL — set in `_attachOpenAlexMetrics`). This both shrinks SSRF surface to "a real public university
domain OpenAlex returned for this person" and doubles as institution grounding.

Add to `lib/utils/safe-fetch.js` a sibling export (one outbound policy module):

```
export async function safeFetchInstitutionPage(url, {
  allowedDomain,     // required; verifiedInstitutionDomain — host must be exact-or-subdomain
  signal, timeoutMs = 8000, maxBytes = 512 * 1024,
})
```

Enforced, on the initial request **and every redirect hop** (manual redirect loop, `MAX_REDIRECTS=3`):
1. **HTTPS only.**
2. **Host predicate — exact-or-subdomain ONLY:** `host === d || host.endsWith('.'+d)` where both
   `host` and `d` (`allowedDomain`) are lowercased + IDNA/punycode-normalized. **Do NOT** use the
   reverse relation `d.endsWith('.'+host)` or the hyphen-stripping in
   `_normalizeDomain`/`_validateEmailAgainstVerifiedDomain` — those are EMAIL-domain *validation*
   semantics; authorizing a fetch to a *parent* of the verified domain (verified `cs.stanford.edu` →
   fetch `stanford.edu`) is a privilege escalation, not a match. Fetch gating ≠ email validation.
3. **Private/reserved-IP block:** `dns.lookup(host, { all: true })`; reject if ANY resolved address
   is loopback / RFC1918 / link-local (`169.254/16`, incl. `169.254.169.254`) / unique-local
   (`fc00::/7`) / CGNAT (`100.64/10`) / reserved, plus the IPv6/edge cases: `0.0.0.0`, `::`
   (unspecified), `fe80::/10` (v6 link-local), and IPv4-mapped-IPv6 private ranges (`::ffff:10.x`,
   etc.) — normalize a mapped address to its v4 form before range-checking. Check AAAA records too,
   not just A. (safe-fetch's static allowlist doesn't do this; required because the host is not
   statically trusted.) **DNS-rebind TOCTOU — CLOSED in implementation (S265 post-impl):** the
   fetch uses an undici `Agent` whose `connect.lookup` returns ONLY the pre-validated public IP, so
   the socket connects to the address we checked (no re-resolution window). TLS SNI/cert validation
   still uses the hostname. Also handles hex-form IPv4-mapped IPv6 (`::ffff:0a00:0001`).
4. **Caps:** `timeoutMs` composed with the caller `signal` AND the remaining deadline (min of the
   three), via the `openalex-service.js` signal-composition pattern; stream-read with a hard
   `maxBytes` cutoff; require `Content-Type` `text/html` or `text/plain`.
5. No cookies/credentials; `redirect: 'manual'`; descriptive `User-Agent`.

**Feature flag:** `REVIEWER_PAGE_EMAIL_TIER_ENABLED`. The code fails closed when unset. Production
was explicitly verified enabled on 2026-07-03; that is a dated configuration attestation, not a
permanent repo fact. Re-verify live configuration before promotion. A selector merge changes
production behavior whenever the flag is enabled and requires deliberate promotion. No coarse academic-TLD allowlist — the OpenAlex
domain binding is strictly better and avoids `.org/.gov/.de` false negatives. (Codex Q5.1/Q5.2:
domain-binding + caps acceptable; IP-pinning IMPLEMENTED in the post-impl pass — the TOCTOU
residual is closed, not merely documented.)

## 4. Where it runs (sequencing)

Inside `_finalize`, AFTER `_attachOpenAlexMetrics` (so `verifiedInstitutionDomain` is set) and BEFORE
`_validateEmailAgainstVerifiedDomain` (so a found email still gets the domain cross-check). All
`enrichCandidate` return paths route through `_finalize`; `persist:false` skips only
`saveToDatabase`. The unanchored-abstain path (`_markUnanchoredAbstain`) clears the URLs + verified
domain, so those candidates no-op here (correct).

```
_finalize(candidate, result, { persist, onProgress, scholarCandidate, signal, deadlineAt }):  // + deadlineAt
  await _attachOpenAlexMetrics(...)                 // sets verifiedInstitutionDomain
  await _attachEmailFromResolvedPage(result, { signal, deadlineAt, onProgress })   // NEW
  _validateEmailAgainstVerifiedDomain(result.contactEnrichment)
  resolveIdentity / _applyAffiliationOverride / saveToDatabase
```

`_attachEmailFromResolvedPage`:
1. Run only when flag on AND `verifiedInstitutionDomain` is set AND
   (`!ce.email` OR `ce.emailSource ∈ {serp_search, claude_search}`) — a low-trust search email does
   not block the tier and may be replaced (Codex #8). An already-trusted email (orcid/pubmed/
   affiliation/institution_page) is left untouched.
2. Candidate URLs, **person-specificity ordered** (Codex Q5.4): prefer a URL whose path contains the
   surname or a name token (`ce.website`/`ce.facultyPageUrl` that looks like a personal/lab page)
   over a generic/event-looking one; skip the Google Scholar search link. De-dup.
3. For each URL whose host passes the domain predicate: `safeFetchInstitutionPage(...)`, then
   page-ground + select (§5). First grounded hit wins; stop.
4. On a grounded hit: set `ce.email`, `ce.emailSource='institution_page'`, `ce.emailIsRecent=true`,
   `ce.emailPersistAllowed=true`, `ce.facultyPageUrl ||= url`; record
   `ce.tierResults.institution_page = { url, email, grounding }`. If replacing a search email, also
   clear the stale `emailSource`/flags first.
5. Best-effort: fetch/DNS/parse errors → `ce.tierResults.institution_page = { url, skipped|error }`,
   never throw — EXCEPT a deadline/cancel abort, which rethrows `abortError(signal)` like the other
   tiers. A 403/blocked page is a normal skip (verified: `ultrafast.stanford.edu` returns 403).

## 5. Parsing + page-grounding (the trust gate)

**Extract** — add `ContactParser.extractEmailsFromHtml(html)`:
- `mailto:` hrefs first (most reliable; recovers `phbuck@stanford.edu`).
- Strip tags; decode `&#64;`/`&commat;`→`@`, `&period;`→`.`; conservatively de-obfuscate ` [at] `/
  `(at)`→`@` and ` [dot] `/`(dot)`→`.` only inside email-looking tokens.
- Run existing `extractEmails()`; return deduped, in document order, each with its source offset (to
  support name-adjacency below).

**Ground + select** (in `page-email.js`; a selector-local trust decision):

1. Filter to addresses whose domain is related to the anchored institution domain.
2. Normalize the candidate name and mailbox local part by deburring and removing separators.
   Honorific and suffix tokens are excluded; hyphenated given names retain their initials and
   hyphenated surnames retain their compact form.
3. Classify each address, strongest first:
   - exact full given+surname / surname+given mailbox;
   - initials+surname or surname+initials (up to two unverified middle letters);
   - exact surname;
   - exact personal-page URL slug;
   - narrow directional adjacency as the opaque-mailbox fallback.
4. Initial-based and exact-surname classes require **strong page identity**: the full candidate
   forename and surname appear in the page title, or in the page's sole H1. A body-only directory
   mention is insufficient. Full-name mailboxes carry their own name evidence.
5. The adjacency fallback requires the full forename (not merely the first initial) and the
   candidate must be the nearest matching surname mention before the address. This prevents
   “Philip Hemmer … Peter Hemmer `phemmer@…`” and “Feng Zhang … Fan Zhang `fzhang@…`” from binding.
6. Select the unique address in the best match class. Equal-best ties abstain; lower-ranked and
   unmatched page addresses are recorded as bounded alternatives.

`isNameConsistentEmail` is deliberately neither reused nor narrowed. Its surname-containment rule
is appropriate for quarantined search leads but too broad for an invitation-ready page source.
There is no domain-only acceptance and no page-wide same-surname scan: publication and collaborator
lists would create false conflicts. Every selected email still passes the downstream verified-domain
guard.

## 6. Provenance / persistence

- `emailSource = 'institution_page'` (existing reserved HIGH-trust source; no new string, no consumer
  fan-out needed — `reviewer-invite.js` already treats it HIGH). (Codex #7)
- **Because `institution_page` is already HIGH trust, the page-grounding in §5 is mandatory** before
  it is stamped — otherwise a same-institution namesake gets HIGH invite confidence (Codex #3). The
  grounding (page-identity + uniqueness + forename gate) is the identity proof the domain check
  alone can't provide.
- It is NOT added to the `claude_search/serp_search` search-sourced drop set; it is grounded by
  construction. Stats: add `institution_page` to `enrichCandidates` `stats.bySource`.
- Roster: `emailSource` already persists via `pruneCandidateForRoster`; no schema change. DB
  `wmkf_emailsource` already accepts the string (reviewer-invite reads it).
- Evidence: `emailEvidence.{sourceUrl,ownershipProof,matchClass,alternatives}` is compacted by
  `pruneEmailEvidence` and persists in the Postgres `reviewer_find_roster` candidate JSON, so the
  Find card can explain the decision after reload. It is not written to Dataverse and does not
  alter send authorization; the server continues to recompute readiness from `wmkf_emailsource`.

## 7. Latency / cost

No LLM, no paid API — one HTTPS GET per still-missing (or search-email) candidate that has a captured
URL, bounded by `min(8s, remaining deadline)`, subset only. Can REDUCE cost by replacing reliance on
the unverifiable paid web_search email.

## 8. Open questions from rev 1 — resolved

1. SSRF model — **accepted**: shared `safe-fetch` dynamic predicate, exact/subdomain binding,
   redirect+IP+type+size+time caps, feature flag; no academic-TLD allowlist.
2. DNS rebinding / IP pin — **IP-pinning IMPLEMENTED** (undici `connect.lookup` → pre-validated IP);
   private-IP rejection tested on initial + redirect hops.
3. No-verified-domain fallback to discovery affiliation — **no** (don't weaken the existing abstain).
4. URL quality — **person-specificity ordering** + skip Scholar search link (§4.2).
5. Multiple plausible emails — **abstain** (§5).
6. Source string — **reuse `institution_page`** (§6), no new consumers.

## 9. Testing

- `contact-parser.extractEmailsFromHtml`: mailto hrefs, entity/obfuscation decode, tag strip, FP
  rejection, document-order + offsets.
- Page-grounding/selection (mocked fetch, fixture HTML):
  - **Bucksbaum regression**: `web.stanford.edu/~phbuck`-style fixture, single mailto `phbuck@…`,
    title "Philip Bucksbaum" → grounded, `institution_page`, persist allowed (the case the rev-1 gate
    would have dropped).
  - `office@phys.ksu.edu` dept page → no candidate-name grounding → abstain (stays rejected).
  - **Lab/group-page false positive**: page title/H1 names the candidate ("Philip Bucksbaum Lab"),
    exactly one domain-valid email, but it's a lab-admin/`webmaster@` address NOT adjacent to the
    candidate's name → **abstain** (the rev-3 association requirement; Codex #4).
  - Multi-person directory: two name-adjacent emails → abstain; exactly one candidate match → select.
  - Strong single-person profile: initials+surname with an extra middle letter plus a generic
    footer address → select the person mailbox and record the footer as unmatched.
  - Weak directory with candidate and same-initial namesake → abstain.
  - Full-name mailbox outranks a lower-class address; equal-best mailboxes abstain.
  - Short surname and hyphenated given name (`gwli`-shape) classify on a strong profile.
  - Same-institution namesake (different forename, same surname) → forename gate abstains.
  - Search email present → tier runs and replaces with grounded `institution_page`; trusted email
    present → tier no-ops.
  - Deadline abort mid-fetch → propagates; fetch/DNS error / 403 → best-effort skip.
- `safe-fetch.safeFetchInstitutionPage`: rejects non-HTTPS, off-domain host, private-IP target,
  redirect to off-domain/private host, oversized body, non-HTML content-type.
- **Rudenko documented-skip test**: `k-state.edu` verified domain + `ksu.edu` page host → domain
  predicate rejects the fetch (asserts the known v1 limitation, no email set).
- No live network (fixtures + mocked fetch/DNS). Gates: `npm test`, `lint`, `build`; re-run
  `check:api-routes`/`check:atlas` if a route/data surface is touched (this tier touches neither).
- Replay gate: reuse recorded search results (`--replay-search-artifact`, zero SerpAPI calls),
  refetch only the already-selected first-party pages, diff invitation-ready outcomes, and manually
  verify every new or changed address. The 2026-07-19 replay produced four unique correct additions,
  zero wrong-person changes, and no lost correct result.

## 10. Known v1 limitations (documented, not bugs)

- **Multi-domain institutions** (e.g. Kansas State `ksu.edu` vs OpenAlex/ROR `k-state.edu`): the
  page host isn't label-related to the verified domain, so the fetch is correctly refused. Rudenko
  falls here. Future enhancement: an institution domain-alias source (ROR `domains` when populated,
  or a curated alias map) feeding the host predicate — explicitly out of scope for v1.
- **Bot-blocked pages** (403/anti-scraping, e.g. `ultrafast.stanford.edu`): best-effort skip; a
  personal page (`web.stanford.edu/~phbuck`) often succeeds where the institute CMS blocks.
