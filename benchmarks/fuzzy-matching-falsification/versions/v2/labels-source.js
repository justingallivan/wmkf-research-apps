'use strict';

// Canonical labels for the institution-only v2 overlay. The human-readable
// v1 cases remain frozen; this file supplies the ROR identifiers needed to
// judge the same cases without exact display-name coupling.
const ROR_ID_BY_EXPECTED_NAME = Object.freeze({
  'Broad Institute': 'https://ror.org/05a0ya142',
  'California State University, Los Angeles': 'https://ror.org/0294hxs80',
  'Dana-Farber Cancer Institute': 'https://ror.org/02jzgtq86',
  'Harvard University': 'https://ror.org/03vek6s52',
  'Lawrence Berkeley National Laboratory': 'https://ror.org/02jbv0t02',
  'Massachusetts Institute of Technology': 'https://ror.org/042nb2s44',
  'San Diego State University': 'https://ror.org/0264fdx42',
  'Touro University California': 'https://ror.org/0556gk990',
  'UC San Diego Health': 'https://ror.org/01kbfgm16',
  'University of California': 'https://ror.org/00pjdza24',
  'University of California, Berkeley': 'https://ror.org/01an7q238',
  'University of California, Davis': 'https://ror.org/05rrcem69',
  'University of California, Irvine': 'https://ror.org/04gyf1771',
  'University of California, Los Angeles': 'https://ror.org/046rm7j60',
  'University of California, Merced': 'https://ror.org/00d9ah105',
  'University of California, Riverside': 'https://ror.org/03nawhv43',
  'University of California, San Diego': 'https://ror.org/0168r3w48',
  'University of California, San Francisco': 'https://ror.org/043mz5j54',
  'University of California, Santa Barbara': 'https://ror.org/02t274463',
  'University of California, Santa Cruz': 'https://ror.org/03s65by71',
  'University of Southern California': 'https://ror.org/03taz7m60',
});

const PAIR_LABELS = Object.freeze({
  'inst-byline-001': pair('https://ror.org/05dq2gs74', 'https://ror.org/05dq2gs74', 'same'),
  'inst-byline-002': pair('https://ror.org/00hj8s172', 'https://ror.org/00hj8s172', 'same'),
  'inst-byline-003': pair('https://ror.org/04tj63d06', 'https://ror.org/04tj63d06', 'same'),
  'inst-byline-004': pair('https://ror.org/04tj63d06', 'https://ror.org/04tj63d06', 'same'),
  'inst-byline-005': pair('https://ror.org/01f5ytq51', 'https://ror.org/01f5ytq51', 'same'),
  'inst-byline-006': pair('https://ror.org/01f5ytq51', 'https://ror.org/01f5ytq51', 'same'),
  'inst-byline-007': pair('https://ror.org/0168r3w48', 'https://ror.org/0168r3w48', 'same'),
  'inst-byline-008': pair('https://ror.org/0168r3w48', 'https://ror.org/0168r3w48', 'same'),
  'inst-byline-009': pair('https://ror.org/00hj8s172', 'https://ror.org/00hj8s172', 'same'),
  'inst-byline-010': pair('https://ror.org/04tj63d06', 'https://ror.org/04tj63d06', 'same'),
  'inst-byline-011': pair('https://ror.org/05dq2gs74', 'https://ror.org/05dq2gs74', 'same'),
  'inst-byline-012': pair('https://ror.org/01f5ytq51', 'https://ror.org/000e0be47', 'distinct'),
  'inst-byline-013': pair('https://ror.org/05dq2gs74', 'https://ror.org/02vm5rt34', 'related'),
  'inst-byline-014': pair('https://ror.org/00hj8s172', 'https://ror.org/01esghr10', 'related'),
  'inst-hier-001': pair('https://ror.org/03vek6s52', 'https://ror.org/02jzgtq86', 'related'),
  'inst-hier-002': pair(
    'https://ror.org/03vek6s52',
    'https://ror.org/03vek6s52',
    'predecessor',
    'https://ror.org/03wevmz92'
  ),
  'inst-hier-007': pair('https://ror.org/02vm5rt34', 'https://ror.org/05dq2gs74', 'related'),
});

function pair(listedRorId, evidenceCanonicalRorId, relationship, evidenceSourceRorId = evidenceCanonicalRorId) {
  return Object.freeze({
    listed_ror_id: listedRorId,
    evidence_source_ror_id: evidenceSourceRorId,
    evidence_canonical_ror_id: evidenceCanonicalRorId,
    expected_relationship: relationship,
  });
}

module.exports = { PAIR_LABELS, ROR_ID_BY_EXPECTED_NAME };
