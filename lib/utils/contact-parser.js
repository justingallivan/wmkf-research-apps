/**
 * ContactParser - Utilities for extracting contact information from text
 *
 * Primarily used to extract emails from PubMed affiliation strings, which often
 * contain email addresses embedded in the text, e.g.:
 * "Department of Biology, University of California San Diego, La Jolla, CA 92093, USA. jsmith@ucsd.edu"
 */

class ContactParser {
  /**
   * Extract email addresses from a string (typically a PubMed affiliation)
   *
   * @param {string} text - Text to search for emails
   * @returns {string[]} Array of found email addresses (normalized to lowercase)
   */
  static extractEmails(text) {
    if (!text || typeof text !== 'string') {
      return [];
    }

    // Standard email regex - handles most academic email formats
    // Intentionally permissive to catch various formats
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;

    const matches = text.match(emailRegex) || [];

    // Normalize and deduplicate
    const normalized = [...new Set(matches.map(e => e.toLowerCase()))];

    // Filter out obvious non-emails (common false positives)
    return normalized.filter(email => {
      // Must have at least one character before @
      if (email.indexOf('@') < 1) return false;

      // Must have valid TLD (at least 2 chars after last dot)
      const parts = email.split('.');
      if (parts[parts.length - 1].length < 2) return false;

      // Filter out common false positives
      const falsePositives = [
        'example.com',
        'email.com',
        'test.com',
        'sample.edu',
      ];
      if (falsePositives.some(fp => email.endsWith(fp))) return false;

      return true;
    });
  }

  /**
   * Extract the first (primary) email from text
   *
   * @param {string} text - Text to search
   * @returns {string|null} First email found, or null
   */
  static extractPrimaryEmail(text) {
    const emails = this.extractEmails(text);
    return emails.length > 0 ? emails[0] : null;
  }

  /**
   * Extract emails from an HTML page body for the resolved-page email tier
   * (docs/RESOLVED_PAGE_EMAIL_TIER_DESIGN.md §5). Returns a normalized plaintext
   * rendering of the page plus each distinct email with its offset INTO that
   * normalized text, so the caller can test name-adjacency / candidate
   * association (the trust gate) — a raw email list is not enough.
   *
   * `mailto:` targets are inlined next to their anchor TEXT before tags are
   * stripped, so `<a href="mailto:phbuck@x.edu">Philip Bucksbaum</a>` keeps the
   * address adjacent to the name. Common entities and conservative `[at]/[dot]`
   * obfuscation (only when BOTH markers are present, so plain emails are
   * untouched) are decoded.
   *
   * Also returns `identityText` — the page's <title> + <h1..h3> text — used by the
   * caller to decide whether the page is ABOUT the candidate (a stronger,
   * structure-aware signal than body name-adjacency for first-person "contact me"
   * pages).
   *
   * @param {string} html
   * @returns {{ text: string, identityText: string, emails: Array<{ email: string, index: number }> }}
   */
  static extractEmailsFromHtml(html) {
    if (!html || typeof html !== 'string') return { text: '', identityText: '', emails: [] };

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const headingMatches = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => m[1]);
    const identityText = [titleMatch ? titleMatch[1] : '', ...headingMatches]
      .join(' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    let s = html;
    // Inline mailto targets beside their anchor text so adjacency survives tag-strip.
    s = s.replace(
      /<a\b[^>]*href\s*=\s*["']?mailto:([^"'?>\s]+)[^>]*>([\s\S]*?)<\/a>/gi,
      (_m, addr, label) => ` ${label} ${this._safeDecodeUri(addr)} `,
    );
    // Any remaining bare mailto: occurrences (no anchor wrapper).
    s = s.replace(/mailto:([^"'?>\s]+)/gi, (_m, addr) => ` ${this._safeDecodeUri(addr)} `);
    // Replace remaining tags with spaces (drops <style>/<script> bodies' markup too;
    // their text content is harmless noise for email extraction).
    s = s.replace(/<[^>]+>/g, ' ');
    // Decode the handful of HTML entities that show up inside obfuscated emails.
    s = s
      .replace(/&#0*64;|&commat;/gi, '@')
      .replace(/&#0*46;|&period;/gi, '.')
      .replace(/&amp;/gi, '&')
      .replace(/&nbsp;/gi, ' ');
    // Conservative de-obfuscation: only rewrite when BOTH "at" and "dot" markers
    // are present (the obfuscated form). Plain addresses already contain @ and .
    // and are left untouched.
    s = s.replace(
      /([a-z0-9._%+-]+)\s*[[({]?\s*at\s*[\])}]?\s*([a-z0-9.-]+)\s*[[({]?\s*dot\s*[\])}]?\s*([a-z]{2,})/gi,
      '$1@$2.$3',
    );

    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const seen = new Set();
    const emails = [];
    let m;
    while ((m = emailRegex.exec(s)) !== null) {
      const email = m[0].toLowerCase();
      if (seen.has(email)) continue;
      // Reuse the shared validity filter (drops example.com/test.com false positives).
      if (!this.extractEmails(email).length) continue;
      seen.add(email);
      emails.push({ email, index: m.index });
    }
    return { text: s, identityText, emails };
  }

  /** decodeURIComponent that never throws on a malformed sequence. */
  static _safeDecodeUri(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  /**
   * Remove honorifics and titles from a name for cleaner searches
   *
   * @param {string} name - Name potentially with honorifics
   * @returns {string} Name without honorifics
   */
  static stripHonorifics(name) {
    if (!name) return '';
    // Strip repeatedly so stacked titles ("Prof. Dr. Reinhard Dörner", common in
    // German academia) are fully removed — a single pass would leave "Dr. …" and
    // still poison name-search / dedup downstream.
    let out = String(name);
    let prev;
    do {
      prev = out;
      out = out.replace(/^(Dr\.?|Prof\.?|Professor|Mr\.?|Ms\.?|Mrs\.?|Sir|Dame)\s+/i, '').trim();
    } while (out !== prev);
    return out;
  }

  /**
   * Check if an email appears to be from an academic institution
   *
   * @param {string} email - Email to check
   * @returns {boolean} True if likely academic
   */
  static isAcademicEmail(email) {
    if (!email) return false;

    const academicDomains = [
      '.edu',
      '.ac.uk',
      '.ac.jp',
      '.edu.au',
      '.edu.cn',
      '.ac.in',
      '.edu.sg',
      '.ac.nz',
      '.edu.hk',
      '.ac.il',
      '.edu.tw',
      '.ac.za',
      '.edu.br',
      '.edu.mx',
      '.ac.kr',
      '.edu.co',
    ];

    const lowerEmail = email.toLowerCase();
    return academicDomains.some(domain => lowerEmail.endsWith(domain));
  }

  /**
   * Heuristic guard against hallucinated / wrong-person emails returned by the
   * Tier-3 web-search contact lookup, where the model can invent a plausible
   * address ("justin@gmail.com" for "Justin Test3") or surface a same-named
   * different person's address ("SarahRose888@boisestate.edu" for a "Gallivan").
   *
   * Returns true only when the email's local part plausibly belongs to the named
   * person: it must contain the surname (≥3 alpha chars), a first-initial+surname
   * combination (e.g. "jgallivan"), or surname+first-initial. Deliberately
   * conservative — for an outreach tool that SENDS invitations, dropping a real
   * address (forcing a manual lookup) is far safer than mailing the wrong person.
   * Authoritative tiers (affiliation/PubMed/ORCID) do not pass through this gate.
   *
   * @param {string} email - Candidate email
   * @param {string} name - The person the email is supposed to belong to
   * @returns {boolean}
   */
  static isNameConsistentEmail(email, name) {
    if (!email || !name || typeof email !== 'string' || typeof name !== 'string') return false;
    const at = email.indexOf('@');
    if (at < 1) return false;
    const local = email.slice(0, at).toLowerCase().replace(/[^a-z]/g, '');
    if (!local) return false;

    // Trailing generational/credential tokens (Jr, III, PhD, MD…) are NOT name
    // parts; left in, they become the "last token" and break the bare-surname
    // rule below ("gallivan@…" rejected for "Justin Gallivan Jr"). NFD-normalize
    // first so accented names reduce to their ASCII form ("Núñez" → "nunez")
    // instead of being stripped to nothing by the [^a-z] filter (Codex S221).
    // Deliberately excludes short tokens that are also real surnames in some
    // cultures (e.g. "Do" = Vietnamese Đỗ); the ≥2-token fallback below protects
    // those anyway.
    const SUFFIX_TOKENS = new Set([
      'jr', 'sr', 'ii', 'iii', 'iv', 'vi', 'vii', 'phd', 'md', 'mbbs', 'dphil',
      'dsc', 'scd', 'msc', 'mph', 'mba', 'dds', 'dvm', 'edd', 'drph', 'pharmd',
      'jd', 'esq',
    ]);
    const rawTokens = this.stripHonorifics(name)
      .normalize('NFD')
      .replace(/\p{Mn}/gu, '')
      .toLowerCase()
      // Collapse intra-token punctuation FIRST so a dotted credential ("Ph.D.")
      // and an apostrophe name ("O'Brien") survive as ONE token (phd / obrien)
      // rather than fragmenting into 'ph'+'d' before the suffix filter runs.
      .replace(/[.'’]/g, '')
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2);
    // Drop generational/credential tokens ONLY when ≥2 real name tokens remain.
    // Otherwise a 2-token "John MD" would collapse to the lone given name 'john'
    // and be accepted by the bare-surname rule below — re-opening the exact
    // lone-given-name hole this guard closes (Codex S221).
    const nonSuffix = rawTokens.filter((t) => !SUFFIX_TOKENS.has(t));
    const tokens = nonSuffix.length >= 2 ? nonSuffix : rawTokens;
    if (tokens.length === 0) return false;

    const initials = tokens.map((t) => t[0]);

    // (1) initial(A) + token(B), or token(B) + initial(A), for two DISTINCT name
    // tokens (B ≥ 3 chars). Covers normal order ("jgallivan"), surname-first
    // order ("wzhang" for Zhang Wei), compound surnames ("mgarcia" for Maria
    // Garcia Marquez), and multi-initial forms ("lhtsai" for Li-Huei Tsai).
    // Requiring a second token's initial is what keeps a lone given-name address
    // ("justin@…" for "Justin Test3") OUT — that has no second-token signal.
    for (let b = 0; b < tokens.length; b++) {
      const tok = tokens[b];
      if (tok.length < 3) continue;
      for (let a = 0; a < initials.length; a++) {
        if (a === b) continue;
        const ini = initials[a];
        if (local.includes(ini + tok) || local.includes(tok + ini)) return true;
      }
    }

    // (2) The LAST token (assumed surname in Western order, ≥ 3 chars) embedded
    // in the local part — accepts a bare-surname address ("madabhushi@…",
    // "gallivan@…"). A lone given name is rejected because the first name is not
    // the last token (e.g. "justin" ⊄ surname "test"). Residual tradeoff: a
    // same-surname different person ("bgallivan@…" for "Justin Gallivan") still
    // passes; that rarer case is left to the identity resolver + human review.
    const surname = tokens[tokens.length - 1];
    if (surname.length >= 3 && local.includes(surname)) return true;

    return false;
  }

  /**
   * Extract website URLs from text
   *
   * @param {string} text - Text to search
   * @returns {string[]} Array of found URLs
   */
  static extractUrls(text) {
    if (!text || typeof text !== 'string') {
      return [];
    }

    // Match http/https URLs
    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

    const matches = text.match(urlRegex) || [];

    // Clean up URLs (remove trailing punctuation)
    return matches.map(url => {
      // Remove trailing punctuation that might have been captured
      return url.replace(/[.,;:!?)]+$/, '');
    });
  }

  /**
   * Check if a publication is recent enough to trust the email
   *
   * @param {number} year - Publication year
   * @param {number} maxAge - Maximum age in years (default: 2)
   * @returns {boolean} True if recent enough
   */
  static isRecentPublication(year, maxAge = 2) {
    if (!year || typeof year !== 'number') return false;

    const currentYear = new Date().getFullYear();
    return (currentYear - year) <= maxAge;
  }

  /**
   * Extract contact info from a list of publications
   * Prioritizes recent publications for email extraction
   *
   * @param {Array} publications - Array of publication objects with year and author affiliations
   * @param {string} authorName - Name of author to find contact for
   * @param {Object} options - Options
   * @param {number} options.maxEmailAge - Max age for trusted emails (default: 2 years)
   * @returns {Object} Contact info { email, emailSource, emailYear, isRecent }
   */
  static extractContactFromPublications(publications, authorName, options = {}) {
    const { maxEmailAge = 2 } = options;

    if (!publications || !Array.isArray(publications) || publications.length === 0) {
      return { email: null, emailSource: null, emailYear: null, isRecent: false };
    }

    // Sort by year descending (most recent first)
    const sorted = [...publications].sort((a, b) => (b.year || 0) - (a.year || 0));

    // Normalize author name for matching
    const normalizedAuthor = this.normalizeNameForMatch(authorName);

    for (const pub of sorted) {
      // Skip if no author data
      if (!pub.authors || !Array.isArray(pub.authors)) continue;

      // Find the author in this publication
      const author = pub.authors.find(a => {
        if (!a || !a.name) return false;
        const normalizedPubAuthor = this.normalizeNameForMatch(a.name);
        return this.namesMatch(normalizedAuthor, normalizedPubAuthor);
      });

      if (!author) continue;

      // Check all affiliations for this author
      const affiliations = author.allAffiliations || [author.affiliation];

      for (const affiliation of affiliations) {
        const email = this.extractPrimaryEmail(affiliation);
        if (email) {
          const isRecent = this.isRecentPublication(pub.year, maxEmailAge);
          return {
            email,
            emailSource: `PubMed (${pub.pmid || 'unknown'})`,
            emailYear: pub.year,
            isRecent,
            publicationTitle: pub.title,
          };
        }
      }
    }

    return { email: null, emailSource: null, emailYear: null, isRecent: false };
  }

  static nameTokensForUrlMatch(name) {
    if (!name || typeof name !== 'string') return [];
    const tokens = this.stripHonorifics(name)
      .normalize('NFD')
      .replace(/\p{Mn}/gu, '')
      .toLowerCase()
      .replace(/[.'’]/g, '')
      .replace(/[^a-z\s-]/g, ' ')
      .split(/[\s-]+/)
      .filter((t) => t.length >= 3);
    if (tokens.length === 0) return [];
    return Array.from(new Set([tokens[0], tokens[tokens.length - 1]].filter(Boolean)));
  }

  static slugTokensForUrlMatch(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/\p{Mn}/gu, '')
      .toLowerCase()
      .replace(/[.'’]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3);
  }

  static profileSlugForUrl(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }

    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (host === 'linkedin.com' && parts[0] === 'in') return parts[1] || '';
    if (host === 'researchgate.net' && parts[0] === 'profile') return parts[1] || '';
    if ((host === 'twitter.com' || host === 'x.com') && parts[0]) return parts[0];
    if (host === 'github.com' && parts[0]) return parts[0];
    return null;
  }

  static isNameConsistentWebsiteUrl(url, name) {
    const slug = this.profileSlugForUrl(url);
    if (slug == null) return true;
    const nameTokens = this.nameTokensForUrlMatch(name);
    if (nameTokens.length === 0) return false;
    const slugTokens = this.slugTokensForUrlMatch(slug);
    const compactSlug = slugTokens.join('');
    return nameTokens.some((token) => slugTokens.includes(token) || compactSlug.includes(token));
  }

  /**
   * True if the URL's path points at a downloadable document/media file rather
   * than a navigable page. A file (a paper PDF, a slide deck, a spreadsheet) is
   * never a profile/faculty page, so it must never be shown as a reviewer's
   * website nor fetched by the resolved-page email tier. Shared by
   * isUsefulWebsiteUrl and SerpContactService.isFacultyPageUrl so a single list
   * governs both the website and faculty-page gates. Path-only (query/fragment
   * ignored, so `…/cv.pdf?dl=1` is still caught); a malformed URL is treated as a
   * non-document and left to the other gates.
   */
  static isDocumentUrl(url) {
    if (!url) return false;
    let pathname;
    try {
      pathname = new URL(url).pathname.toLowerCase();
    } catch {
      return false;
    }
    return /\.(pdf|docx?|pptx?|xlsx?|ps|rtf|txt|csv|zip)$/.test(pathname);
  }

  static sanitizeWebsiteForCandidate(url, name) {
    return this.isUsefulWebsiteUrl(url, name) ? url : null;
  }

  /**
   * Check if a URL looks like a useful personal/profile page
   * Filters out generic directory pages that aren't helpful
   *
   * @param {string} url - URL to check
   * @param {string|null} candidateName - Candidate name for personal/profile URL gating
   * @returns {boolean} True if URL appears to be a useful individual page
   */
  static isUsefulWebsiteUrl(url, candidateName = null) {
    if (!url) return false;

    // A document/media file (e.g. a paper PDF) is never a profile page. Catch it
    // here so it's rejected regardless of which capture tier produced it (the
    // Kitzler-Zeiler case: a co-author's `Treiber-2022-….pdf` shown as website).
    if (this.isDocumentUrl(url)) return false;

    const lowerUrl = url.toLowerCase();

    // Patterns that indicate a generic directory/listing page (not useful)
    const genericPatterns = [
      /[?&]p=people$/,          // ?p=people (like the Suttle example)
      /\/people\/?$/,           // ends with /people
      /\/directory\/?$/,        // ends with /directory
      /\/faculty\/?$/,          // ends with /faculty (without specific person)
      /\/staff\/?$/,            // ends with /staff
      /\/members\/?$/,          // ends with /members
      /\/team\/?$/,             // ends with /team
      /[?&]q=/,                 // search queries with q parameter
      /\/search\/?$/,           // ends with /search
    ];

    for (const pattern of genericPatterns) {
      if (pattern.test(lowerUrl)) {
        return false;
      }
    }

    if (!this.isNameConsistentWebsiteUrl(url, candidateName)) {
      return false;
    }

    // Known useful profile sites - accepted after the candidate-name gate above.
    const knownProfileSites = [
      'researchgate.net/profile',
      'scholar.google.com/citations',
      'orcid.org/',
      'linkedin.com/in/',
      'github.com/',
      'twitter.com/',
      'x.com/',
    ];

    if (knownProfileSites.some(site => lowerUrl.includes(site))) {
      return true;
    }

    return true;
  }

  /**
   * Check if an email domain is from an academic institution (international)
   *
   * @param {string} email - Email to check
   * @returns {boolean} True if likely academic
   */
  static isInternationalAcademicDomain(domain) {
    if (!domain) return false;

    const lowerDomain = domain.toLowerCase();

    // Comprehensive list of international academic TLDs and patterns
    const academicPatterns = [
      // USA
      '.edu',
      // UK
      '.ac.uk',
      // Japan
      '.ac.jp',
      // Australia
      '.edu.au',
      // China
      '.edu.cn',
      // India
      '.ac.in', '.edu.in',
      // Singapore
      '.edu.sg',
      // New Zealand
      '.ac.nz',
      // Hong Kong
      '.edu.hk',
      // Israel
      '.ac.il',
      // Taiwan
      '.edu.tw',
      // South Africa
      '.ac.za',
      // Brazil
      '.edu.br',
      // Mexico
      '.edu.mx',
      // South Korea
      '.ac.kr', '.edu.kr',
      // Colombia
      '.edu.co',
      // Germany
      '.uni-', 'tu-', 'rwth-',
      // France
      '.u-', 'univ-', '.fr',
      // Netherlands
      '.nl',
      // Sweden
      '.se',
      // Switzerland
      '.ethz.ch', '.epfl.ch', '.unibe.ch',
      // Canada
      '.ca',
      // Spain
      '.es',
      // Italy
      '.it',
      // Poland
      '.edu.pl',
      // Russia
      '.msu.ru', '.spbu.ru',
      // Generic patterns
      'university',
      'college',
      'institute',
      'school',
      'academy',
    ];

    return academicPatterns.some(pattern => lowerDomain.includes(pattern));
  }

  /**
   * Normalize a name for matching (lowercase, remove punctuation, etc.)
   * Copied from discovery-service to avoid circular dependency
   */
  static normalizeNameForMatch(name) {
    if (!name) return '';
    return name
      .toLowerCase()
      .replace(/[.,]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Check if two normalized names match
   * Simple version - just checks if they're equal or one contains the other
   */
  static namesMatch(name1, name2) {
    if (!name1 || !name2) return false;

    // Exact match
    if (name1 === name2) return true;

    // Split into parts
    const parts1 = name1.split(' ').filter(p => p.length > 0);
    const parts2 = name2.split(' ').filter(p => p.length > 0);

    // Check if last names match (usually the last part)
    const lastName1 = parts1[parts1.length - 1];
    const lastName2 = parts2[parts2.length - 1];

    if (lastName1 !== lastName2) return false;

    // If last names match, check first name/initial
    const firstName1 = parts1[0] || '';
    const firstName2 = parts2[0] || '';

    // Exact first name match
    if (firstName1 === firstName2) return true;

    // Initial match (e.g., "J" matches "John")
    if (firstName1.length === 1 && firstName2.startsWith(firstName1)) return true;
    if (firstName2.length === 1 && firstName1.startsWith(firstName2)) return true;

    return false;
  }
}

module.exports = { ContactParser };
