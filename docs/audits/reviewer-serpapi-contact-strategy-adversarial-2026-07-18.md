# Verdict

**SOUND WITH MATERIAL REVISIONS.**

The proposal's premise — *be more systematic about web search for the new-to-WMKF
reviewers the free structured tiers miss* — is correct, and its core mechanic
(collect candidate-specific pages, fetch the top first-party pages, promote an
email only when the page is demonstrably about the candidate — brief items 4–5)
is the right direction and is what the already-enabled page-fetch tier is built
to do. The revisions are about **endpoint and sequencing, not a missing idea**:

- The genuinely weak element is the *email-aggregation* half of item 4 and the
  experiment's endpoint. **A snippet email from either paid tier is
  `research_only` by Contract 3 and is never sent** (verified end to end below);
  aggregating/ranking snippet emails cannot change that. The invitation-sendable
  web grade is the page-fetch tier's `institution_page` — recovered from a
  *first-party page*, which is exactly item 5's instinct. So the work should
  measure and optimize *page-grounded sendable addresses*, not snippet-email hits
  or reference matches.
- The recommended `site:<institution-domain>` / anchored-domain scoping **cannot
  run where SerpAPI currently sits** — the OpenAlex-resolved domain and identity
  verdict are computed in `_finalize`, *after* the paid tiers (P1.5). Enabling it
  requires an explicit data-flow reorder with real latency/identity tradeoffs,
  stated below.
- Co-affiliation (item 6) is **real and correct-instinct**: Feng Zhang genuinely
  publishes `zhang@mit.edu` (MIT McGovern) and `zhang@broadinstitute.org` (Broad);
  David Liu genuinely holds Harvard-Chemistry and Broad core appointments. These
  are page-grounded correct-person addresses, not namesakes. The fix is to
  resolve co-affiliation in OpenAlex ID-space (`associated_institutions`) so the
  co-affiliate page is *anchored and grounded* — **not** the hand-listed
  Broad/MIT/Harvard string family (which relaxes acceptance without adding
  person-specificity).
- Whether SerpAPI should run before Claude is **unresolved** — the experiment
  compared Google query variants, not the two tiers on page recovery / sendable
  yield / latency / cost. That ordering belongs in the next experiment, not in a
  categorical verdict.

The safety posture the proposal leaves intact (abstain-is-safe, forename gate,
`research_only`-never-sends, page-grounding required for a sendable web address)
is load-bearing and must not be relaxed.

---

# Prioritized Findings

## P0 — snippet emails are unsendable, so the endpoint (not the page-fetch idea) is the weak part

**P0.1 — Item 4's email-aggregation half, and the experiment's snippet-email
endpoint, cannot yield an invitation; item 5's page-fetch instinct is correct and
already built.**
The proposal has two halves. Item 5 — "fetch and verify the top first-party
pages before promoting an address" — is the *right* mechanism and maps directly
onto the shipped page-fetch tier; this finding does not fault it. The weak part
is (a) the "aggregate candidate *emails*" half of item 4 and (b) the endpoint the
paired experiment actually measured (raw snippet-email hits / reference matches).
Evidence a snippet email cannot be sent: `lib/utils/reviewer-invite.js:83`
(`RESEARCH_ONLY_EMAIL_SOURCES = serp_search, claude_search, search_contested`),
`:107-112` (`emailConfidence` → `action:'research_only'`);
`lib/services/review-manager/send-emails-service.js:403-418` (first-contact
invitation with `research_only` is hard-skipped `email_research_only` — a checkbox
or forged allowlist cannot override it);
`lib/services/contact-enrichment/email-adjudication.js:141-156` (even a serp email
whose domain *matches* an anchored domain keeps `emailSource:'serp_search'`: the
domain match sets `emailPersistAllowed` but never upgrades the source, so it stays
`research_only`). The *only* path that makes a web address sendable is
`page-email.js:206-224`, which overwrites `emailSource` to `institution_page` (a
`READY_EMAIL_SOURCES` member, `reviewer-invite.js:82`), and it reads a *page URL*
(`ce.facultyPageUrl`/`ce.website`, `page-email.js:133-158`) — i.e. it consumes
item 5's output, not a snippet email.
Impact: aggregating/ranking snippet emails (item 4) adds SerpAPI calls and
wall-clock without changing sendable coverage (the local eval already shows
37/40 raw snippet emails but ~6/40 sendable, companion audit §3.2). This is a
*measurement/endpoint* defect, not "the proposal forgot page grounding."
Correction: keep item 5; make its success metric *"a first-party page on an
anchored institution domain that the page-fetch tier can ground into
`institution_page`"*, and demote item 4 to page-URL aggregation (snippet emails go
only to the quarantined `contactLeads[]` staff layer, never `email`). Pair with
Europe PMC `<corresp>` parsing (audit §6.1) for the OA subset. Keep
`REVIEWER_PAGE_EMAIL_TIER_ENABLED` on (prod-enabled 2026-07-03,
`docs/CREDENTIALS_RUNBOOK.md:178`) as the sendability path.

## P1 — mis-prioritizations that will waste budget or admit the wrong person

**P1.1 — The SerpAPI-vs-Claude ordering is unresolved by the current evidence;
only its safety-neutrality is verified.**
`[VERIFIED]` reordering is safety-neutral: both tiers run the identical guards —
`lib/services/contact-enrichment/tiers.js:296` (Claude `resultContradictsAnchor`)
and `:382` + `:395` (Serp `resultContradictsAnchor` + `isNameConsistentEmail`),
both gated `hasIdentityAnchor` (`tiers.js:284`, `:370`).
`[UNVERIFIED]` which ordering yields more *sendable* coverage. The paired
experiment compared two Google *query variants* (current vs `lab`); it did **not**
compare Claude vs SerpAPI on first-party-page recovery, sendable (`institution_page`)
yield, latency, or dollar/quota cost. My earlier draft asserted "Serp-first is
negative on recall-of-sendable" from the mechanism (Claude reads pages and returns
citations, `search-tiers.js:64-185`; Serp returns only `organic_results[].snippet`)
— that is a *hypothesis*, not a measured result, and I retract it as a conclusion.
Impact: there is no basis in hand to keep or change the order.
Correction: treat the ordering as an open question and put it in the next
experiment (a Claude-only arm vs a Serp-only arm on the page-grounded sendable
endpoint, with latency measured for both). Cost is not the tiebreaker — marginal
dollar cost is zero under the 5,000/mo quota (claim 14); latency is the binding
constraint (`.claude-memory/project-serpapi-budget-latency.md`, P1.3).

**P1.2 — The Zhang/Liu addresses are page-grounded correct-person results (my
earlier "probable namesake" reading was wrong); they show why page grounding, not
the bare-surname gate alone, is the safe mechanism — and the gate also
false-rejects a real short surname.**
Correction of my own prior error: `zhang@mit.edu` is Feng Zhang's real address,
published on his official MIT McGovern profile (`https://mcgovern.mit.edu/profile/feng-zhang/`,
verified 2026-07-18: "[zhang@mit.edu](mailto:zhang@mit.edu)"), and
`liu@chemistry.harvard.edu` is David R. Liu's, on his official Harvard Chemistry
profile (`https://www.chemistry.harvard.edu/people/david-r-liu`, owner-verified;
the page bot-blocks direct fetch — 403). Both people are genuinely
dual-affiliated (Zhang: MIT + Broad `zhang@broadinstitute.org`; Liu: Harvard
Chemistry + Broad core member, corroborated via web search 2026-07-18). So these
are **not** namesake failures — they are exactly the case the proposal's item 5
targets.
What they actually establish:
1. **Page grounding is the safe promoter of a bare-surname address.** A senior
   faculty member often *holds* the canonical short local part (`zhang@`, `liu@`).
   The bare-surname acceptance in `lib/utils/contact-parser.js:295-296` is
   *correct* for these; its weakness is only that bare-surname **alone**, on a
   snippet with no page context, cannot distinguish them from a same-surname
   namesake. The page-fetch tier resolves that ambiguity by requiring the page to
   identify the person (`selectGroundedEmail`, `page-email.js:108-130`). Gate +
   page grounding together are the right design; the gate alone is insufficient
   `[VERIFIED via page-email.js:108-130]`.
2. **Co-affiliation is real and these prove it** — an official address at a
   credible co-affiliate (Broad) is a genuine alternate, supporting item 6's
   instinct.
The one residual gate defect is a *false reject*, verified live:
`isNameConsistentEmail('gwli@mit.edu','Gene-Wei Li')` → **REJECT** (real address:
first-initial + middle-initial + surname, but surname `li` is 2 chars, so
`contact-parser.js:281` skips it and `:295` fails the length gate). This drops a
correct short-East-Asian-surname address.
Correction: (a) do **not** cite these as a reason to *relax* acceptance — they
argue for page grounding, which is already built; (b) fix the short-surname
false-reject (`contact-parser.js:279-296`: allow a two-initial + short-surname
compact form); (c) realize co-affiliation via ID-space `associated_institutions`
so the co-affiliate page is anchored and grounded (P2.3), not via a query-time
acceptance loophole.

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

**P1.5 — The OpenAlex-resolved domain and identity anchor the recommended
`site:`/anchored-domain scoping depends on are NOT computed until after SerpAPI
runs; enabling the recommendation requires an explicit reorder.**
`[VERIFIED via execution-order read]` In `enrichCandidate`, `applyTier3` (Claude)
and `applyTier4` (SerpAPI) run at `contact-enrichment-service.js:278` and `:284`,
then `_finalize` runs at `:290`. Inside `_finalize` (`tiers.js:464-508`),
`attachOpenAlexMetrics` (`:465`, sets `ce.verifiedInstitutionDomain`),
`resolveIdentity` (`:468-469`, sets `ce.identity`), and
`buildInstitutionDomainEvidence` (`:473`, sets `ce.anchoredInstitutionDomains` /
`plausibleInstitutionDomains`, and it is gated on
`mayPersistIdentity(ce.identity?.status)`, `domain-evidence.js:98`) all run
**after** the paid tiers. So when SerpAPI executes, `ce.verifiedInstitutionDomain`
and `ce.anchoredInstitutionDomains` are unset; only `effectiveInstitution` (a
claimed/ORCID institution *name* string, computed at
`contact-enrichment-service.js:250`) is available.
Impact: my recommended `site:<resolved-institution-domain>` query cannot be built
where SerpAPI currently sits. Two ways to fix it, with different tradeoffs:
- **(a) Reorder — identity-safe, higher latency.** Move the
  `{attachOpenAlexMetrics → resolveIdentity → buildInstitutionDomainEvidence}`
  sub-pipeline ahead of the paid tiers. These OpenAlex/ORCID calls already run in
  `_finalize`, so no *new* calls, but they become a serial prerequisite of the
  paid search (SerpAPI waits on OpenAlex, which is ~1 rps rate-limited per
  `.claude-memory/project-serpapi-capability-erosion.md` — adds ~1–2 s before Serp
  starts). Upside: the paid search is then scoped to the *identity-verified*
  institution domain, tightening namesake containment beyond the current post-hoc
  `resultContradictsAnchor`. If identity is unresolved → no anchored domain → fall
  back to the name-only query (safe abstain-friendly default).
- **(b) Cheap resolve — lighter, less identity-safe.** Add one
  `OpenAlexService.searchInstitutions(effectiveInstitution)` before the paid tiers
  to get the *claimed* institution's domain, without the full identity pipeline
  (+1 rate-limited call). The `site:` domain then comes from the unverified
  claimed affiliation, so it only *narrows* the search to the hypothesized
  institution; a namesake there is still contained downstream by page-grounding
  (`page-email.js:108-130`), not at query time.
Correction: state this dependency explicitly in the design; pick (a) if the
identity-scoped search is wanted (and accept the pre-Serp OpenAlex latency), else
(b). Do not describe `site:<resolved-domain>` as a drop-in — it is a reorder.

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
| 12 | Only 27/40 subjects have a structured reference | `[VERIFIED]` | 27 subjects carry `references[].length > 0`; the complement query (`references.length === 0`) independently yields 13, the SerpAPI target population (P1.4) |
| 13 | `zhang@mit.edu` / `liu@chemistry.harvard.edu` are correct-person, page-grounded addresses that support the co-affiliation instinct | `[VERIFIED — corrects my earlier REFUTED]` | `zhang@mit.edu` published on Feng Zhang's official MIT McGovern profile (`mcgovern.mit.edu/profile/feng-zhang/`, fetched 2026-07-18); `liu@chemistry.harvard.edu` on David Liu's official Harvard Chemistry profile (owner-verified; page 403s automated fetch). Both genuinely dual-affiliated (Zhang MIT+Broad; Liu Harvard+Broad, search-corroborated). They PASS `isNameConsistentEmail` via the bare-surname rule (`contact-parser.js:295`) AND are page-grounded to the person — so page grounding, not the gate alone, is what makes them safe (P1.2). NOT namesake failures |
| 14 | SerpAPI Developer plan is $0.015/search allocated; `num` does not change price; cached/failed searches are free | `[VERIFIED — EXTERNAL]` | SerpAPI pricing + FAQ (2026-07-18): Developer $75 / 5,000 = **$0.015 allocated (sunk subscription) cost per search**; "100 results or empty both count as 1 search"; "Cached, errored, and failed searches are not [counted]". **Marginal dollar cost of an extra search is $0 until the 5,000/mo quota binds** — actual usage is ~hundreds/cycle (`.claude-memory/project-serpapi-capability-erosion.md`: 259 in ~8 days → ~900–1,000/cycle, well under 5,000). The eval script's `SERP_CALL_COST_USD = 0.005` (`evaluate-serp-lab-query-variants.mjs:36`) is a bookkeeping under-estimate of the allocated rate; immaterial to any conclusion since marginal cost is zero |
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
   uses `isNameConsistentEmail`, which is not a correct-person oracle in either
   direction: it *accepts* a bare-surname local part (correct for `zhang@mit.edu`
   when page-grounded, but the same shape a namesake would present on an
   ungrounded snippet) and it *false-rejects* a real short-surname address
   (`gwli@mit.edu`, P1.2) — so the metric neither confirms a correct person nor
   cleanly excludes a wrong one without the page context the experiment never
   fetched. `labPageHit` is a keyword regex
   (`evaluate-serp-lab-query-variants.mjs:174-178` `/\b(lab|laborator…)\b/`), which
   cannot tell a page about the candidate from a page about their lab's other
   members — the exact over-count the metric is used to *measure*.
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
5. **Cost bookkeeping (immaterial to the conclusion).** The script's
   `SERP_CALL_COST_USD = 0.005` under-states the *allocated* Developer rate
   ($0.015/search, claim 14). But neither figure is a real spend signal: the
   *marginal* dollar cost of these searches is **$0** — usage sits far under the
   5,000/mo quota (claim 14). The relevant cost of the experiment (and of any
   wider cascade) is latency and quota headroom, not dollars.

David Liu and Feng Zhang (prompt §"Experimental evidence") are hand-probes, not
in the 40-cohort. On the substance they *support* the co-affiliation instinct
(both are real dual appointments with page-published addresses at each
institution, claim 13) — but as **two hand-picked cases** they cannot establish a
*rate* at which co-affiliate addresses are correctly recoverable across the
population; that is what the Next Experiment must measure. Their value here is
existence-proof (page-grounded co-affiliate addresses are real and recoverable),
not a success rate.

---

# Recommended Resolver Strategy

Corrected order and budget (keeps every existing safety gate):

1. **Structured tiers first — unchanged.** Free structured tiers (Tier 0
   affiliation-embedded → PubMed → ORCID → NCBI/Europe PMC scholarly) first; then
   paid tiers only when no recent structured/ORCID address exists (`tiers.js:274`,
   `:284`, `:370`). **Claude-vs-Serp ordering: unresolved — do not change it on
   this review's evidence** (P1.1); the next experiment decides it on a
   page-grounded sendable endpoint with latency measured. The reframing below
   (page-URL objective) applies to whichever tier runs.
2. **Change the paid-tier objective from "snippet email" to "first-party page."**
   The cascade's win condition is a page on an anchored institution domain that
   `attachEmailFromResolvedPage` (`page-email.js:169-232`, tier already enabled in
   prod) can ground into an `institution_page` (the only sendable web grade,
   P0.1). Snippet emails route only to the quarantined `contactLeads[]` layer.
   This is the proposal's own item 5, made the primary objective.
3. **Query budget ≤ 2 SerpAPI calls per candidate, parallel** (P1.3): (a)
   `"Name" institution` (drop the trailing `email` token — it biases toward mailto
   scrapes, not faculty pages); (b) `"Name" site:<institution-domain>` scoped to
   the institution's domain (not `site:.edu`). **Dependency (P1.5): (b) needs a
   resolved domain that is not available where SerpAPI currently runs** — enable it
   via the reorder in P1.5 (identity-anchored domain, safer) or a single pre-Serp
   `searchInstitutions(effectiveInstitution)` (claimed-institution domain,
   lighter). Do **not** add a "Scholar/ORCID profile probe" as a third SerpAPI
   query: the SerpAPI Scholar path is retired from the live flow (claim 9), and
   ORCID is its own free tier (Tier 2), not a Google query — ORCID/Scholar
   identity is already resolved upstream, not via paid search. `log()` anything
   dropped.
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
8. **Terminal fallback.** Both web tiers are already gated on identity anchor +
   name consistency; their *relative order* is the open question in item 1, not
   settled here. The fallback that matters when neither tier + the page-fetch tier
   yields a grounded address is *staff hand-off with a pre-built faculty-page
   link* — the honest terminal state (audit §3.2c), not another paid search pass.

Advanced SerpAPI params (`as_epq`/`as_oq`/`as_sitesearch`): supported but not
worth adopting — they are exact equivalents of the `"…"`/`OR`/`site:` syntax
already used, same billing, no accuracy gain (claim 15).

---

# Next Experiment

> **Completed/superseded 2026-07-18.** The lower-burden staged protocol in
> `docs/REVIEWER_PAGE_FIRST_EMAIL_EXPERIMENT_PLAN.md` replaced the draft below
> and ran through a fresh 20-person, 10 US / 10 non-US validation cohort. The
> selected cascade gained only +1 correct-ready subject (2/20 versus 1/20),
> below its +3 promotion gate, so production ordering and send policy were not
> changed. The remainder of this section is the historical adversarial proposal,
> not pending work.

**Question the eval must answer:** for the population that reaches the paid tiers
(no structured/ORCID address), does a page-first cascade + page-fetch tier
produce a **correct-person, first-party-page-verified, sendable** address at a
rate that justifies the added latency — versus simply handing staff a
faculty-page link — and **which web tier (Claude or SerpAPI), in which order,
gets there fastest**?

- **Cohort.** The **13 no-structured-reference subjects** from this run (the true
  target) **plus** a fresh ≥ 25-person sample drawn from *new-to-WMKF* candidates
  weighted toward thinner-footprint / earlier-career / non-US reviewers (to
  correct the cohort bias in P1.4/critique 2). Freeze it as
  `reviewer-email-page-first-cohort-v1.json`; record fingerprint.
- **Arms** (run in parallel; page-URL objective, ≤ 2 SerpAPI calls where SerpAPI
  is used):
  1. **Current production** (`"Name" institution email`, first-snippet) — baseline.
  2. **Serp page-first** (`"Name" institution` + `"Name" site:<institution-domain>`
     → top-1/2 page URLs → page-fetch tier). Requires the P1.5 domain-availability
     fix; record which variant (identity-anchored vs claimed-institution domain)
     is used.
  3. **Claude page-first** (Claude web search, which already reads pages and
     returns citations, `search-tiers.js:64-185`) → top page URLs → page-fetch
     tier. This is the head-to-head that settles the P1.1 ordering question.
  4. **Serp page-first + `<corresp>`** (arm 2 plus Europe PMC OA `<corresp>`
     parse).
  Record **per-arm latency** (median + p90) alongside yield, so ordering is
  decided on sendable-yield-per-second, not assumption. (Drop the proposal's
  "quoted institution" and "domain-family cascade" arms — P2.3 predicts they add
  namesake admission without sendable yield; include one *only* to isolate a
  shortfall.)
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
- **Manual-review burden:** ~ (13 + 25) × 4 arms ≈ 150 addresses to adjudicate;
  budget ~4–5 hours. This is the real cost of the endpoint and must be stated up
  front.
- **Call/quota budget:** the two SerpAPI arms (2 + 4) issue ≤ 2 calls × 38
  subjects × 2 arms ≈ **150 SerpAPI calls**; the Claude arm issues Haiku
  web-search calls; plus page-fetch bandwidth and Haiku for `<corresp>` parsing on
  arm 4. **Marginal dollar cost ≈ $0** (well within the 5,000/mo SerpAPI quota,
  claim 14) — the ~150 calls are ~3% of monthly quota headroom, not a spend. The
  binding budget is wall-clock/latency, which the arms measure directly.
- **Stopping rule:** stop at the frozen cohort; no adaptive expansion. If no
  page-first arm's `correct-sendable` rate exceeds arm 1 by a pre-registered
  margin (e.g. ≥ +10 pp absolute) under the manual labels, the cascade is not
  worth the latency.
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
- **Bare-surname ambiguity is resolved by page grounding, not by the gate — so the
  page-identification step is load-bearing.** `zhang@mit.edu` is Feng Zhang's real
  address *and* the shape a Zhang-namesake would present; the page-fetch tier
  distinguishes them only because it requires the page to identify the person
  (`selectGroundedEmail` + the `associated.size === 1` uniqueness gate,
  `page-email.js:108-130`). The residual risk is a mis-identification there — a
  shared *role* mailbox on a page that happens to name the person, or a co-located
  namesake's page. Do not weaken that step to chase recall; it is the only thing
  standing between a bare-surname address and a wrong send.
- **OpenAlex identifier / institution churn** (audit §2.2): the resolved-domain
  the cascade relies on comes from OpenAlex `last_known_institution`, which drifts
  (sabbatical, most-recent paper). A stale institution → wrong `site:` domain →
  missed page. This argues for the evidence-bundle persistence in
  `REVIEWER_IDENTITY_CONTACT_PLAN.md` W4, independent of this proposal.
- **Latency variance is heavy-tailed** (p90 7.5 s, max 17.7 s measured on the Serp
  calls; Claude web-search latency is unmeasured and must be captured in the next
  experiment). Even a 2-query parallel cascade's wall-clock is set by its slowest
  call; a few tail latencies per batch can still breach the reviewer time budget
  on large batches.
- **The magic-link closes the loop anyway.** Every invited reviewer self-reports a
  preferred email at accept (audit §1). The entire paid-search apparatus is a
  bridge to first contact; over-investing in it optimizes a few days before the
  reviewer supplies ground truth for free.

---

# Bottom Line

**Highest-leverage change:** keep the proposal's page-fetch instinct (item 5) but
make it the *endpoint* — stop scoring on snippet emails, which Contract 3 never
sends. Point whichever web tier runs at finding the correct *first-party page*,
let the already-enabled page-fetch tier ground it into the only sendable web grade
(`institution_page`), and parse Europe PMC `<corresp>` for the OA subset. That is
where sendable coverage actually comes from; snippet-email aggregation feeds only
the quarantined staff-breadcrumb layer.

**The one idea not to implement as written:** the Broad/MIT/Harvard/HMS
"institution family" as a *query-expansion-and-acceptance* cascade. The
co-affiliation goal is right (Zhang and Liu really do publish addresses at both
their institutions), but a hand-listed string family relaxes acceptance without
adding person-specificity and duplicates — in lexical string space — the ID-space
`associated_institutions` consistency rule already planned in
`REVIEWER_IDENTITY_CONTACT_PLAN.md` W1.4. Resolve co-affiliation by institution
id, and use it to widen the *page-grounding* domain set so a real
`@broadinstitute.org` faculty page can be fetched and grounded — never as a reason
to accept an ungrounded address on domain match alone.
