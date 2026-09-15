---
title: June–August 2026 Institution-Affiliation Source Recovery
domain: reviewer-identity
kind: audit
status: complete
summary: "Read-only source recovery found 65 PubMed-backed candidates; a bounded 26-case owner exercise then labeled person and institution relationships, but no case was cleared for selection."
canonical: false
cataloged: 2026-09-14
last_verified: 2026-09-14
owner: product-engineering
related:
  - docs/audits/institution-affiliation-last-cycle-baseline-2026-09-14.md
  - docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md
  - docs/plans/REVIEWER_INSTITUTION_AUTO_RESOLUTION_PLAN_2026-09-14.md
  - scripts/collect-institution-affiliation-source-packet.js
  - scripts/select-institution-affiliation-adjudication-queue.js
---

# June–August 2026 institution-affiliation source recovery

## Result and authority

**[VERIFIED via read-only Production Postgres roster query and PubMed/ORCID
source fetch, 2026-09-14]** The 106 retained mismatch-flagged rows divide into:

| Retained source evidence | Cases | What it supports |
|---|---:|---|
| At least one retained PubMed link with a uniquely matched full-forename/surname byline and that byline's affiliation | 65 | A source-backed **candidate for independent adjudication**, not a proven original decision input or person identity |
| No retained PubMed or ORCID reference, but a website URL | 6 | An unverified profile link for source inspection; no author or affiliation claim has been extracted from it |
| No retained PubMed, ORCID, or website link | 35 | Another source path is needed to reconstruct evidence; these rows cannot be scored from the retained roster alone |

The first group contains 293 distinct referenced PubMed IDs and 11 distinct
ORCID IDs. All 293 PubMed records and all 11 ORCID profiles were fetched. In
the 65 cases, 277 PubMed article records provide a uniquely matched full-name
byline with at least one author-specific affiliation; the dates parsed by
`PubMedService` are no later than the corresponding roster `first_seen_at`.
Date precision may be only month or year. All 11
ORCID profiles are in this same 65-case group, so they add context but no cases
to the recoverable set. A current ORCID profile without an employment end date
does **not** establish that employment was current at the June–August decision.

**[VERIFIED via roster shape]** The 41 rows without PubMed/ORCID references
are all applicant suggestions. Six retain website links on institutional
domains; the collector retains those URLs without fetching or asserting their
contents. The other 35 lack these three reference types. The 41 rows'
provenance has no grounding work IDs, but each retains a suggestion ID and
suggested institution text. This is a
*roster-source gap*, not proof that the original applicant submission or a
separate Dataverse record is unavailable. Recovering the exact applicant
assertion requires a separately authorized, source-specific trace.

**[VERIFIED via the 2026-09-14 exploratory replay artifact]** The 65
source-backed cases span two stored-text `same` proposals, four `distinct`,
28 `unresolved`, 19 slash-joined affiliation skips, and 12 skips where the
stored “suggested institution” is decision text rather than an institution.
These are sampling strata, **not labels**. The replay compared retained text
under unknown source/time and did not run selection policy. Two of the 19 slash
skips also contain decision text; the intake selector removes those before
sampling.

## Local packets and privacy

Run `node --env-file=.env.local scripts/collect-institution-affiliation-source-packet.js`
to recreate the full local packet, then
`node scripts/select-institution-affiliation-adjudication-queue.js` to recreate
the 26-case intake queue. The latter samples the two `same`, four `distinct`,
ten slash-joined, and ten `unresolved` source-backed cases; it omits replay
predictions from the packet itself. This varied queue is not representative
and is not yet a held-out acceptance corpus.

Both outputs are under gitignored `outputs/` and written mode `0600`:

- `outputs/institution-affiliation-source-packet-2026-09-14.json` — all 106
  cases, source records, triage reason, and empty label fields;
- `outputs/institution-affiliation-adjudication-queue-2026-09-14.json` — 26
  source-backed intake cases with no replay verdict.

A private Excel confirmation sheet was generated from the 26-case queue using
the July 2026 single-reviewer workbook pattern. Its `Review` tab shows one
cited publication per case and plain-text answer cells for same person and
same institution. The earlier original-source question was removed because
the worksheet evidence does not let the owner identify which source drove the
historical decision. The `Evidence` tab retains 226 citation/affiliation rows
for closer inspection. Exploratory replay predictions are absent.

**[VERIFIED via byte-preserved workbook import and owner clarification,
2026-09-14]** The completed workbook was copied unchanged to
`outputs/institution-affiliation-confirmation-owner-completed-2026-09-14.xlsx`
with SHA-256
`ab5b3917abe8e7e11aff4e23bb7f72378bb133895918b2638c55fd835da12ca4`.
Every raw answer and note was imported to the private, mode-0600
`outputs/institution-affiliation-adjudication-import-2026-09-14.json` before
normalization. Seven rows had at least one blank assessment cell; their notes
supported bounded review-layer interpretations, including one case resolved
after the owner reviewed its proposal context. One mistyped confirmation was
normalized, and one same-person/multiple-institution answer was separated into
its two independent labels. The import retains every raw value and records the
rationale for each review-layer interpretation.

The resulting relationship labels are 22 same-person, two different-person,
and two unknown; institution comparison is 19 same and seven distinct. These
are owner-confirmed inputs from a varied, nonrepresentative intake queue, not a
completed blind policy-label set. All 26 final consumer actions remain
`not_evaluable`: the exercise did not recover the exact original decision
source, prove currentness at the decision, or screen additional-affiliation
COI. No row is approved for automatic selection or a durable write.

The packet includes a candidate name, stored institution text, public PubMed
and ORCID links, a sanitized retained website URL when present, matched public
byline, author-specific affiliation, source
date, and ORCID employment summary because adjudication needs those fields.
It excludes raw request/candidate IDs, email addresses, abstracts, provider
credentials, and historical staff-action claims. IDs are pseudonymous hashes
from the existing retrospective audit, so the packets still contain personal
data and should remain local and be removed after adjudication.

## Label contract and stopping points

The queue deliberately leaves every label unset. Independent adjudicators
should fill distinct fields for: whether the **exact original decision source**
was recovered; author attribution; currentness at the original decision;
every affiliation segment; organization relationship; institution-only
clearance; independent non-affiliation person identity; COI from additional
affiliations; other hold reasons; and the final consumer action. Use `unknown`
where the original source or time cannot be established. PubMed publication
date is a lower bound on when that work existed, not proof of current
employment. A full-name byline is not a person bind, and the retained pair may
not be the original verifier-versus-recorded pair.

Use `null` for an unworked field and `unknown` for a completed review with
insufficient evidence. The intended label vocabulary is:

| Field | Allowed adjudication result |
|---|---|
| `exactOriginalDecisionSourceRecovered` | `yes`, `no`, `unknown` |
| `authorAttribution` | `direct`, `ambiguous`, `unrelated`, `unknown` |
| `sourceCurrentnessAtDecision` | `current`, `historical`, `unknown` |
| `affiliationSegments` | Array of distinct organizations with the source URL and observed date; `unknown` if segmentation cannot be established |
| `organizationRelationship` | `same`, `parent_child`, `sibling`, `distinct`, `related_other`, `unresolved` |
| `institutionOnlyClearance` | `clear`, `hold`, `neutral`, `not_evaluable` |
| `independentPersonIdentity` | `sufficient`, `insufficient`, `unknown` |
| `additionalAffiliationCoi` | `clear`, `conflict`, `unscreened` |
| `otherHoldReasons` | Array of independent hold reasons, or `[]` when checked and none apply |
| `finalConsumerAction` | `selectable`, `hold`, `not_evaluable` |

Adjudicators should record the cited source and rationale separately from
these compact labels. No `clear` may be inferred from a matching institution
name without the author, time, identity, and COI checks above.

No historical staff clicks can be reconstructed from these sources. The queue
can test whether source-aware institution rules would make safe decisions once
the independent identity and COI contracts are available; it cannot quantify
staff actions avoided or authorize a live selection/write flip. The 14
source-backed rows whose stored institution is decision text need
recorded-institution repair before pair adjudication;
the six unverified profile URLs need source inspection, and the other 35
applicant rows need source tracing or remain
`not_evaluable`. Keep genuine current discrepancies visible with a concrete
remedy, while treating compatible departments as institution-only clear
*only after* the separate person and COI gates pass.
