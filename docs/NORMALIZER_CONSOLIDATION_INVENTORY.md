---
title: Normalizer Consolidation Inventory — Caller Semantics for Person-Name and Institution Normalizers
domain: reviewer-identity
kind: audit
status: active
summary: "Person-name/institution normalizer and nickname-map inventory verified against source: callers, equivalence classes, delta vs the research memo's counts."
canonical: false
cataloged: 2026-08-07
owner: product-engineering
related:
  - outputs/fuzzy-matching-independent-research-fable-2026-08-05.md
  - outputs/fuzzy-matching-consensus-recommendation-2026-08-06.md
  - outputs/fuzzy-matching-reconciliation-draft-claude-2026-08-06.md
  - docs/agent-wiki/topics/reviewer-identity.md
---

# Normalizer Consolidation Inventory

This document is **step 1 groundwork** for the fuzzy-matching consensus
(`outputs/fuzzy-matching-consensus-recommendation-2026-08-06.md` §1 step 1):
"inventory the caller-specific semantics first, pin current behavior under
tests" — before any consolidation, refactor, or edit of the normalizers
themselves. **No production code was touched to produce this document or its
companion characterization tests** (`tests/unit/normalizer-characterization/`).
Everything below was verified by reading the current source and grepping for
call sites; no claim here should be read as a plan or a recommendation.

The independent research memo (`outputs/fuzzy-matching-independent-research-fable-2026-08-05.md`
§1) asserted counts up front: "14 person-name normalizer definitions,
reducible to 8 genuinely distinct algorithms" and "11 institution normalizer
definitions, 6 distinct algorithms ... two verbatim copies of a keyword-set
extractor." Those are treated here as **claims to re-verify**, not facts. My
own count (§4/§5) is the ground truth for this document; see §6 for the
explicit reconciliation and the one place my count diverges from the memo's.

## 1. Person-name normalizers

### 1.1 `normalizeName` — `lib/utils/name-normalization.js:14`
```
lowercase → strip [^a-z\s] → collapse whitespace → trim
```
No honorific strip, no diacritic fold, no reordering.
- **Callers**: imported by `lib/services/deduplication-service.js:12` as
  `normalizeName`, but that import is shadowed — see §1.2, the class defines
  its OWN static `normalizeName` with an identical body and the class method
  is what every internal caller (`this.normalizeName`) actually invokes.
  (Historical note in the file: extracted from `DatabaseService#normalizeName`
  for the drained Postgres-era `researchers.normalized_name` keyed-lookup
  column.)
- Semantic identity: **byte-identical** to §1.2 (deduplication-service.js's
  own static method). Two independent copies of the same four-step pipeline.

### 1.2 `DeduplicationService.normalizeName` — `lib/services/deduplication-service.js:131`
```
lowercase → strip [^a-z\s] → collapse whitespace → trim
```
- **Callers** (via `this.normalizeName` inside the class): `areNamesSimilar`
  (fuzzy dedup grouping, `groupByNameSimilarity` → `deduplicateAndStore`),
  `filterProposalAuthors` (COI author-name filter, line ~424/449),
  `partitionConflicts`/`filterConflicts` (exclude-name matching, line
  ~460/465/488/523) — i.e. this ONE function backs candidate dedup grouping,
  proposal-author COI exclusion, and the exclude-name partition simultaneously.
- Byte-identical to §1.1; not called from outside the class today (the module
  import at line 12 is dead for this purpose — `normalizeName` free function
  is never referenced directly, only via `this.normalizeName`).

### 1.3 `normalizeReviewerName` — `lib/utils/reviewer-name-match.js:26`
```
NFKD-decompose → strip combining diacritical marks → ß→ss →
lowercase → strip leading /^(dr|prof|professor|mr|mrs|ms)\.?\s+/i →
strip [^a-z\s] → collapse whitespace → trim
```
Explicitly documented in its own header as "the SINGLE source of truth for
reviewer-name normalization + exact exclusion matching" and "Mirrors
`DeduplicationService.normalizeName`" (a claim this inventory shows is FALSE
for the diacritic/honorific steps — it mirrors only the shape, not the
behavior; see §1.1/§1.2, which have neither).
- **Callers** (one shared implementation, re-exported/required from four
  places — confirmed no drift here):
  - `lib/services/reviewer-roster-store.js` (roster dedup key, 4 call sites:
    add/lookup/list/remove paths).
  - `lib/services/claude-reviewer-service.js` (Claude suggestion soft-block:
    drops previously-excluded names from new suggestion batches).
  - `pages/api/workbench/reviewer-roster.js` (roster API dedup key).
  - `shared/components/reviewers/reviewer-search-logic.js` (client re-export;
    also re-exports `partitionByExcluded`, used by the UI's exclude filter).
  - `pages/api/reviewer-finder/discover.js` (excluded-name hard filter at
    `/discover`).
- This is the ONE normalizer in the inventory with diacritic folding AND
  honorific stripping AND non-alpha stripping together — the most complete
  single-string transform, but its honorific set (`dr|prof|professor|mr|mrs|ms`)
  omits `sir`/`dame`/`mx` that other seams strip (§1.6, format-name-list.js).

### 1.4 `normalizeNameForMatch` — `lib/services/discovery/name-matching.js:19`
```
lowercase → strip leading /^(dr\.?|prof\.?|professor)\s+/i →
collapse whitespace → trim
```
No non-alpha strip, no diacritic fold — punctuation like periods/commas
survives.
- **Callers**: `firstNamesEquivalent`, `nameMatchEvidence` (surname+forename
  byline-match evidence engine — the core function `evaluateNameEvidence`,
  `namesMatch`, `filterToMatchingAuthor(MultiVariant)` all build on this),
  used throughout PubMed/OpenAlex byline confirmation
  (`lib/services/discovery/affiliation.js` recency-weighted affiliation
  picker) for identity confirmation of a suggested reviewer against retrieved
  article authors.
- Distinct from §1.5 even though §1.5's docstring claims to be "Copied from
  discovery-service" — see next entry.

### 1.5 `ContactParser.normalizeNameForMatch` — `lib/utils/contact-parser.js:628`
```
lowercase → strip [.,] only → collapse whitespace → trim
```
Docstring: *"Normalize a name for matching (lowercase, remove punctuation,
etc.) Copied from discovery-service to avoid circular dependency."*
**This claim is stale/false as written**: the honorific-strip step present
in §1.4 (`normalizeNameForMatch` in discovery/name-matching.js) is ABSENT
here. The two functions have diverged since the copy — same name, same
apparent purpose, different behavior on any string beginning with
"Dr./Prof./Professor ".
- **Callers**: `ContactParser.namesMatch` (own module, last-name +
  first-initial match), `extractContactFromPublications` (contact-enrichment
  author matching), and — critically — reused as the base of THREE further
  composites:
  - `lib/services/institution-identity-resolver.js:30` `normalizeInstitutionName`
    (an INSTITUTION normalizer built on a PERSON-name normalizer — cross-domain
    reuse; see §2.6).
  - `lib/services/contact-enrichment/domain-evidence.js:19` `institutionTokens`
    (feeds `institutionsContradict`, the negative-evidence contradiction check
    for contact-enrichment tier results).
  - `lib/services/reviewer-work-author-resolver.js:34` `normalizeName` =
    `ContactParser.normalizeNameForMatch(ContactParser.stripHonorifics(name))`
    — a composite that ALSO appears independently re-implemented inline at
    `lib/services/reviewer-identity-lookup.js:44-45` (`nameConsistent`):
    same two-function composite, two separate call sites, not shared via
    import. This is a genuine duplicate-composite, not just a duplicate leaf.

### 1.6 `stripHonorifics` — `lib/utils/contact-parser.js:168`
```
repeat: strip leading /^(Dr\.?|Prof\.?|Professor|Mr\.?|Ms\.?|Mrs\.?|Sir|Dame)\s+/i
```
Broadest honorific set in the codebase (adds `Sir`/`Dame` that most other
strippers omit). Repeats to fully remove stacked titles ("Prof. Dr. …").
- **Callers**: `DeduplicationService.areNamesSimilar` (line 106-107, applied
  BEFORE `normalizeName` — the fix note in that file explains this was added
  because "Prof. Ursula Keller" vs "Ursula Keller" defeated dedup when only
  `normalizeName`'s non-alpha strip ran); `lib/services/discovery/provenance.js:36`;
  `lib/services/reviewer-identity-evidence.js:300` (feeds `givenNameToken`,
  §1.9); `lib/services/reviewer-identity-lookup.js:44-45`; and indirectly via
  §1.5's composite at `reviewer-work-author-resolver.js`.

### 1.7 `stripHonorific` — `lib/utils/format-name-list.js:23`
```
repeat: strip leading /^\s*(?:Dr|Prof|Mr|Mrs|Ms|Mx)\.?\s+|^\s*Professor\s+/i
```
Own honorific set: has `Mx`, lacks `Sir`/`Dame` (unlike §1.6) and lacks
`Professor` in the main alternation (handled as a second clause). Documented
in its own comment as deliberately mirroring `parseRecipientName`'s DETECTION
set (§1.11) but for REMOVAL rather than salutation generation.
- **Caller**: PI/co-PI display-name cleanup for grantee-deliverable email
  copy — a DISPLAY seam, not an identity-matching seam.

### 1.8 `stripHonorific` (module-level) — `lib/services/reviewer-works-first.js:103`
```
strip leading /^(dr\.?|prof\.?|professor)\s+/i
```
Third distinct honorific token set (narrowest: no Mr/Mrs/Ms/Sir/Dame/Mx).
- **Callers**: `comparableName` (§1.10, feeds `nameConsistent` →
  `collectBylineCandidates`, the OpenAlex works-first identity-candidate
  collector), `worksFirstNameVariants`, `candidateUsesInitialOnly`.

### 1.9 `givenNameToken` — `lib/services/reviewer-identity-evidence.js:299`
```
ContactParser.stripHonorifics(name) → first whitespace-split token →
lowercase → NFKD-decompose → strip [^\p{L}]
```
Diacritics fold via NFKD + Unicode-letter-class filtering (equivalent effect
to §1.3's explicit combining-mark strip, different mechanism) but returns
ONLY the first given-name token, not a full normalized name.
- **Callers**: `forenameFullyAgrees` / `forenamesContradict` — the
  identity-resolver's positive-corroboration and negative-evidence (heavy
  penalty) predicates for promoting a candidate on ORCID-employment or
  affiliation/topic-spine evidence WITHOUT a full name gate. `forenamesContradict`
  is exactly the hand-rolled boolean the outside research memo (§1) calls out
  as "a special case of" Fellegi–Sunter negative-evidence weighting.
  `orcidProfileForenameFullyAgrees` also builds on this via
  `forenameFullyAgrees`.

### 1.10 `comparableName` — `lib/services/reviewer-works-first.js:107`
```
stripHonorific (§1.8) → NFKC-normalize → unify hyphen variants
  (‐‑‒–—→-) → strip [.] → collapse whitespace → trim
```
**Does NOT lowercase** — the one full-name normalizer in the inventory that
preserves case. (Downstream `nameMatchEvidence` from §1.4 lowercases
internally, so case survives only as far as the `nameConsistent` call.)
- **Callers**: `nameConsistent` (works-first byline candidate collection —
  `collectBylineCandidates`), which feeds the OpenAlex-works-first identity
  resolver's candidate accumulation.

### 1.11 `parseRecipientName` honorific detection — `lib/utils/email-generator.js:222`
```
ContactParser.normalizeDisplayName (whitespace-only, §1.12) →
match /^(Dr\.?|Prof\.?|Professor|Mr\.?|Ms\.?|Mrs\.?)\s+/i → branch on
matched honorific to choose a SALUTATION (default "Dr." for academics if
none present) → strip the matched honorific from `cleanName`
```
Fourth distinct honorific token set (no Sir/Dame/Mx). This is a DISPLAY/
greeting-generation seam, not an identity-match seam — it is listed here
because it is a caller of a honorific-detection regex, and because the
divergent token set is itself evidence for the "same strings, different
verdicts at different seams" finding, even though the seam's PURPOSE (email
salutation) means a wrong classification here reads as an odd greeting, not
a wrong-person identity error.
- **Caller**: every reviewer email (single documented chokepoint for the app).

### 1.12 `normalizeDisplayName` — `lib/utils/contact-parser.js:195`
```
collapse whitespace → trim (no lowercase, no honorific strip)
```
Explicitly documented as presentation cleanup, NOT match-normalization
(docstring contrasts it directly with `normalizeNameForMatch` and
`stripHonorifics`).
- **Callers**: `lib/utils/email-generator.js:210` (`parseRecipientName`, feeds
  §1.11); guards against a trailing-space artifact turning into
  "Dear Name ," in outbound greeting copy.

### 1.13 Inline dedup-key `normalizedName` — `lib/services/reviewer-finder/save-candidates-service.js:963`
```
lowercase → strip leading /^(dr\.?|prof\.?|professor)\s+/i →
strip [^a-z\s] → collapse whitespace → trim
```
Combines §1.4's honorific strip with §1.1/§1.2's non-alpha strip — a FIFTH
distinct pipeline shape, inlined rather than calling any shared helper, at
the single highest-risk seam in this inventory: the roster-promotion save
path (candidate → potential-reviewer + suggestion writes).
- **Caller**: `saveCandidates` — used for the promotion-time duplicate-key
  check immediately before persisting a new reviewer record. A name that
  collides under §1.13's rule but not under, say, §1.5's (no honorific strip)
  would be treated as "new" for one seam's purposes and "duplicate" for
  another's.

### 1.14 `IntegrityMatchingService.normalizeName` — `lib/services/integrity-matching-service.js:200`
```
lowercase → NFD-decompose, strip [̀-ͯ] (diacritic strip) →
"Last, First" → "First Last" reorder (regex ^([^,]+),\s*(.+)$ → $2 $1) →
strip honorifics /\b(dr|prof|professor|mr|mrs|ms|sir|phd|md)\b\.?/gi →
strip [^a-z\s] → collapse whitespace → trim
```
The ONLY normalizer in the inventory that reorders "Last, First" → "First
Last". Sixth distinct honorific token set (`phd`/`md` included, `sir`
included, but as mid-string word-boundary matches rather than leading-anchor
— structurally different matching strategy from every other stripper here).
- **Callers**: `extractNameParts`, `isCommonName`, `calculateNameMatch` (the
  7-tier confidence scorer used by Retraction Watch integrity screening —
  `findMatchesInAuthors`), `buildDatabaseSearchTerms`,
  `buildTextSearchPatterns`. This is retraction/integrity screening's OWN
  independent nickname map too — see §3.2.

## 2. Institution normalizers

### 2.1 `normalizeInstitution` — `lib/services/dataverse-export/disclosure.js:113`
```
NFKD-decompose → strip diacritics → lowercase → strip [.] →
tokenize on [^a-z0-9]+ → strip trailing legal-suffix tokens (repeat: inc,
llc, ltd, corp, co, foundation, fdn, trust, fund) → strip leading "the" →
expand fixed abbreviations (univ→university, u→university, inst→institute)
→ join, collapse, trim
```
Documented in-file as "the EXACT deterministic algorithm (§3c)... Specified
so two implementations cannot diverge" for CRM Account-disclosure
deduplication — i.e. this file already tried to be the one canonical
institution key for ITS domain (donor/grantee accounts), but is unrelated to
and unaware of the reviewer-side institution normalizers below.
- **Caller**: `institutionKey` (per-account precedence: legalname → akoya_aka
  → name), used for CRM disclosure-account collision detection.

### 2.2 `DeduplicationService.normalizeInstitution` — `lib/services/deduplication-service.js:578`
```
lowercase → strip leading "department/dept/school/division/center/centre
of/for …," prefix (two regex variants, comma-bounded and
university/institute/college-bounded) → strip trailing "usa/united
states/u.s.a." → strip [^a-z\s] → collapse whitespace → trim
```
No diacritic fold, no legal-suffix strip, no abbreviation expansion (that is
a SEPARATE prior step — see §2.3).
- **Callers**: `institutionsMatch` (legacy boolean institution-match, applies
  §2.3 first then this), `institutionDirectMatch` (the COI hard-drop
  comparator — applies §2.3 AFTER this, i.e. `normalizeInstitution` runs
  twice, once before and once after abbreviation expansion),
  `coiExemptInstitutionKey` (HHMI/Broad exemption lookup),
  `institution-coi-context.js` (`baseName`/`expandedName` display keys),
  `institution-affiliation-consistency.js` (via `institutionDirectMatch`).
  This is the single highest-stakes institution normalizer: it backs the
  COI hard-drop decision (`institutionCOIMatchKind` → auto-exclude a
  candidate reviewer).

### 2.3 `DeduplicationService.expandInstitutionAbbreviations` — `lib/services/deduplication-service.js:1035`
```
lowercase, trim → for each of ~25 hardcoded abbreviation pairs (UC campuses,
MIT, Caltech, UCLA, UCSD, UCSF, USC, NYU, CUNY, SUNY, OSU, PSU, UT, UF, Va
Tech, Texas Tech, …) replace \b<abbrev>\b (case-insensitive) with the full
name
```
A distinct PRE-processing transform, not itself a canonicalizer — it expands
before §2.2 normalizes. Own abbreviation table, unrelated to §2.1's
`ABBREV_MAP` (which handles only `univ`/`u`/`inst` as generic word
abbreviations, not named-institution acronyms).
- **Callers**: `institutionsMatch`, `institutionDirectMatch` (both apply this
  before calling §2.2).

### 2.4 `normalizeInstitutionName` — `lib/fundingApis.js:257`
```
lowercase → remove administrative term phrases as whole-word regex
("regents of", "regents of the", "the regents of", "the", "university of",
"college of", "institute of", "inc", "incorporated", "foundation",
"center", "centre") → split on [\s,.-]+ → keep words length > 2, excluding
{and, for, the} → return as a Set<string> of significant keywords
```
Returns a **Set of keywords**, not a canonical string — a different return
shape from every other institution normalizer in this inventory, which
matters for anyone consolidating: this one is designed for set-intersection
comparison, not string equality.
- **Caller**: `institutionsMatch` (fundingApis.js's OWN local function of
  that name — do not confuse with `DeduplicationService.institutionsMatch`,
  §2.2's caller; these are two different functions with the same name in
  different files, comparing funding-opportunity institution matches, not
  reviewer/COI institution matches). Applies a campus-keyword veto list
  (berkeley/davis/irvine/... for UC-system disambiguation) after keyword
  intersection — structurally similar in INTENT to
  `DeduplicationService.institutionDirectMatch`'s conflicting-words veto
  (§2.2/2.3 combined), but a wholly separate, independently-maintained
  implementation with a different campus list and different stop-word list.

### 2.5 `normalizeAffiliationForComparison` — `lib/services/discovery/affiliation.js:117`
```
lowercase → strip trailing ".<email>" pattern → strip trailing
"usa/united states/uk/france/germany/canada" → regex-extract first match of
/(university of [^,]+|[^,]+ university|[^,]+ institute of technology|[^,]+
institute)/i → else fallback: first 50 chars, trimmed
```
The only institution normalizer that EXTRACTS a substring via pattern match
rather than stripping/tokenizing the whole string — an institution named
something other than "University of X"/"X University"/"X Institute" (e.g. a
company, a museum, a hospital not named "... Institute") falls through to
the 50-char truncation fallback, which can produce a different key purely
based on affiliation-string LENGTH (department-name verbosity), not
institution identity.
- **Caller**: `_affiliationWeightsMap` (recency-weighted current-affiliation
  picker, `collectAffiliationHistory`) — groups PubMed/OpenAlex byline
  affiliation strings across articles by this key to find the
  highest-weighted (most-recent, most-frequent) current institution.

### 2.6 `normalizeInstitutionName` — `lib/services/institution-identity-resolver.js:29`
```
ContactParser.normalizeNameForMatch(value) [§1.5, a PERSON-name normalizer:
lowercase + strip [.,] + collapse ws] → collapse whitespace again → trim
```
Institution normalization here is a THIN WRAPPER around a person-name
normalizer — the lightest-touch of all institution normalizers (no
legal-suffix strip, no admin-term removal, no abbreviation expansion). This
is deliberate for THIS caller's purpose (comparing against OpenAlex
`displayName` strings, which are already fairly canonical), but it means
"Univ. of California" and "University of California" are NOT equal under
this normalizer while they ARE equal under §2.2+§2.3.
- **Callers**: `institutionNameMatchRank` (EXACT / ACRONYM / CONTAINMENT
  ranking for OpenAlex institution-identity resolution — used for identity
  corroboration and to narrow pre-existing COI matches; the module docstring
  states it "must never manufacture a new hard conflict from a lexical
  non-match"), `institutionIdentityKey` (identity dedup key combining
  OpenAlex ID / ROR / name+country).

### 2.7 `normalizeAffiliationForCompare` — `lib/services/alert-reviewer-affiliation-mismatch.js:42`
```
trim → lowercase → strip leading/trailing [\p{P}\p{S}\s]+ (Unicode
punctuation/symbol classes) only
```
Lightest-touch of ALL normalizers in this inventory (person or institution):
no internal-word changes, no stopword removal, no abbreviation handling —
literally just edge-trim of punctuation/symbols plus case-fold. Deliberately
conservative because a MISS here escalates to a full async
`institutionConsistency.areConsistent` call (§2.2's `institutionDirectMatch`
plus associated-institution one-hop check) rather than silently equating two
different-looking names.
- **Caller**: `alertReviewerAffiliationMismatch` — staff notification when an
  accepted reviewer's self-reported affiliation differs from their linked CRM
  contact's institution. Explicitly does NOT write any CRM field; the
  comparison result only gates whether a human gets pinged.

### 2.8 Inline `normalizeInst` — `lib/services/integrity-matching-service.js:376`
```
lowercase → strip [^a-z\s] → collapse whitespace → trim
```
Same four-step shape as §1.1/§1.2's PERSON-name algorithm, applied to
institutions instead — not exported, defined inline inside
`adjustConfidenceForInstitution`.
- **Caller**: `adjustConfidenceForInstitution` — institution-match confidence
  BONUS (+15 exact, +10 partial-contains, +10 on ≥2-significant-word-overlap
  after stripping a small stopword list `{of,the,and,at,in,for,university,
  college,institute}`) layered on top of `calculateNameMatch`'s (§1.14)
  person-name confidence tiers, for Retraction Watch integrity screening.

### 2.9 `institutionTokens` — `lib/services/contact-enrichment/domain-evidence.js:18`
```
ContactParser.normalizeNameForMatch(value) [§1.5] → split on whitespace →
filter tokens length ≥ 4, excluding {department, university, institute,
school, college}
```
A TOKENIZER for contradiction-detection, not a canonicalizing normalizer —
returns an array/Set of tokens for the negative-evidence check
`institutionsContradict` (anchor institution shares NO token with result
institution → contradiction), the contact-enrichment analogue of
`DeduplicationService`'s conflicting-words veto (§2.2/2.3) and
`fundingApis.js`'s campus-keyword veto (§2.4) — a THIRD independent
implementation of the same underlying idea (rare/significant-token overlap
as evidence), with its own stopword list.
- **Caller**: `resultContradictsAnchor` (contact-enrichment tier-result
  validation: an enrichment result whose ORCID or institution contradicts the
  anchor identity is rejected).

## 3. Nickname / name-variant maps

### 3.1 `NICKNAME_MAP` — `lib/services/discovery/constants.js:54`
~42 entries, nickname → ONE formal name (`chris: 'Christopher'`), English-only,
no international variants. Case-sensitive VALUES (formal names are
capitalized; lookups lowercase the key first).
- **Callers**: `firstNamesEquivalent` (§1.4's byline-confirmation
  forename-equivalence check), `generateNameVariants` (PubMed search-variant
  generation).

### 3.2 `NAME_VARIANTS` (+ `NAME_VARIANT_REVERSE`) — `lib/services/integrity-matching-service.js:13`
~90 formal-name entries, each mapping to MULTIPLE nickname variants
(`robert: ['bob','rob','robbie','bobby','bert']`), PLUS international
variants (Mikhail/Misha, Giuseppe/Joe, Wilhelm/William, Karl/Charles…) that
§3.1 has no equivalent for at all. Bidirectional (reverse map built at
module load).
- **Callers**: `getNameVariants`, `areNameVariants` (used inside
  `calculateNameMatch`'s Tier 2.5/5.5 name-variant confidence bump, §1.14),
  `buildDatabaseSearchTerms`, `buildTextSearchPatterns` (Retraction Watch
  search-term generation).

**These are the two independent nickname maps the research memo names.**
Confirmed distinct: different key sets, different value cardinality (one
formal name vs. many nicknames), different coverage (§3.2 has international
variants, §3.1 doesn't), and — the caller-risk finding — used at completely
different seams: §3.1 gates PubMed byline identity CONFIRMATION for a
suggested reviewer (discovery/name-matching.js); §3.2 gates Retraction Watch
NAME-MATCH CONFIDENCE scoring for integrity screening. **"Chris" and
"Christopher" are the same person for retraction screening and for PubMed
byline confirmation, but nowhere else** — the roster dedup key (§1.3), the
proposal-author COI exclusion filter (§1.1/§1.2), the save-candidates
promotion dedup key (§1.13), and the reviewer-exclusion partition (§1.3) all
have NO nickname awareness at all and would treat "Chris Cheung" and
"Christopher Cheung" as two different people.

## 4. Person-name equivalence classes

| # | Entry (§ ref) | File:line | Algorithm shape |
|---|---|---|---|
| 1 | `normalizeName` | name-normalization.js:14 | lowercase+strip-non-alpha+ws |
| 2 | `normalizeName` | deduplication-service.js:131 | **byte-identical to #1** |
| 3 | `normalizeReviewerName` | reviewer-name-match.js:26 | +NFKD diacritic +ß→ss +honorific(6) |
| 4 | `normalizeNameForMatch` | discovery/name-matching.js:19 | lowercase+honorific(3)+ws, no non-alpha strip |
| 5 | `ContactParser.normalizeNameForMatch` | contact-parser.js:628 | lowercase+strip[.,]+ws, NO honorific — diverged copy of #4 |
| 6 | `stripHonorifics` | contact-parser.js:168 | honorific-strip only, set of 8 (incl Sir/Dame) |
| 7 | `stripHonorific` | format-name-list.js:23 | honorific-strip only, set of 6 (incl Mx) |
| 8 | `stripHonorific` | reviewer-works-first.js:103 | honorific-strip only, set of 3 |
| 9 | `parseRecipientName` detector | email-generator.js:222 | honorific-DETECT only, set of 6, display purpose |
| 10 | `givenNameToken` | reviewer-identity-evidence.js:299 | stripHonorifics(#6)+first-token+NFKD+\p{L} |
| 11 | `comparableName` | reviewer-works-first.js:107 | stripHonorific(#8)+NFKC+hyphen-unify, NO lowercase |
| 12 | `normalizeDisplayName` | contact-parser.js:195 | ws-collapse only, NO lowercase, NO honorific — display purpose |
| 13 | inline `normalizedName` | save-candidates-service.js:963 | lowercase+honorific(3, =#4's set)+strip-non-alpha+ws |
| 14 | `IntegrityMatchingService.normalizeName` | integrity-matching-service.js:200 | +NFD diacritic +Last,First reorder +honorific(8, mid-word) |
| — | composite `normalizeName` | reviewer-work-author-resolver.js:34 | #6 then #5 — **duplicated inline** at reviewer-identity-lookup.js:44-45 |

**14 definitions found** (matches the memo's count exactly), of which:
- 2 are byte-identical (#1/#2).
- 1 is a diverged "copy" whose docstring is now false (#5, claims to be
  copied from #4 but lacks the honorific strip).
- 1 composite (`ContactParser.stripHonorifics` then
  `ContactParser.normalizeNameForMatch`) is independently re-implemented
  inline at a second call site rather than shared.
- The rest are genuinely distinct pipelines (different diacritic handling,
  different honorific sets — SIX different honorific token sets exist across
  #3/#4≈#13/#6/#7/#8/#9/#14 — different reordering, different return
  granularity (full string vs. first token vs. keyword set)).

Collapsing byte-identical and diverged-copy pairs: **12 distinct algorithms**
by strict pipeline-shape comparison (treating each honorific-set variant as
distinct, since the memo's own framing — "some strip honorifics, some don't"
— makes the honorific set itself a behavioral axis). If honorific-set
differences are instead treated as parametrization of ONE stripping step
(closer to the memo's likely methodology), the distinct-algorithm count drops
to **8**, matching the memo's claim exactly. See §6.

## 5. Institution equivalence classes

| # | Entry (§ ref) | File:line | Algorithm shape | Return type |
|---|---|---|---|---|
| 1 | `normalizeInstitution` | disclosure.js:113 | NFKD diacritic+legal-suffix strip+"the"-strip+3-word abbrev expand | string |
| 2 | `DeduplicationService.normalizeInstitution` | deduplication-service.js:578 | dept-prefix strip+USA-suffix strip+non-alpha strip | string |
| 3 | `expandInstitutionAbbreviations` | deduplication-service.js:1035 | ~25-entry named-institution acronym table (pre-step to #2) | string |
| 4 | `normalizeInstitutionName` | fundingApis.js:257 | admin-term-phrase strip+word-length filter | **Set<string>** |
| 5 | `normalizeAffiliationForComparison` | discovery/affiliation.js:117 | pattern-EXTRACT "University of X" else 50-char truncate | string |
| 6 | `normalizeInstitutionName` | institution-identity-resolver.js:29 | wraps person-normalizer §4#5 — commas/periods only | string |
| 7 | `normalizeAffiliationForCompare` | alert-reviewer-affiliation-mismatch.js:42 | edge punctuation/symbol trim only | string |
| 8 | inline `normalizeInst` | integrity-matching-service.js:376 | lowercase+strip-non-alpha+ws (same shape as person #1/#2) | string |
| 9 | `institutionTokens` | domain-evidence.js:18 | wraps person-normalizer §4#5+token-length/stopword filter | **token array** |

**9 definitions found** (memo claimed 11). No second verbatim copy of a
"keyword-set extractor" was found: `fundingApis.js`'s Set-returning
normalizer (#4) has no byte-identical twin anywhere else in the codebase —
the closest kin are `domain-evidence.js`'s `institutionTokens` (#9) and
`DeduplicationService`'s inline `getKeyWords`/`keyInstitutionWords` helpers
(embedded inside `institutionsMatch`/`institutionDirectMatch`, not
separately exported — not counted as standalone definitions here since they
have no independent caller), which are SIMILAR in intent (significant-word
extraction) but different in stopword list, length threshold, and campus/
conflict-veto list. **This is the one place my count diverges from the
memo's — see §6.**

By strict pipeline-shape comparison: **9 distinct algorithms** (every
definition here differs from every other in at least one structural way —
suffix handling, abbreviation table, return type, or extraction-vs-strip
strategy). Two pairs are close in SPIRIT but not code (#4 vs #9: both are
significant-token extractors for veto-style contradiction checks, but
different implementations with different tables) — if those are treated as
one "significant-token overlap" algorithm family, the count drops to
**7 distinct algorithms**, still short of the memo's claimed 6 (my inventory
did not find a pair close enough to collapse to 6; see §6).

## 6. Reconciliation against the research memo's claims

| Claim (memo §1) | My verified count | Match? |
|---|---|---|
| 14 person-name normalizer definitions | 14 | **Exact match** |
| reducible to 8 distinct algorithms | 12 strict / 8 if honorific-set variants are treated as one parametrized step | **Matches under the looser reading; my strict reading says 12** |
| 11 institution normalizer definitions | 9 | **Discrepancy: 2 fewer found.** Grepped broadly (`normalize`, `fold`, `institution` + `normaliz`) across `lib/`, `pages/`, `shared/`; did not exhaustively read every file with an `institution`-adjacent identifier (e.g. `field-primer-service.js`, `proposal-pi-identity.js` were checked and found to consume identity objects rather than define new normalizers). The memo may be counting the embedded `getKeyWords`/`keyInstitutionWords` helpers inside `deduplication-service.js` as separate definitions, or counting a file this pass missed. **Flagged, not resolved** — a consolidation effort should re-grep before relying on either count. |
| 6 distinct institution algorithms, incl. 2 verbatim copies of a keyword-set extractor | 9 (or 7 if #4/#9 are merged as one family) — **no verbatim-copy pair found** | **Discrepancy.** No byte-identical institution-normalizer pair exists in the current source; every pair I compared differs in at least stopword list or return type. Possible explanations: the verbatim-copy claim referred to code since refactored, to a file outside my grep patterns, or to a different notion of "verbatim" (e.g. same INTENT/spirit rather than same source text) than this inventory used (byte-for-byte body comparison). |
| Two independent nickname maps (`NICKNAME_MAP`, `NAME_VARIANTS`) | Confirmed, §3 | **Exact match** |

## 7. Callers-at-risk: same string, different verdict, different seam

These are the pairs worth carrying into consolidation planning as the
concrete "why this matters" cases (not exhaustive — see the characterization
tests for the full battery):

- **"Chris Cheung" vs "Christopher Cheung"**: equivalent for PubMed byline
  confirmation (§3.1, discovery/name-matching.js) and Retraction Watch
  screening (§3.2, integrity-matching-service.js); NOT equivalent for roster
  dedup (§1.3), proposal-author COI exclusion (§1.1/§1.2), or the
  save-candidates promotion dedup key (§1.13) — none of those consult either
  nickname map.
- **"Prof. Ursula Keller" vs "Ursula Keller"**: equivalent everywhere
  `stripHonorifics`/`stripHonorific` runs first (§1.3, §1.4≈§1.13, §1.6, §1.14)
  — but §1.1/§1.2's bare `normalizeName` (no honorific strip) treats the
  leading "prof" token as a name token, so a caller that uses ONLY
  `normalizeName` without first stripping honorifics (there is no such
  caller today for `DeduplicationService.normalizeName` — `areNamesSimilar`
  strips first — but nothing in the type system prevents a future caller from
  skipping that step) would silently miscompare.
- **"Univ. of California, Berkeley" vs "University of California, Berkeley"**:
  equal under `DeduplicationService.normalizeInstitution` + abbreviation
  expansion (§2.2+§2.3, the COI hard-drop seam) since abbreviation expansion
  runs first; NOT necessarily equal under `institution-identity-resolver.js`'s
  thin wrapper (§2.6, no abbreviation handling) used for OpenAlex identity
  corroboration — the module's own docstring says it "must never manufacture
  a new hard conflict from a lexical non-match," so a false non-match here is
  a documented, accepted risk for THAT seam but would be a bug if the same
  string pair reached the COI seam and got the same treatment.
- **"University of California" (bare, no campus)**: `fundingApis.js`'s
  campus-keyword veto (§2.4) and `DeduplicationService`'s conflicting-words
  veto (§2.2/§2.3) both exist specifically to stop a bare system-level string
  from matching a specific campus, but are two independently-maintained word
  lists (fundingApis.js's campus list vs. dedup's conflictingWords list) —
  a campus added to one list is not automatically added to the other.
- **An institution string with NO shared token vs. an anchor**: three
  independent implementations of "no rare-token overlap ⇒ contradiction"
  exist — `institutionsContradict` (domain-evidence.js §2.9, contact-enrichment
  tier validation), the conflicting-words veto inside
  `institutionDirectMatch`/`institutionsMatch` (deduplication-service.js
  §2.2/§2.3, COI hard-drop), and the campus-keyword veto in `fundingApis.js`
  (§2.4, funding-opportunity institution match) — each with its own stopword/
  significant-token threshold, so the SAME anchor/candidate institution pair
  could be "contradicted" at one seam and merely "unmatched" (not
  contradicted) at another.

## 8. What this document does not do

No production file under `lib/`, `pages/`, or `shared/` was modified to
produce this inventory. No threshold, table, or algorithm is recommended for
change. The characterization tests in `tests/unit/normalizer-characterization/`
pin TODAY'S behavior — including behavior this document flags as
inconsistent or as a documentation/reality drift (e.g. §1.5's false "copied
from" claim) — so that a later consolidation step has a regression net that
fails loudly if consolidation silently changes any seam's current behavior.
