/**
 * Pure, code-owned provider JSON Schema for recommendations compiler 2.
 * Input: the complete frozen roster context; revalidated before deriving enums.
 * Output: direct recommendations, never persistence/checkpoint wrappers.
 * No I/O. This narrows generation, not authorization: the domain validator still
 * enforces identity, length, lead distinctness and all retained-result rules.
 * Local size limits are conservative guards, not provider acceptance guarantees.
 */
import { rebuildRecommendationsRosterBlock } from './recommendations-contract';
import { rosterMatchSchema } from './roster-match-validation';

const MAX_ENUM_ENTRIES = 512;
const MAX_SCHEMA_BYTES = 64 * 1024;

const object = properties => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});
const text = description => ({ type: 'string', description });
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const rationale = () => text('One short sentence explaining the relevant expertise.');
const identity = ids => ({ type: 'string', enum: [...ids] });

/**
 * Empty optional categories are omitted, not represented by an empty enum or
 * unsupported maxItems:0. Existing postvalidation supplies their empty arrays.
 * All text is generic; names, expertise and private roster values never enter
 * schema descriptions. Only GUIDs already present in the visible roster do.
 */
export function buildRecommendationsOutputSchema({ snapshot, rosterBlock } = {}) {
  const rebuilt = rebuildRecommendationsRosterBlock(snapshot);
  if (typeof rosterBlock !== 'string' || rebuilt !== rosterBlock) {
    throw Object.assign(new Error('The visible roster differs from the frozen roster.'), {
      code: 'expertise_roster_snapshot_invalid',
    });
  }
  const idsFor = category => snapshot.rows
    .filter(row => category === null || row.role_type === category)
    .map(row => row.profile_guid).sort();
  const leads = [...snapshot.leadGuids].sort();
  const staff = idsFor('Research Program Staff');
  const consultants = idsFor('Consultant');
  const board = idsFor('Board');
  const visible = idsFor(null);
  const relevance = [...rosterMatchSchema.fields.consultant_overlap.of.fields.relevance.enum];
  const enumEntries = 2 * leads.length + staff.length + consultants.length + board.length
    + visible.length + (consultants.length ? relevance.length : 0);
  if (enumEntries > MAX_ENUM_ENTRIES) throw tooLarge();

  const lead = () => leads.length
    ? nullable(object({ profile_guid: identity(leads), rationale: rationale() }))
    : { type: 'null' };
  const properties = {
    proposal_summary: object({}),
    staff_assignment: object({ primary: lead(), secondary: lead() }),
  };
  const addArray = (key, ids, fields) => {
    if (ids.length) {
      properties[key] = {
        type: 'array',
        description: 'Include only the most relevant eligible people; an empty array is allowed.',
        items: object({ profile_guid: identity(ids), ...fields }),
      };
    }
  };
  addArray('staff_consultation', staff, { rationale: rationale() });
  addArray('consultant_overlap', consultants, {
    relevance: { type: 'string', enum: relevance }, rationale: rationale(),
  });
  addArray('board_interest', board, {
    rationale: rationale(), note: text('One short note about Board interest.'),
  });
  properties.expertise_gaps = object({
    has_gaps: { type: 'boolean' },
    description: nullable(text('Briefly describe material expertise gaps; use null when there are none.')),
  });
  addArray('conflicts', visible, {
    reason: text('One short sentence explaining the conflict for this roster member.'),
  });
  const schema = object(properties);
  if (Buffer.byteLength(JSON.stringify(schema)) > MAX_SCHEMA_BYTES) throw tooLarge();
  return schema;
}

function tooLarge() {
  return Object.assign(new Error('Recommendations generation schema exceeds its local size limit.'), {
    code: 'expertise_generation_schema_too_large',
  });
}
