---
agent_wiki: topic
status: active
last_verified: 2026-10-22
verification_scope: "Inherited hub date; extraction integrity only, no claim or live-state recertification"
stale_after_days: 90
owner: reviewers
title: "Reviewer Institution Display"
source_files:
  - shared/utils/review-writeup-paragraphs.js
  - lib/services/pre-rp-brief/docx-renderer.js
  - lib/services/external-review/context-service.js
  - lib/services/contact-enrichment-service.js
canonical_docs:
  - docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md
  - docs/atlas/dataverse-wmkf-potentialreviewers.md
watch_paths:
  - shared/utils/review-writeup-paragraphs.js
  - lib/services/pre-rp-brief/docx-renderer.js
  - lib/services/external-review/context-service.js
update_triggers:
  - "Reviewer affiliation or institution display rules change"
  - "Review or brief composition inputs change"
extracted_from: docs/agent-wiki/topics/reviewer-workbench-lifecycle.md
extraction_source_sha256: fdccedfe393f7ae7db7afa04b5b48297080b5c269290637bbf70e192f68888e7
extraction_segments:
  - "945-1116"
---

# Reviewer Institution Display

> The source page mixed current guidance with dated history and owner decisions; those distinctions are preserved in the extracts. The inherited `last_verified` date does not certify these claims anew. This pass verifies only extraction bounds and byte provenance, not runtime behavior, repository-wide drift, or live state.

<!-- source-lines: 945-1116 -->
**Institution names in the reviewer sentence (2026-09-21):** the composer's
`institutionOf` precedence is unchanged (`mainInstitution` → accept-time
`reviewerAffiliationOf` → person `affiliation`), but the two free-text sources
now pass through `institutionNameOf` (`review-writeup-paragraphs.js`) before
display: the accept form's "Title & Organization" field is pre-filled from the
CRM affiliation, which for a PubMed-enriched reviewer is the whole byline, and
request 1002852 rendered "Division of Biochemistry and Structural Biology,
Department of Chemistry, Lund University, SE-22362, Lund, Sweden. Electronic
address: …" because the echoed email differed from the stored one, so the
exact-match strip in `reviewerAffiliationOf` never fired. `institutionNameOf`
strips any echoed email, splits on `;` (independent bylines) and `,`
(including comma-delimited co-affiliations within one byline), drops
geographic parts, and within each run keeps every DISTINCT institution-tier
part (a university-tier part, or a whole hospital/clinic/medical-school/
foundation/national-laboratory-shaped organization, or a whole institute that
is not a sub-institute lead like "Institute of …") — e.g. "University of
Washington, Fred Hutchinson Cancer Center" shows both. With no
institution-tier part in a run, the existing fallback (organization-shaped-
but-sub-unit-looking > first non-sub-unit part > first part) supplies one.
All institution-tier parts across every semicolon run are pooled, deduplicated
case-insensitively, and joined with the Oxford comma (Codex adversarial review,
2026-09-21 — comma co-affiliations and semicolon runs are no longer capped at
one institution per run). The digit rule that drops geographic parts is
narrow: only postal-code shapes (`SE-22362`, `77030`, `D-69120`, and UK-style
`CB2 1TN` / `SW7 2AZ`), `City ST 12345` /
`ST 12345`, and leading street addresses count as geographic — an
organization name that merely contains a digit ("3M Corporate Research
Laboratory", "Institut Curie U1234") is no longer dropped. Matching is
Unicode-aware (`u`-flag regexes with `(?<![\p{L}\p{N}])`/`(?![\p{L}\p{N}])`
boundaries, not ASCII `\b`) and the term lists cover non-English forms:
university terms (université, universität, universidad, universidade,
università, universiteit, universitet, univerzita, uniwersytet, polytechnique,
hochschule, …), organization terms (institut/instituto/istituto, hôpital,
ospedale, klinikum, CHU, CEA, Helmholtz, Fraunhofer, Karolinska, Pasteur,
Weizmann, …), and sub-unit leads (centre de recherche, centro de, departamento
de, département de, laboratoire de, institut de/für, instituto de, abteilung).
`MULTI_CAMPUS_SYSTEM` (the closed "University of <system>" list) is unchanged;
"New York University, Abu Dhabi" still resolves to "New York University"
without campus re-attachment. Owner decisions: every distinct institution in a
byline is shown, joined with "and"/Oxford commas; with no institution-shaped
part the first non-geographic part is shown. A self-confirmed `mainInstitution`
is now reduced through `institutionNameOf` as well, because the accept form's
required "Main institution" field was pre-filled from `wmkf_primaryaffiliation`
(a PubMed byline for enriched reviewers) and reviewers submit it unchanged
(request 1002852, Herwig Schüler): the pre-fill in
`lib/services/external-review/context-service.js` now seeds the reduced name
instead of the raw byline (a prior confirmed `wmkf_maininstitution` is not
re-reduced at pre-fill — it is used as-is, since it is the reviewer's own
prior value; the composer reduces it for display). `reviewerAffiliationOf`
itself is untouched (tab cards and the review-bundle fingerprint depend on
it). Reaches the Reviews tab, the Pre-Site Reviews paragraph, and the Pre-RP
brief (all use `composeReviewerSentence`); the Pre-Research Presentation Brief
card also now shows `generated <date>` next to the draft link, matching
the Pre-Site card. `PRE_RP_BRIEF_CONTRACT.renderVersion` moved `'2'` → `'3'`
for the free-text-source change, then `'3'` → `'4'` for the mainInstitution
reduction above: the Pre-RP generation key binds `renderVersion`
(`lib/services/pre-rp-brief/artifact-service.js:746`), and since the
composer's output changed, identical inputs would otherwise produce different
bytes under the same version, which the contract forbids. Concretely: the
generation key includes `renderVersion`, so post-change generations carry a
new identity (a fresh key/row) — the input fingerprint itself is unchanged,
since it hashes composer inputs, not outputs. Three further tightenings
(owner decision 2026-09-21, after Codex round 3): a campus is never
re-attached (`reattachMultiCampus`) when the next part is itself
institution-tier, which previously duplicated a co-affiliation like "Fred
Hutchinson Cancer Center"; a bare generic label with no proper-noun content
("Cancer Center", "Hospital" alone, "Cancer Center of Excellence") is never
promoted to institution tier, while a real named institution like "Hospital
for Sick Children" or "Fred Hutchinson Cancer Center" still is; and
`Istituto`/`istituto di` are now recognized alongside `Institute`/`Institut`/
`Instituto` for the whole-institute and sub-institute-lead rules. The
`INSTITUTE_SUBUNIT_LEAD` rule itself stays as owner-accepted: a named whole
institute whose name starts "Institute of/for …" is still omitted when a
university is present in the same run (e.g. "Institute of Science and
Technology Austria, University of Vienna" shows only "University of Vienna");
no curated whole-institute list was built to except this. The trailing-digit
geographic rule ("City ST 12345" / "ST 12345") now requires a preceding US
state code, not just a trailing digit group, so an organization name like
"ETH 2" is no longer misread as geographic.

**`mainInstitution` reduction is gated on byline markers (Codex round 4
finding, 2026-09-21):** `institutionOf` (and the accept-form pre-fill in
`context-service.js`) no longer runs EVERY `mainInstitution`/enrichment-affiliation
value through `institutionNameOf` unconditionally — that was lossy on a
clean, reviewer- or staff-confirmed name that happens to contain its own
commas, e.g. "Weill Cornell Medicine, Cornell University" was reduced to just
"Cornell University", and "Cold Spring Harbor Laboratory, Stony Brook
University" to just "Stony Brook University". A new exported helper,
`looksLikeByline(text)`, returns true only when the text carries a marker a
confirmed institution name never has — an echoed email address
(`/\S+@\S+/` or "electronic address"), a comma/semicolon segment that
`isGeographicSegment` already treats as geographic (postal code, US state,
listed country/state name, "City ST 12345", a street address), or a segment
matching the existing `SUBUNIT_SEGMENT` (department/division/lab-of/etc.
lead). `institutionOf`'s `mainInstitution` branch and the accept-form's
`wmkf_primaryaffiliation`/`wmkf_organizationname` seed now reduce through
`institutionNameOf` ONLY when `looksLikeByline` is true; otherwise the value
is shown/seeded verbatim. The other two `institutionOf` branches
(accept-time `reviewerAffiliationOf`, person `affiliation`) are unconditionally
reduced as before — those are free-text sources, never reviewer/staff-
confirmed. A prior confirmed `wmkf_maininstitution` is still never re-reduced
at pre-fill, unchanged from the paragraph above.

**"…Medicine"/"…Laboratory" institutions are recognized structurally, not by
bare word, and are specialty/generic-aware (Fix A, Codex round 5, 2026-09-21;
made specialty/generic-aware, owner decision 2026-09-21, Codex round 6):**
bare `medicine` and `laboratory` were removed from `INSTITUTION_TIER_ORG_TERM`
— matching the bare word anywhere in a segment wrongly promoted structurally
unrelated text like "Laboratory Medicine" and "Sports Medicine" to institution
tier. Instead, `isInstitutionTierPart` recognizes a whole institution named
this way only when the segment ENDS with "Medicine" or "Laboratory" AND the
word immediately before the tail is not itself a generic descriptor:
- `NAMED_MEDICINE_TAIL` (via `isNamedMedicineTail`): the segment ends with
  "Medicine" after at least two preceding, uppercase-initial
  (proper-noun-shaped) words, AND the word directly before "Medicine" is not
  in a clinical-specialty list (`internal`, `emergency`, `pediatric`,
  `regenerative`, `laboratory`, …; see `MEDICINE_SPECIALTY_WORD`) — "Weill
  Cornell Medicine" qualifies, but "Harvard Internal Medicine" and "Pediatric
  Emergency Medicine" do not, even though both have two preceding
  proper-noun-shaped words, because the immediately preceding word names a
  specialty. "Sports Medicine"/"Laboratory Medicine"/"Regenerative Medicine"
  (one preceding word) still fail on shape alone. "Icahn School of Medicine at
  Mount Sinai" isn't a "…Medicine" tail at all (it doesn't end in "Medicine");
  it stays covered by `school\s+of\s+medicine` in `INSTITUTION_TIER_ORG_TERM`.
- `NAMED_LABORATORY_TAIL` (via `isNamedLaboratoryTail`): the segment ends with
  "Laboratory" after at least one preceding, uppercase-initial word, AND that
  word is not generic (`research`, `clinical`, `national`, `university`,
  `medical`, …; see `LABORATORY_GENERIC_WORD`) — "Jackson Laboratory" and
  "Cold Spring Harbor Laboratory" qualify, but "Research Laboratory"/"Clinical
  Laboratory" do not. "Lawrence Berkeley National Laboratory" is excluded here
  (preceding word "National" is generic) but still reaches institution tier
  via `national\s+laboratory` in `INSTITUTION_TIER_ORG_TERM`.
- An all-caps acronym (2+ letters) leading straight into "Laboratory"
  (`ACRONYM_LABORATORY_LEAD`) — "MRC Laboratory of Molecular Biology"
  qualifies, independent of the two rules above.

Bare "Medicine" alone is still excluded via `BARE_INSTITUTION_TIER_LABEL`, and
"Department/Faculty/School of Medicine" stay handled by the existing
`SUBUNIT_SEGMENT`/`ORGANIZATION_TERM` rules, unchanged. `national laboratory`
and `laboratories` (plural) remain in `INSTITUTION_TIER_ORG_TERM` since they
are unambiguous without a proper-noun lead.

**The trailing-single-word byline marker is removed (owner decision
2026-09-21, Codex round 6):** `looksLikeByline` no longer treats a trailing
single letters-only comma/semicolon segment as a byline marker (the Fix B
rule from Codex round 5 is deleted). That rule caught an unlisted trailing
city ("Weill Cornell Medicine, Cornell University, Doha", "Cornell
University, Ithaca") but also misfired on a confirmed value that legitimately
ends in one unlisted word — a real co-affiliation ("Stanford University,
Genentech") or a campus qualifier ("Weill Cornell Medicine, Qatar") — erasing
confirmed content to fix a display artifact. `looksLikeByline` now returns
true only for: an echoed email/"electronic address", any `isGeographicSegment`
segment, or any `SUBUNIT_SEGMENT` segment. A trailing unlisted city is
therefore a **documented miss**: it is shown verbatim rather than reduced.
Staff correct such values directly in the Reviewer Finder candidate edit
modal's Main institution field.

Owner decision 2026-09-21 (Codex round 6): the heuristic stops here; remaining
misclassifications are corrected by staff in the Reviewer Finder candidate
edit modal (Main institution), and a corrected value with no byline markers is
shown verbatim.

`PRE_RP_BRIEF_CONTRACT.renderVersion` stays `'4'` — the gating and tier
change are unreleased on this branch, so no version bump was needed. (It
later moved `'4'` → `'5'` for the unrelated expertise-sentence addition,
owner decision 2026-09-21: the Referee Comments paragraph gains a third,
non-underlined sentence from `composeExpertiseSentence`, and the fingerprint
gained `lastName`/`keywords`/`areaOfExpertise` so the brief regenerates when
expertise data changes — see `docs/atlas/dataverse-wmkf-requestdocument.md`
and `docs/agent-wiki/topics/external-reviewer-portal.md` for the current
description.)

<!-- end-source-lines: 945-1116 -->
