const {
  PROVENANCE_KINDS,
  SEED_ROLES,
  withReviewerProvenance,
} = require('./reviewer-provenance');
const { normalizeReviewerName } = require('./reviewer-name-match');

const MAX_SEEDS = 50;
const MAX_NAME = 180;
const MAX_EMAIL = 254;
const MAX_AFFILIATION = 500;
const MAX_URL = 500;
const MAX_REFERRER = 180;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const URL_RE = /https?:\/\/[^\s,;|]+/i;

function cleanString(value, max) {
  if (value === undefined || value === null) return '';
  return String(value).trim().replace(/\s+/g, ' ').slice(0, max);
}

function cleanEmail(value) {
  const email = cleanString(value, MAX_EMAIL).toLowerCase();
  return EMAIL_RE.test(email) ? email : '';
}

function cleanUrl(value) {
  const url = cleanString(value, MAX_URL);
  return URL_RE.test(url) ? url : '';
}

function parseLine(line, referredBy) {
  let text = String(line || '').trim();
  if (!text) return null;

  const emailMatch = text.match(EMAIL_RE);
  const email = emailMatch ? cleanEmail(emailMatch[0]) : '';
  if (emailMatch) text = text.replace(emailMatch[0], ' ');

  const urlMatch = text.match(URL_RE);
  const url = urlMatch ? cleanUrl(urlMatch[0]) : '';
  if (urlMatch) text = text.replace(urlMatch[0], ' ');

  const parts = text
    .split(/[|;\t]/)
    .flatMap((part) => part.split(','))
    .map((part) => cleanString(part, MAX_AFFILIATION))
    .filter(Boolean);
  const name = cleanString(parts.shift() || text, MAX_NAME);
  if (!name) return null;
  const affiliation = cleanString(parts.join(', '), MAX_AFFILIATION);
  const out = { name };
  if (email) out.email = email;
  if (affiliation) out.affiliation = affiliation;
  if (url) out.url = url;
  const referrer = cleanString(referredBy, MAX_REFERRER);
  if (referrer) out.referredBy = referrer;
  return out;
}

function parseReferredSeeds(text, referredBy = '') {
  const seen = new Set();
  const seeds = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (seeds.length >= MAX_SEEDS) break;
    const seed = parseLine(line, referredBy);
    if (!seed) continue;
    const key = `${normalizeReviewerName(seed.name)}|${seed.email || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    seeds.push(seed);
  }
  return seeds;
}

function sanitizeReferredSeeds(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const seeds = [];
  for (const raw of input) {
    if (seeds.length >= MAX_SEEDS) break;
    if (!raw || typeof raw !== 'object') continue;
    const name = cleanString(raw.name, MAX_NAME);
    if (!name) continue;
    const email = cleanEmail(raw.email);
    const affiliation = cleanString(raw.affiliation, MAX_AFFILIATION);
    const url = cleanUrl(raw.url || raw.website);
    const referredBy = cleanString(raw.referredBy, MAX_REFERRER);
    const key = `${normalizeReviewerName(name)}|${email}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const seed = { name };
    if (email) seed.email = email;
    if (affiliation) seed.affiliation = affiliation;
    if (url) seed.url = url;
    if (referredBy) seed.referredBy = referredBy;
    seeds.push(seed);
  }
  return seeds;
}

function buildReferredSeedCandidate(seed, lookupResult = null) {
  const confident = lookupResult?.outcome === 'confident' ? lookupResult.match || {} : null;
  const context = confident?.context || {};
  const candidate = {
    name: seed.name,
    email: seed.email || context.email || null,
    affiliation: seed.affiliation || context.affiliation || null,
    website: seed.url || null,
    source: 'referred',
    sources: ['referred'],
    referredBy: seed.referredBy || null,
    reasoning: seed.referredBy
      ? `Referred by ${seed.referredBy}.`
      : 'Externally referred by staff.',
    provenance: {
      kind: PROVENANCE_KINDS.REFERRED,
      seedRole: SEED_ROLES.REFERRED_BY,
      sources: [],
      groundingWorkIds: [],
      ...(seed.referredBy ? { referredBy: seed.referredBy } : {}),
    },
    isReferredSeed: true,
  };

  if (confident && (confident.matchKey === 'email' || confident.matchKey === 'orcid')) {
    candidate.seedResolvedPotentialReviewerId = confident.reviewerId || null;
    candidate.seedResolvedContactId = confident.contactId || null;
    candidate.seedIdentityMatchKey = confident.matchKey;
    candidate.seedIdentityNameConsistent = confident.nameConsistent !== false;
    candidate.identityStatus = 'confirmed';
    candidate.verificationStatus = 'verified';
    candidate.verified = true;
  } else {
    candidate.identityStatus = 'unresolved';
    candidate.verificationStatus = 'unresolved';
    candidate.needsIdentification = true;
  }

  return withReviewerProvenance(candidate);
}

function blockReferredSeed(seed, reason, detail = null) {
  return {
    name: seed?.name || null,
    email: seed?.email || null,
    referredBy: seed?.referredBy || null,
    reason,
    detail,
  };
}

module.exports = {
  MAX_SEEDS,
  parseReferredSeeds,
  sanitizeReferredSeeds,
  buildReferredSeedCandidate,
  blockReferredSeed,
};
