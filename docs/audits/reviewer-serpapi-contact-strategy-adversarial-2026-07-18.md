# Reviewer SerpAPI contact strategy adversarial audit — redacted edition

Original audit date: 2026-07-18
Original evidence commit: 83f162f8
Current-tree redaction: 2026-07-27

> This edition preserves the audit's technical findings, measurements,
> conclusions, and reproducibility boundaries. Person names, email addresses,
> person-specific profile URLs, and hand-probe identities were removed. The
> original identity examples are not required to support the production
> decision.

## Post-experiment outcome

Both proposed additions were tested separately and were not promoted:

- The page-first cascade gained only +1/20 against its +3 promotion gate.
- The Europe PMC `fullTextXML` fallback added 0/40 beyond the live
  core-record tier.
- Production ordering and behavior remained unchanged.

Current decisions live in
`docs/REVIEWER_PAGE_FIRST_EMAIL_EXPERIMENT_PLAN.md` and
`docs/REVIEWER_IDENTITY_CONTACT_PLAN.md` W3.1/W3.4.

## Verdict

**SOUND WITH MATERIAL REVISIONS.**

The premise was correct: paid web search should be systematic for
new-to-WMKF reviewers missed by free structured tiers. The correct objective,
however, is recovery of a candidate-specific first-party page that the
page-fetch tier can ground into a sendable address. Ranking snippet email
addresses cannot produce an invitation because those results remain
`research_only`.

The safety posture is load-bearing and remains unchanged:

- abstention is safe;
- the forename/name-consistency gate remains active;
- `research_only` evidence never sends;
- a web-derived sendable address requires page grounding.

## Prioritized findings

### P0 — snippet email is the wrong endpoint

Snippet results from both paid tiers remain `research_only` and are hard-skipped
for first-contact invitations:

- `lib/utils/reviewer-invite.js:83,107-112`
- `lib/services/review-manager/send-emails-service.js:403-418`
- `lib/services/contact-enrichment/email-adjudication.js:141-156`

The page-email tier is the web path that can promote an address to
`institution_page`, a ready/sendable source:

- `lib/services/contact-enrichment/page-email.js:133-158,206-224`

Therefore the paid-search success metric must be a candidate-specific
first-party page on an anchored institution domain, not a snippet-email hit or
reference match. Snippet addresses may remain quarantined in `contactLeads[]`
for staff review.

### P1.1 — Claude-versus-Serp ordering remained unresolved

Both tiers apply the same identity-anchor and name-consistency safeguards, so
reordering is safety-neutral. The experiment compared Google query variants,
not Claude and SerpAPI on page recovery, sendable yield, latency, and quota
cost. It therefore did not justify changing the tier order.

### P1.2 — page grounding, not a bare-surname gate alone, resolves ambiguity

Two manually verified, dual-affiliation cases demonstrated that short
surname-only local parts can be legitimate when published on a first-party page
that identifies the person. A separate verified case demonstrated a false
reject for a real two-initial plus two-character-surname local-part shape.

The identities, addresses, and profile URLs from those hand probes have been
removed. The retained technical conclusion is:

- keep the bare-surname rule paired with person-specific page grounding;
- do not promote an ungrounded snippet on local-part shape alone;
- allow the narrowly defined two-initial plus short-surname form only with the
  existing grounding safeguards;
- resolve co-affiliation through OpenAlex identifier relationships, not a
  hand-listed institution-name family.

### P1.3 — a wide adaptive cascade exceeds the latency budget

Across 160 SerpAPI calls:

| Statistic | Latency |
|---|---:|
| Median | 2.14 s |
| Mean | 3.20 s |
| p90 | 7.49 s |
| Maximum | 17.7 s |

A five- or six-query per-candidate cascade would add roughly 10–20 seconds per
candidate in the largely sequential enrichment flow. Any cascade should be
bounded to two or three probes, parallelized, and explicit about work dropped
at the deadline.

### P1.4 — the reference metric was blind on the target population

Only 27/40 subjects had a structured reference. The 13 without one were the
cases the paid tier was intended to cover, yet reference-hit metrics were zero
for them by construction. Seven of those 13 returned a name-consistent first
address that the metric could neither confirm nor refute.

The correct primary endpoint is manual adjudication of a correct-person address
on a first-party page that is sendable under Contract 3.

### P1.5 — anchored-domain search is not a drop-in change

`attachOpenAlexMetrics`, `resolveIdentity`, and
`buildInstitutionDomainEvidence` run in `_finalize`, after the paid tiers:

- `lib/services/contact-enrichment/contact-enrichment-service.js:278-290`
- `lib/services/contact-enrichment/tiers.js:464-508`
- `lib/services/contact-enrichment/domain-evidence.js:98`

An identity-anchored `site:<resolved-domain>` query therefore requires moving
that resolution sub-pipeline ahead of paid search. A cheaper alternative is a
single pre-search institution resolution, but that domain reflects the claimed
institution and relies on downstream page grounding for identity safety.

### P2 — lower-severity constraints

- Hard-coded `gl=us` / `hl=en` can suppress localized institutional results.
  Production locale should follow the resolved institution country; a fixed
  locale is appropriate only for a reproducible evaluation.
- SerpAPI cache reuse requires an exact query-and-parameter match and expires
  after one hour. A local cache must include query, locale/domain parameters,
  and effective institution, with a short lifetime.
- `search_contested` can persist and display a name-mismatched address as a
  flagged staff breadcrumb even though send is blocked. Expanding plausible
  institution domains must not become an email-acceptance shortcut.

## Claim-verification summary

The source review verified these material mechanics:

1. The primary Serp query includes name, institution, and `email`.
2. Claude web search currently precedes SerpAPI.
3. SerpAPI is skipped when an earlier tier supplies an email.
4. In production, a page/website lead can stop Serp fallbacks without an email.
5. The Serp service keeps the first snippet email rather than ranking
   alternatives.
6. Generic `site:.edu` is a late conditional fallback.
7. The resolved-page tier can replace low-trust search evidence with
   `institution_page`.
8. Wrong-person search evidence is contained at send, but flagged evidence can
   still be persisted and displayed.
9. The retired Google Scholar lookup is not part of the live contact path.
10. Both production callers enable both paid tiers.
11. The paired evaluation made 160 successful calls over 40 subjects.
12. Only 27/40 subjects had a structured reference.
13. The redacted hand probes established that page-grounded co-affiliation
    addresses can be correct; they did not establish a population success rate.
14. The SerpAPI plan allocated $75 across 5,000 searches, or $0.015 per counted
    search. Cached and failed searches did not count; marginal cost remained
    zero while usage stayed below quota.
15. Advanced query parameters were supported but equivalent to quoted,
    `OR`, and `site:` syntax for this purpose.
16. SerpAPI cache entries required exact query/parameter equality and expired
    after one hour.

## Experiment critique

The 40-subject paired run established:

- Adding `lab` reduced snippet-email recall from 37 to 30.
- Usable Scholar profiles fell from 30 to 18.
- Keyword-classified lab-page hits rose from 21 to 32.
- Both query forms produced any actionable lead for 39 subjects.

These figures did not license a broader resolver change because:

- the automatic reference metric covered only the 27 easier subjects;
- name-consistency was not a correct-person oracle without page context;
- the cohort skewed toward senior, high-footprint researchers;
- each variant ran once, so post-cache result churn was unmeasured;
- the structured reference was incomplete by design;
- latency and quota headroom, not marginal dollars, were the binding costs.

The two redacted dual-affiliation hand probes were existence proofs only. They
supported the co-affiliation mechanism but could not establish a recovery rate.

## Recommended resolver strategy

1. Keep structured tiers first.
2. Treat a candidate-specific first-party page as the paid-tier objective.
3. Limit SerpAPI to at most two parallel queries per candidate:
   `"Name" institution` and, when a trustworthy domain is available,
   `"Name" site:<institution-domain>`.
4. Aggregate and rank first-party page URLs, not snippet addresses.
5. Keep the page tier's SSRF, anchored-domain, name-grounding, uniqueness, and
   document-rejection safeguards.
6. Resolve co-affiliation using OpenAlex `associated_institutions` identifiers,
   then widen the page-fetch domain set only when the page identifies the person.
7. Derive locale from the resolved institution and use short, exact-key caches.
8. When no grounded address is available, hand staff a faculty-page lead rather
   than add another paid-search pass.

The advanced SerpAPI parameters `as_epq`, `as_oq`, and `as_sitesearch` were not
recommended because they were equivalent to the syntax already in use.

## Completed next experiment

The historical proposal was superseded by
`docs/REVIEWER_PAGE_FIRST_EMAIL_EXPERIMENT_PLAN.md`.

That experiment used a fresh 20-person cohort split evenly between US and
non-US candidates. The selected page-first cascade yielded 2/20
correct-ready subjects versus 1/20 for the comparison, below the required +3
gain. Production ordering and send policy were not changed.

The durable evaluation rule remains: promote only if correct-sendable coverage
increases materially, there are zero wrong-person sendable addresses, and
added latency remains within the interactive budget. Otherwise, use the method
only for offline staff enrichment.

## Residual risks

- No cascade can recover an address that is absent from crawlable first-party
  pages and structured sources.
- Person-specific page identification is the load-bearing control for
  ambiguous short local parts.
- OpenAlex institution state can drift and make a resolved domain stale.
- Paid-search latency is heavy-tailed.
- The invitation magic-link later collects the reviewer's preferred address;
  paid search is only a bridge to first contact.

## Bottom line

Keep the page-fetch instinct, but make the page the endpoint. Snippet-address
aggregation feeds only a quarantined staff-breadcrumb layer. Co-affiliation
should be resolved in institution identifier space and used to widen grounded
page retrieval, never to accept an ungrounded address on domain match alone.

## Redaction and reproducibility boundary

This current-tree edition intentionally removes all person names, raw email
addresses, person-specific profile URLs, and the subject-name list from the
original audit. It retains no hashes, stable aliases, or reversible
transformations of those values.

The code paths, aggregate experiment counts, latency measurements, decisions,
date, and original commit provenance remain. Revalidating the identity examples
requires a fresh, authorized manual probe against first-party sources; results
must be recorded as aggregate outcomes rather than copied into tracked docs.
