/**
 * SerpContactService - Google Search for Contact Information
 *
 * Uses SerpAPI's Google Search (not Google Scholar) to find:
 * - Email addresses from faculty pages and search snippets
 * - Faculty page URLs
 * - Personal website URLs
 *
 * This is Tier 4 in the contact enrichment system.
 */

const { ContactParser } = require('../utils/contact-parser');

class SerpContactService {
  static apiKey = process.env.SERP_API_KEY;
  static baseUrl = 'https://serpapi.com/search.json';

  /**
   * Find contact information for a candidate using Google Search
   *
   * @param {Object} candidate - Candidate with name and affiliation
   * @param {string} apiKey - SerpAPI key (optional, uses env var if not provided)
   * @returns {Promise<Object|null>} { email, facultyPageUrl, website } or null
   */
  static async findContact(candidate, apiKey = null) {
    const key = apiKey || this.apiKey;
    if (!key) {
      console.log('SerpContactService: No SERP_API_KEY configured, skipping Google Search');
      return null;
    }

    // Extract just institution name for cleaner search
    const institution = candidate.affiliation
      ? candidate.affiliation.split(',')[0].trim()
      : '';

    // Clean name by removing honorifics (Dr., Prof., etc.)
    const cleanName = ContactParser.stripHonorifics(candidate.name);

    // Primary query: "FirstName LastName" institution email
    const query = institution
      ? `"${cleanName}" ${institution} email`
      : `"${cleanName}" email`;

    console.log('Google Search query:', query);

    try {
      const params = new URLSearchParams({
        engine: 'google',
        q: query,
        num: '10', // Get 10 results
        api_key: key,
      });

      const url = `${this.baseUrl}?${params}`;
      const response = await fetch(url);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('SerpAPI error:', response.status, response.statusText);
        console.error('SerpAPI error details:', errorText.substring(0, 500));
        return null;
      }

      const data = await response.json();
      const organicResults = data.organic_results || [];

      // Extract contact information from results
      const result = {
        email: null,
        facultyPageUrl: null,
        website: null,
      };

      // First pass: look for emails in snippets and links
      for (const item of organicResults) {
        // Extract email from snippet
        if (!result.email && item.snippet) {
          const email = this.extractEmailFromText(item.snippet);
          if (email) {
            result.email = email;
          }
        }

        // Check if this is a useful faculty page URL
        if (!result.facultyPageUrl && item.link) {
          if (this.isFacultyPageUrl(item.link, candidate.name)) {
            result.facultyPageUrl = item.link;
          } else if (!result.website && ContactParser.isUsefulWebsiteUrl(item.link)) {
            // If not a faculty page but is a useful URL, save as website
            result.website = item.link;
          }
        }
      }

      // If no results found, try multiple fallback queries
      if (!result.email && !result.facultyPageUrl && !result.website) {
        const fallbackQueries = [];

        // Fallback 1: Faculty page search
        if (institution) {
          fallbackQueries.push(`"${cleanName}" ${institution} faculty`);
        }

        // Fallback 2: Site-specific search for .edu domains
        if (institution) {
          // Try to extract domain hint from institution name
          const instWords = institution.toLowerCase().split(/\s+/);
          if (instWords.some(w => w.includes('university') || w.includes('college'))) {
            fallbackQueries.push(`"${cleanName}" site:.edu ${institution}`);
          }
        }

        // Fallback 3: Lab/research page search
        fallbackQueries.push(`"${cleanName}" ${institution || ''} lab research`.trim());

        // Fallback 4: Profile page search
        fallbackQueries.push(`"${cleanName}" ${institution || ''} profile`.trim());

        for (const fallbackQuery of fallbackQueries) {
          if (result.facultyPageUrl || result.email) break; // Stop if we found something

          console.log('Google Search fallback query:', fallbackQuery);

          const fallbackParams = new URLSearchParams({
            engine: 'google',
            q: fallbackQuery,
            num: '10',
            api_key: key,
          });

          try {
            const fallbackResponse = await fetch(`${this.baseUrl}?${fallbackParams}`);
            if (fallbackResponse.ok) {
              const fallbackData = await fallbackResponse.json();
              const fallbackResults = fallbackData.organic_results || [];

              for (const item of fallbackResults) {
                // Try to extract email from snippet
                if (!result.email && item.snippet) {
                  const email = this.extractEmailFromText(item.snippet);
                  if (email) {
                    result.email = email;
                  }
                }

                // Check for faculty page URLs
                if (!result.facultyPageUrl && item.link) {
                  if (this.isFacultyPageUrl(item.link, candidate.name)) {
                    result.facultyPageUrl = item.link;
                  }
                }

                // Check for useful website
                if (!result.website && item.link && ContactParser.isUsefulWebsiteUrl(item.link)) {
                  result.website = item.link;
                }
              }
            }
          } catch (fallbackError) {
            console.error('Fallback query error:', fallbackError.message);
          }
        }
      }

      // Return null if we found nothing
      if (!result.email && !result.facultyPageUrl && !result.website) {
        return null;
      }

      console.log('Google Search results:', {
        email: result.email ? 'found' : 'not found',
        facultyPageUrl: result.facultyPageUrl ? 'found' : 'not found',
        website: result.website ? 'found' : 'not found',
      });

      return result;

    } catch (error) {
      console.error('Google Search error:', error.message);
      return null;
    }
  }

  /**
   * Extract email address from text using regex
   * Filters out generic emails like info@, contact@, support@
   */
  static extractEmailFromText(text) {
    if (!text) return null;

    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
    const matches = text.match(emailPattern);

    if (!matches || matches.length === 0) {
      return null;
    }

    // Filter out generic emails
    const validEmails = matches.filter(email => {
      const lowerEmail = email.toLowerCase();
      return !lowerEmail.includes('example') &&
             !lowerEmail.startsWith('info@') &&
             !lowerEmail.startsWith('contact@') &&
             !lowerEmail.startsWith('support@') &&
             !lowerEmail.startsWith('help@') &&
             !lowerEmail.startsWith('webmaster@') &&
             !lowerEmail.startsWith('admin@') &&
             !lowerEmail.startsWith('no-reply@') &&
             !lowerEmail.startsWith('noreply@');
    });

    return validEmails.length > 0 ? validEmails[0] : null;
  }

  /**
   * Check if a URL looks like a faculty page
   * Faculty pages typically include the person's name or have /faculty/, /people/, /profile/ patterns
   */
  static isFacultyPageUrl(url, candidateName) {
    if (!url) return false;

    const lowerUrl = url.toLowerCase();
    const lowerName = candidateName.toLowerCase();

    // Extract last name (assume Western name order: First Last)
    const nameParts = lowerName.split(' ').filter(p => p.length > 0);
    const lastName = nameParts.length > 0 ? nameParts[nameParts.length - 1] : '';
    const firstName = nameParts.length > 0 ? nameParts[0] : '';

    // Check if URL contains the last name (or first name for unique names)
    const hasLastName = lastName.length > 2 && lowerUrl.includes(lastName);
    const hasFirstName = firstName.length > 2 && lowerUrl.includes(firstName);
    const hasName = hasLastName || hasFirstName;

    // Expanded faculty page patterns - more inclusive
    const facultyPatterns = [
      '/faculty/',
      '/people/',
      '/profile/',
      '/staff/',
      '/directory/',
      '/bio/',
      '/~',
      '/research/',
      '/lab/',
      '/group/',
      '/member/',
      '/team/',
      '/investigator/',
      '/scientist/',
      '/researcher/',
      '/person/',
      '/user/',
      '/about/',
      '/contact/',
    ];

    const hasFacultyPattern = facultyPatterns.some(pattern => lowerUrl.includes(pattern));

    // Academic domain patterns - international support
    const academicDomains = [
      '.edu',
      '.edu.',      // .edu.au, .edu.cn, etc.
      '.ac.',       // .ac.uk, .ac.jp, etc.
      '.uni-',      // German universities
      '.u-',        // French universities (u-paris.fr)
      'university',
      'univ.',
      'college',
      'institute',
    ];
    const isAcademicDomain = academicDomains.some(pattern => lowerUrl.includes(pattern));

    // Research organization patterns
    const researchPatterns = [
      'nih.gov',
      'nsf.gov',
      'gov/staff',
      'gov/people',
      '.gov/',
      'researchgate.net/profile',
      'scholar.google',
      'orcid.org',
    ];
    const isResearchSite = researchPatterns.some(pattern => lowerUrl.includes(pattern));

    // A URL is a faculty page if:
    // 1. Has name AND has faculty pattern (strongest signal)
    // 2. Has name AND is from academic domain (not generic directory)
    // 3. Is a known research profile site
    // 4. Has faculty pattern AND is academic domain (even without name in URL)

    if (hasName && hasFacultyPattern) return true;
    if (hasName && isAcademicDomain && !this.isGenericDirectoryUrl(url)) return true;
    if (isResearchSite && hasName) return true;
    if (hasFacultyPattern && isAcademicDomain && !this.isGenericDirectoryUrl(url)) return true;

    return false;
  }

  /**
   * Check if URL is a generic directory page (not useful)
   */
  static isGenericDirectoryUrl(url) {
    if (!url) return false;

    const lowerUrl = url.toLowerCase();

    const genericPatterns = [
      /[?&]p=people/,
      /\/people\/?$/,
      /\/directory\/?$/,
      /\/faculty\/?$/,
      /\/staff\/?$/,
      /\/members\/?$/,
      /\/team\/?$/,
    ];

    return genericPatterns.some(pattern => pattern.test(lowerUrl));
  }

  /**
   * Check if SerpAPI is configured
   */
  static isConfigured() {
    return !!this.apiKey;
  }

  /**
   * Search Google Scholar for a researcher's profile
   * Returns their profile URL if found
   *
   * Note: The google_scholar_profiles API was deprecated by SerpAPI in December 2024
   * due to Google requiring login for profile access. We now use regular Google
   * search with site:scholar.google.com instead.
   *
   * @param {Object} candidate - Candidate with name and affiliation
   * @param {string} apiKey - SerpAPI key
   * @returns {Promise<Object|null>} { scholarProfileUrl, scholarId } or null
   */
  static async findScholarProfile(candidate, apiKey = null) {
    const key = apiKey || this.apiKey;
    if (!key) return null;

    // Use Google search to find Scholar profiles (profiles API deprecated)
    return await this.findScholarProfileViaGoogle(candidate, key);
  }

  /**
   * Extract the meaningful institution name from a (possibly messy) affiliation
   * string — prefer a part naming a real institution (university/institute/
   * college/hospital), else the first comma segment. Mirrors the heuristic the
   * Workbench search card uses for Scholar lookups.
   */
  static extractInstitution(affiliation) {
    if (!affiliation) return '';
    const noEmail = affiliation.replace(/\S+@\S+/g, '').trim();
    const parts = noEmail.split(',').map((p) => p.trim()).filter(Boolean);
    let inst = parts.find((p) =>
      /\b(university|institute|college)\b/i.test(p) &&
      !/^(department|dept|division|school|faculty|center|centre)\s+of/i.test(p));
    if (!inst) inst = parts.find((p) => /\b(hospital|laborator|medical center)\b/i.test(p));
    return (inst || parts[0] || '')
      .replace(/^(department of|dept\.? of|division of|school of|faculty of|center for|centre for)\s+/i, '')
      .trim();
  }

  static _normInst(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * True ONLY when the Scholar result snippet names a recognizable institution
   * that CONFLICTS with the candidate's known affiliation — i.e. positive
   * evidence we matched a different person. Keep-biased: an empty/ambiguous
   * snippet, or any distinctive-word overlap, returns false (don't reject).
   *
   * Distinctive overlap (e.g. "ottawa", "stony"/"brook", "colorado") => same
   * institution. No overlap AND the snippet names some other university/hospital
   * => conflict. (Known limitation: an applicant-supplied ACRONYM like "UConn"
   * vs a full-name snippet has no distinctive overlap and would conflict; the
   * applicant data uses full institution names, so this is rare — flagged for
   * later tuning.)
   */
  static institutionConflicts(knownAffiliation, snippet) {
    const known = this._normInst(this.extractInstitution(knownAffiliation));
    const snip = this._normInst(snippet);
    if (!known || !snip) return false;
    const stop = new Set(['university', 'institute', 'college', 'of', 'the', 'at', 'for', 'and',
      'department', 'dept', 'division', 'school', 'faculty', 'medical', 'center', 'centre',
      'hospital', 'laboratory', 'laboratoire']);
    const distinctive = known.split(' ').filter((w) => w.length >= 4 && !stop.has(w));
    if (distinctive.length === 0) return false; // nothing distinctive to judge on → keep
    if (distinctive.some((w) => snip.includes(w))) return false; // shared distinctive word → same place
    // No overlap: conflict only if the snippet itself names a recognizable institution.
    return /\b(university|institute|college|hospital|medical center)\b/.test(snip);
  }

  /**
   * Extract the Scholar profile owner's displayed name from a Google result
   * title. Titles look like "‪Li-Huei Tsai‬ - ‪MIT‬ - ‪Google Scholar‬" (with
   * Unicode bidi marks) — the profile owner's name is the first " - "-delimited
   * segment. Strips bidi/control marks and drops a title that is only the
   * "Google Scholar" boilerplate (no extractable name).
   *
   * @returns {string} the displayed name, or '' if none could be extracted.
   */
  static extractScholarDisplayName(title) {
    if (!title) return '';
    // Strip the LTR/RTL bidi + isolate control marks SerpAPI passes through
    // verbatim: U+200E/200F (marks), U+202A-202E (embeddings/overrides),
    // U+2066-2069 (isolates).
    const clean = title.replace(/[‎‏‪-‮⁦-⁩]/g, '').trim();
    const first = clean.split(/\s[-–—]\s/)[0].trim();
    if (!first) return '';
    if (/^google scholar$/i.test(first)) return ''; // boilerplate-only title
    return first;
  }

  /**
   * True ONLY when we can extract a Scholar profile owner name from the result
   * title AND it fails the strict name comparator against the target candidate.
   * Keep-biased like {@link institutionConflicts}: an unextractable/empty
   * displayed name returns false (don't reject) so legitimate enrichment isn't
   * over-blocked. This catches the same-institution lab-member case the
   * institution guard can't (e.g. target "Li-Huei Tsai" vs profile owner
   * "Masayuki Nakano" whose snippet still names her MIT lab).
   */
  static scholarNameMismatch(targetName, title) {
    const displayed = this.extractScholarDisplayName(title);
    if (!displayed) return false; // nothing to judge on → keep
    const target = ContactParser.stripHonorifics(targetName || '');
    if (!target) return false;
    return !ContactParser.namesMatch(
      ContactParser.normalizeNameForMatch(target),
      ContactParser.normalizeNameForMatch(displayed),
    );
  }

  /**
   * Find Google Scholar profile using regular Google search
   * Searches for "Name" <institution> site:scholar.google.com and extracts the
   * profile URL. Includes the known institution in the query to disambiguate
   * common names, and flags `institutionMismatch` when the matched profile's
   * snippet names a different institution, and `nameMismatch` when the matched
   * profile's displayed owner name fails the strict name comparator against the
   * target (the caller refuses to persist a likely-wrong person's metrics).
   */
  static async findScholarProfileViaGoogle(candidate, apiKey) {
    const cleanName = ContactParser.stripHonorifics(candidate.name);
    const institution = this.extractInstitution(candidate.affiliation);
    const query = institution
      ? `"${cleanName}" ${institution} site:scholar.google.com`
      : `"${cleanName}" site:scholar.google.com`;

    console.log('Scholar fallback search:', query);

    try {
      const params = new URLSearchParams({
        engine: 'google',
        q: query,
        num: '5',
        api_key: apiKey,
      });

      const url = `${this.baseUrl}?${params}`;
      const response = await fetch(url);

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const results = data.organic_results || [];

      // Look for scholar.google.com/citations URLs
      for (const result of results) {
        if (result.link && result.link.includes('scholar.google.com/citations')) {
          // Extract user ID from URL
          const userMatch = result.link.match(/user=([^&]+)/);
          return {
            scholarProfileUrl: result.link,
            scholarId: userMatch ? userMatch[1] : null,
            scholarName: result.title,
            scholarDisplayName: this.extractScholarDisplayName(result.title),
            scholarAffiliation: result.snippet,
            institutionMismatch: this.institutionConflicts(candidate.affiliation, result.snippet),
            nameMismatch: this.scholarNameMismatch(candidate.name, result.title),
          };
        }
      }

      return null;
    } catch (error) {
      console.error('Scholar fallback search error:', error.message);
      return null;
    }
  }

  /**
   * Fetch real bibliometrics (h-index, i10-index, total citations) for a
   * researcher via SerpAPI's google_scholar_author engine, keyed on the Scholar
   * author_id (the `user=` param captured by findScholarProfile). This is a
   * separate, still-supported engine — NOT the deprecated google_scholar_profiles.
   *
   * The cited_by metrics table is locale-dependent: row keys are h_index/indice_h,
   * i10_index/indice_i10, citations (stable). We force hl=en and match each row by
   * which metric key is present rather than by array position, since order is not
   * contractually guaranteed.
   *
   * Also opportunistically returns the author block's current `affiliations`
   * string and `email` hint ("Verified email at stanford.edu") from the same
   * payload (S224, Topic #2) — used by ContactEnrichmentService as a
   * current-affiliation candidate (authority 2, below ORCID) and a COI/domain
   * corroborator. `scholarEmail` is a verified-domain hint, NOT a sendable
   * address, so the enrichment layer never promotes it to a contact email.
   *
   * @param {string} authorId - Scholar author_id (the `user=` URL param)
   * @param {string} apiKey - SerpAPI key (optional, uses env var if not provided)
   * @returns {Promise<{hIndex:number|null,i10Index:number|null,totalCitations:number|null,scholarAffiliations:string|null,scholarEmail:string|null}|null>}
   */
  static async fetchScholarMetrics(authorId, apiKey = null) {
    const key = apiKey || this.apiKey;
    if (!key || !authorId) return null;

    try {
      const params = new URLSearchParams({
        engine: 'google_scholar_author',
        author_id: authorId,
        hl: 'en',
        api_key: key,
      });

      const url = `${this.baseUrl}?${params}`;
      const response = await fetch(url);
      if (!response.ok) return null;

      const data = await response.json();
      const metrics = { hIndex: null, i10Index: null, totalCitations: null, scholarAffiliations: null, scholarEmail: null };

      // Author block (same payload): the researcher's CURRENT self-reported
      // affiliation + verified-email domain hint. Both confirmed populated by
      // the S223 live probe. `affiliations` is free text ("Professor of
      // Biology, Stanford University"); `email` is a domain hint ("Verified
      // email at stanford.edu"), not a sendable address. Parsed BEFORE the
      // cited_by.table guard (S224 Codex post-impl MEDIUM) so a profile that
      // carries a current affiliation but no metrics table still surfaces it.
      const author = data?.author;
      if (author && typeof author === 'object') {
        if (typeof author.affiliations === 'string' && author.affiliations.trim()) {
          metrics.scholarAffiliations = author.affiliations.trim();
        }
        if (typeof author.email === 'string' && author.email.trim()) {
          metrics.scholarEmail = author.email.trim();
        }
      }

      const table = data?.cited_by?.table;
      // No metrics table → return whatever the author block gave us (or all
      // nulls), rather than dropping the affiliation we just parsed.
      if (!Array.isArray(table)) return metrics;

      for (const row of table) {
        if (!row || typeof row !== 'object') continue;
        // Each row is a single-key object, e.g. { citations: { all, since_2016 } }.
        const citations = row.citations || row.Citations;
        const hIndex = row.h_index || row.indice_h || row.hindex;
        const i10Index = row.i10_index || row.indice_i10 || row.i10index;
        if (citations && metrics.totalCitations == null) {
          metrics.totalCitations = this._numOrNull(citations.all);
        }
        if (hIndex && metrics.hIndex == null) {
          metrics.hIndex = this._numOrNull(hIndex.all);
        }
        if (i10Index && metrics.i10Index == null) {
          metrics.i10Index = this._numOrNull(i10Index.all);
        }
      }
      return metrics;
    } catch (error) {
      console.error('Scholar metrics fetch error:', error.message);
      return null;
    }
  }

  static _numOrNull(v) {
    const n = typeof v === 'number' ? v : parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
}

module.exports = { SerpContactService };
