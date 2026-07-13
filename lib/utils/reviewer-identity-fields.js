/**
 * Identity-bearing reviewer fields whose values require durable lineage.
 *
 * CommonJS keeps this literal authority usable by the legacy resolver and the
 * ESM binding contract without maintaining two independently editable lists.
 */

const IDENTITY_LINEAGE_FIELDS = Object.freeze([
  'wmkf_googlescholarid',
  'wmkf_googlescholarurl',
  'wmkf_hindex',
  'wmkf_i10index',
  'wmkf_totalcitations',
  'wmkf_orcid',
  'wmkf_orcidurl',
]);

module.exports = { IDENTITY_LINEAGE_FIELDS };
