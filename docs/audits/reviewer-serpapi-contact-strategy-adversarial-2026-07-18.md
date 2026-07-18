# Verdict

**SOUND WITH MATERIAL REVISIONS.**

The proposal's premise — *be more systematic about web search for the new-to-WMKF
reviewers the free structured tiers miss* — is correct, and several of its
mechanics (US locale for reproducibility, aggregate-then-verify instead of
first-snippet, page-fetch before promotion) are individually defensible. But as
written it optimizes the wrong surface. **Every snippet email either paid tier
produces is `research_only` by Contract 3 and can never be sent** (verified end
to end below), so a richer query cascade that aggregates and ranks *snippet
emails* spends more latency to produce more addresses the send gate refuses. The
one web source that is invitation-sendable is the already-enabled page-fetch
tier's `institution_page` grade, which consumes a *first-party page URL*, not a
snippet email. The highest-leverage version of this work therefore points the
cascade at finding the correct first-party page (and parses Europe PMC
`<corresp>` for the OA subset), and treats snippet-email aggregation and the
Broad/MIT/Harvard "institution family" as the parts to drop or rebuild in
ID-space. Three of the proposal's eight points are net-negative as written
(SerpAPI-before-Claude reorder, snippet-email aggregation as the endpoint, the
hand-listed co-affiliation family); the rest are fine or already built. The
safety posture the proposal leaves intact (abstain-is-safe, forename gate,
`research_only`-never-sends) is load-bearing and must not be relaxed to admit
co-affiliate addresses.

---

# Prioritized Findings

## P0 — the proposal optimizes a tier whose entire output is unsendable

**P0.1 — Both paid tiers' snippet emails are `research_only`; a better query
cascade produces more unsendable leads, not more invitations.**
Evidence: `lib/utils/reviewer-invite.js:83` (`RESEARCH_ONLY_EMAIL_SOURCES = serp_search, claude_search, search_contested`),
`:107-112` (`emailConfidence` maps those to `action:'research_only'`);
`lib/services/review-manager/send-emails-service.js:403-418` (first-contact
invitation with `confidence.action === 'research_only'` is hard-skipped
`email_research_only` — a checkbox or forged allowlist cannot override it);
`lib/services/contact-enrichment/email-adjudication.js:141-156` (even a serp
email whose domain *matches* an anchored institution domain keeps
`emailSource:'serp_search'` — a domain match sets `emailPersistAllowed` but never
upgrades the source, so it is still `research_only`). The *only* code path that
turns a web-found address into a sendable one is
`lib/services/contact-enrichment/page-email.js:206-224`, which overwrites
`emailSource` with `institution_page` (a `READY_EMAIL_SOURCES` member,
`reviewer-invite.js:82`). That tier reads `ce.facultyPageUrl` / `ce.website`
(`page-email.js:133-158`), i.e. a **page URL**, not a snippet email.
Impact: the proposal's items 3–4 (adaptive query cascade + email aggregation)
buy nothing the send gate will accept; they add SerpAPI calls and wall-clock to
raise an unsendable-lead count the local eval already shows is high (37/40 raw
snippet emails, ~6/40 sendable per the companion audit §3.2).
Correction: make the cascade's success metric *"a first-party page on an
anchored institution domain that the page-fetch tier can ground"*, not *"a
snippet email."* Pair it with Europe PMC `<corresp>` parsing (audit §6.1) for the
OA subset. Keep `REVIEWER_PAGE_EMAIL_TIER_ENABLED` on (prod-enabled 2026-07-03,
`docs/CREDENTIALS_RUNBOOK.md:178`) as the sendability path. Snippet-email
aggregation should feed only the quarantined `contactLeads[]` staff breadcrumb
layer, never `email`.

## P1 — mis-prioritizations that will waste budget or admit the wrong person

**P1.1 — SerpAPI-before-Claude reorder is neutral on safety and negative on
recall-of-sendable.**
Evidence: both tiers run the identical guards —
`lib/services/contact-enrichment/tiers.js:296` (Claude
`resultContradictsAnchor`) and `:382` + `:395` (Serp `resultContradictsAnchor` +
`isNameConsistentEmail`), both gated `hasIdentityAnchor`
(`tiers.js:284`, `:370`). The Claude tier *fetches and reads* pages and returns
citations (`lib/services/contact-enrichment/search-tiers.js:64-185`), so it can
surface a page-published email a Serp *snippet* never contains; Serp returns only
`organic_results[].snippet`. Reordering puts the shallower tier first.
Impact: since both outputs are `research_only` (P0.1), reordering changes which
unsendable lead you get and does not improve sendable coverage; its only real
effect is cost/latency ordering.
Correction: do not reorder for accuracy. If cost is the motive, note it is not
the binding constraint (`.claude-memory/project-serpapi-budget-latency.md`);
latency is (P1.3).

**P1.2 — The name-consistency gate the proposal keeps is simultaneously too loose
(bare surname) and too strict (short surname); the cited co-affiliation
"successes" are its loose failures.**
Evidence: `lib/utils/contact-parser.js:295-296` accepts any address whose local
part contains the last token when the surname is ≥3 chars. Verified live against
the gate:
`isNameConsistentEmail('zhang@mit.edu','Feng Zhang')` → **PASS**,
`isNameConsistentEmail('liu@chemistry.harvard.edu','David R. Liu')` → **PASS**
(both bare-surname, no person-specificity — the exact namesake-collapse form);
`isNameConsistentEmail('gwli@mit.edu','Gene-Wei Li')` → **REJECT** (real address:
first-initial + middle-initial + surname, but surname `li` is 2 chars so
`contact-parser.js:281` skips it and `:295` fails the length gate).
Impact: the proposal (item 6, and prompt §"Experimental evidence" Zhang/Liu)
presents `zhang@mit.edu` / `liu@chemistry.harvard.edu` as evidence for a
co-affiliation policy, but they are precisely the addresses the gate cannot
distinguish from a namesake's; meanwhile the gate silently drops the correct
short-surname address. `zhang@mit.edu` is almost certainly a different Zhang or a
role mailbox, not Feng Zhang's personal address.
Correction: do not lean on bare-surname web addresses as co-affiliation evidence.
If the East-Asian-surname recall gap is worth fixing, fix the gate
(`contact-parser.js:279-296`: allow a two-initial + short-surname compact form),
not the query cascade.

**P1.3 — The adaptive cascade re-introduces the per-candidate fan-out already
scoped out for latency.**
Evidence: measured over the frozen run's 160 SerpAPI calls (this artifact),
per-call latency median **2.14 s**, mean **3.20 s**, p90 **7.49 s**, max
**17.7 s**. `.claude-memory/project-serpapi-budget-latency.md`: latency, not cost,
is the binding constraint; "Scholar-first reordering, topic-keyword query
expansion, and per-candidate multi-profile web fan-out were all evaluated and
scoped OUT for latency reasons (S234)." Enrichment runs largely sequentially per
candidate under a `reviewer_time_budget_exceeded` deadline
(`pages/api/reviewer-finder/enrich-contacts.js:88-95`).
Impact: the proposed 5–6-query cascade (`serp-contact-service.js:114-135` already
issues up to 5 fallback queries; the proposal widens this to a co-affiliation
family) adds ~10–20 s/candidate against a budget where the PD's bar is "could I
Google these myself in the same time?"
Correction: bound any cascade to ≈2–3 probes, run them in parallel, and `log()`
what was dropped. Do not re-justify wide fan-out on "we have call budget."

**P1.4 — The experiment's automatic reference metric is blind on exactly the
population SerpAPI is for.**
Evidence: `scripts/evaluate-serp-lab-query-variants.mjs:122-135` builds the
reference index from the structured-scholarly production artifact; the run baked
references into **27 of 40** subjects. The 13 with no structured reference —
Cavalleri, Imamoğlu, Abanin, Wherry, Shan, Berg, Aidelsburger, Keblinski, Singer,
Schäfer, Haravifard, Sebastian, Masquelier — are exactly the cases the free tier
failed and SerpAPI exists to cover. For those 13, `exactReferenceEmailHit` /
`referenceDomainHit` are 0 by construction, yet 7 of them returned a
name-consistent first email the metric can neither confirm nor refute.
Impact: the headline "18 name-consistent → 18 reference matches (current)"
measures *agreement on the easy cases that did not need SerpAPI* and is silent on
the hard cases. It is not a valid proxy for correct-person resolution on the
target population.
Correction: the primary endpoint must be manual adjudication of correct-person
email on a first-party page (see Next Experiment); the reference is a convenience
check on the easy subset only.

## P2 — real but lower-severity

**P2.1 — Fixing `gl=us`/`hl=en` harms the international reviewers whose emails are
hardest.** Evidence: ≥14 of the 40 cohort are non-US (MPSD/MPI, ETH, EMBL,
Bar-Ilan, CNRS/Toulouse, Nottingham, Münster). The faculty-page and academic
domain gates already support international TLDs
(`serp-contact-service.js:262-274`, `lib/utils/contact-parser.js:536-604`).
Forcing US locale can suppress the localized institutional result that carries the
correct address. Correction: fix locale only for *reproducibility of the eval*,
not as a production default; or set `gl`/`hl` from the resolved institution
country (available once the institution is resolved to a ROR/OpenAlex id).

**P2.2 — Caching is not free given the reproducibility params and affiliation
drift.** Evidence: SerpAPI serves a cached result only when *query and all
parameters are exactly the same*, TTL **1 h** (SerpAPI docs, verified). So (a)
adding `google_domain`/`gl`/`hl` changes the cache key and *misses* the existing
production cache and this experiment's cache — the proposal's items 4 and 7
interact; and (b) an address is only ~98%/yr stable (audit §3.2), so a durable
cache keyed on name+institution can serve a stale address after a move.
Correction: if caching, key on `{query, google_domain, gl, hl}` exactly, keep the
TTL short (hours, matching SerpAPI's own), and include the *effective institution*
in the key so a re-resolved affiliation invalidates it.

**P2.3 — `search_contested` resurrection persists and displays a name-mismatched
address (contained at send, not at display).** Evidence:
`email-adjudication.js:25-41` (`readjudicateNameMismatchRejectedEmail`) revives a
previously name-rejected serp/claude email when its domain relates to a
*plausible* institution domain, marking it `search_contested` with
`emailPersistAllowed = true` (`:19`). It is `research_only` at send (P0.1), but it
is persisted and shown as the (flagged) contact. Impact: expanding the co-affiliate
domain set (proposal item 6) enlarges the `plausibleInstitutionDomains` set
(`domain-evidence.js:114-131`) and therefore how often a name-mismatched address
is revived for display. Correction: acceptable as a quarantined staff breadcrumb,
but do not widen the plausible-domain set as a *email-acceptance* mechanism;
resolve co-affiliation in ID-space (W1.4) so display reflects real associated
institutions, not lexical domain relatedness.

No additional P3 findings.

---

# Claim Verification Matrix

| # | Claim (from the review brief) | Verdict | Evidence |
|---|---|---|---|
| 1 | Primary Serp query already includes name, institution, and `email` | `[VERIFIED]` | `serp-contact-service.js:41-43` — `"${cleanName}" ${institution} email` |
| 2 | Claude web search currently runs before SerpAPI | `[VERIFIED]` | `contact-enrichment-service.js:278` (Tier 3) precedes `:284` (Tier 4); `tiers.js:280` `applyTier3`, `:365` `applyTier4` |
| 3 | SerpAPI is skipped when an earlier tier supplied any email | `[VERIFIED]` | `tiers.js:370` `if (!result.contactEnrichment.email && hasIdentityAnchor)`; else branch `:451` "Skipped (email already found)". (Note: Tier 4 skips on *any* email; Tier 3's `emailAlreadyFound` is stricter — `email && emailIsRecent`, `contact-enrichment-service.js:274`.) |
| 4 | Outside the evidence experiment, a page/website lead can stop Serp fallbacks even with no email | `[VERIFIED]` | `serp-contact-service.js:109-112` — production (`evidenceExperiment=false`) sets `shouldTryFallbacks = !email && !facultyPageUrl && !website`, so a captured page suppresses fallbacks |
| 5 | The Serp service keeps the first snippet email, not ranked alternatives | `[VERIFIED]` | `serp-contact-service.js:80-93` sets `result.email` only `if (!result.email && item.snippet)` (first wins); `:138` `if (result.email) break`. No ranking/aggregation |
| 6 | Generic `site:.edu` is a late, conditional fallback | `[VERIFIED]` | `serp-contact-service.js:123-129` — only inside the fallback block (primary found nothing) and only when the institution name contains "university"/"college" |
| 7 | A resolved-page tier can upgrade or replace low-trust search evidence | `[VERIFIED]` | `page-email.js:177` `replaceable = !ce.email || SEARCH_EMAIL_SOURCES.has(ce.emailSource) || 'search_contested'`; `:206-224` overwrites to `institution_page` (READY) |
| 8 | Downstream domain/invitation checks contain wrong-person / cross-affiliation results | `[VERIFIED — with nuance]` | Contained **at send**: `send-emails-service.js:403-418` hard-skips `research_only`; `save-candidates-service.js:145-154` `paidSearchSource` gates persistence. **Not contained at display/persist**: a domain-matching or `search_contested` serp email is persisted+shown (flagged), `email-adjudication.js:19`,`:141-156` |
| 9 | The dormant Google Scholar lookup is not part of the live contact path | `[VERIFIED]` | `serp-contact-service.js:335-343` header ("RETIRED from the live enrichment path"); grep shows `findScholarProfile`/`fetchScholarMetrics` referenced only by `scripts/measure-scholar-orcid-crosstab.js` and `scripts/backfill-lone-orcid-scholar.js`, not by `lib/`/`pages/`. Enrichment sources bibliometrics from OpenAlex (`openalex-metrics.js:39-152`) |
| 10 | Both production callers hard-enable both paid tiers | `[VERIFIED]` | `enrich-contacts.js:116-117` passes `useClaudeSearch/useSerpSearch` from client options (UI `ReviewerSearchSection.js:765` sends both `true`); `workbench/enrich-recommended-service.js:258-260` hardcodes `useSerpSearch:true, useClaudeSearch:true, persist:false` |
| 11 | The paired eval made 160 successful SerpAPI calls over 40 subjects | `[VERIFIED]` | Artifact `summary.callsAttempted = 160`, `subjects = 40`, both variants `completed:40 errors:0` |
| 12 | Only 27/40 subjects have a structured reference | `[VERIFIED]` | 27 subjects carry `references[].length > 0`; the 13 without are the SerpAPI target population (P1.4) |
| 13 | `zhang@mit.edu` / `liu@chemistry.harvard.edu` support the co-affiliation policy | `[REFUTED]` | Both PASS `isNameConsistentEmail` only via the bare-surname rule (`contact-parser.js:295`); they carry no person-specificity and are the namesake-collapse form. Hand-picked, not representative (P1.2) |
| 14 | SerpAPI Developer plan is $0.015/search; `num` does not change price; cached/failed searches are free | `[VERIFIED — EXTERNAL]` | SerpAPI pricing + FAQ (2026-07-18): Developer $75 / 5,000 = $0.015; "100 results or empty both count as 1 search"; "Cached, errored, and failed searches are not [counted]". (The repo's `SERP_CALL_COST_USD = 0.005` in the eval script is a stale under-estimate.) |
| 15 | `as_epq` / `as_oq` / `as_sitesearch` are supported and materially better than plain query syntax | `[VERIFIED support; REFUTED "materially better"]` | SerpAPI documents `as_epq`/`as_oq`/`as_sitesearch`/`as_eq`/`as_qdr` (SerpAPI advanced-query docs). They are 1:1 equivalents of `"…"`, `OR`, `site:` — same billing, same engine; no accuracy advantage over the quoted/`site:` syntax already used |
| 16 | SerpAPI cache TTL is 1 h, keyed on exact query+params | `[VERIFIED — EXTERNAL]` | SerpAPI `no_cache` docs: "A cache is served only if the query and all parameters are exactly the same. Cache expires after 1h." |

---

# Experiment Critique

What the run **does** establish (exact over n=40, no population claim):

- Adding `lab` to the contact query is net-negative on raw email recall
  (37→30 snippet emails; paired −7) and strongly negative on usable Scholar
  profiles (30→18; paired −12), while merely raising keyword-classified "lab
  page" hits (21→32) — i.e. `lab` biases toward pages *about a lab* (which over-
  count collaborators/members, prompt Q4) and away from the person's own
  contact/profile page. Correctly, the run concludes `lab` should not be added.
- Both query forms tie on "any actionable lead" (39/39), so `lab` changes *which*
  lead, not *whether* there is one.

Threats to validity (why the numbers do not license the broader strategy):

1. **The automatic metrics are not a correct-person proxy on the target
   population (P1.4).** `exactReferenceEmailHit` is defined only on the 27/40 easy
   cases; on the 13 hard cases it is 0 by construction. `nameConsistentEmailHit`
   uses `isNameConsistentEmail`, which P1.2 shows both over- and under-accepts.
   `labPageHit` is a keyword regex (`evaluate-serp-lab-query-variants.mjs:174-178`
   `/\b(lab|laborator…)\b/`), which cannot tell a page about the candidate from a
   page about their lab's other members — the exact over-count the metric is used
   to *measure*.
2. **Cohort bias.** The 40 are elite, high-footprint, senior researchers
   (36/40 have Scholar profiles), skewed to physics/condensed-matter with a
   biomedical minority. They are the *most* web-discoverable end of the
   distribution; the real target (new, often earlier-career or non-US reviewers
   with thin footprints) is under-represented, so raw discoverability here is an
   upper bound. n=40 with no confidence interval; a single run.
3. **Result/cache instability is unmeasured.** The run executed each variant once.
   SerpAPI's 1 h exact-match cache (verified) means a re-run of the *same* variant
   within an hour would be cache-served and look perfectly stable while masking
   Google's real result churn; a re-run *after* the hour is a fresh, possibly
   different SERP. The comparison has no test-retest measurement, so none of the
   single-subject deltas (added/lost lists) are known to be stable rather than
   SERP noise. Because `current` and `lab` are *different* query strings, they do
   not share a cache entry, so intra-pair contamination is not the issue —
   run-to-run reproducibility is.
4. **The reference is the structured-scholarly artifact itself**
   (`DEFAULT_REFERENCE`), which the companion audit shows has a structural
   ceiling. Using it as the comparison anchor is fine (the script honestly labels
   it "not exhaustive truth", `contract.referenceUse`), but the derived
   `exactReference*` counts still bake that incompleteness into the headline.
5. **`SERP_CALL_COST_USD = 0.005`** in the script under-states the real
   $0.015/search Developer cost by 3× (claim 14) — the "$0.80 total" figure is
   ~$2.40 in reality. Immaterial to the conclusion, but the cost line in the
   artifact is wrong.

David Liu and Feng Zhang (prompt §"Experimental evidence") are hand-probes, not
in the 40-cohort, and are refuted as co-affiliation evidence by P1.2/claim 13.

---

# Recommended Resolver Strategy

Corrected order and budget (keeps every existing safety gate):

1. **Call order — unchanged.** Free structured tiers (Tier 0 affiliation-embedded
   → PubMed → ORCID → NCBI/Europe PMC scholarly) first; then paid tiers only when
   no recent structured/ORCID address exists (`tiers.js:274`, `:284`, `:370`). Do
   **not** move SerpAPI ahead of Claude (P1.1). If anything, keep Claude (which
   reads pages and returns citations) as the richer web tier and treat Serp as the
   *page-URL finder* that feeds the page-fetch tier.
2. **Change the paid-tier objective from "snippet email" to "first-party page."**
   The cascade's win condition is a page on an anchored institution domain that
   `attachEmailFromResolvedPage` (`page-email.js:169-232`, tier already enabled in
   prod) can ground into an `institution_page` (the only sendable web grade,
   P0.1). Snippet emails route only to the quarantined `contactLeads[]` layer.
3. **Query budget ≤ 3 per candidate, parallel** (P1.3): (a) `"Name" institution`
   (drop the trailing `email` token — it biases toward mailto scrapes, not
   faculty pages); (b) `"Name" site:<resolved-institution-domain>` using the
   OpenAlex-resolved domain the system already has
   (`openalex-metrics.js:127-135`), not `site:.edu`; (c) one conditional Scholar/
   ORCID profile probe. `log()` anything dropped.
4. **Aggregate pages, not emails.** Collect candidate *first-party page URLs*
   across the ≤3 results, rank by person-specificity (surname/slug in host+path,
   the ordering `page-email.js:133-158` already does), and hand the top 1–2 to the
   page-fetch tier. Never accept a snippet email as `email`.
5. **Page verification — already correct, extend cautiously.** The page tier is
   SSRF-bound to anchored domains (`page-email.js:187`, `safe-fetch.js`),
   name-grounds the address (`selectGroundedEmail`, `page-email.js:108-130`), and
   rejects document/PDF URLs (`contact-parser.js:456-465`). Treat directories /
   shared-lab rosters as *non-grounding* (the `associated.size === 1` uniqueness
   gate at `page-email.js:129` already abstains on a roster with multiple
   candidate-adjacent emails). Do **not** relax the name-grounding to admit
   opaque local parts.
6. **Co-affiliation — resolve in ID-space, not a hand-listed family (P2.3,
   P1.2).** Replace the proposed Broad/MIT/Harvard/HMS string family with the
   OpenAlex `associated_institutions` consistency rule already scoped in
   `docs/REVIEWER_IDENTITY_CONTACT_PLAN.md` W1.4: two institutions are consistent
   iff they share an id or one is in the other's `associated_institutions`. Use it
   to *widen the anchored-domain set for the page-fetch/domain guard*, so an
   official `@broadinstitute.org` page for a verified MIT-anchored person is
   *grounded and sendable* — but only when the page identifies the person. A bare
   `surname@big-university` address never becomes sendable on domain alone.
7. **Locale/caching (P2.1/P2.2).** Set `gl`/`hl`/`google_domain` from the resolved
   institution country, not hardcoded US; fix US only inside the eval harness for
   reproducibility. If caching, key on `{query, google_domain, gl, hl,
   effectiveInstitution}` with a short (≤ a few hours) TTL.
8. **Claude fallback.** Unchanged: Claude runs before Serp today and both are
   already gated on identity anchor + name consistency; no reorder. The real
   fallback that matters is *staff hand-off with a pre-built faculty-page link*
   when the page tier finds no grounded address — the honest terminal state
   (audit §3.2c), not another paid search pass.

Advanced SerpAPI params (`as_epq`/`as_oq`/`as_sitesearch`): supported but not
worth adopting — they are exact equivalents of the `"…"`/`OR`/`site:` syntax
already used, same billing, no accuracy gain (claim 15).

---

# Next Experiment

**Question the eval must answer:** for the population that reaches the paid tiers
(no structured/ORCID address), does a page-first cascade + page-fetch tier
produce a **correct-person, first-party-page-verified, sendable** address at a
rate that justifies the SerpAPI spend and latency — versus simply handing staff a
faculty-page link?

- **Cohort.** The **13 no-structured-reference subjects** from this run (the true
  target) **plus** a fresh ≥ 25-person sample drawn from *new-to-WMKF* candidates
  weighted toward thinner-footprint / earlier-career / non-US reviewers (to
  correct the cohort bias in P1.4/critique 2). Freeze it as
  `reviewer-email-page-first-cohort-v1.json`; record fingerprint.
- **Arms** (per candidate, ≤ 3 SerpAPI calls each, run in parallel):
  1. **Current production** (`"Name" institution email`, first-snippet).
  2. **Page-first cascade** (`"Name" institution` + `"Name"
     site:<resolved-domain>` + conditional profile probe) → top-1/2 page URLs →
     page-fetch tier.
  3. **Page-first + `<corresp>`** (arm 2 plus Europe PMC OA `<corresp>` parse).
  (Drop the proposal's "quoted institution" and "domain-family cascade" arms —
  P1.2/P2.3 predict they add namesake admission without sendable yield; include
  one *only* if arm 2 underperforms and you want to isolate why.)
- **Primary endpoint (replaces the reference metric):** **correct-person email
  verified on a first-party page, AND sendable under Contract 3** (`ready` /
  `institution_page`). A snippet email that stays `research_only` is a **failure**
  of the endpoint, not a partial success — that is the whole point.
- **Adjudication rubric (manual, blinded to arm):** for each returned address,
  one adjudicator records: (a) is the page first-party for THIS person (title/h1
  or URL slug identifies them, not a co-author/lab member)? (b) does the local
  part or page text tie the address to the person (not a shared/role mailbox)? (c)
  independent confirmation via the person's own ORCID/institutional directory.
  Label `correct-sendable` / `correct-not-sendable` / `wrong-person` /
  `unverifiable`. Two adjudicators on a 20% overlap sample; report Cohen's κ.
- **Manual-review burden:** ~ (13 + 25) × 3 arms ≈ 114 addresses to adjudicate;
  budget ~3–4 hours. This is the real cost of the endpoint and must be stated up
  front.
- **Cost/call budget:** ≤ 3 SerpAPI calls × 38 subjects × 3 arms ≈ **342 SerpAPI
  calls ≈ $5.13** at the *real* $0.015/search (not $0.005), plus page-fetch
  bandwidth and Haiku for arm-3 `<corresp>` parsing. State this before running;
  it is ~7% of the monthly 5,000-call Developer quota.
- **Stopping rule:** stop at the frozen cohort; no adaptive expansion. If arm 2/3
  `correct-sendable` rate does not exceed arm 1 by a pre-registered margin (e.g.
  ≥ +10 pp absolute) with the manual labels, the cascade is not worth the latency.
- **Production-decision thresholds:** promote a page-first cascade only if it
  (i) raises `correct-sendable` coverage materially over current, (ii) adds **zero
  wrong-person sendable** addresses (a single wrong-person `institution_page` is a
  hard fail — it is the fail-dangerous class,
  `.claude-memory/project-reviewer-verify-fail-dangerous.md`), and (iii) keeps
  median added latency under the PD's "Google-it-myself" bar (target ≤ ~5 s/
  candidate added). If it fails (iii) but passes (i)/(ii), ship it as an *offline
  staff-batch* enrichment, not the interactive path.

---

# Residual Risks

- **The structural ceiling remains.** Even a perfect cascade cannot manufacture an
  email that is not on a first-party page: NLM stopped embedding emails in 2013,
  ORCID public email is < 5%, Crossref/OpenAlex expose none (audit §3.2). The
  page-fetch tier is the ceiling, and it depends on the person having a
  crawlable, name-grounded institutional page — which the thinnest-footprint
  target reviewers least often have.
- **Bare-surname namesake admission persists** until `isNameConsistentEmail` is
  hardened (P1.2). Any co-affiliation widening (even ID-space) that reaches the
  domain guard inherits this: `zhang@mit.edu` on a Zhang lab page could ground if
  the page names the person, but a shared *role* mailbox on a personal page could
  too. The uniqueness gate (`page-email.js:129`) mitigates but does not eliminate.
- **OpenAlex identifier / institution churn** (audit §2.2): the resolved-domain
  the cascade relies on comes from OpenAlex `last_known_institution`, which drifts
  (sabbatical, most-recent paper). A stale institution → wrong `site:` domain →
  missed page. This argues for the evidence-bundle persistence in
  `REVIEWER_IDENTITY_CONTACT_PLAN.md` W4, independent of this proposal.
- **Latency variance is heavy-tailed** (p90 7.5 s, max 17.7 s measured). Even a
  3-query parallel cascade's wall-clock is set by its slowest call; a few tail
  latencies per batch can still breach the reviewer time budget on large batches.
- **The magic-link closes the loop anyway.** Every invited reviewer self-reports a
  preferred email at accept (audit §1). The entire paid-search apparatus is a
  bridge to first contact; over-investing in it optimizes a few days before the
  reviewer supplies ground truth for free.

---

# Bottom Line

**Highest-leverage change:** stop treating the paid tiers' *snippet emails* as the
product. Point the query cascade at finding the correct *first-party page* and let
the already-enabled page-fetch tier ground it into the only sendable web grade
(`institution_page`), and parse Europe PMC `<corresp>` for the OA subset. That is
where sendable coverage actually comes from; snippet-email aggregation feeds only
the quarantined staff-breadcrumb layer.

**The one idea not to implement as written:** the Broad/MIT/Harvard/HMS
"institution family" as a query-expansion-and-acceptance cascade. It admits
bare-surname namesake addresses (`zhang@mit.edu`) it cannot person-verify, adds no
person-specificity, and duplicates — worse, in lexical string space — the
ID-space `associated_institutions` consistency rule already planned in
`REVIEWER_IDENTITY_CONTACT_PLAN.md` W1.4. Resolve co-affiliation by institution id
and use it to widen the *page-grounding* domain set, never as a reason to accept
an ungrounded address.
