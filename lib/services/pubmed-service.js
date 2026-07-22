/**
 * PubMedService - Search PubMed/NCBI for scientific publications
 *
 * Uses NCBI E-utilities API:
 * - esearch: Find article IDs matching a query
 * - efetch: Retrieve full article details
 *
 * Rate limits: 3 requests/second without API key, 10/second with key
 */

const { DatabaseService } = require('./database-service');
const { parseStringPromise } = require('xml2js');

class PubMedService {
  static baseUrl = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
  static apiKey = process.env.NCBI_API_KEY;
  // NCBI permits 10 requests/second with an API key and 3 without one. Keep
  // substantial headroom for overlapping Vercel activity that shares the same
  // key/IP, and serialize request starts so caller-level Promise.all fan-out
  // cannot create a burst.
  static requestIntervalMs = this.apiKey ? 250 : 500;
  static maxRetries = 3;
  static retryBaseMs = 1000;
  static retryJitterMs = 250;
  static _requestQueue = Promise.resolve();
  static _nextRequestAt = 0;

  static abortError(signal) {
    if (signal?.reason) return signal.reason;
    const error = new Error('PubMed request aborted');
    error.name = 'AbortError';
    return error;
  }

  static async wait(ms, signal) {
    if (!ms || ms <= 0) {
      if (signal?.aborted) throw this.abortError(signal);
      return;
    }
    await new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timeout);
        reject(this.abortError(signal));
      };
      const timeout = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  static retryAfterMs(response) {
    const value = response?.headers?.get?.('retry-after');
    if (!value) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
    const dateMs = Date.parse(value);
    return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : null;
  }

  static async _requestWithRetries(url, { signal, operation = 'request' } = {}) {
    let lastError = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (signal?.aborted) throw this.abortError(signal);
      const pacingDelay = Math.max(0, this._nextRequestAt - Date.now());
      await this.wait(pacingDelay, signal);
      this._nextRequestAt = Date.now() + this.requestIntervalMs;

      let response;
      try {
        response = await fetch(url, { signal });
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw error;
        lastError = error;
        if (attempt >= this.maxRetries) throw error;
      }

      if (response?.ok) return response;

      if (response) {
        const error = new Error(`PubMed ${operation} failed (${response.status})`);
        error.status = response.status;
        lastError = error;
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt >= this.maxRetries) throw error;
      }

      const retryAfter = this.retryAfterMs(response);
      const backoff = retryAfter ?? (
        this.retryBaseMs * (2 ** attempt)
        + Math.floor(Math.random() * this.retryJitterMs)
      );
      console.warn(
        `[PubMedService] ${operation} attempt ${attempt + 1} failed`
        + `${response?.status ? ` (${response.status})` : ''}; retrying after ${backoff}ms`
      );
      // Hold the shared queue during backoff. Otherwise sibling requests would
      // continue hitting NCBI while this request is already rate-limited.
      await this.wait(backoff, signal);
    }
    throw lastError || new Error(`PubMed ${operation} failed`);
  }

  static request(url, options = {}) {
    const run = () => this._requestWithRetries(url, options);
    const queued = this._requestQueue.then(run, run);
    // Keep the queue usable after a failed request; callers still receive the
    // original rejection through `queued`.
    this._requestQueue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  static resetRequestGovernorForTests() {
    this._requestQueue = Promise.resolve();
    this._nextRequestAt = 0;
  }

  /**
   * Extract string from XML parsed value (handles mixed content with tags like <i>)
   */
  static extractString(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      // Handle xml2js parsed objects with _ for text and tag names for nested elements
      if (value._) return String(value._);
      // Try to extract text from any nested structure
      return JSON.stringify(value);
    }
    return String(value);
  }

  static parsePubMedMonth(value) {
    const raw = this.extractString(value).trim();
    if (!raw) return 1;
    const numeric = parseInt(raw, 10);
    if (Number.isFinite(numeric)) return numeric;
    const month = raw.slice(0, 3).toLowerCase();
    const months = {
      jan: 1,
      feb: 2,
      mar: 3,
      apr: 4,
      may: 5,
      jun: 6,
      jul: 7,
      aug: 8,
      sep: 9,
      oct: 10,
      nov: 11,
      dec: 12,
    };
    return months[month] || 1;
  }

  static parsePubMedDate(dateNode) {
    if (!dateNode) return null;
    const medlineDate = this.extractString(dateNode.MedlineDate?.[0]);
    const yearFromMedlineDate = medlineDate.match(/\b(19|20)\d{2}\b/)?.[0];
    const year = parseInt(this.extractString(dateNode.Year?.[0]) || yearFromMedlineDate || '0', 10);
    if (!Number.isFinite(year) || year <= 0) return null;
    const month = this.parsePubMedMonth(dateNode.Month?.[0]);
    const day = parseInt(this.extractString(dateNode.Day?.[0]) || '1', 10);
    return {
      year,
      month: Number.isFinite(month) && month >= 1 && month <= 12 ? month : 1,
      day: Number.isFinite(day) && day >= 1 && day <= 31 ? day : 1,
    };
  }

  static selectPublicationDate(articleData, medlineCitation) {
    const articleDate = articleData.ArticleDate?.map((d) => this.parsePubMedDate(d)).find(Boolean);
    if (articleDate) return articleDate;

    const journalPubDate = this.parsePubMedDate(articleData.Journal?.[0]?.JournalIssue?.[0]?.PubDate?.[0]);
    if (journalPubDate) return journalPubDate;

    return this.parsePubMedDate(medlineCitation.DateCompleted?.[0])
      || this.parsePubMedDate(medlineCitation.DateRevised?.[0]);
  }

  // ============================================
  // SEARCH (WITH OPTIONAL CACHING)
  // ============================================

  /**
   * Search PubMed for articles matching a query
   *
   * @param {string} query - PubMed search query
   * @param {number} maxResults - Maximum results to return
   * @param {Object} options - Search options
   * @param {boolean} options.useCache - Whether to use cache (default: false for free API)
   */
  static async search(query, maxResults = 100, options = {}) {
    const { useCache = false, signal, throwOnError = false } = options;

    // Only check cache if explicitly requested
    if (useCache) {
      const cached = await DatabaseService.checkCache('pubmed', query);
      if (cached) {
        console.log('PubMed cache hit for:', query.substring(0, 50) + '...');
        return cached;
      }
    }

    console.log('Querying PubMed API for:', query.substring(0, 50) + '...');

    try {
      // Step 1: Search to get PMIDs
      const pmids = await this.searchPMIDs(query, maxResults, { signal });

      if (pmids.length === 0) {
        return [];
      }

      // Step 2: Fetch full article details
      const articles = await this.fetchArticles(pmids, { signal });

      // Only cache if explicitly requested (e.g., for paid APIs like Google Scholar)
      // PubMed is free, so we skip caching to always get fresh results
      if (useCache) {
        await this.cacheResults(query, articles);
      }

      return articles;
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError' || throwOnError) throw error;
      console.error('PubMed search error:', error.message);
      return [];
    }
  }

  // ============================================
  // INTERNAL METHODS
  // ============================================

  /**
   * Search for PMIDs matching a query
   */
  static async searchPMIDs(query, maxResults, { signal } = {}) {
    const params = new URLSearchParams({
      db: 'pubmed',
      term: query,
      retmax: maxResults.toString(),
      retmode: 'json',
      sort: 'relevance',
      tool: 'wmkf_reviewer_finder',
    });

    if (this.apiKey) {
      params.append('api_key', this.apiKey);
    }
    if (process.env.NOTIFICATION_EMAIL_FROM) {
      params.append('email', process.env.NOTIFICATION_EMAIL_FROM);
    }

    const url = `${this.baseUrl}esearch.fcgi?${params}`;
    const response = await this.request(url, { signal, operation: 'esearch' });
    const data = await response.json();

    return data.esearchresult?.idlist || [];
  }

  /**
   * Fetch full article details for a list of PMIDs
   */
  static async fetchArticles(pmids, { signal } = {}) {
    const chunkSize = 200;
    const articles = [];

    // Index-bearing batch loop; not consolidated onto lib/utils/chunk.js (needs i). See docs/CHUNK_CONSOLIDATION_PLAN.md.
    for (let i = 0; i < pmids.length; i += chunkSize) {
      const chunk = pmids.slice(i, i + chunkSize);
      const chunkArticles = await this.fetchArticleChunk(chunk, { signal });
      articles.push(...chunkArticles);

      // Rate limiting: wait 350ms between requests (without API key)
      if (i + chunkSize < pmids.length) {
        const delay = this.apiKey ? 100 : 350;
        await new Promise((resolve, reject) => {
          const onAbort = () => {
            clearTimeout(timeout);
            reject(signal.reason || new DOMException('Aborted', 'AbortError'));
          };
          const timeout = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
          }, delay);
          if (signal?.aborted) onAbort();
          else signal?.addEventListener('abort', onAbort, { once: true });
        });
      }
    }

    return articles;
  }

  /**
   * Fetch a chunk of articles by PMIDs
   */
  static async fetchArticleChunk(pmids, { signal } = {}) {
    const params = new URLSearchParams({
      db: 'pubmed',
      id: pmids.join(','),
      retmode: 'xml',
      tool: 'wmkf_reviewer_finder',
    });

    if (this.apiKey) {
      params.append('api_key', this.apiKey);
    }
    if (process.env.NOTIFICATION_EMAIL_FROM) {
      params.append('email', process.env.NOTIFICATION_EMAIL_FROM);
    }

    const url = `${this.baseUrl}efetch.fcgi?${params}`;
    const response = await this.request(url, { signal, operation: 'efetch' });
    const text = await response.text();

    // Check if response is XML (should start with < or whitespace then <)
    const trimmed = text.trim();
    if (!trimmed.startsWith('<')) {
      console.error('PubMed returned non-XML response:', trimmed.substring(0, 100));
      return [];
    }

    return this.parseXML(text);
  }

  /**
   * Parse PubMed XML response into article objects
   */
  static async parseXML(xml) {
    try {
      // Validate input is actually XML
      if (!xml || typeof xml !== 'string') {
        console.error('parseXML received non-string input:', typeof xml);
        return [];
      }

      const trimmed = xml.trim();
      if (!trimmed.startsWith('<')) {
        console.error('parseXML received non-XML content:', trimmed.substring(0, 50));
        return [];
      }

      const result = await parseStringPromise(xml);
      const articles = [];

      const pubmedArticles = result.PubmedArticleSet?.PubmedArticle || [];

      for (const article of pubmedArticles) {
        try {
          const medlineCitation = article.MedlineCitation?.[0];
          const articleData = medlineCitation?.Article?.[0];

          if (!articleData) continue;

          // Extract PMID
          const pmid = this.extractString(medlineCitation.PMID?.[0]);

          // Extract title (may have <i> tags for italics)
          const title = this.extractString(articleData.ArticleTitle?.[0]);

          // Extract all authors with their affiliations
          // This allows us to find the correct affiliation for any author
          const authorList = articleData.AuthorList?.[0]?.Author || [];
          const allAuthors = authorList.map((author) => {
            const lastName = this.extractString(author.LastName?.[0]);
            const foreName = this.extractString(author.ForeName?.[0]);
            // PubMed can have multiple affiliations per author
            const affiliationInfoList = author.AffiliationInfo || [];
            const affiliations = affiliationInfoList
              .map(info => this.extractString(info.Affiliation?.[0]))
              .filter(a => a && a.length > 0);
            const affiliation = affiliations[0] || ''; // Primary affiliation

            return {
              name: `${foreName} ${lastName}`.trim(),
              affiliation,
              allAffiliations: affiliations,
            };
          }).filter(a => a.name);

          // Return all authors (needed for affiliation lookup)
          // but mark the last author as senior/PI
          const authors = allAuthors.map((author, index) => ({
            ...author,
            isSeniorAuthor: index === allAuthors.length - 1,
          }));

          // Extract journal
          const journal = this.extractString(articleData.Journal?.[0]?.Title?.[0]);

          // Extract publication date. Prefer actual publication dates over
          // Medline maintenance dates.
          const pubDate = this.selectPublicationDate(articleData, medlineCitation);
          const year = pubDate?.year || 0;
          // PubMed supplies a calendar date without a timezone. Construct it at
          // UTC midnight so the stored day is stable in every runtime timezone
          // (local midnight in UTC+ zones serializes as the previous UTC day).
          const publicationDate = year
            ? new Date(Date.UTC(year, pubDate.month - 1, pubDate.day))
            : null;

          // Extract DOI
          const articleIds = article.PubmedData?.[0]?.ArticleIdList?.[0]?.ArticleId || [];
          const doiObj = articleIds.find((id) => id.$?.IdType === 'doi');
          const doi = this.extractString(doiObj) || null;

          // Extract abstract
          const abstractTexts = articleData.Abstract?.[0]?.AbstractText || [];
          const abstract = abstractTexts.map((text) => this.extractString(text)).join(' ');

          articles.push({
            pmid,
            title,
            authors,
            journal,
            publicationDate,
            year,
            doi,
            abstract,
          });
        } catch (parseError) {
          console.error('Error parsing article:', parseError.message);
          continue;
        }
      }

      return articles;
    } catch (error) {
      console.error('XML parse error:', error.message);
      return [];
    }
  }

  /**
   * Cache search results
   */
  static async cacheResults(query, results) {
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 6); // 6 months expiry

    await DatabaseService.cacheSearch({
      source: 'pubmed',
      query,
      results,
      expiresAt,
    });
  }

  // ============================================
  // QUERY GENERATORS
  // ============================================

  /**
   * Generate a PubMed search query from proposal metadata
   * Keep queries focused - PubMed works better with specific, short queries
   */
  static generateQuery(metadata) {
    // Use primarily the research area - keep it simple
    const researchArea = metadata.primaryResearchArea;
    if (!researchArea || researchArea === 'Not specified') {
      return '';
    }

    // Extract just key terms (first 2-3 words)
    const terms = researchArea.split(/[\s,]+/).slice(0, 3).join(' ');

    // Add recent publications filter (last 5 years)
    const fiveYearsAgo = new Date().getFullYear() - 5;

    return `${terms}[Title/Abstract] AND (${fiveYearsAgo}:${new Date().getFullYear()}[pdat])`;
  }
}

module.exports = { PubMedService };
