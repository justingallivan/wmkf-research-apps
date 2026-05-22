/**
 * Maps a validated Phase II Research 2026-06 submission to Dynamics
 * write operations.
 *
 * Returns:
 *   {
 *     akoyaRequestPatch: { ... },        // flat OData PATCH body for akoya_request
 *     sharepointUploads: [...],          // attachments to write to SharePoint
 *     relatedEntityWrites: [...],        // child-row writes (budget lines, milestones, etc.)
 *     unmapped: [...],                   // schema keys with no Dynamics target yet
 *   }
 *
 * Three target categories:
 *
 * `TODO_ASK_CONNOR_*` markers fall into two distinct blocker categories
 * (do not conflate; future editors decide what to ask Connor based on which):
 *
 *   - `blockedOn: 'item-6'` — field choice is settled but the WRITER (drain vs.
 *     PA flow vs. rollup) is gated on the unresolved Item 6 decision from the
 *     2026-05-14 schema review. Document: `docs/BUDGET_FORM_SPEC.md` v3 status block.
 *   - No `blockedOn` set — field/entity target itself still needs Connor's design
 *     input. These move when Connor surfaces the right home, independent of Item 6.
 *
 *   1. CONFIRMED — matched to a real `akoya_request` field that exists
 *      in production (verified in lib/services/dynamics-service.js call
 *      sites and other API routes). Safe to PATCH on submit.
 *
 *   2. NEEDS CONNOR — schema field is sensible but the destination is
 *      not yet decided. Could be a new `wmkf_*` column on akoya_request,
 *      a separate child entity, or a SharePoint artifact. Tracked in the
 *      `unmapped` array so the Connor sync agenda has a concrete list.
 *
 *   3. STRUCTURED CHILD ROWS (budget_lines, co_investigators, milestones,
 *      prior_support_rows) — almost certainly belong in dedicated child
 *      entities, not as JSON on akoya_request. Stubbed in
 *      `relatedEntityWrites` with placeholder entity sets that Connor
 *      will rename.
 *
 * This mapper does NOT execute writes. It produces a plan. The submit
 * endpoint feeds the plan into DynamicsService + GraphService.
 */

const schema = require('./schema');

// ---------------------------------------------------------------------
// Field mappings — single source of truth for "where does this go?"
// ---------------------------------------------------------------------

/**
 * Direct schema-key → akoya_request OData field mappings.
 * `transform` is optional; when present, it gets the raw value and
 * returns the value to write (or undefined to skip).
 */
const AKOYA_REQUEST_DIRECT_MAP = {
  // CONFIRMED — verified against existing API routes.
  project_title: { field: 'akoya_title' },
  project_abstract: { field: 'wmkf_abstract' },
  project_start_date: { field: 'akoya_begindate' },

  // NEEDS CONNOR — verify field name + whether duration is stored or
  // derived from begindate + enddate.
  project_duration_months: {
    field: 'TODO_ASK_CONNOR_durationmonths',
    needsConnor: true,
    note: 'Either a real wmkf_* numeric field, or derive akoya_enddate = begindate + N months client-side.',
  },

  // NEEDS CONNOR — narrative fields. These do not exist on akoya_request
  // today (Phase II content has historically lived in attached PDFs).
  // Decision: dedicated wmkf_* longtext columns, OR a child entity
  // (wmkf_phase_ii_narrative) with one row per request, OR keep them
  // attachment-only. Recommend dedicated columns so downstream AI tools
  // see the text without re-parsing PDFs.
  specific_aims:      { field: 'TODO_ASK_CONNOR_specificaims',     needsConnor: true },
  significance:       { field: 'TODO_ASK_CONNOR_significance',     needsConnor: true },
  innovation:         { field: 'TODO_ASK_CONNOR_innovation',       needsConnor: true },
  approach:           { field: 'TODO_ASK_CONNOR_approach',         needsConnor: true },
  risks_alternatives: { field: 'TODO_ASK_CONNOR_risksalternatives', needsConnor: true },
  broader_impact:     { field: 'TODO_ASK_CONNOR_broaderimpact',    needsConnor: true },

  // CONFIRMED — pre-filled from Phase I; portal generally writes these
  // back unchanged. PI is a lookup → contact, so it gets resolved by the
  // submit endpoint (mapper just records the intent).
  pi_name: {
    field: 'wmkf_projectleader@odata.bind',
    needsConnor: true,
    note: 'pi_name is a string in the form; the submit endpoint must resolve it to a contact GUID before PATCH. Mapper records intent only.',
  },
  pi_email: {
    field: 'TODO_ASK_CONNOR_piemail',
    needsConnor: true,
    note: 'Likely already on the contact via emailaddress1; may not need a separate akoya_request field.',
  },
  pi_orcid: {
    field: 'TODO_ASK_CONNOR_piorcid',
    needsConnor: true,
    note: 'Probably belongs on contact, not akoya_request.',
  },

  // BLOCKED ON Item 6 (drain-vs-PA aggregate write conflict). Live-probe
  // 2026-05-14 settled the FIELD as existing akoya_request.akoya_request
  // (Money, "Requested Amount"); WRITER is gated on Item 6 resolution.
  // See docs/BUDGET_FORM_SPEC.md v3 status block.
  total_request_usd: { field: 'TODO_ITEM_6_totalrequestusd', needsConnor: true, blockedOn: 'item-6' },

  // NEEDS CONNOR — compliance flags.
  human_subjects:     { field: 'TODO_ASK_CONNOR_humansubjects',    needsConnor: true },
  vertebrate_animals: { field: 'TODO_ASK_CONNOR_vertebrateanimals', needsConnor: true },
  biohazards:         { field: 'TODO_ASK_CONNOR_biohazards',       needsConnor: true },
  compliance_note:    { field: 'TODO_ASK_CONNOR_compliancenote',   needsConnor: true },
};

/**
 * Schema keys that map to structured child entities. Pilot entities
 * do NOT exist yet — Connor will name them. Recording the *intent*
 * here keeps the Connor sync concrete.
 */
const CHILD_ENTITY_MAP = {
  co_investigators: {
    // RESOLVED 2026-05-14: extends wmkf_apprequestperson junction (S139, 5,561 rows);
    // adds wmkf_effortpct/wmkf_biosketchurl/wmkf_lineorder + expanded wmkf_role enum
    // (PI / Co-PI / Senior Personnel / Key Personnel / Other). Mapper update blocked
    // on Item 6 only insofar as the parent-aggregate writers settle; entity choice locked.
    entitySet: 'wmkf_apprequestpersons',
    needsConnor: false,
    note: 'See docs/INTAKE_PORTAL_SCHEMA_CHANGES.md 2026-05-14 entry.',
  },
  budget_lines: {
    // RESOLVED 2026-05-14: new wmkf_proposalbudgetline entity, unified cost-share
    // via wmkf_category enum (WaivedIndirect / WaivedTuition / OtherCostShare added
    // to Personnel/Equipment/Supplies/Travel/Other Direct/Tuition/Indirect). Mapper
    // update blocked on Item 6 (writer for parent aggregates not yet decided).
    entitySet: 'wmkf_proposalbudgetlines',
    needsConnor: false,
    blockedOn: 'item-6',
    note: 'See docs/BUDGET_FORM_SPEC.md v3 + docs/INTAKE_PORTAL_SCHEMA_CHANGES.md 2026-05-14.',
  },
  milestones: {
    entitySet: 'TODO_ASK_CONNOR_milestones',
    needsConnor: true,
    note: 'Date + deliverable rows. Same shape question as budget_lines.',
  },
  prior_support_rows: {
    entitySet: 'TODO_ASK_CONNOR_priorsupport',
    needsConnor: true,
    note: 'Per-person grant inventory. Probably its own entity since rows reference Co-Is.',
  },
};

/**
 * Schema file fields that go to SharePoint, not Dynamics. Folder
 * follows the existing convention from EXTERNAL_REVIEWER_INTAKE_PLAN.md
 * for reviewer-facing files; applicant-source attachments use a sibling
 * directory.
 */
const SHAREPOINT_TARGETS = {
  budget_justification_attachment: { subfolder: 'Submission/Budget',     reviewerVisible: true  },
  pi_biosketch:                    { subfolder: 'Submission/Biosketches', reviewerVisible: true  },
  co_investigator_biosketches:     { subfolder: 'Submission/Biosketches', reviewerVisible: true  },
  letters_of_support:              { subfolder: 'Submission/Support',     reviewerVisible: true  },
  facilities_resources:            { subfolder: 'Submission/Facilities',  reviewerVisible: true  },
  data_management_plan:            { subfolder: 'Submission/DMP',         reviewerVisible: true  },
};

// ---------------------------------------------------------------------
// Mapping function
// ---------------------------------------------------------------------

function mapToDynamics(data, { requestId } = {}) {
  if (!data) throw new Error('mapToDynamics: data required');
  if (!requestId) throw new Error('mapToDynamics: requestId required');

  const akoyaRequestPatch = {};
  const sharepointUploads = [];
  const relatedEntityWrites = [];
  const unmapped = [];

  // submission audit timestamps -- always set
  akoyaRequestPatch.wmkf_phaseiisubmittedat = new Date().toISOString();
  // wmkf_phaseiisubmittedby is a contact lookup; submit endpoint sets
  // the @odata.bind once it has resolved the contact GUID.

  // status flip is the trigger -- submit endpoint sets it after the
  // patch lands cleanly.

  for (const section of schema.sections) {
    for (const field of section.fields) {
      const value = data[field.key];

      // structured tables -> child entity writes
      if (field.type === 'table') {
        if (Array.isArray(value) && value.length > 0) {
          const target = CHILD_ENTITY_MAP[field.key];
          relatedEntityWrites.push({
            schemaKey: field.key,
            entitySet: target?.entitySet ?? null,
            rows: value,
            parentRequestId: requestId,
            needsConnor: !!target?.needsConnor,
            note: target?.note,
          });
          if (target?.needsConnor) unmapped.push({ schemaKey: field.key, reason: 'child entity not yet decided', note: target.note });
        }
        continue;
      }

      // file fields -> SharePoint uploads
      if (field.type === 'file') {
        if (Array.isArray(value) && value.length > 0) {
          const target = SHAREPOINT_TARGETS[field.key];
          for (const fileRef of value) {
            sharepointUploads.push({
              schemaKey: field.key,
              subfolder: target?.subfolder ?? `Submission/Misc/${field.key}`,
              reviewerVisible: target?.reviewerVisible ?? false,
              fileRef,
            });
          }
        }
        continue;
      }

      // scalars -> akoya_request PATCH
      const mapping = AKOYA_REQUEST_DIRECT_MAP[field.key];
      if (!mapping) {
        unmapped.push({ schemaKey: field.key, reason: 'no mapping defined' });
        continue;
      }
      // `needsConnor: true` means the mapping is not yet executable —
      // either a TODO_ASK_CONNOR_* placeholder field name, or a real
      // field name (e.g. wmkf_projectleader@odata.bind) whose value
      // requires resolution the mapper does not perform (lookup -> GUID).
      // In both cases we surface the intent via `unmapped` and skip the
      // PATCH so an unresolved value cannot land on akoya_request.
      if (mapping.needsConnor) {
        unmapped.push({ schemaKey: field.key, reason: 'mapping placeholder', note: mapping.note, placeholder: mapping.field });
        continue;
      }
      const out = mapping.transform ? mapping.transform(value) : value;
      if (out === undefined) continue;
      akoyaRequestPatch[mapping.field] = out;
    }
  }

  return {
    akoyaRequestPatch,
    sharepointUploads,
    relatedEntityWrites,
    unmapped,
  };
}

module.exports = mapToDynamics;
module.exports.mapToDynamics = mapToDynamics;
module.exports.AKOYA_REQUEST_DIRECT_MAP = AKOYA_REQUEST_DIRECT_MAP;
module.exports.CHILD_ENTITY_MAP = CHILD_ENTITY_MAP;
module.exports.SHAREPOINT_TARGETS = SHAREPOINT_TARGETS;
