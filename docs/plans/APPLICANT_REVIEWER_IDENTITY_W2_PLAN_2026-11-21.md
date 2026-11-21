# Applicant reviewer identity — W2 works-first resolver plan

Status: **plan for owner decision; nothing changed.** Written 2026-11-21
(Session 693) after the owner asked why every applicant reviewer on test
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
matching inside the shared verification step runs only for non-biomedical
proposals (`discovery/verification.js:62-66,87-113`). On biomedical
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

Production has a value set for the variable (stored as a hidden secret), and
the shadow comparison table `reviewer_identity_shadow_log` has **no rows at
all** [VERIFIED 2026-11-21, read-only count]. So shadow mode has never
recorded a comparison; Production most likely runs `legacy` [ASSUMED; the
hidden value was not read].

Enrichment already calls `ReviewerIdentityRuntime.evaluateExistingResult`
(`tiers.js:501`), which in `combined` mode applies W2 to applicant rows with
no further code change.

**Local test, the five 1003526 reviewers, `combined` mode** (public OpenAlex
and ROR only; database URLs removed, shadow writes disabled) [VERIFIED
2026-11-21]:

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

- **W4.1 evidence persistence.** Combined results thread typed anchors into
  `wmkf_identityverifiedanchorsjson` on the reviewer record. Built, never run
  in Production (`REVIEWER_IDENTITY_CONTACT_PLAN.md` W4). A cutover is also
  the first Production write of that field.
- **Every caller of the runtime seam,** not only applicant rows: Track A
  non-biomedical verification and every enrichment run.
- More OpenAlex calls per reviewer (about 3 seconds each in the local test).

## Options

1. **Shadow first (recommended first step).** Set the variable to `shadow` in
   Production. Nothing a director sees changes; each enrichment run logs a
   decision-only comparison (no names). After a week of real use, read the
   log: how many legacy abstains W2 would rescue, and any W2 bind that
   disagrees with the listed institution.
2. **Combined everywhere.** The owner-gated cutover the existing plan already
   describes. Largest effect, widest blast radius, first W4.1 writes.
3. **Combined for applicant rows only.** Pass a combined-mode override from
   `enrich-recommended-service.js` only. Narrow, but it is new code on the
   identity path and needs `/contract-reconcile` and a Codex plan review.

Recommendation: option 1 now, then option 3 or 2 on the measured result.
Target: raise the share of applicant rows reaching `probable` from 15 of 58
(26%) with zero wrong-person binds in a manual check of every new bind.

## Consequence for the card brief

The card brief's D26 measurements (§7 item 6) treat "no address found" as a
lookup miss. 34 of the 43 unresolved rows have no found email because the
server blanks contact data for unresolved identities
(`enrich-recommended-service.js:1248-1300`). So "8 of 62 one-click" is a
floor, not a measurement, until identity resolution improves.

## Not decided here

- Whether to change the legacy institution contradiction check (13 rows).
- Whether biomedical Track A search suggestions should get the same fix.
