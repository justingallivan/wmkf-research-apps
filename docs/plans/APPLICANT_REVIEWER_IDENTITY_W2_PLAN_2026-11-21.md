# Applicant reviewer identity — W2 works-first resolver plan

Status: **plan for owner decision; nothing changed.** Written 2026-11-21
(Session 693), then corrected the same day after an independent Codex
assessment (verbatim output kept in the session scratchpad; findings folded
in below). Written after the owner asked why every applicant reviewer on test
request 1003526 showed "No publications found". Separate workstream from the
card redesign (`FIND_IDENTITY_CARD_REDESIGN_BRIEF_2026-11-20.md`).

## The problem, in one example

Anna Pyle, recommended by the applicant at Yale. Run locally on 2026-11-21:

- PubMed verified her: 5 papers matched her full name at Yale
  [VERIFIED via local run of `DiscoveryService.verifyClaudeSuggestions`].
- Contact enrichment found an email on several of her papers.
- The identity check still returned "unresolved — no identity evidence", so
  the card hides her papers and asks the director to confirm by hand
  [VERIFIED via local run of `ContactEnrichmentService.enrichCandidates`,
  persist off, production Dataverse reads blocked].

**Why.** In the legacy resolver, the identity check (`tiers.js:494-506`) only
accepts an ORCID found by name search, a Google Scholar profile, or an
OpenAlex author id that an earlier step already matched
(`openalex-metrics.js:49-54`). The PubMed check never supplies an OpenAlex id
(`discovery/verification.js:276-282`), and Anna Pyle has no ORCID that the
ORCID search finds, even with "Yale University" or "Anna Marie Pyle"
[VERIFIED via local `ORCIDService.findContact`]. Yifan Cheng does resolve
through ORCID with UCSF.

**Scope correction.** This is not only applicant reviewers. The OpenAlex
matching inside the shared verification step runs only for clearly
non-biomedical proposals or when PubMed is explicitly off
(`discovery/verification.js:61-66,87-113`). On biomedical
proposals, every Track A suggestion, including the AI's own search
suggestions, depends on the same ORCID or Scholar route. Track B literature
finds have their own works-first step (`discovery/track-b-identity.js`).

## How big it is

Saved Find rows for real applicant reviewers in the previous data format
(`applicantEnrichmentCacheVersion` 4, 58 rows) [VERIFIED 2026-11-21 via
owner-approved read-only, counts-only query of `reviewer_find_roster`]:

| Outcome | Rows |
|---|---|
| Unresolved: resolver abstained (the W2 target) | 29 |
| Resolved: probable | 15 |
| Unresolved: legacy institution contradiction | 13 |
| Unresolved: stage-2 institution hold | 1 |

All 9 rows in the current format (4 real, 5 test) are unresolved. The
institution contradiction rows will not be fixed by W2 alone.

## The fix already exists

The works-first resolver ("W2") is built behind
`REVIEWER_IDENTITY_RESOLVER_MODE` (`lib/services/reviewer-identity-runtime.js`):
`legacy` (default), `shadow` (compare and log, return legacy) and `combined`
(W2 rescues become the result, capped at `probable`). Its frozen 40-case
evaluation: legacy 13 correct / 2 wrong-person / 12 miss; combined 22 correct
/ 0 wrong-person / 3 miss (`REVIEWER_IDENTITY_CONTACT_PLAN.md` "Evidence
basis"). The credentials runbook says not to set `combined` in a deployed
environment without an owner-approved cutover.

Production has a value set for the variable (stored as a Secret, which
Vercel cannot reveal after saving; owner reports it was changed 2026-08-08),
and the comparison table `reviewer_identity_shadow_log` currently holds **no
rows** [VERIFIED 2026-11-21, read-only count]. That does **not** show the
mode: rows older than the 90-day retention are deleted
(`maintenance-service.js:64`), inserts can be skipped by the logger's circuit
breaker (`reviewer-identity-shadow-log.js:64`), and shadow logs only on the
non-biomedical verifier path. Production's current mode is **unknown**.

Enrichment already calls `ReviewerIdentityRuntime.evaluateExistingResult`
(`tiers.js:501`). In `combined` mode it applies W2 there; in `shadow` mode it
returns the legacy result **without running or logging any comparison**
(`reviewer-identity-runtime.js:591-610`, pinned by
`tests/unit/reviewer-identity-runtime.test.js:900`). So setting `shadow`
measures nothing for biomedical applicant reviewers; it only covers
non-biomedical ones, which pass through the shared verifier first
(`enrich-recommended-service.js:722`).

**Local seam test, the five 1003526 reviewers, `combined` mode** (public
OpenAlex and ROR only; database URLs removed, shadow writes disabled)
[VERIFIED 2026-11-21]. This fed a synthetic "legacy unresolved" input to the
seam; it is **not** a replay of the full applicant path, whose real legacy
inputs and later institution checks can give different outcomes:

| Reviewer, institution used | Result |
|---|---|
| Anna Pyle, Yale | probable (works rescue; OpenAlex last-known: HHMI) |
| Rachel Klevit, University of Washington | probable (works rescue) |
| Ailong Ke, Cornell | probable (works rescue; OpenAlex last-known: **Yale**) |
| W. Lee Kraus, "UT Southwestern Medical Ccenter" | review: claimed institution unresolved (the test record's typo) |
| Yifan Cheng, UCSF | review: multiple distinct ORCID clusters |

Institutions other than Yale and UTSW were typed from public knowledge, not
read from the AkoyaGO records. Ailong Ke's bind with a different last-known
institution needs a look before cutover.

## What `combined` also turns on

- **Conditional identity writes.** W2 rescues produce typed anchors that
  applicant enrichment can write to `wmkf_identityverifiedanchorsjson` when
  its guards allow (`reviewer-works-first-authoritative.js:43`,
  `enrich-recommended-service.js:1179`, `lib/dataverse/adapters/researcher.js:227`).
  Switching the mode back does not undo those writes. Whether any W2 write
  has happened before is unknown.
- **Every execution reaching the seam:** the non-biomedical verifier and
  enrichment runs. PubMed verification and Track B are unchanged; cached
  rows skip enrichment. Combined can demote as well as rescue.
- **Profile-propagation gap.** Enrichment copies W2's identity and ORCID but
  not its selected OpenAlex profile, so later institution reconciliation
  never sees it (`tiers.js:477,501`; `enrich-recommended-service.js:112`).
  Ailong Ke's Yale-vs-Cornell case may go unexamined. This is an
  integration gap, not proof of a wrong match.
- **Independent institution hold.** `identityNeedsReview = !identityConfirmed
  || institutionContradicted` (`enrich-recommended-service.js:891-998`); a
  probable identity alone does not clear the 13 contradiction rows.
- **Stale caches.** Saved unresolved results stay valid caches regardless of
  mode (`reviewer-search-logic.js:989`), so any change needs a deliberate
  re-enrichment.
- More OpenAlex calls per reviewer (about 3 seconds each in the local test).

## Options (corrected)

1. **Confirm Production's effective mode.** Behavioural evidence: the
   2026-11-21 Production run left Anna Pyle, Rachel Klevit and Ailong Ke
   unresolved, while `combined` resolves them locally, so Production is not
   effectively `combined` [inference]. `legacy` and `shadow` look identical
   to directors; once step 2 deploys, new comparison rows appear only under
   `shadow`. Otherwise, from existing evidence
   (`resolverMode` in institution-resolver metrics logs, or a non-biomedical
   admin identity comparison), or a small reviewed diagnostic that returns
   only the normalized mode and deployment id.
2. **[BUILT 2026-11-21 on branch `reviewer-identity-shadow-enrichment`, not
   deployed]** **Add comparison coverage to the enrichment seam** (code change): in
   `shadow`, run W2 there too, log the comparison, keep the exact legacy
   result, and write nothing. Directors see no change.
3. **Test the complete applicant path** with real stored inputs, institution
   reconciliation and the final card, persistence stubbed. Close the
   profile-propagation gap.
4. **Applicant-only combined pilot.** Needs explicit plumbing (the public
   enrichment method takes no mode override, `reviewer-identity-runtime.js:631`),
   a manual check of every new bind, regression checks on existing probable
   matches, and cache refresh.
5. **Global combined cutover** only with representative coverage, benchmark
   regression checks and an explicit decision.

Recommendation (Codex, adopted): steps 1–3 before any switch; do not cut
over globally on the five-reviewer seam test. Target for the pilot: raise
the share of applicant rows reaching `probable` above the prior-format
cohort baseline of 15 of 58, with zero wrong-person binds in a manual check.
Individual urgent reviewers can still be confirmed by staff through the
existing evidence-backed confirmation.

## Consequence for the card brief

The card brief's D26 measurements (§7 item 6) treat "no address found" as a
lookup miss. 34 of the 43 unresolved rows have no found email because the
server blanks contact data for unresolved identities
(`enrich-recommended-service.js:1248-1300`). So "8 of 62 one-click" is a
floor, not a measurement, until identity resolution improves.

## Not decided here

- Whether to change the legacy institution contradiction check (13 rows).
- Whether biomedical Track A search suggestions should get the same fix.
