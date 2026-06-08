const { OpenAlexService } = require('./openalex-service');
const { resolveIdentity } = require('./reviewer-identity-resolver');
const { buildIdentityNote } = require('./reviewer-identity-evidence');
const { ContactParser } = require('../utils/contact-parser');

const RESOLVER_VERSION = 'reviewerWorkAuthorResolver@1.0.0';

function normalizeOrcid(orcid) {
  if (!orcid) return null;
  const value = String(orcid).trim().replace(/^https?:\/\/orcid\.org\//i, '');
  const compact = value.replace(/-/g, '').toUpperCase();
  if (!/^\d{15}[\dX]$/.test(compact)) return null;
  let total = 0;
  for (let i = 0; i < 15; i += 1) {
    total = (total + Number(compact[i])) * 2;
  }
  const remainder = total % 11;
  const check = (12 - remainder) % 11;
  const expected = check === 10 ? 'X' : String(check);
  if (compact[15] !== expected) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8, 12)}-${compact.slice(12)}`;
}

function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeName(name) {
  return ContactParser.normalizeNameForMatch(ContactParser.stripHonorifics(name || ''));
}

function namesMatch(left, right) {
  const a = normalizeName(left);
  const b = normalizeName(right);
  return !!a && !!b && ContactParser.namesMatch(a, b);
}

function firstPublication(candidate = {}) {
  return Array.isArray(candidate.publications) ? candidate.publications.find(Boolean) || null : null;
}

function workMatchesTitle(work, title) {
  if (!title) return true;
  return normalizeTitle(work?.title) === normalizeTitle(title);
}

function anchor(type, weight, value, parserOutput = {}) {
  return {
    type,
    weight,
    value: value || null,
    canonicalKey: value ? `${type}:${value}` : null,
    parserOutput,
    verifier: RESOLVER_VERSION,
    verdict: 'pass',
  };
}

function abstain(reason, sources = {}) {
  const identity = resolveIdentity({}, {
    identityAnchors: [],
    spine: { abstainReason: reason },
  });
  return {
    status: 'abstain',
    resolverStatus: identity.status,
    reason,
    sources,
    work: null,
    author: null,
    openAlexAuthorId: null,
    orcid: null,
    institution: null,
    topics: [],
    anchors: [],
    identity,
    identityNote: buildIdentityNote(identity.status, [], null, null),
  };
}

class ReviewerWorkAuthorResolver {
  static async resolveCandidate(candidate = {}, { signal } = {}) {
    const publication = firstPublication(candidate);
    if (!publication) return abstain('no_publication');

    let workResult;
    try {
      workResult = await this.resolveWork(publication, { signal });
    } catch (err) {
      return abstain(err?.name === 'AbortError' ? 'source_timeout' : 'source_outage', { openalex: 'error' });
    }

    if (!workResult.work) {
      return abstain(workResult.reason || 'work_unresolved', { openalex: 'ok' });
    }

    const matches = (workResult.work.authorships || [])
      .filter((authorship) => namesMatch(authorship.displayName, candidate.name));

    if (matches.length !== 1) {
      return abstain(matches.length > 1 ? 'ambiguous_author_match' : 'no_author_match', { openalex: 'ok' });
    }

    const author = matches[0];
    const anchors = [
      anchor('authorship_grounded', 'strong', author.openAlexAuthorId || author.displayName, {
        workId: workResult.work.openAlexId,
        workTitle: workResult.work.title,
        authorName: author.displayName,
      }),
    ];
    if (author.topics?.length) {
      anchors.push(anchor('topic_match', 'weak', workResult.work.openAlexId, {
        topics: author.topics,
      }));
    }
    if (author.orcid) {
      anchors.push(anchor('orcid_present', 'weak', author.orcid, {
        source: 'openalex_authorship',
      }));
    }

    const identity = resolveIdentity(
      { name: candidate.name, claimedInstitution: candidate.affiliation || author.institution || null },
      { identityAnchors: anchors, spine: { authorshipGrounded: true } },
    );

    return {
      status: identity.status,
      resolverStatus: identity.status,
      reason: identity.evidenceSummary,
      sources: { openalex: 'ok', orcid: author.orcid ? 'ok' : 'not_run' },
      work: workResult.work,
      author,
      openAlexAuthorId: author.openAlexAuthorId,
      orcid: author.orcid,
      institution: author.institution,
      topics: author.topics || [],
      anchors,
      identity,
      identityNote: buildIdentityNote(identity.status, anchors, {
        lastKnownInstitution: author.institution,
      }, author.orcid),
    };
  }

  static async resolveWork(publication = {}, { signal } = {}) {
    const title = publication.title || null;
    const lookups = [
      publication.doi ? ['doi', publication.doi] : null,
      publication.pmid ? ['pmid', publication.pmid] : null,
      publication.arxivId ? ['arxiv', publication.arxivId] : null,
    ].filter(Boolean);

    for (const [kind, value] of lookups) {
      const result = await OpenAlexService.getWorkByExternalId(kind, value, { signal });
      const records = result.records || [];
      // An external id (DOI / PMID / arXiv-DOI) uniquely identifies the work — trust it
      // and do NOT require an exact title match here. arXiv/preprint titles drift from
      // OpenAlex's (LaTeX, subtitles, casing), so a title gate on an id lookup would
      // discard a valid hit and over-abstain. Title equality stays on the search fallback.
      if (records.length === 1) return { work: records[0], reason: null, method: kind };
      // A supposedly-unique id returning multiple works: disambiguate by title if we can,
      // otherwise treat as a collision and move on.
      if (records.length > 1) {
        const byTitle = title ? records.filter((work) => workMatchesTitle(work, title)) : [];
        if (byTitle.length === 1) return { work: byTitle[0], reason: null, method: kind };
        return { work: null, reason: `${kind}_collision`, method: kind };
      }
    }

    if (!title) return { work: null, reason: 'no_work_identifier', method: null };

    const titleResult = await OpenAlexService.getWorkByTitle(title, { signal, limit: 5 });
    const exact = (titleResult.records || []).filter((work) => workMatchesTitle(work, title));
    if (exact.length === 1) return { work: exact[0], reason: null, method: 'title' };
    if (exact.length > 1) return { work: null, reason: 'title_collision', method: 'title' };
    return { work: null, reason: 'work_not_found', method: 'title' };
  }

  static normalizeOrcid = normalizeOrcid;
}

module.exports = {
  ReviewerWorkAuthorResolver,
  normalizeOrcid,
};
