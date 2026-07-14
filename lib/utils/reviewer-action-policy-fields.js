/**
 * Raw Wave 13 fields required by the pure reviewer action-policy contract.
 * Shared by the contract and its inert specialized Dataverse projections so a
 * policy input cannot silently outgrow the fields its readers fetch.
 */

import { IDENTITY_LINEAGE_FIELDS } from './reviewer-identity-fields.js';

export const REVIEWER_ACTION_POLICY_PERSON_FIELDS = Object.freeze([
  'wmkf_identitybindingversion',
  'wmkf_identitybindingsource',
  'wmkf_identitybindinganchor',
  'wmkf_identityboundat',
  'wmkf_identityderivedbindingversion',
  'wmkf_identityfieldlineagejson',
  ...IDENTITY_LINEAGE_FIELDS,
]);

export const REVIEWER_ACTION_POLICY_SUGGESTION_FIELDS = Object.freeze([
  'wmkf_identitycoistatus',
  'wmkf_identitycoibindingversion',
  'wmkf_identitycoicontexthash',
  'wmkf_identitycoicheckedat',
]);
