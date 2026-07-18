---
title: "Claude adversarial review prompt — SerpAPI reviewer contact resolution"
domain: reviewer-operations
kind: draft
status: active
summary: "Read-only adversarial review brief for the proposed SerpAPI-first, domain-aware reviewer contact resolution strategy."
canonical: false
owner: product-engineering
related:
  - docs/REVIEWER_IDENTITY_CONTACT_PLAN.md
  - docs/REVIEWER_IDENTITY_CONTACT_HANDOFF.md
  - docs/audits/reviewer-disambiguation-email-external-alternatives-fable-2026-07-18.md
  - lib/services/serp-contact-service.js
  - lib/services/contact-enrichment/tiers.js
  - scripts/evaluate-serp-lab-query-variants.mjs
---

# Claude adversarial review prompt — SerpAPI reviewer contact resolution

## Where and ownership

You are in:

```text
/Users/gallivan/Code/WMKF_Apps/.claude/worktrees/claude-parked
```

on branch:

```text
claude/adversarial-serpapi-resolver
```

Run `/start`, then invoke `/contract-reconcile` for this review because the
proposal crosses identity, retrieval, evidence, persistence, and invitation
consumers.

Stay on this branch and in this worktree. A Codex session is active in the main
checkout on `codex/reviewer-email-evidence`; do not switch branches, edit the main
checkout, merge, rebase, or push `main`.

Claude owns only the review artifact:

```text
docs/audits/reviewer-serpapi-contact-strategy-adversarial-2026-07-18.md
```

This is an adversarial review, not an implementation assignment. Do not change
resolver code, tests, configuration, environment variables, plans, handoffs, or
existing audit documents. You may create the review artifact above and update
`docs/DOCS_CATALOG.md` only as required by the repository's docs gates.

## Review objective

Evaluate whether WMKF should use SerpAPI/Google more aggressively and more
systematically to resolve reviewer identity and contact ambiguity, especially for
new reviewers absent from WMKF's database.

The proposed direction is:

1. Keep structured scholarly sources.
2. Move SerpAPI ahead of Claude web search for unresolved contact discovery.
3. Replace the current one-query/first-email behavior with an adaptive query
   cascade:
   - exact candidate name plus quoted institution;
   - exact candidate name constrained to an anchored institutional domain;
   - conditional `lab` search for first-party lab/profile pages;
   - searches across credible co-affiliation domains such as
     Broad/MIT/Harvard/HMS;
   - generic `site:.edu` only as a last resort.
4. Aggregate candidate emails/pages across results instead of accepting the first
   snippet email.
5. Fetch and verify the top first-party pages before promoting an address.
6. Treat an official address at any credible co-affiliate institution as useful,
   rather than rejecting it solely because it differs from one current-institution
   anchor.
7. Make results reproducible with US Google parameters (`google_domain=google.com`,
   `gl=us`, `hl=en`) and cache/deduplicate identical searches.
8. Use Claude web search only after the cheaper structured Google search and page
   verification fail to resolve the ambiguity.

Your job is to try to prove this strategy wrong, incomplete, unsafe, or
mis-prioritized. Do not merely improve the wording.

## Claims to verify from live code

Do not trust this prompt's description. Trace the actual caller-to-consumer flow and
confirm or refute each claim:

- The primary Serp query already includes candidate name, institution, and `email`.
- Claude web search currently runs before SerpAPI.
- SerpAPI is skipped when an earlier tier has supplied any email.
- Outside the evidence experiment, a page/website lead can stop Serp fallbacks even
  when no email was found.
- The Serp service keeps the first snippet email rather than returning ranked
  alternatives.
- Generic `site:.edu` is a late, conditional fallback.
- A resolved-page tier can upgrade or replace low-trust search evidence.
- Domain and invitation checks downstream are strong enough—or not strong enough—to
  contain wrong-person and cross-affiliation results.
- The dormant Google Scholar lookup is not part of the live contact-enrichment path.

At minimum inspect:

```text
lib/services/serp-contact-service.js
lib/services/contact-enrichment-service.js
lib/services/contact-enrichment/tiers.js
lib/services/contact-enrichment/page-email.js
lib/services/contact-enrichment/domain-evidence.js
lib/services/contact-enrichment/email-adjudication.js
lib/services/contact-enrichment/identity-anchor.js
lib/services/reviewer-identity-resolver.js
lib/utils/contact-parser.js
lib/utils/reviewer-invite.js
scripts/evaluate-serp-lab-query-variants.mjs
docs/REVIEWER_IDENTITY_CONTACT_PLAN.md
docs/REVIEWER_IDENTITY_CONTACT_HANDOFF.md
docs/audits/reviewer-disambiguation-email-external-alternatives-fable-2026-07-18.md
.claude-memory/project-serpapi-budget-latency.md
.claude-memory/project-serpapi-capability-erosion.md
```

Trace callers and invitation consumers rather than reviewing these files in
isolation.

## Experimental evidence to challenge

A local, ignored copy of the full 40-person artifact is available at:

```text
outputs/reviewer-holistic-m1/reviewer-email-serp-lab-query-variants-v1.json
```

It is input evidence only. Do not commit it.

The paired experiment made 160 successful SerpAPI calls over the frozen 40-person
cohort:

| Outcome | Current query | Query with `lab` |
|---|---:|---:|
| Raw snippet-email hits | 37 | 30 |
| Name-consistent first emails | 20 | 19 |
| Matches to structured scholarly references | 18 | 15 |
| Faculty-page leads | 36 | 35 |
| Keyword-classified lab-page leads | 21 | 32 |
| Any actionable lead | 39 | 39 |
| Raw Scholar-profile hits | 36 | 34 |
| Usable Scholar-profile hits after name/institution checks | 30 | 18 |

Paired findings:

- `lab` added one otherwise-missing raw email and two name-consistent first-email
  outcomes, but added no structured-reference matches.
- `lab` lost seven net raw email hits and twelve net usable Scholar matches.
- Some raw “email hits” were clearly another person's address, a generic mailbox,
  or malformed snippet text; raw hit rate is not the success criterion.
- David R. Liu produced `liu@chemistry.harvard.edu` with both query forms.
- Feng Zhang produced `zhang@mit.edu` with the current query and
  `zhang@broadinstitute.org` with the lab query; both query forms found the same
  correct Scholar profile.

Adversarially examine:

1. Whether the evaluator's automatic metrics are valid proxies for correct-person
   resolution.
2. Whether the frozen cohort is biased or too small.
3. Whether repeated Google calls, cache effects, result instability, or query
   ordering invalidate the comparison.
4. Whether `lab` page classification over-counts pages about collaborators or lab
   members rather than the candidate.
5. Whether the structured scholarly artifact is trustworthy enough to serve as a
   comparison reference.
6. Whether David Liu and Feng Zhang support the proposed co-affiliation policy or
   merely illustrate two hand-picked successes.

Re-run targeted read-only experiments if they materially answer a review question.
Do not run bulk experiments without stating the call count and estimated cost first
in your working notes. Never write external records or send email.

## Required adversarial questions

### Strategy and economics

1. Is moving SerpAPI before Claude actually the correct ordering? Consider accuracy,
   identity anchoring, latency, parallelism, cancellation, and total cost—not just
   price per call.
2. Should SerpAPI run when Claude or a scholarly tier already found an address, as
   corroboration rather than fallback? Where is the marginal call valuable?
3. What is the smallest adaptive query budget likely to outperform the current
   behavior?
4. Is caching safe given changing affiliations and addresses? What should the cache
   key and TTL include?

### Query design

5. Does quoting the full institution help, or does it suppress pages that use school,
   hospital, acronym, or affiliate names?
6. Is exact `site:<institution-domain>` preferable to `site:.edu`, and how should
   international, hospital, nonprofit, and personal lab domains be handled?
7. Should SerpAPI receive one institution, a domain family, or a ranked sequence of
   identity hypotheses?
8. Does fixing `gl=us` and `hl=en` improve reproducibility without harming
   international reviewer discovery?
9. Are advanced SerpAPI parameters (`as_epq`, `as_oq`, `as_sitesearch`) materially
   better than ordinary Google query syntax?
10. Which additional result structures—sitelinks, knowledge graph, displayed link,
    snippet highlights—are useful evidence, and which create noise?

### Identity and email safety

11. Can an official co-affiliate email safely outrank a single OpenAlex
    current-institution anchor? Define the evidence needed.
12. Does the proposed Broad/MIT/Harvard/HMS “institution family” create a loophole
    large enough to admit namesakes?
13. Should first-party page evidence permit addresses whose local part fails the
    current name-consistency heuristic?
14. Is page fetching sufficient evidence, or do dynamic pages, directories, shared
    lab pages, stale pages, and PDFs require different treatment?
15. Identify every route by which a wrong search email could still become persisted,
    displayed as primary, selected, rendered, or sent.

### Experiment design

16. Design the strongest practical next experiment. The proposed arms are:
    - current behavior;
    - quoted institution;
    - anchored exact-domain search;
    - adaptive domain-family cascade with conditional lab search.
17. The primary endpoint should be correct-person email verified on a first-party
    page. Confirm or replace that endpoint and specify the adjudication rubric.
18. Specify stopping rules, sample size, manual-review burden, and decision thresholds
    that would justify a production change.

## External research

Use web research where it changes the verdict. Prefer primary sources:

- official SerpAPI Google Search and advanced-parameter documentation;
- official Google search-operator guidance;
- official API/provider documentation for any alternative you recommend.

Distinguish documented behavior from inference and from experiment-specific
observation. Do not rely on generic SEO advice.

## Required output contract

Write:

```text
docs/audits/reviewer-serpapi-contact-strategy-adversarial-2026-07-18.md
```

Use these sections exactly:

1. `# Verdict`
   - one of `SOUND`, `SOUND WITH MATERIAL REVISIONS`, or `UNSOUND`;
   - a concise explanation of the decision.
2. `# Prioritized Findings`
   - findings ordered P0, P1, P2, P3;
   - each finding includes `file:line` evidence, impact, and the concrete correction;
   - write “No P0 findings” or similar when a severity is empty.
3. `# Claim Verification Matrix`
   - every material current-state claim labeled `[VERIFIED]`, `[REFUTED]`,
     `[ASSUMED]`, or `[STALE]`;
   - cite source, test, artifact, or web authority.
4. `# Experiment Critique`
   - threats to validity and what the existing experiment actually establishes.
5. `# Recommended Resolver Strategy`
   - the corrected call order, query budget, evidence aggregation, page-verification,
     domain-family, caching, and Claude-fallback policy.
6. `# Next Experiment`
   - exact cohort, arms, endpoint rubric, manual adjudication plan, cost/call budget,
     stopping rule, and production-decision thresholds.
7. `# Residual Risks`
   - risks that remain even if the recommendation is implemented.
8. `# Bottom Line`
   - the one highest-leverage change;
   - the one idea from the proposal that should not be implemented as written.

Do not praise the proposal. Do not summarize work performed unless it supports a
finding. If no high-severity defects exist, say so plainly rather than inventing
one.

## Completion and handoff

After writing the review:

1. Run the relevant docs catalog and fact-consistency gates.
2. Confirm no file outside the owned review artifact and required catalog changed.
3. Commit with a descriptive message.
4. Push:

   ```bash
   git push -u origin claude/adversarial-serpapi-resolver
   ```

   Do not push or merge `main`.
5. Report using:

   ```text
   Owner: Claude
   Branch: claude/adversarial-serpapi-resolver
   Status:
   Changed surfaces:
   Commits:
   Verification:
   Dirty worktree:
   Next owner/action:
   ```
