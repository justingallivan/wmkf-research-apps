'use strict';

/**
 * Curated locality evidence for registry records whose ROR city is broader
 * than a published campus mailing locality. Every alias is scoped to one ROR
 * id and carries an authoritative source. It is decision evidence, never a
 * retrieval-query rewrite.
 */
const LOCALITY_EVIDENCE = Object.freeze({
  'https://ror.org/0168r3w48': Object.freeze({
    aliases: Object.freeze(['La Jolla']),
    sources: Object.freeze([
      'https://blink.ucsd.edu/technology/help-desk/directory/address.html',
    ]),
  }),
});

function localityAliases(candidate) {
  return LOCALITY_EVIDENCE[candidate?.ror_id]?.aliases || [];
}

module.exports = { LOCALITY_EVIDENCE, localityAliases };
