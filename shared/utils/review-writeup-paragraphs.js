/**
 * review-writeup-paragraphs — Reviews-tab writeup sentences: deterministic
 * (Slice 1) plus model-authored themes/quotations verified at the read
 * boundary (Slice 2)
 * (docs/plans/REVIEWS_TAB_WRITEUP_PARAGRAPHS_PLAN_2026-09-14.md §4.2-4.3,
 * W1-W3, W5, W7, W8).
 *
 * NO DOM, NO React, NO Dataverse/network imports — same purity contract as
 * `shared/utils/review-report.js`. Consumed by the Reviews tab card, by the
 * Word export (`shared/utils/review-report.js`'s `writeupSection`, Slice 3),
 * and, later, the Pre-Site Visit `[[STAFF:RefereeSection]]` fill (Slice 4).
 *
 * Input filter: every composer here takes only reviewers with
 * `reviewReceivedAt` set — the same filter `digestReviewers` applies in
 * `reviewers-service.js` (:~450). `composeWriteupParagraphs` additionally
 * needs `reviewer.answers[].answerText` (already on the Slice 1 projection)
 * to verify quotation provenance — a caller passing the full submitted-
 * reviewer projection from `getReviewers` unchanged satisfies both.
 *
 * Ordering: descending `reviewerOverallAssessment` (nulls/unlabelled last).
 * The DETERMINISTIC sentences (`composeReviewerSentence`,
 * `composeExpertiseSentence`, via `orderByRatingDescending`) break ties by
 * the order the CALLER passed reviewers in (the tab name-sorts `submitted`
 * before calling in) — this part of the module never re-sorts by name.
 * QUOTATION selection (`verifyAndSelectQuotations`) is different: its W8 tie-
 * break uses the exported `compareReviewersByName` on a CANONICAL re-sort,
 * independent of caller order, so two callers passing the same reviewers in
 * different orders (the tab's name-sorted roster; an export roster in
 * Dataverse fetch order) select identical quotations (Opus Slice 2 review
 * follow-up).
 *
 * Unlabelled ratings (a legacy row with no in-domain overall rating — see
 * plan §3 "Ratings required at submit"): the reviewer still appears in the
 * reviewer/expertise sentences (identity is independent of rating), is
 * EXCLUDED from the score tally, and is reported by name in `warnings` so
 * the tab can show "N review(s) could not be scored" without silently
 * dropping the reviewer from the roster.
 *
 * Runs: `composeReviewerSentence` returns `[{text, underline}]` arrays so a
 * renderer (React, DOCX `TextRun`, or a Word-fill token) underlines the name
 * without ever having to parse or trust an HTML string. Reviewer names are
 * NEVER put in the plain "text" alongside markup — the underline flag is the
 * only formatting signal.
 */

import { labelForReviewRating } from '../../lib/external/review-form-schema';

const NUMBER_WORDS = [
  null, 'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
];

function numberWord(n) {
  if (n >= 1 && n <= 12) return NUMBER_WORDS[n];
  return String(n);
}

function joinWithOxfordComma(items) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function isVowelLetter(ch) {
  return /^[aeiou]/i.test(ch || '');
}

// Vowel-LETTER but consonant-SOUND ranks (Opus Slice 1 follow-up): "University
// Professor" and "University Distinguished Professor" are pronounced with a
// leading /j/ ("yoo-"), so they take "a", not "an", despite starting with "U".
const CONSONANT_SOUND_VOWEL_RANKS = [/^university\b/i];

function articleFor(phrase) {
  if (CONSONANT_SOUND_VOWEL_RANKS.some((re) => re.test(phrase || ''))) return 'a';
  return isVowelLetter(phrase) ? 'an' : 'a';
}

/**
 * Lifted byte-identical from `shared/components/workbench/ReviewsTab.js`
 * (Reviews Tab Phase II Slice 1). Strips a legacy accepted-reviewer free-text
 * affiliation's trailing echoed email (occasionally as
 * "Electronic address: …"), leaving all other affiliation text untouched.
 *
 * @param {{reviewerAffiliation?: string, affiliation?: string, email?: string}} reviewer
 * @returns {string|null}
 */
export function reviewerAffiliationOf(reviewer) {
  const acceptedAffiliation = typeof reviewer?.reviewerAffiliation === 'string'
    ? reviewer.reviewerAffiliation.trim()
    : '';
  const personAffiliation = typeof reviewer?.affiliation === 'string'
    ? reviewer.affiliation.trim()
    : '';
  const affiliation = acceptedAffiliation || personAffiliation;
  const email = typeof reviewer?.email === 'string' ? reviewer.email.trim() : '';
  if (!affiliation || !email) return affiliation || null;

  const emailIndex = affiliation.toLowerCase().lastIndexOf(email.toLowerCase());
  if (emailIndex < 0) return affiliation;
  const suffix = affiliation.slice(emailIndex + email.length);
  if (suffix.replace(/[\s,.;:]/g, '') !== '') return affiliation;
  return affiliation
    .slice(0, emailIndex)
    .replace(/electronic\s+address\s*:?\s*$/i, '')
    .replace(/[\s,.;:]+$/g, '')
    .trim() || null;
}

// --- Institution-name extraction from a free-text affiliation/byline -------
//
// The accept form's "Title & Organization" field is pre-filled from the CRM
// affiliation, which for a reviewer enriched from PubMed is the raw
// publication byline ("Division of X, Department of Y, Lund University,
// SE-22362, Lund, Sweden. Electronic address: …"). A reviewer who leaves it
// untouched sends the whole byline into the Reviews paragraph. These helpers
// reduce such text to the institution name(s) for DISPLAY only; the stored
// value and `reviewerAffiliationOf` (which fingerprints and tab cards depend
// on) are untouched. A self-confirmed `mainInstitution` also passes through
// here (request 1002852, 2026-09-21): the accept form's required "Main
// institution" field used to be pre-filled from that same raw byline, and a
// reviewer who left it unchanged carried the byline into the stored,
// confirmed value. `context-service.js` now seeds the pre-fill with the
// reduced name instead, but the composer-side reduction still matters for
// values stored before that fix (1002852 itself) and for any staff edit
// (`CandidateEditModal`) that pastes a byline back in.

// Segments that are sub-units of an institution, never the institution.
// Unicode-aware (`u` flag, explicit lookaround boundaries in place of ASCII-
// only `\b`) so an accented lead ("Département de …") still matches (Codex
// adversarial review, 2026-09-21).
const SUBUNIT_SEGMENT = /^(?:dept\.?|department|division|section|unit|group|program(?:me)?|lab(?:oratory)?\s+(?:of|for)|faculty\s+of|graduate\s+school\s+of|school\s+of(?!\s+medicine(?![\p{L}\p{N}]))|college\s+of|centre?\s+(?:for|of)|institute\s+(?:for|of)|chair\s+of|centre\s+de\s+recherche|centro\s+de|departamento\s+de|département\s+de|laboratoire\s+de|institut\s+de|instituto\s+de|institut\s+für|abteilung)(?![\p{L}\p{N}])/iu;
// A university-tier organization: preferred over any other segment.
const UNIVERSITY_TERM = /(?<![\p{L}\p{N}])(?:university|universität|universitaet|université|universite|università|universita|universidad|universidade|universiteit|universitet|universitetet|univerzita|uniwersytet|polytechnic|politecnico|polytechnique|hochschule|college|ETH|MIT|Caltech)(?![\p{L}\p{N}])/iu;
// Any other organization-shaped segment (second preference).
const ORGANIZATION_TERM = /(?<![\p{L}\p{N}])(?:institut(?:e|o|ion)?|istituto|hospital|hôpital|hopital|ospedale|clinic|klinik|klinikum|medical\s+(?:center|centre|school)|school\s+of\s+medicine|centre\s+hospitalier|CHU|laborator(?:y|ies)|foundation|academy|center|centre|research\s+council|CNRS|INSERM|CEA|Max\s+Planck|Howard\s+Hughes|Helmholtz|Fraunhofer|Karolinska|Pasteur|Weizmann|Riken|CSIC)(?![\p{L}\p{N}])/iu;
// Institution-tier whitelist within ORGANIZATION_TERM (Fix 2, Codex
// adversarial review 2026-09-21): a comma co-affiliation is only pooled
// alongside a university when it names a whole institution, not any
// organization-shaped sub-unit ("Center for Translational Cancer Research"
// stays a sub-unit-shaped fallback only — bare "center"/"centre" is excluded
// here even though it is in the broader ORGANIZATION_TERM above).
// Bare `medicine` and `laboratory` were removed from this whitelist (Fix A,
// Codex round 5 finding, 2026-09-21): a bare word match promoted structurally
// unrelated segments like "Laboratory Medicine" and "Sports Medicine" to
// institution tier just because they contained the word. Whole-institution
// names built on those words ("Weill Cornell Medicine", "Cold Spring Harbor
// Laboratory", "MRC Laboratory of Molecular Biology") are now recognized
// structurally by NAMED_MEDICINE_TAIL / NAMED_LABORATORY_TAIL /
// ACRONYM_LABORATORY_LEAD below,
// which require a proper-noun lead rather than matching the bare word
// anywhere in the segment. `national\s+laboratory` and `laboratories` stay
// here since they are unambiguous even without a proper-noun lead.
const INSTITUTION_TIER_ORG_TERM = /(?<![\p{L}\p{N}])(?:hospital|clinic|klinik|medical\s+(?:center|centre)|medical\s+school|school\s+of\s+medicine|cancer\s+(?:center|centre)|national\s+laboratory|laboratories|foundation|CNRS|INSERM|Max\s+Planck|Howard\s+Hughes|Riken|CSIC)(?![\p{L}\p{N}])/iu;
// Structural whole-institution names ending in "Medicine" or "Laboratory"
// (Fix A, Codex round 5, 2026-09-21; made specialty/generic-aware, owner
// decision 2026-09-21, Codex round 6). The segment must END with the tail
// word and have proper-noun-shaped (uppercase-initial) words directly before
// it, AND the word immediately before the tail must not itself be a generic
// descriptor — a clinical specialty before "Medicine" ("Harvard Internal
// Medicine", "Pediatric Emergency Medicine", "Regenerative Medicine") or a
// generic qualifier before "Laboratory" ("Research Laboratory", "Clinical
// Laboratory") names a department/service, not a whole institution. Written
// WITHOUT the `i` flag for the leading words so the uppercase-initial
// requirement is not defeated; the tail and the preceding-word check are
// matched case-insensitively via explicit alternations instead.
const NAMED_MEDICINE_TAIL_SHAPE = /^(?:\p{Lu}[\p{L}\p{N}.&'’-]*\s+){2,}(?:Medicine|medicine)$/u;
const MEDICINE_SPECIALTY_WORD = /^(?:internal|emergency|family|sports|laboratory|nuclear|veterinary|regenerative|translational|preventive|preventative|occupational|molecular|precision|genomic|personalized|personalised|pediatric|paediatric|sleep|pain|palliative|geriatric|tropical|community|rural|social|behavioral|behavioural|integrative|complementary|alternative|physical|rehabilitation|pulmonary|respiratory|cardiovascular|hospital|academic|experimental|systems|computational|biomedical|clinical|general|oral|dental|maternal|fetal|reproductive|sexual|addiction|forensic|aerospace|military|wilderness|travel|transfusion|critical)$/iu;
// "Weill Cornell Medicine" ✓ (preceding word "Cornell" is not a specialty);
// "Harvard Internal Medicine" ✗, "Pediatric Emergency Medicine" ✗, "Sports
// Medicine" ✗ (one preceding word, shape doesn't match), "Laboratory
// Medicine" ✗ (one preceding word), "Regenerative Medicine" ✗ (one preceding
// word).
function isNamedMedicineTail(trimmed) {
  if (!NAMED_MEDICINE_TAIL_SHAPE.test(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  const precedingWord = words[words.length - 2];
  return !MEDICINE_SPECIALTY_WORD.test(precedingWord);
}
const NAMED_LABORATORY_TAIL_SHAPE = /^(?:\p{Lu}[\p{L}\p{N}.&'’-]*\s+){1,}(?:Laboratory|laboratory)$/u;
const LABORATORY_GENERIC_WORD = /^(?:research|clinical|core|central|teaching|analytical|diagnostic|testing|reference|regional|state|public|health|national|university|hospital|department|medical|molecular|cell|tissue|imaging|computing|computer|dry|wet)$/iu;
// "Jackson Laboratory" ✓, "Cold Spring Harbor Laboratory" ✓; "Research
// Laboratory" ✗, "Clinical Laboratory" ✗. "Lawrence Berkeley National
// Laboratory" is excluded here (preceding word "National" is generic) but
// still reaches institution tier via `national\s+laboratory` in
// INSTITUTION_TIER_ORG_TERM above.
function isNamedLaboratoryTail(trimmed) {
  if (!NAMED_LABORATORY_TAIL_SHAPE.test(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  const precedingWord = words[words.length - 2];
  return !LABORATORY_GENERIC_WORD.test(precedingWord);
}
// An all-caps acronym (2+ letters) leading straight into "Laboratory" (Fix A):
// "MRC Laboratory of Molecular Biology" ✓, "LMB Laboratory" ✓.
const ACRONYM_LABORATORY_LEAD = /^[A-Z]{2,}\s+Laboratory(?![\p{L}\p{N}])/u;
// A whole institute, not a sub-institute lead ("Institute of X" inside a run
// that also has a university is a sub-institute — see SUBUNIT_SEGMENT).
const INSTITUTE_WORD = /(?<![\p{L}\p{N}])(?:institute|institut|instituto|istituto)(?![\p{L}\p{N}])/iu;
const INSTITUTE_SUBUNIT_LEAD = /^(?:institute\s+of|institute\s+for|institut\s+de|institut\s+für|instituto\s+de|istituto\s+di)(?![\p{L}\p{N}])/iu;

// Bare, proper-noun-free institution-tier labels (2026-09-21 tightening): a
// segment that is ONLY a generic descriptor ("Cancer Center") names no
// institution by itself — it is a sub-unit or department-shaped fragment
// left over after splitting, not the whole organization. The leading-word
// form ("Cancer Center of Excellence") is excluded too, but only for
// cancer/medical center — "Hospital for Sick Children" is a real, named
// institution and must not be caught by this rule.
const BARE_INSTITUTION_TIER_LABEL = /^(?:cancer\s+(?:center|centre)|medical\s+(?:center|centre|school)|hospital|clinic|institute|institut|laboratory|laboratories|medicine|foundation)$/iu;
const GENERIC_LEAD_WITH_OF = /^(?:cancer\s+(?:center|centre)|medical\s+(?:center|centre))\s+(?:of|for)(?![\p{L}\p{N}])/iu;

// Institution-tier part (Fix 2): a university-tier part, OR an
// organization-shaped part matching the narrower INSTITUTION_TIER_ORG_TERM
// whitelist, OR a whole institute that is not a sub-institute lead, OR a
// structurally named "…Medicine"/"…Laboratory" institution (Fix A,
// 2026-09-21). A bare generic label with no proper-noun content is never
// promoted (2026-09-21).
function isInstitutionTierPart(part) {
  const trimmed = part.trim();
  if (BARE_INSTITUTION_TIER_LABEL.test(trimmed) || GENERIC_LEAD_WITH_OF.test(trimmed)) return false;
  if (UNIVERSITY_TERM.test(part)) return true;
  if (INSTITUTION_TIER_ORG_TERM.test(part)) return true;
  if (INSTITUTE_WORD.test(part) && !INSTITUTE_SUBUNIT_LEAD.test(trimmed)) return true;
  if (isNamedMedicineTail(trimmed) || isNamedLaboratoryTail(trimmed) || ACRONYM_LABORATORY_LEAD.test(trimmed)) return true;
  return false;
}
// Geography that never names an institution on its own.
const US_STATE_CODE = /^(?:A[KLRZ]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])$/;
const GEOGRAPHIC_TOKEN = new Set([
  'usa', 'us', 'u.s.a.', 'u.s.', 'united states', 'united states of america', 'uk', 'u.k.', 'united kingdom',
  'england', 'scotland', 'wales', 'northern ireland', 'ireland', 'canada', 'australia', 'new zealand',
  'germany', 'deutschland', 'france', 'italy', 'italia', 'spain', 'españa', 'portugal', 'netherlands',
  'the netherlands', 'belgium', 'switzerland', 'austria', 'sweden', 'norway', 'denmark', 'finland', 'iceland',
  'poland', 'czech republic', 'czechia', 'hungary', 'greece', 'israel', 'japan', 'china', "people's republic of china",
  'pr china', 'p.r. china', 'south korea', 'republic of korea', 'korea', 'taiwan', 'singapore', 'india',
  'brazil', 'brasil', 'mexico', 'méxico', 'argentina', 'chile', 'south africa', 'russia', 'turkey', 'türkiye',
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida',
  'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine',
  'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska',
  'nevada', 'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio',
  'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas',
  'utah', 'vermont', 'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming', 'district of columbia',
  'ontario', 'quebec', 'québec', 'british columbia', 'alberta',
]);
// "University of <system>" names whose campus follows as its own comma segment
// ("University of California, San Francisco"). Only these re-attach the next
// segment; "University of Oxford, Oxford" must not become a two-part name.
const MULTI_CAMPUS_SYSTEM = /^university of (?:california|texas|illinois|colorado|massachusetts|maryland|minnesota|wisconsin|nebraska|tennessee|north carolina|alabama|hawaii|missouri|michigan|pittsburgh)$/i;

// A digit alone no longer marks a segment geographic (Fix 3, Codex
// adversarial review 2026-09-21): that dropped organization names that
// happen to contain a digit ("3M Corporate Research Laboratory", "Institut
// Curie U1234"). Only narrow postal/address shapes are geographic:
//  - a postal code standing alone, with an optional short country/region
//    letter prefix and an optional short suffix digit group ("SE-22362",
//    "02139", "77030", "D-69120", "12345-6789"), or a UK/Irish-style
//    outward+inward code ("CB2 1TN", "SW7 2AZ", "EC1A 1BB") — no trailing
//    word content is accepted ("U1234 Research Institute" is rejected)
//  - "City ST 12345" / "ST 12345" (last token is all digits AND the
//    preceding token is a US state code — 2026-09-21 tightening; "ETH 2"
//    is not geographic, it is an organization name)
//  - a street address ("77030 Main Street") — a leading street number
const POSTAL_CODE_SHAPE = /^(?:(?:[A-Z]{1,2}[- ]?)?\d{3,}(?:[- ]?\d{1,4})?|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})$/i;
const STREET_ADDRESS_SHAPE = /^\d+\s+\S/;

function isGeographicSegment(segment) {
  const lower = segment.toLowerCase().replace(/\.$/, '');
  if (GEOGRAPHIC_TOKEN.has(lower)) return true;
  if (US_STATE_CODE.test(segment)) return true;
  // "Houston TX", "Cambridge MA", "Lund, Sweden" already split; "City ST".
  const words = segment.split(/\s+/);
  const lastWord = words[words.length - 1];
  if (words.length >= 2 && US_STATE_CODE.test(lastWord)) return true;
  // "City ST 12345" / "ST 12345" — only when a US state code precedes the
  // trailing digit group (2026-09-21); a bare trailing digit on its own no
  // longer marks a segment geographic ("ETH 2").
  if (words.length >= 2 && /^\d+$/.test(lastWord) && US_STATE_CODE.test(words[words.length - 2])) return true;
  if (POSTAL_CODE_SHAPE.test(segment)) return true;
  if (STREET_ADDRESS_SHAPE.test(segment)) return true;
  return false;
}

function stripEchoedContact(text) {
  return String(text || '')
    .replace(/\b(?:electronic\s+address|e-?mail(?:\s+address)?)\s*:?\s*\S+@\S+/gi, '')
    .replace(/\S+@\S+/g, '')
    .replace(/\b(?:electronic\s+address|e-?mail(?:\s+address)?)\s*:?\s*$/i, '')
    .replace(/[\s,.;:]+$/g, '')
    .trim();
}

// "University of <system>" re-attachment (unchanged behavior, now applied to
// each institution-tier part individually — Fix 2).
function reattachMultiCampus(ranked, parts) {
  if (!MULTI_CAMPUS_SYSTEM.test(ranked)) return ranked;
  const next = parts[parts.indexOf(ranked) + 1];
  const lastWord = ranked.split(/\s+/).pop().toLowerCase();
  if (next && /^[A-Za-z][A-Za-z .'-]*$/.test(next) && !isGeographicSegment(next)
    && !SUBUNIT_SEGMENT.test(next) && !isInstitutionTierPart(next) && next.toLowerCase() !== lastWord) {
    return `${ranked}, ${next}`;
  }
  return ranked;
}

/**
 * Rank the institution-tier parts of one semicolon-delimited byline run.
 * Returns an array: every DISTINCT institution-tier part in byline order
 * when one or more exist (Fix 2, Codex adversarial review 2026-09-21 — a
 * comma-delimited co-affiliation like "University of Washington, Fred
 * Hutchinson Cancer Center" names two institutions, not one); otherwise a
 * one-element array from the existing fallback chain.
 */
function pickInstitutionsFromRun(parts) {
  const candidates = parts.filter((part) => !isGeographicSegment(part));
  const pool = candidates.length > 0 ? candidates : parts;
  const nonSubunit = pool.filter((part) => !SUBUNIT_SEGMENT.test(part));
  const institutionTierParts = nonSubunit.filter(isInstitutionTierPart);
  if (institutionTierParts.length > 0) {
    return institutionTierParts.map((part) => reattachMultiCampus(part, parts));
  }
  // No institution-tier part at all. Fallback chain (unchanged): a
  // university-tier non-sub-unit part; then any other organization-shaped
  // non-sub-unit part (broader than the institution-tier whitelist above —
  // e.g. "academy", bare "center"/"centre"); then an organization-shaped
  // part even if it LOOKS like a sub-unit ("Institute of Science and
  // Technology Austria" is a whole institution; "Center for Translational
  // Cancer Research" is a genuine sub-unit shown only because nothing else
  // in the run qualifies); then the first non-sub-unit part — unless that is
  // a bare one-word proper noun, which is almost always a town the
  // geographic list does not know ("Department of Chemistry,
  // Klosterneuburg"), in which case the sub-unit part is less wrong; then
  // the first part at all.
  const organizationShaped = nonSubunit.find((part) => UNIVERSITY_TERM.test(part))
    || nonSubunit.find((part) => ORGANIZATION_TERM.test(part))
    || pool.find((part) => UNIVERSITY_TERM.test(part) || ORGANIZATION_TERM.test(part))
    || null;
  const fallback = nonSubunit[0] || pool[0] || null;
  const subunit = pool.find((part) => SUBUNIT_SEGMENT.test(part)) || null;
  const bareWord = typeof fallback === 'string' && !/\s/.test(fallback);
  const ranked = organizationShaped || (bareWord && subunit ? subunit : fallback);
  if (!ranked) return [];
  return [reattachMultiCampus(ranked, parts)];
}

/**
 * True when `text` carries a marker a confirmed institution name never has:
 * an echoed email address, a geographic segment (postal code, US state,
 * listed country/state name, "City ST 12345", a street address), or a
 * department/division-shaped sub-unit lead.
 *
 * Owner decision 2026-09-21 (Codex round 6): the trailing-single-word marker
 * (added Codex round 5, removed here) is gone. It caught an unlisted
 * trailing city ("Cornell University, Ithaca") but also misfired on a
 * confirmed value that legitimately ends in one unlisted word — a
 * co-affiliation ("Stanford University, Genentech") or a campus qualifier
 * ("Weill Cornell Medicine, Qatar") — erasing real content to fix a display
 * artifact. A trailing unlisted city is therefore a documented miss: a
 * value like "Weill Cornell Medicine, Cornell University, Doha" is shown
 * verbatim rather than reduced. Staff correct such values directly in the
 * Reviewer Finder candidate edit modal's Main institution field.
 *
 * A confirmed value may legitimately contain commas of its own ("Weill Cornell
 * Medicine, Cornell University", "University of California, San Francisco")
 * and must be shown verbatim in that case; only a value that still looks like
 * a pasted publication byline (what the accept form used to pre-fill) is
 * reduced by `institutionNameOf` (Codex round 4 finding, 2026-09-21).
 *
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeByline(text) {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) return false;
  if (/\S+@\S+/.test(trimmed) || /electronic\s+address/i.test(trimmed)) return true;
  const segments = trimmed.split(/[,;]/).map((part) => part.trim()).filter(Boolean);
  if (segments.some((segment) => isGeographicSegment(segment) || SUBUNIT_SEGMENT.test(segment))) return true;
  return false;
}

/**
 * Reduce a free-text affiliation/byline to its institution name(s) for
 * display in the reviewer clause. Semicolons separate independent bylines;
 * commas separate the parts of one byline, including comma-delimited
 * co-affiliations ("University of Washington, Fred Hutchinson Cancer
 * Center"). Within a byline, geographic parts (cities, states, postal codes,
 * countries) and an echoed email are dropped; every distinct institution-
 * tier part (a university, or a whole hospital/institute/foundation-shaped
 * organization) is kept, or — when nothing in the run looks like an
 * institution — the first non-geographic part is shown. All institution-tier
 * parts across every run are pooled, deduplicated case-insensitively, and
 * joined with the Oxford comma (Fix 2, Codex adversarial review 2026-09-21 —
 * semicolon runs and comma co-affiliations are pooled and deduplicated
 * together, not one institution per run). A short value with no commas
 * ("MIT") passes through unchanged. Returns null for blank input.
 *
 * Owner decisions (2026-09-21): every distinct institution in a byline is
 * shown, joined with "and"/Oxford commas; when nothing looks like an
 * institution the first non-geographic part is shown.
 *
 * @param {string} text
 * @returns {string|null}
 */
export function institutionNameOf(text) {
  const cleaned = stripEchoedContact(text);
  if (!cleaned) return null;
  const runs = cleaned.split(';').map((run) => run.trim()).filter(Boolean);
  const picked = [];
  const seen = new Set();
  for (const run of runs) {
    const parts = run.split(',').map((part) => part.replace(/\.$/, '').trim()).filter(Boolean);
    const institutions = pickInstitutionsFromRun(parts);
    for (const institution of institutions) {
      const key = institution.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(institution);
    }
  }
  if (picked.length === 0) return cleaned;
  return joinWithOxfordComma(picked);
}

/**
 * Institution precedence for the reviewer clause (W1): `mainInstitution` →
 * accept-time affiliation (`reviewerAffiliationOf`, email-suffix stripped) →
 * `affiliation` (the person projection's `primaryAffiliation`/
 * `organizationName`, already collapsed by `reviewers-service.js`) → fallback.
 * All three sources are reduced to institution name(s) by `institutionNameOf`
 * (2026-09-21 for the free-text sources). `mainInstitution` is reduced only
 * when `looksLikeByline` says it still looks like a raw PubMed byline — from
 * before the accept-form pre-fill seed was fixed, or from a staff edit
 * (2026-09-21/request-1002852) — never for a reviewer- or staff-confirmed
 * value that merely contains commas of its own ("Weill Cornell Medicine,
 * Cornell University"), which is shown verbatim (Codex round 4 finding,
 * 2026-09-21). A clean value with no separators passes through unchanged.
 *
 * Opus Slice 1 follow-up: `reviewerAffiliationOf` can strip the accept-time
 * value down to an empty string (e.g. `reviewerAffiliation` IS the reviewer's
 * echoed email, with nothing left after the strip) without ever consulting
 * `affiliation` — it only falls back to `affiliation` when `reviewerAffiliation`
 * was blank to begin with. That fall-through belongs here, in the composer,
 * not inside `reviewerAffiliationOf` (whose existing tab callers depend on its
 * current return value, including returning null in that exact case).
 */
function institutionOf(reviewer) {
  const main = typeof reviewer?.mainInstitution === 'string' ? reviewer.mainInstitution.trim() : '';
  // `mainInstitution` is reviewer/staff-confirmed, so a comma-bearing value
  // may legitimately be a clean multi-part institution name ("Weill Cornell
  // Medicine, Cornell University", "University of California, San
  // Francisco") that must be shown verbatim. Only reduce it when
  // `looksLikeByline` finds a marker (echoed email, geographic segment, or
  // department lead) showing it is still a raw pasted byline — from before
  // the accept-form pre-fill seed was fixed, or from a staff edit via
  // `CandidateEditModal` (request 1002852, 2026-09-21; gated Codex round 4,
  // 2026-09-21).
  if (main) return looksLikeByline(main) ? (institutionNameOf(main) || main) : main;
  // Free-text sources (accept-time field, person affiliation) may be a whole
  // PubMed byline (observed on request 1002852, 2026-09-21): reduce them to
  // the institution name(s) for display, unconditionally — these fields are
  // not reviewer/staff-confirmed the way `mainInstitution` is. A clean value
  // with no separators ("Stanford University", "MIT") has nothing to reduce
  // and passes through `institutionNameOf` unchanged.
  const accepted = reviewerAffiliationOf(reviewer);
  if (accepted) return institutionNameOf(accepted) || accepted;
  const personAffiliation = typeof reviewer?.affiliation === 'string' ? reviewer.affiliation.trim() : '';
  if (personAffiliation) return institutionNameOf(personAffiliation) || personAffiliation;
  return 'institution not recorded';
}

/**
 * Lowercase an expertise area's first letter for mid-sentence use, EXCEPT
 * when that would clip an acronym (Opus Slice 1 follow-up): "DNA repair" and
 * "CRISPR screens" must keep their case. Heuristic: only lowercase when the
 * SECOND character is not itself an uppercase letter — an acronym's second
 * character is uppercase ("D" in "DNA", "R" in "CRISPR"); an ordinary
 * capitalized word's second character is lowercase ("i" in "Microbial").
 */
function lowercaseFirstLetterUnlessAcronym(area) {
  if (!area) return area;
  const second = area[1] || '';
  if (second && second === second.toUpperCase() && second !== second.toLowerCase()) {
    return area;
  }
  return area[0].toLowerCase() + area.slice(1);
}

function lastNameOf(reviewer) {
  const explicit = typeof reviewer?.lastName === 'string' ? reviewer.lastName.trim() : '';
  if (explicit) return explicit;
  const name = typeof reviewer?.name === 'string' ? reviewer.name.trim() : '';
  if (!name) return '';
  const tokens = name.split(/\s+/).filter(Boolean);
  return tokens.length ? tokens[tokens.length - 1] : '';
}

/**
 * Stable sort by descending overall rating (labelled ratings only participate
 * in ordering weight — an unlabelled/null rating sorts after every labelled
 * one, preserving the input order among unlabelled reviewers and among ties).
 */
function orderByRatingDescending(reviewers, labelFor) {
  return reviewers
    .map((reviewer, index) => ({ reviewer, index, label: labelFor(reviewer) }))
    .sort((a, b) => {
      const aRated = a.label != null;
      const bRated = b.label != null;
      if (aRated && bRated) {
        const diff = (b.reviewer.reviewerOverallAssessment ?? 0) - (a.reviewer.reviewerOverallAssessment ?? 0);
        if (diff !== 0) return diff;
        return a.index - b.index;
      }
      if (aRated !== bRated) return aRated ? -1 : 1;
      return a.index - b.index;
    })
    .map((entry) => entry.reviewer);
}

function submittedReviewersOf(reviewers) {
  return (Array.isArray(reviewers) ? reviewers : []).filter((r) => !!r?.reviewReceivedAt);
}

/**
 * Canonical reviewer ordering used ANYWHERE a rating tie needs a stable,
 * caller-order-independent tie-break — most importantly `verifyAndSelectQuotations`'s
 * W8 selection, so two callers passing the same reviewers in different
 * incoming orders (the tab's name-sorted `submitted`; an export roster still
 * in Dataverse fetch order) select the identical three quotations rather than
 * silently diverging on a rating tie. By reviewer display name
 * (locale-aware), then `suggestionId` as a final deterministic tie-break.
 * Exported so every caller that needs "the tab's" reviewer ordering (the tab
 * itself included) uses this one implementation.
 *
 * @param {{name?: string, suggestionId?: string}} a
 * @param {{name?: string, suggestionId?: string}} b
 * @returns {number}
 */
export function compareReviewersByName(a, b) {
  // Pin locale 'en' explicitly (Opus Slice 3 review follow-up): an unpinned
  // localeCompare uses the runtime's default locale, which can differ
  // between a browser tab and a Node server process — the exact
  // cross-surface divergence this comparator exists to prevent.
  const byName = (a?.name || '').localeCompare(b?.name || '', 'en');
  if (byName !== 0) return byName;
  return (a?.suggestionId || '').localeCompare(b?.suggestionId || '', 'en');
}

/**
 * Shared tally step for both `composeScoreSentence` (Reviews tab) and the
 * Slice 4 referee-section count sentence: bucket labelled ratings by label,
 * in descending rating order. A reviewer whose `reviewerOverallAssessment`
 * has no label (legacy row) is excluded from the tally and its name is
 * added to `warnings`. Caller supplies an already-`submittedReviewersOf`-
 * filtered array.
 *
 * @param {Array<Object>} submitted
 * @returns {{ tallies: Map<string, number>, labelOrder: Array<{label:string, rating:number|null}>, warnings: string[], unlabelled: Array<{name:(string|null)}> }}
 */
function tallyScoreLabels(submitted) {
  const tallies = new Map(); // label -> count
  const labelOrder = [];
  const warnings = [];
  const unlabelled = [];
  for (const reviewer of submitted) {
    const label = labelForReviewRating('overallAssessment', reviewer.reviewerOverallAssessment);
    if (!label) {
      warnings.push(`${reviewer.name || 'An unnamed reviewer'}'s overall rating has no label and was left out of the score tally.`);
      unlabelled.push({ name: reviewer.name || null });
      continue;
    }
    if (!tallies.has(label)) {
      tallies.set(label, 0);
      labelOrder.push({ label, rating: reviewer.reviewerOverallAssessment });
    }
    tallies.set(label, tallies.get(label) + 1);
  }
  labelOrder.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  return { tallies, labelOrder, warnings, unlabelled };
}

/**
 * "We received three reviews with scores of two Excellent and one Fair."
 * Tally is computed on labelled ratings only, in descending rating order.
 * A reviewer whose `reviewerOverallAssessment` has no label (legacy row) is
 * excluded from the tally and its name is added to `warnings`.
 *
 * @param {Array<Object>} reviewers - full projection (Slice 1 shape)
 * @returns {{ sentence: string|null, warnings: string[] }}
 */
export function composeScoreSentence(reviewers) {
  const submitted = submittedReviewersOf(reviewers);
  if (submitted.length === 0) return { sentence: null, warnings: [] };

  const { tallies, labelOrder, warnings } = tallyScoreLabels(submitted);
  const reviewWord = submitted.length === 1 ? 'review' : 'reviews';
  const countWord = numberWord(submitted.length);

  if (labelOrder.length === 0) {
    return { sentence: `We received ${countWord} ${reviewWord}.`, warnings };
  }

  if (submitted.length === 1 && labelOrder.length === 1) {
    return {
      sentence: `We received one review with a score of ${labelOrder[0].label}.`,
      warnings,
    };
  }

  const tallyPhrases = labelOrder.map(({ label }) => `${numberWord(tallies.get(label))} ${label}`);
  return {
    sentence: `We received ${countWord} ${reviewWord} with scores of ${joinWithOxfordComma(tallyPhrases)}.`,
    warnings,
  };
}

/**
 * Slice 4 variant of the count sentence used ONLY inside
 * `composeRefereeSection` — "so far" phrasing when blockers are outstanding,
 * identical to `composeScoreSentence` when there are none (plan §4.5: "the
 * plain form when none").
 *
 * @param {Array<Object>} submitted - already `submittedReviewersOf`-filtered
 * @param {boolean} hasBlockers
 * @returns {{ sentence: string|null, warnings: string[] }}
 */
function composeRefereeCountSentence(submitted, hasBlockers) {
  if (submitted.length === 0) return { sentence: null, warnings: [] };
  if (!hasBlockers) return composeScoreSentence(submitted);

  const { tallies, labelOrder, warnings } = tallyScoreLabels(submitted);
  const reviewWord = submitted.length === 1 ? 'review' : 'reviews';
  const countWord = numberWord(submitted.length);

  if (labelOrder.length === 0) {
    return { sentence: `We have received ${countWord} ${reviewWord} so far.`, warnings };
  }
  if (submitted.length === 1 && labelOrder.length === 1) {
    return {
      sentence: `We have received one review so far, with a score of ${labelOrder[0].label}.`,
      warnings,
    };
  }
  const tallyPhrases = labelOrder.map(({ label }) => `${numberWord(tallies.get(label))} ${label}`);
  return {
    sentence: `We have received ${countWord} ${reviewWord} so far, with scores of ${joinWithOxfordComma(tallyPhrases)}.`,
    warnings,
  };
}

/**
 * "The reviewers were <u>Name</u>, a professor at Institution; …"
 * One clause per submitted reviewer, in descending-rating order (ties keep
 * the caller's order). Returns runs so a renderer underlines the name
 * without HTML.
 *
 * @param {Array<Object>} reviewers
 * @returns {{ runs: Array<{text:string, underline?:boolean}> }|null}
 */
export function composeReviewerSentence(reviewers) {
  const submitted = submittedReviewersOf(reviewers);
  if (submitted.length === 0) return null;

  const ordered = orderByRatingDescending(
    submitted,
    (r) => labelForReviewRating('overallAssessment', r.reviewerOverallAssessment),
  );

  const clauses = ordered.map((reviewer) => {
    const trimmedName = typeof reviewer.name === 'string' ? reviewer.name.trim() : '';
    const name = trimmedName || 'Unnamed reviewer';
    const institution = institutionOf(reviewer);
    const rank = typeof reviewer.academicRank === 'string' ? reviewer.academicRank.trim() : '';
    const runs = [{ text: name, underline: true }];
    if (rank) {
      const lowerRank = rank.toLowerCase();
      runs.push({ text: `, ${articleFor(lowerRank)} ${lowerRank} at ${institution}` });
    } else {
      runs.push({ text: ` of ${institution}` });
    }
    return runs;
  });

  const lead = submitted.length === 1 ? 'The reviewer was ' : 'The reviewers were ';
  const runs = [{ text: lead }];
  clauses.forEach((clauseRuns, i) => {
    if (i > 0) {
      const isLast = i === clauses.length - 1;
      runs.push({ text: isLast ? '; and ' : '; ' });
    }
    runs.push(...clauseRuns);
  });
  runs.push({ text: '.' });
  return { runs };
}

/**
 * The expertise areas recorded for a reviewer: `keywords` split on ";",
 * falling back to `areaOfExpertise`; trimmed, empties dropped, first three.
 * Shared by the expertise sentence and `composeRefereeSection`'s
 * `referee_expertise_missing` diagnostic so the two can never disagree about
 * which reviewer was omitted. Exported for the same reason.
 *
 * @param {Object} reviewer
 * @returns {string[]}
 */
export function expertiseAreasOf(reviewer) {
  const source = (typeof reviewer?.keywords === 'string' && reviewer.keywords.trim())
    ? reviewer.keywords
    : reviewer?.areaOfExpertise;
  if (typeof source !== 'string' || !source.trim()) return [];
  return source
    .split(';')
    .map((a) => a.trim())
    .filter(Boolean)
    .slice(0, 3);
}

/**
 * "Nadell has expertise in X, Y, and Z, while Breitbart has expertise in …"
 * Keyed by last name (fallback: last token of `name`). Areas come from
 * `keywords` split on ";", falling back to `areaOfExpertise`; first three
 * areas, first letter lowercased. Reviewers with no expertise data are
 * omitted; pairs are joined with "while"; a third (and later) reviewer
 * starts a new sentence.
 *
 * @param {Array<Object>} reviewers
 * @returns {string|null}
 */
export function composeExpertiseSentence(reviewers) {
  const submitted = submittedReviewersOf(reviewers);
  if (submitted.length === 0) return null;

  const ordered = orderByRatingDescending(
    submitted,
    (r) => labelForReviewRating('overallAssessment', r.reviewerOverallAssessment),
  );

  const clauses = [];
  for (const reviewer of ordered) {
    const areas = expertiseAreasOf(reviewer).map(lowercaseFirstLetterUnlessAcronym);
    if (areas.length === 0) continue;
    const lastName = lastNameOf(reviewer);
    if (!lastName) continue;
    clauses.push(`${lastName} has expertise in ${joinWithOxfordComma(areas)}`);
  }

  if (clauses.length === 0) return null;

  const sentences = [];
  for (let i = 0; i < clauses.length; i += 2) {
    const pair = clauses.slice(i, i + 2);
    sentences.push(`${pair.join(', while ')}.`);
  }
  return sentences.join(' ');
}

function runsToPlainText(runs) {
  return runs.map((r) => r.text).join('');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function runsToHtml(runs) {
  return runs
    .map((r) => (r.underline ? `<u>${escapeHtml(r.text)}</u>` : escapeHtml(r.text)))
    .join('');
}

// Collapse whitespace, unify curly/straight quotes and apostrophes, and
// casefold — so a verbatim quote survives an LLM's whitespace/typography
// drift without becoming a false negative at the read boundary.
function normalizeForMatch(value) {
  return String(value ?? '')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const QUOTATION_LEAD_INS = {
  1: ['The most positive reviewer said:'],
  2: ['The most positive reviewer said:', 'The most critical reviewer noted:'],
  3: ['The most positive reviewer said:', 'Another reviewer noted:', 'The most critical reviewer noted:'],
};

/**
 * Quote provenance is enforced HERE, at the read boundary — never trusted
 * from the model (plan §4.3, Codex AR-1 finding 1). A candidate `{questionKey,
 * quote}` survives only if it is a normalized, WORD-BOUNDARY substring of
 * exactly one submitted reviewer's `answers[].answerText` on a NARRATIVE
 * question (`questionType` `'richtext'` or `'string'` — never `'picklist'`/
 * `'multiselect'`, whose `answerText` is a decoded option LABEL, not
 * reviewer-authored prose: `labelForOption` in
 * `lib/external/build-review-submission.js` stores that label verbatim, so
 * e.g. the picklist label "Excellent" would otherwise verify against any
 * reviewer's rating row); ambiguous (matches more than one reviewer) or
 * unmatched candidates are dropped and counted (Codex adversarial review
 * finding, wrap-up 2026-09-14).
 *
 * Two more guards at the same read boundary, same finding:
 * - Minimum length: a candidate under `MIN_QUOTE_WORDS` (6) normalized words
 *   is dropped and counted. Six words reads as "at least a short clause"
 *   without being so long it excludes a genuinely terse but real quotation;
 *   it also reliably rejects rating-label- and boilerplate-length fragments
 *   that would otherwise slip through a bare non-empty-substring check.
 * - Word-boundary matching: the normalized quote must match the normalized
 *   answer at WORD boundaries (`matchesAtWordBoundaries`), not merely as a
 *   raw substring — so a quote like "cell" never verifies against
 *   "...excellent..." (a partial-word match inside an unrelated word).
 *
 * At most one surviving quote per reviewer (first candidate for that
 * reviewer wins). Survivors are ordered by that reviewer's
 * `reviewerOverallAssessment` descending (ties broken by
 * `compareReviewersByName` on a CANONICAL re-sort of `submitted`, never by
 * the order `reviewers` arrived in — see that function's doc comment); when
 * more than three survive, W8 keeps only the highest-rated, the median (by
 * sorted position), and the lowest-rated.
 *
 * Exported so other consumers of the same reviewer projection (e.g.
 * `shared/utils/review-report.js`'s Word-export synthesis section) can reuse
 * the identical verification instead of trusting raw `synthesis.writeupQuotations`.
 *
 * @param {Array<Object>} candidates - raw `synthesis.writeupQuotations`
 * @param {Array<Object>} reviewers - full reviewer projection; filtered to
 *   `reviewReceivedAt` internally, same as every other composer here.
 * @returns {{ kept: Array<{leadIn:string, quote:string, questionKey:string}>, droppedQuotationCount: number }}
 */
const MIN_QUOTE_WORDS = 6;
const NARRATIVE_ANSWER_TYPES = new Set(['richtext', 'string']);

function normalizedWordCount(value) {
  return String(value ?? '').split(/\s+/).filter(Boolean).length;
}

function escapeRegExpLiteral(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Both `haystack` and `needle` are already `normalizeForMatch`-normalized
// (lowercased, whitespace-collapsed) by every caller. A word-character
// lookaround (rather than `\b`, which treats punctuation itself as a
// boundary) is what rejects "cell" matching inside "excellent" while still
// accepting a quote that starts/ends at real punctuation.
function matchesAtWordBoundaries(haystack, needle) {
  if (!needle) return false;
  const pattern = new RegExp(`(?<![a-z0-9])${escapeRegExpLiteral(needle)}(?![a-z0-9])`);
  return pattern.test(haystack);
}

export function verifyAndSelectQuotations(candidates, reviewers) {
  const submitted = submittedReviewersOf(reviewers);
  // Tie-break index is derived from a CANONICAL ordering (compareReviewersByName),
  // never from the order `reviewers` arrived in — the tab passes a name-sorted
  // roster, an export path may pass Dataverse fetch order, and a rating tie
  // among survivors must resolve identically either way (Opus Slice 2 review).
  const canonicalOrder = [...submitted].sort(compareReviewersByName);
  const rosterIndex = new Map(canonicalOrder.map((r, i) => [r.suggestionId, i]));
  const survivors = []; // { reviewer, quote, questionKey }
  const usedReviewers = new Set();
  let droppedQuotationCount = 0;

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const quoteText = typeof candidate?.quote === 'string' ? candidate.quote.trim() : '';
    const normalizedQuote = normalizeForMatch(quoteText);
    if (!normalizedQuote || normalizedWordCount(normalizedQuote) < MIN_QUOTE_WORDS) {
      droppedQuotationCount += 1;
      continue;
    }

    const matchingReviewers = submitted.filter((reviewer) => {
      const answers = Array.isArray(reviewer.answers) ? reviewer.answers : [];
      // Match against answerText ONLY, never answerHtml — a sentence present
      // solely in the (richer, model-untrusted) HTML answer does not count as
      // verified provenance (Opus Slice 2 review follow-up 3). Restrict to
      // narrative question types and require word-boundary matching (Codex
      // adversarial review, wrap-up 2026-09-14) — see the doc comment above.
      return answers.some((a) => NARRATIVE_ANSWER_TYPES.has(a?.questionType)
        && typeof a?.answerText === 'string'
        && matchesAtWordBoundaries(normalizeForMatch(a.answerText), normalizedQuote));
    });

    if (matchingReviewers.length !== 1) {
      // Zero matches: not verbatim in any submitted review (paraphrase or
      // invention). More than one match: ambiguous attribution — drop rather
      // than guess.
      droppedQuotationCount += 1;
      continue;
    }

    const reviewer = matchingReviewers[0];
    if (usedReviewers.has(reviewer.suggestionId)) {
      // Second+ quote for a reviewer who already has one kept: drop, count.
      droppedQuotationCount += 1;
      continue;
    }
    usedReviewers.add(reviewer.suggestionId);
    survivors.push({
      reviewer,
      quote: quoteText,
      questionKey: typeof candidate.questionKey === 'string' ? candidate.questionKey : '',
    });
  }

  survivors.sort((a, b) => {
    const aLabelled = labelForReviewRating('overallAssessment', a.reviewer.reviewerOverallAssessment) != null;
    const bLabelled = labelForReviewRating('overallAssessment', b.reviewer.reviewerOverallAssessment) != null;
    const aIndex = rosterIndex.get(a.reviewer.suggestionId) ?? 0;
    const bIndex = rosterIndex.get(b.reviewer.suggestionId) ?? 0;
    if (aLabelled && bLabelled) {
      const diff = (b.reviewer.reviewerOverallAssessment ?? 0) - (a.reviewer.reviewerOverallAssessment ?? 0);
      if (diff !== 0) return diff;
      return aIndex - bIndex;
    }
    if (aLabelled !== bLabelled) return aLabelled ? -1 : 1;
    return aIndex - bIndex;
  });

  // W8: keep at most three — the highest, the median (by sorted position),
  // and the lowest — when more than three survived verification.
  let selected = survivors;
  if (survivors.length > 3) {
    const medianIndex = Math.floor((survivors.length - 1) / 2);
    selected = [survivors[0], survivors[medianIndex], survivors[survivors.length - 1]];
  }

  const leadIns = QUOTATION_LEAD_INS[selected.length] || [];
  const kept = selected.map((entry, i) => ({
    leadIn: leadIns[i] || 'A reviewer noted:',
    quote: entry.quote,
    questionKey: entry.questionKey,
  }));

  return { kept, droppedQuotationCount };
}

/**
 * Compose the full writeup block from stored data: score sentence, reviewer
 * sentence (as runs), expertise sentence, and — Slice 2 — the model-authored
 * `writeupThemes` paragraph plus verified `writeupQuotations`, each as its
 * own paragraph, in that order. Plus plain-text and HTML serialisations for
 * Copy.
 *
 * `synthesis` may be absent, current-but-empty (pre-Slice-2 stored row), or
 * fully populated — every case renders only what's present; an absent/empty
 * `synthesis` renders only the three deterministic Slice 1 sentences.
 *
 * @param {{reviewers: Array<Object>, synthesis?: Object|null}} input
 * @returns {{ paragraphs: Array<Array<{text:string, underline?:boolean}>>, deterministicParagraphs: Array<Array<{text:string, underline?:boolean}>>, warnings: string[], droppedQuotationCount: number, themes: string|null, quotations: Array<{leadIn:string, quote:string, questionKey:string}>, text: string, html: string }}
 */
export function composeWriteupParagraphs({ reviewers, synthesis } = {}) {
  const { sentence: scoreSentence, warnings: scoreWarnings } = composeScoreSentence(reviewers);
  const reviewerSentence = composeReviewerSentence(reviewers);
  const expertiseSentence = composeExpertiseSentence(reviewers);
  const warnings = [...scoreWarnings];

  // The deterministic (Slice 1) sentences ONLY — no themes/quotations mixed
  // in. Exposed separately (`deterministicParagraphs`) so a consumer that
  // already renders `themes`/`quotations` from their own dedicated fields
  // (e.g. `review-report.js`'s `writeupSection`, Slice 3) doesn't have to
  // re-derive which prefix of `paragraphs` is deterministic.
  const deterministicParagraphs = [];
  if (scoreSentence) deterministicParagraphs.push([{ text: scoreSentence }]);
  if (reviewerSentence) deterministicParagraphs.push(reviewerSentence.runs);
  if (expertiseSentence) deterministicParagraphs.push([{ text: expertiseSentence }]);

  const paragraphs = [...deterministicParagraphs];

  const submitted = submittedReviewersOf(reviewers);

  // A submitted reviewer with no recorded expertise is silently absent from
  // the expertise sentence above (composeExpertiseSentence skips them). This
  // is the same condition composeRefereeSection's `referee_expertise_missing`
  // diagnostic names — but that diagnostic only reaches the Pre-Site panel.
  // Staff also review and export from the Reviews tab, which renders this
  // `warnings` list as plain strings, so name it here too.
  for (const reviewer of submitted) {
    if (expertiseAreasOf(reviewer).length === 0) {
      const name = typeof reviewer.name === 'string' && reviewer.name.trim() ? reviewer.name.trim() : 'A reviewer';
      warnings.push(`${name} has no recorded expertise, so the expertise sentence omits them. Add keywords or an area of expertise to their reviewer record.`);
    }
  }

  const themesText = typeof synthesis?.writeupThemes === 'string' ? synthesis.writeupThemes.trim() : '';
  if (themesText) paragraphs.push([{ text: themesText }]);

  const { kept: quotations, droppedQuotationCount } = verifyAndSelectQuotations(
    synthesis?.writeupQuotations,
    submitted,
  );
  for (const { leadIn, quote } of quotations) {
    paragraphs.push([{ text: `${leadIn} "${quote}"` }]);
  }
  if (droppedQuotationCount > 0) {
    warnings.push(`${droppedQuotationCount} quotation(s) could not be matched to a review and were omitted.`);
  }

  const text = paragraphs.map(runsToPlainText).join('\n\n');
  const html = paragraphs.map((runs) => `<p>${runsToHtml(runs)}</p>`).join('');

  return {
    paragraphs,
    deterministicParagraphs,
    warnings,
    droppedQuotationCount,
    themes: themesText || null,
    quotations,
    text,
    html,
  };
}

// The ONLY blocker reason `composeRefereeSection` names a blocker by (plan
// §4.5, Codex AR-1 finding 5: allowlist, not denylist). Every other reason —
// `missing_current_token`, `missing_token_*`, `malformed_*`, `unknown_*`, and
// anything not yet defined by `review-synthesis-readiness.js` — collapses to
// a counted generic clause. Also requires the row itself to be
// `accepted === true`.
const NAMEABLE_BLOCKER_REASON = 'active_invitation';

/**
 * Slice 4 (plan §4.5): compose the Pre-Site Visit `[[STAFF:RefereeSection]]`
 * fill from the reviews in hand at generation time — the SAME deterministic
 * sentences as the Reviews tab (count/scores, reviewers, expertise; NO model
 * text — themes/quotations stay tab-only) plus an "outstanding" sentence
 * naming reviewers whose invitation is still open.
 *
 * Returns `null` when zero reviews are submitted (plan: "leave the token").
 *
 * Outstanding naming is an ALLOWLIST: a blocker is named by reviewer name
 * only when `accepted === true` AND `reason === 'active_invitation'`; every
 * other unresolved reason collapses into a counted generic clause ("One
 * invitation is unresolved." / "Two invitations are unresolved.") and emits
 * a `{code: 'referee_blocker_unnamed', reason}` diagnostic instead of
 * silently naming (or silently dropping) an ambiguous case.
 *
 * A submitted review with an unlabelled (pre-current-scale) rating is
 * excluded from the score tally and emits a
 * `{code: 'referee_rating_unlabelled', name}` diagnostic (wrap-up item 5)
 * rather than silently vanishing from both the sentence and the persisted
 * diagnostics.
 *
 * @param {{reviewers: Array<Object>, blockers?: Array<{suggestionId:string, reason:string, name:(string|null), accepted:boolean}>}} input
 * @returns {{ text: string, names: string[], diagnostics: Array<{code:string, reason?:string, name?:(string|null)}> } | null}
 */
export function composeRefereeSection({ reviewers, blockers } = {}) {
  const submitted = submittedReviewersOf(reviewers);
  if (submitted.length === 0) return null;

  const safeBlockers = Array.isArray(blockers) ? blockers : [];
  const hasBlockers = safeBlockers.length > 0;

  const { sentence: countSentence } = composeRefereeCountSentence(submitted, hasBlockers);
  const reviewerSentence = composeReviewerSentence(submitted);
  const expertiseSentence = composeExpertiseSentence(submitted);

  const sentences = [];
  const names = [];
  const diagnostics = [];

  // Wrap-up item 5: a submitted review whose rating has no label under the
  // current form scale is silently excluded from the score tally above
  // (`tallyScoreLabels`'s `warnings`); promote that to a diagnostic so it
  // reaches the artifact's stored diagnostics and the Workbench warning
  // panel, rather than only ever being visible as a tab-side string.
  const { unlabelled } = tallyScoreLabels(submitted);
  for (const entry of unlabelled) {
    diagnostics.push({ code: 'referee_rating_unlabelled', name: entry.name || null });
  }

  // A submitted reviewer with no recorded expertise (neither `keywords` nor
  // `areaOfExpertise` on the person row — the applicant-recommended case,
  // whose ingestion path never writes either) is silently absent from the
  // expertise sentence. Name them so the Workbench warning panel tells staff
  // to fill the field in, instead of the sentence quietly shrinking.
  for (const reviewer of submitted) {
    if (expertiseAreasOf(reviewer).length === 0) {
      const name = typeof reviewer.name === 'string' && reviewer.name.trim() ? reviewer.name.trim() : null;
      diagnostics.push({ code: 'referee_expertise_missing', name });
    }
  }

  if (countSentence) sentences.push(countSentence);
  if (reviewerSentence) {
    sentences.push(runsToPlainText(reviewerSentence.runs));
    for (const run of reviewerSentence.runs) {
      if (run.underline && run.text) names.push(run.text);
    }
  }
  if (expertiseSentence) sentences.push(expertiseSentence);

  const namedOutstanding = [];
  let unnamedCount = 0;
  for (const blocker of safeBlockers) {
    if (blocker?.accepted === true && blocker?.reason === NAMEABLE_BLOCKER_REASON) {
      const name = typeof blocker.name === 'string' && blocker.name.trim()
        ? blocker.name.trim()
        : 'An unnamed reviewer';
      namedOutstanding.push(name);
    } else {
      unnamedCount += 1;
      diagnostics.push({ code: 'referee_blocker_unnamed', reason: blocker?.reason || 'unknown' });
    }
  }

  if (namedOutstanding.length > 0) {
    const lead = namedOutstanding.length === 1 ? 'A review from ' : 'Reviews from ';
    const verb = namedOutstanding.length === 1 ? 'is' : 'are';
    sentences.push(`${lead}${joinWithOxfordComma(namedOutstanding)} ${verb} outstanding.`);
    names.push(...namedOutstanding);
  }
  if (unnamedCount > 0) {
    const word = numberWord(unnamedCount);
    const capitalizedWord = word.charAt(0).toUpperCase() + word.slice(1);
    const noun = unnamedCount === 1 ? 'invitation is' : 'invitations are';
    sentences.push(`${capitalizedWord} ${noun} unresolved.`);
  }

  return {
    text: sentences.join(' '),
    names,
    diagnostics,
  };
}
