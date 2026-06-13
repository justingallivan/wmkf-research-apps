/**
 * LiteratureSearchService - Orchestrates academic database searches for Stage 0
 *
 * Searches PubMed, arXiv, bioRxiv, ChemRxiv, and OpenAlex in parallel, then returns
 * normalized results for LLM collation. (Slice 2 of the SerpAPI→free-stack migration
 * replaced the paid Google Scholar novelty + PI-publication searches with free OpenAlex
 * works lookups — see docs/REVIEWER_FINDER_SERPAPI_MIGRATION_PLAN.md.)
 */

const { PubMedService } = require('./pubmed-service');
const { ArXivService } = require('./arxiv-service');
const { BioRxivService } = require('./biorxiv-service');
const { ChemRxivService } = require('./chemrxiv-service');
const { OpenAlexService } = require('./openalex-service');

const MAX_RESULTS_PER_QUERY = 10;
const MAX_RESULTS_PER_DB = 20;
const OPENALEX_MAX_PER_QUERY = 5;
const RECENT_YEARS = 5;

export class LiteratureSearchService {

  /**
   * Run all searches in parallel based on extracted claim data.
   *
   * @param {Object} claimData - Output from claim extraction (Stage 0a)
   * @param {string[]} claimData.noveltySearchStrings
   * @param {string[]} claimData.techniqueSearchStrings
   * @param {string[]} claimData.piNames
   * @param {string} claimData.field
   * @returns {Promise<Object>} Raw search results from all databases
   */
  static async searchAll(claimData) {
    const allQueries = [
      ...claimData.noveltySearchStrings || [],
      ...claimData.techniqueSearchStrings || [],
    ].slice(0, 8); // Cap total queries to control API costs

    const piDetails = claimData.piDetails || claimData.piNames?.map(n => ({ name: n })) || [];

    const [pubmed, arxiv, biorxiv, chemrxiv, openAlex, piPubs] = await Promise.allSettled([
      this._searchPubMed(allQueries),
      this._searchArXiv(allQueries),
      this._searchBioRxiv(allQueries),
      this._searchChemRxiv(allQueries),
      this._searchOpenAlexWorks(claimData.noveltySearchStrings || []),
      this._searchPIPubs(piDetails, claimData.field),
    ]);

    return {
      pubmed: this._extractResult(pubmed),
      arxiv: this._extractResult(arxiv),
      biorxiv: this._extractResult(biorxiv),
      chemrxiv: this._extractResult(chemrxiv),
      openAlex: this._extractResult(openAlex),
      piPublications: this._extractResult(piPubs),
      searchQueries: allQueries,
      piNames: piDetails.map(p => p.name || p),
      piDetails,
      field: claimData.field,
    };
  }

  /**
   * Search PubMed across multiple queries, dedup by PMID
   */
  static async _searchPubMed(queries) {
    const seen = new Set();
    const results = [];

    for (const query of queries) {
      try {
        const articles = await PubMedService.search(query, MAX_RESULTS_PER_QUERY);
        for (const article of articles) {
          if (!seen.has(article.pmid)) {
            seen.add(article.pmid);
            results.push({
              source: 'pubmed',
              id: article.pmid,
              title: article.title,
              authors: article.authors?.map(a => a.name).join(', ') || '',
              journal: article.journal,
              year: article.year,
              doi: article.doi,
              abstract: article.abstract?.substring(0, 300) || '',
            });
          }
        }
      } catch (err) {
        console.warn(`[LiteratureSearch] PubMed query failed: "${query}" — ${err.message}`);
      }
    }
    return results.slice(0, MAX_RESULTS_PER_DB);
  }

  /**
   * Search arXiv across multiple queries, dedup by arXiv ID
   */
  static async _searchArXiv(queries) {
    const seen = new Set();
    const results = [];

    for (const query of queries) {
      try {
        const articles = await ArXivService.search(query, MAX_RESULTS_PER_QUERY);
        for (const article of articles) {
          if (!seen.has(article.arxivId)) {
            seen.add(article.arxivId);
            results.push({
              source: 'arxiv',
              id: article.arxivId,
              title: article.title,
              authors: article.authors?.join(', ') || '',
              year: article.year,
              categories: article.categories?.join(', ') || '',
              doi: article.doi,
              abstract: article.abstract?.substring(0, 300) || '',
            });
          }
        }
      } catch (err) {
        console.warn(`[LiteratureSearch] arXiv query failed: "${query}" — ${err.message}`);
      }
    }
    return results.slice(0, MAX_RESULTS_PER_DB);
  }

  /**
   * Search bioRxiv across multiple queries, dedup by DOI
   */
  static async _searchBioRxiv(queries) {
    const seen = new Set();
    const results = [];

    for (const query of queries) {
      try {
        const articles = await BioRxivService.search(query, MAX_RESULTS_PER_QUERY);
        for (const article of articles) {
          if (article.doi && !seen.has(article.doi)) {
            seen.add(article.doi);
            results.push({
              source: 'biorxiv',
              id: article.doi,
              title: article.title,
              authors: article.authors?.join(', ') || article.correspondingAuthor || '',
              year: article.year,
              category: article.category,
              abstract: article.abstract?.substring(0, 300) || '',
            });
          }
        }
      } catch (err) {
        console.warn(`[LiteratureSearch] bioRxiv query failed: "${query}" — ${err.message}`);
      }
    }
    return results.slice(0, MAX_RESULTS_PER_DB);
  }

  /**
   * Search ChemRxiv across multiple queries, dedup by DOI
   */
  static async _searchChemRxiv(queries) {
    const seen = new Set();
    const results = [];

    for (const query of queries) {
      try {
        const articles = await ChemRxivService.search(query, MAX_RESULTS_PER_QUERY);
        for (const article of articles) {
          if (article.doi && !seen.has(article.doi)) {
            seen.add(article.doi);
            results.push({
              source: 'chemrxiv',
              id: article.doi,
              title: article.title,
              authors: article.authors?.join(', ') || '',
              year: article.year,
              keywords: article.keywords,
              abstract: article.abstract?.substring(0, 300) || '',
            });
          }
        }
      } catch (err) {
        console.warn(`[LiteratureSearch] ChemRxiv query failed: "${query}" — ${err.message}`);
      }
    }
    return results.slice(0, MAX_RESULTS_PER_DB);
  }

  /**
   * Search OpenAlex works for novelty claims (Slice 2 — replaces SerpAPI google_scholar).
   * FREE; no key. Recency-filtered to the last RECENT_YEARS. The `source` label is
   * 'openalex' (honest provenance for the collation prompt + reviewer briefings).
   */
  static async _searchOpenAlexWorks(noveltyQueries) {
    const results = [];
    const yearFrom = new Date().getFullYear() - RECENT_YEARS;
    // Limit to top 4 novelty queries (parity with the prior cost cap; keeps latency bounded).
    for (const query of noveltyQueries.slice(0, 4)) {
      try {
        const { records } = await OpenAlexService.searchWorks(query, { yearFrom, limit: OPENALEX_MAX_PER_QUERY });
        for (const work of records) {
          results.push({
            source: 'openalex',
            title: work.title,
            authors: this._authorNames(work),
            snippet: work.abstract ? work.abstract.substring(0, 300) : '',
            year: work.year ? String(work.year) : '',
            citedBy: work.citedByCount || 0,
            url: work.url || '',
            searchQuery: query,
          });
        }
      } catch (err) {
        console.warn(`[LiteratureSearch] OpenAlex works query failed: "${query}" — ${err.message}`);
      }
    }
    return results;
  }

  /**
   * Search for PI publications via OpenAlex (Slice 2 — replaces SerpAPI google_scholar).
   * Resolves the PI to an OpenAlex author by name, preferring the candidate whose
   * last-known institution token-overlaps the supplied institution (disambiguates common
   * names, e.g. "Bo Li" at MIT vs Tsinghua), then fetches that author's recent works.
   * Best-effort context — the downstream collation prompt independently re-filters PI
   * publications by institution/field and excludes ambiguous attributions.
   */
  static async _searchPIPubs(piDetails, field) {
    if (!piDetails || piDetails.length === 0) return [];

    const results = [];
    const yearFrom = new Date().getFullYear() - RECENT_YEARS;
    for (const pi of piDetails.slice(0, 3)) {
      const piName = typeof pi === 'string' ? pi : pi.name;
      const institution = typeof pi === 'string' ? '' : (pi.institution || '');
      if (!piName) continue;

      try {
        const { records: authors } = await OpenAlexService.searchAuthors(piName, { limit: 5 });
        const author = this._pickAuthorForPI(authors, institution);
        if (!author?.openAlexId) {
          results.push({ piName, institution, publications: [] });
          continue;
        }

        const { records: works } = await OpenAlexService.getWorksByAuthor(author.openAlexId, { yearFrom, limit: 15 });
        results.push({
          piName,
          institution,
          // The OpenAlex author actually selected — surfaced so the collation prompt can
          // cross-check institution and reject a wrong-namesake attribution (Codex S251 LOW;
          // matters when the supplied institution is an acronym that couldn't token-match).
          resolvedInstitution: author.lastKnownInstitution || null,
          publications: works.map((w) => ({
            title: w.title,
            year: w.year ? String(w.year) : '',
            snippet: w.abstract ? w.abstract.substring(0, 300) : '',
            citedBy: w.citedByCount || 0,
          })),
        });
      } catch (err) {
        console.warn(`[LiteratureSearch] PI pub search failed: "${piName}" — ${err.message}`);
      }
    }
    return results;
  }

  /** Join an OpenAlex work's author display names for the collation citation line. */
  static _authorNames(work) {
    const names = (Array.isArray(work?.authorships) ? work.authorships : [])
      .map((a) => a.displayName)
      .filter(Boolean);
    return names.join(', ');
  }

  /**
   * Pick the OpenAlex author best matching the PI. Prefers a last-known-institution token
   * overlap with the supplied institution; otherwise the top relevance result (OpenAlex
   * orders by relevance, which favors the more prominent same-name author). Returns null
   * for an empty list. The keep-bias is acceptable here because the collation prompt
   * re-filters by institution/field downstream (lower stakes than contact enrichment).
   */
  static _pickAuthorForPI(authors, institution) {
    if (!Array.isArray(authors) || authors.length === 0) return null;
    const instTokens = this._instTokens(institution);
    if (instTokens.length) {
      const matched = authors.find((a) => {
        const recordTokens = new Set(this._instTokens(a.lastKnownInstitution));
        return instTokens.some((t) => recordTokens.has(t));
      });
      if (matched) return matched;
    }
    return authors[0];
  }

  /** Distinctive lowercase institution tokens (≥4 chars, drop generic words) for overlap. */
  static _instTokens(value) {
    const STOP = new Set(['department', 'university', 'institute', 'school', 'college', 'center', 'centre', 'laboratory']);
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 4 && !STOP.has(t));
  }

  /**
   * Extract result from Promise.allSettled outcome
   */
  static _extractResult(settledResult) {
    if (settledResult.status === 'fulfilled') {
      return settledResult.value;
    }
    console.warn('[LiteratureSearch] Search failed:', settledResult.reason?.message);
    return [];
  }
}
