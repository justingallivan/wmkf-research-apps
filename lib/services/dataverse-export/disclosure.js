/**
 * Dataverse Power Tools — Track B — semantic / disclosure engine.
 *
 * Post-query, per-row + aggregate. Produces the BAKED-IN HONESTY (design doc
 * §"Disclosure-layer spec", 6 mandatory items + the S159-resolved engine
 * rules; build plan §3c). This is where the correctness budget is spent — on
 * the error class human judgment cannot backstop (composition / era /
 * classification disclosure), per the threat-model recalibration.
 *
 * Status / semantic determinations are OWNED by the design doc and bound here
 * via constants.js. Sentinel WORDING is named explicitly (constants below) so
 * a reimplementation cannot silently reword or shrink a named set.
 *
 * Every non-decided / null / unannotated condition resolves to an explicit
 * sentinel — NEVER a bare blank (a bare blank reads as $0 / "no co-PI" /
 * "resolved", the exact plausible-wrong-answer the tool exists to prevent).
 */

import {
  ERA,
  classifyEra,
  classifyStatus,
  STATUS_CLASS,
  B_STRUCTURAL_AMOUNT_FIELDS,
  baseAmountField,
  DECLINE_FIELDS,
  DECLINE_TRIAGE_STATUSES,
  programAnnotation,
  PER_PROGRAM_SEED_PROVENANCE,
  PROGRAM_UNATTRIBUTED_LABEL,
} from './constants.js';

// ── Named sentinels (design-doc wording — do NOT reword in a reimpl) ──────
const SENTINEL = Object.freeze({
  ERA_UNKNOWN: 'UNCLASSIFIED — era (createdon absent/malformed)',
  // B-lifecycle null caption (item 2), driven by the status class map.
  NOT_YET_DECIDED: 'NOT YET DECIDED',
  DECIDED_NO_AWARD: 'DECIDED — no award',
  AMOUNT_UNKNOWN_NOT_CAPTURED: 'UNKNOWN — not captured',
  // B-structural class-aware sentinel (item 3).
  STRUCT_MIGRATION_BACKFILL: 'UNKNOWN — migration backfill',
  STRUCT_FEEDBACK_REQUEST: 'N/A — feedback request',
  STRUCT_INVITED_DISCRETIONARY: 'N/A — invited/discretionary award (see awarded amount)',
  // Withdrawn — terminal, no award, PATH-AGNOSTIC (no actor attributed;
  // user-confirmed S158). Distinct from "UNKNOWN — not captured", which
  // wrongly implies an award might have existed (Codex S160 P1).
  WITHDRAWN_NO_AWARD: 'WITHDRAWN — no decision, no award',
  // PI program-conditional (S159).
  PI_NONE_NONRESEARCH: 'N/A — no PI (non-research process)',
  PI_UNCLASSIFIED_PROCESS: 'UNCLASSIFIED PROCESS — manual review required',
  // Institution resolution (§3c deterministic algorithm).
  INST_UNRESOLVED: 'unresolved — no legalname/aka/name',
});

const INST_RESOLUTION = Object.freeze({
  RESOLVED: 'resolved',
  PAYEE_DIFFERS: 'ambiguous — payee differs',
  VARIANTS_SHARE_KEY: 'ambiguous — N variants share key', // N filled per cluster
  UNRESOLVED: 'unresolved — no legalname/aka/name',
});

// Decline trifurcation buckets (build plan §3c).
const DECLINE_BUCKET = Object.freeze({
  WITH_REASON: 'declined-with-reason',
  TRIAGE: 'declined-triage (no reason expected)',
  REASON_MISSING: 'declined-reason-missing (should exist)',
  // A program with no decline_segment annotation is a process-dependent
  // output path with no rule — its OWN distinct fail-loud bucket, never
  // folded into reason-missing (Codex S160 P2; build plan §9).
  UNCLASSIFIED_PROCESS: 'declined-UNCLASSIFIED PROCESS (manual review required)',
  PROGRAM_UNATTRIBUTED: PROGRAM_UNATTRIBUTED_LABEL,
  NOT_DECLINED: null,
});

// ── Row field accessors (processAnnotations shape) ────────────────────────
// Lookups arrive as `_<field>_value` (+ `_<field>_value_formatted`).
const lookupId = (row, f) => row[`_${f}_value`] ?? null;
const lookupName = (row, f) => row[`_${f}_value_formatted`] ?? null;

// Applicant / payee account attributes. Phase-2 wires the FetchXML link
// aliases into row.__applicant / row.__payee; Phase-1 fixtures supply them
// directly. Fall back to flat alias keys if a join object is absent.
function account(row, role) {
  const j = role === 'payee' ? row.__payee : row.__applicant;
  if (j && typeof j === 'object') return j;
  const p = role === 'payee' ? 'payee_' : 'appl_';
  return {
    name: row[`${p}name`] ?? null,
    akoya_aka: row[`${p}akoya_aka`] ?? null,
    wmkf_legalname: row[`${p}wmkf_legalname`] ?? null,
    address1_city: row[`${p}address1_city`] ?? null,
    address1_stateorprovince: row[`${p}address1_stateorprovince`] ?? null,
  };
}

// ── Institution Normalize() — the EXACT deterministic algorithm (§3c) ─────
// Specified so two implementations cannot diverge. v1 is deterministic-only:
// NO fuzzy / learned merge (that is a Phase-2 enhancement). The fixed maps
// are committed constants (Living-taxonomy: data, extendable without code).

const LEGAL_SUFFIXES = new Set([
  'inc', 'llc', 'ltd', 'corp', 'co', 'foundation', 'fdn', 'trust', 'fund',
]); // 'inc.', 'l.l.c.' collapse to these once non-alphanumerics are stripped
const ABBREV_MAP = { univ: 'university', u: 'university', inst: 'institute' };

/** Pure. Returns the normalized cluster key (possibly '' if input empty).
 * Spec order (§3c step 1): NFKD + strip diacritics → lowercase → strip
 * trailing legal-suffix set (incl. dotted `inc.` / `l.l.c.`) → strip
 * leading "the" → expand abbreviations → strip non-alphanumeric → collapse.
 * Head("the") & tail(suffix) strips are independent — order is immaterial.
 * Dots removed FIRST so dotted suffixes (`l.l.c.`→llc, `inc.`→inc) match
 * the committed set (Codex S160 P1: prior tokenizer shattered L.L.C.→[l,l,c]). */
function normalizeInstitution(s) {
  if (s == null) return '';
  // 1. NFKD + strip diacritics → lowercase
  let t = String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  // remove dots so `l.l.c.` / `inc.` collapse to committed suffix tokens
  t = t.replace(/\./g, '');
  // tokenize on the remaining non-alphanumerics
  let tokens = t.split(/[^a-z0-9]+/).filter(Boolean);
  // 2. strip trailing legal-suffix tokens (repeat: "research foundation inc")
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens = tokens.slice(0, -1);
  }
  // 3. strip leading "the"
  if (tokens[0] === 'the') tokens = tokens.slice(1);
  // 4. expand fixed abbreviations
  tokens = tokens.map(w => ABBREV_MAP[w] || w);
  // 5. join, collapse runs of space, trim
  return tokens.join(' ').replace(/\s+/g, ' ').trim();
}

/** Per-row precedence: legalname → akoya_aka → name (first non-empty wins).
 * Also returns the RAW value that produced the key, so collision detection
 * can count distinct raw account names — NOT row count (Codex S160 P1). */
function institutionKey(acct) {
  if (!acct) return { key: '', tier: null, raw: null };
  for (const [field, tier] of [
    ['wmkf_legalname', 'legalname'], ['akoya_aka', 'aka'], ['name', 'name'],
  ]) {
    const k = normalizeInstitution(acct[field]);
    if (k) return { key: k, tier, raw: String(acct[field]).trim() };
  }
  return { key: '', tier: null, raw: null };
}

// ── The engine ───────────────────────────────────────────────────────────

/**
 * Annotate a result set in place-of-truth + compute the aggregate
 * disclosure. Pure (no I/O).
 *
 * @param {object[]} rows  processAnnotations-shaped akoya_request rows
 * @param {object}   querySpec  the confirmed spec (for column intent)
 * @returns {{ rows, summary }}  rows: each augmented with __era, __statusClass,
 *   amount sentinels, __pi, resolved_institution, institution_resolution,
 *   __decline, and any `UNCLASSIFIED — <axis>` columns. summary: composition
 *   line, program roll-up Option-B lines, decline trifurcation, unclassified
 *   sets, fail-loud lists, provenance footnotes.
 */
function annotate(rows, querySpec = {}) {
  const out = [];
  const unclassified = { status: new Map(), era: 0 };
  const piUnclassifiedPrograms = new Set();
  const declineUnannotatedPrograms = new Set();
  const declineBuckets = new Map(); // bucket → count
  const programUnattributed = [];
  let migrated = 0, native = 0, inFlightNative = 0;

  // Pass 1 — cluster keys. A collision is "≥2 DISTINCT raw account names
  // share a key" (build plan §3c step 4) — NOT ≥2 rows. Repeated rows from
  // the SAME account must not be flagged ambiguous (Codex S160 P1).
  const keyRawNames = new Map(); // key → Set<distinct raw name>
  for (const row of rows) {
    const { key, raw } = institutionKey(account(row, 'applicant'));
    if (!key) continue;
    if (!keyRawNames.has(key)) keyRawNames.set(key, new Set());
    keyRawNames.get(key).add(raw || key);
  }

  for (const raw of rows) {
    const row = { ...raw };

    // (1) Era column on every row.
    const era = classifyEra(row.createdon);
    if (era == null) { row.__era = SENTINEL.ERA_UNKNOWN; unclassified.era += 1; }
    else { row.__era = era; if (era === ERA.MIGRATED) migrated += 1; else native += 1; }

    // Status class (drives B-lifecycle caption + native-in-flight count).
    const sc = classifyStatus(row.akoya_requeststatus);
    if (!sc) {
      row.__statusClass = STATUS_CLASS.UNCLASSIFIED;
      const v = String(row.akoya_requeststatus ?? '(blank)');
      unclassified.status.set(v, (unclassified.status.get(v) || 0) + 1);
      row['UNCLASSIFIED — status'] = `UNCLASSIFIED — status=${v}`;
    } else {
      row.__statusClass = sc.class;
      if (sc.class === STATUS_CLASS.IN_FLIGHT && era === ERA.NATIVE) inFlightNative += 1;
    }

    // Program annotation (NAME-keyed dated seed; GUID is the canonical group
    // key for roll-up — duplicate-name caveat noted in the methods sheet).
    const programName = lookupName(row, 'akoya_programid');
    const programGuid = lookupId(row, 'akoya_programid');
    const ann = programAnnotation(programName);

    // (2) B-lifecycle null caption — never a bare blank. Applies to the
    //     awarded-amount / decision-date lifecycle fields.
    for (const f of ['akoya_grant', 'akoya_originalgrantamount', 'akoya_decisiondate']) {
      const present = isPresentMoneyOrDate(row, f);
      if (!present) row[`${f}__sentinel`] = bLifecycleCaption(row.__statusClass);
    }

    // (3) B-structural class-aware sentinel — migrated akoya_request /
    //     akoya_expenses are NEVER a real amount (migration-backfill artifact).
    for (const f of B_STRUCTURAL_AMOUNT_FIELDS) {
      const sentinel = bStructuralSentinel(row, f, era, sc);
      if (sentinel) { row[`${f}__sentinel`] = sentinel; row[baseAmountField(f)] = null; }
    }

    // (6) PI column — program-conditional via the per-program pi_bearing
    //     annotation. PI-bearing ⇒ value; not-PI-bearing ⇒ N/A sentinel;
    //     UNANNOTATED program ⇒ fail-loud UNCLASSIFIED PROCESS (never guess).
    if (ann == null) {
      row.__pi = SENTINEL.PI_UNCLASSIFIED_PROCESS;
      if (programName != null) piUnclassifiedPrograms.add(String(programName));
      else piUnclassifiedPrograms.add(PROGRAM_UNATTRIBUTED_LABEL);
    } else if (ann.pi_bearing === true) {
      row.__pi = lookupName(row, 'wmkf_projectleader')
        || SENTINEL.AMOUNT_UNKNOWN_NOT_CAPTURED; // PI-bearing but blank: not captured
    } else if (ann.pi_bearing === false) {
      row.__pi = SENTINEL.PI_NONE_NONRESEARCH;
    } else {
      row.__pi = SENTINEL.PI_UNCLASSIFIED_PROCESS;
      piUnclassifiedPrograms.add(String(programName ?? PROGRAM_UNATTRIBUTED_LABEL));
    }

    // (5) Primary Contact stays a VALUE; the liaison-vs-PI disambiguation is
    //     a mandatory methods-sheet caption (set in summary), not a per-row
    //     mutation — but we surface the value explicitly, never blank.
    row.__primaryContact = lookupName(row, 'akoya_primarycontactid')
      || SENTINEL.AMOUNT_UNKNOWN_NOT_CAPTURED;

    // Decline output — per-program-segmented, era-aware, trifurcated.
    const dec = classifyDecline(row, era, sc, ann, programName, programGuid);
    row.__decline = dec;
    if (dec.bucket) declineBuckets.set(dec.bucket, (declineBuckets.get(dec.bucket) || 0) + 1);
    if (dec.bucket === DECLINE_BUCKET.PROGRAM_UNATTRIBUTED) {
      programUnattributed.push(row.akoya_requestnum ?? lookupId(row, 'akoya_requestid'));
    }
    if (dec.unannotatedProgram) declineUnannotatedPrograms.add(String(programName));

    // Institution resolution — deterministic, fail-loud, never false-precise.
    const inst = resolveInstitution(row, keyRawNames);
    row.resolved_institution = inst.resolved;
    row.institution_resolution = inst.resolution;

    out.push(row);
  }

  // Aggregate disclosure ----------------------------------------------------
  const total = out.length;
  const compositionLine =
    `${total} rows: ${migrated} migrated (Blackbaud, pre-2023-12-03) · `
    + `${native} Akoya-native; of native, ${inFlightNative} in-flight `
    + `(akoya_requeststatus Pending*)`
    + (unclassified.era ? ` · ${unclassified.era} era-unclassified` : '');

  const unclassifiedSets = [];
  if (unclassified.status.size) {
    const list = [...unclassified.status.entries()]
      .map(([v, n]) => `${v} (${n})`).join(', ');
    const k = [...unclassified.status.values()].reduce((a, b) => a + b, 0);
    unclassifiedSets.push(
      `${k} rows in ${unclassified.status.size} unclassified status value(s): `
      + `[${list}] — included, flagged, not interpreted by this tool`);
  }

  const programRollup = querySpec.programRollup === 'optionB'
    ? computeOptionBRollup(out)
    : null;

  const failLoud = [];
  if (piUnclassifiedPrograms.size) {
    failLoud.push(
      `PI column: ${piUnclassifiedPrograms.size} program(s) have no pi_bearing `
      + `annotation in the dated seed — rows emit "${SENTINEL.PI_UNCLASSIFIED_PROCESS}" `
      + `(NOT a guessed default): [${[...piUnclassifiedPrograms].join(', ')}]`);
  }
  if (declineUnannotatedPrograms.size) {
    failLoud.push(
      `Decline routing: ${declineUnannotatedPrograms.size} program(s) have no `
      + `decline_segment annotation — declined rows flagged UNCLASSIFIED PROCESS: `
      + `[${[...declineUnannotatedPrograms].join(', ')}]`);
  }
  if (programUnattributed.length) {
    failLoud.push(
      `${PROGRAM_UNATTRIBUTED_LABEL}: ${programUnattributed.length} native declined `
      + `row(s) with a null program — surfaced, never silently dropped or `
      + `mis-assigned (Puzzle 3 / decline sub-hazard).`);
  }

  const provenance = [
    `Era cutover 2023-12-03 — scripts/probe-akoya-createdon-2023.js, 2026-05-16 `
    + `(creation provenance only; business history slices on akoya_decisiondate).`,
    `Per-program pi_bearing seed — ${PER_PROGRAM_SEED_PROVENANCE.pi_bearing} `
    + `(probe-substantiated behavioral signature; wmkf_projectleader=PI is `
    + `USER-ATTESTED S159, not probe-proven).`,
    `Per-program decline segmentation — ${PER_PROGRAM_SEED_PROVENANCE.decline} `
    + `(SoCal-area programs read the third field wmkf_socalreasonsfordecline2; `
    + `research programs are structurally empty there).`,
    `Request Primary Contact (copy) is the Request's own akoya_primarycontactid `
    + `— NOT the PI (the PI is wmkf_projectleader, user-attested S159). For `
    + `Research programs the Liaison of record is the applicant institution's `
    + `Primary Contact, which may have changed since; this column is the `
    + `Request's copy, not the current Liaison (owner decision, 2026-09-29).`,
    `Institution clustering is deterministic exact normalized-key only, NOT `
    + `entity resolution — fuzzy/learned merge is a Phase-2 enhancement.`,
    `Status intent labels (Active / Proposal Not Invited / Withdrawn) are `
    + `USER-ATTESTED S158, not probe-proven; behavioral signatures are `
    + `probe-substantiated.`,
  ];

  return {
    rows: out,
    summary: {
      total, migrated, native, inFlightNative,
      compositionLine,
      programRollup,
      declineTrifurcation: Object.fromEntries(declineBuckets),
      programUnattributedDeclines: programUnattributed.length,
      unclassifiedSets,
      failLoud,
      provenance,
      primaryContactCaption:
        'Request Primary Contact (copy) = the Primary Contact recorded on the '
        + 'Request itself — NOT the PI/scientific lead (the PI is the Project '
        + 'Leader column, wmkf_projectleader). For Research programs the '
        + 'Liaison of record is the applicant institution\'s Primary Contact, '
        + 'which this copy may no longer match.',
      sentinels: SENTINEL,
    },
  };
}

// ── piece functions ──────────────────────────────────────────────────────

function isPresentMoneyOrDate(row, f) {
  if (f === 'akoya_decisiondate') return row[f] != null && row[f] !== '';
  const base = row[baseAmountField(f)];
  return typeof base === 'number' || (row[f] != null && row[f] !== '');
}

function bLifecycleCaption(statusClass) {
  if (statusClass === STATUS_CLASS.IN_FLIGHT) return SENTINEL.NOT_YET_DECIDED;
  if (statusClass === STATUS_CLASS.DECIDED_NO_AWARD) return SENTINEL.DECIDED_NO_AWARD;
  // Withdrawn is terminal + no award (path-agnostic). An absent grant is NOT
  // "UNKNOWN — not captured" (that implies an award might have existed) —
  // it is the withdrawn no-award sentinel, no actor attributed (Codex S160).
  if (statusClass === STATUS_CLASS.WITHDRAWN) return SENTINEL.WITHDRAWN_NO_AWARD;
  // DECIDED_AWARD / UNCLASSIFIED with a genuinely absent value:
  return SENTINEL.AMOUNT_UNKNOWN_NOT_CAPTURED;
}

function bStructuralSentinel(row, f, era, sc) {
  // Only sentinel when the field is not a trustworthy real amount.
  const base = row[baseAmountField(f)];
  const hasRaw = typeof base === 'number' || (row[f] != null && row[f] !== '');
  if (era === ERA.MIGRATED) return SENTINEL.STRUCT_MIGRATION_BACKFILL; // never real
  if (!hasRaw) {
    const reqType = row._wmkf_request_type_value_formatted
      || row.wmkf_request_type_formatted || '';
    if (/concept|visit|phone/i.test(String(reqType))) return SENTINEL.STRUCT_FEEDBACK_REQUEST;
    if (sc && sc.class === STATUS_CLASS.DECIDED_AWARD) return SENTINEL.STRUCT_INVITED_DISCRETIONARY;
    return SENTINEL.AMOUNT_UNKNOWN_NOT_CAPTURED;
  }
  return null; // native + real value — keep it
}

function classifyDecline(row, era, sc, ann, programName, programGuid) {
  const declined = sc && sc.class === STATUS_CLASS.DECIDED_NO_AWARD;
  if (!declined) return { bucket: DECLINE_BUCKET.NOT_DECLINED };

  // Native declined with a NULL program — own fail-loud bucket.
  if (era === ERA.NATIVE && programGuid == null && programName == null) {
    return { bucket: DECLINE_BUCKET.PROGRAM_UNATTRIBUTED,
      detail: 'native declined, akoya_programid null — cannot route to any '
        + 'program-scoped decline view' };
  }

  // Unannotated program on this process-dependent path ⇒ its OWN distinct
  // fail-loud bucket (NOT folded into reason-missing — Codex S160; §9).
  if (ann == null || !ann.decline_segment) {
    return { bucket: DECLINE_BUCKET.UNCLASSIFIED_PROCESS,
      unannotatedProgram: true,
      detail: SENTINEL.PI_UNCLASSIFIED_PROCESS };
  }

  // Era-aware field selection (+ SoCal third field).
  let value = null;
  let source = null;
  if (era === ERA.MIGRATED) {
    value = row[`${DECLINE_FIELDS.migratedReason}_formatted`] ?? row[DECLINE_FIELDS.migratedReason];
    source = DECLINE_FIELDS.migratedReason;
  } else {
    value = row[DECLINE_FIELDS.nativeNotes];
    source = DECLINE_FIELDS.nativeNotes;
    if (!value && ann.socal_area === true) {
      value = row[`${DECLINE_FIELDS.socalThird}_formatted`] ?? row[DECLINE_FIELDS.socalThird];
      source = DECLINE_FIELDS.socalThird;
    }
  }

  if (value != null && String(value).trim() !== '') {
    return { bucket: DECLINE_BUCKET.WITH_REASON, source, value: String(value) };
  }
  // Triage declines (Proposal Not Invited / *Ineligible) expect no reason.
  if (DECLINE_TRIAGE_STATUSES.includes(String(row.akoya_requeststatus))) {
    return { bucket: DECLINE_BUCKET.TRIAGE, source,
      detail: 'no reason expected for this terminal triage status' };
  }
  return { bucket: DECLINE_BUCKET.REASON_MISSING, source,
    detail: 'declined but no decline reason captured (should exist)' };
}

function resolveInstitution(row, keyRawNames) {
  const appl = account(row, 'applicant');
  const ak = institutionKey(appl);
  if (!ak.key) {
    return { resolved: SENTINEL.INST_UNRESOLVED, resolution: INST_RESOLUTION.UNRESOLVED };
  }
  // Applicant vs payee merge.
  const payeeId = lookupId(row, 'akoya_payee');
  if (payeeId != null) {
    const pk = institutionKey(account(row, 'payee'));
    if (pk.key && pk.key !== ak.key) {
      return { resolved: ak.key, resolution: INST_RESOLUTION.PAYEE_DIFFERS };
    }
  }
  // Collision transparency — ≥2 DISTINCT raw account names share a key
  // (NOT row count). NEVER fuzzy-merged across distinct keys (v1
  // deterministic exact-key only).
  const distinct = keyRawNames.get(ak.key);
  if (distinct && distinct.size >= 2) {
    return {
      resolved: ak.key,
      resolution: INST_RESOLUTION.VARIANTS_SHARE_KEY.replace(
        'N', String(distinct.size)),
    };
  }
  return { resolved: ak.key, resolution: INST_RESOLUTION.RESOLVED };
}

// Program roll-up — Option B. A program's grant TOTAL = wmkf_type="Program"
// rows ONLY; non-Program giving modes report as their OWN separate lines,
// never folded in. Emits the mandatory per-program in/out breakdown.
function computeOptionBRollup(rows) {
  const byProgram = new Map(); // program → { program:Map<typeLabel,$> }
  for (const r of rows) {
    const prog = lookupName(r, 'akoya_programid') || PROGRAM_UNATTRIBUTED_LABEL;
    const typeLabel = lookupName(r, 'wmkf_type') || r.wmkf_type_formatted || '(no type)';
    const amt = typeof r.akoya_grant_base === 'number'
      ? r.akoya_grant_base
      : (typeof r.akoya_grant === 'number' ? r.akoya_grant : 0);
    if (!byProgram.has(prog)) byProgram.set(prog, new Map());
    const t = byProgram.get(prog);
    t.set(typeLabel, (t.get(typeLabel) || 0) + amt);
  }
  const lines = [];
  for (const [prog, types] of byProgram) {
    const programTotal = types.get('Program') || 0;
    const excludes = [...types.entries()]
      .filter(([t]) => t !== 'Program')
      .map(([t, v]) => `${t} ${fmtUSD(v)}`);
    lines.push({
      program: prog,
      programTotal,
      line: `${prog} — Program ${fmtUSD(programTotal)}`
        + (excludes.length
          ? ` [excludes: ${excludes.join(', ')} — reported separately]`
          : ''),
    });
  }
  return { rule: 'optionB', lines };
}

function fmtUSD(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

export {
  annotate,
  normalizeInstitution,
  institutionKey,
  classifyDecline,
  computeOptionBRollup,
  SENTINEL,
  INST_RESOLUTION,
  DECLINE_BUCKET,
};
