/**
 * ORCIDService - Query ORCID API for researcher information
 *
 * ORCID (Open Researcher and Contributor ID) provides unique identifiers for researchers
 * and stores their profile information including:
 * - Email (if made public by researcher)
 * - Website/URLs
 * - Affiliations (current and past)
 * - Works (publications)
 *
 * API Documentation: https://info.orcid.org/documentation/api-tutorials/
 *
 * Authentication: OAuth 2.0 client credentials flow
 * Rate Limits: Generally permissive for public API
 */

const { ContactParser } = require('../utils/contact-parser');

class ORCIDService {
  static baseUrl = 'https://pub.orcid.org/v3.0';
  static tokenUrl = 'https://orcid.org/oauth/token';

  // Cache access token (expires in ~20 minutes typically)
  static accessToken = null;
  static tokenExpiry = null;

  /**
   * Escape Lucene/SOLR special characters so a name carrying operator chars
   * (a hyphen in "Li-Huei", parentheses, brackets, quotes, colons, slashes,
   * &/|) can't break ORCID expanded-search's query parser and return a 500
   * (S215 residual: special-character names were 500ing searchByName). The
   * trailing `*` wildcards searchByName appends are added AFTER escaping, so
   * they keep their wildcard meaning; a literal `*`/`?` inside a name is
   * escaped (names don't contain wildcards). Lucene treats `\X` as the literal
   * X for the documented special set.
   *
   * `<`/`>` are NOT Lucene operators (range syntax is `[]`/`{}`, already in the
   * set) so they don't 500 the standard parser, but they're escaped too as a
   * cheap hedge against a non-standard analyzer and to neutralize email-shaped
   * junk like "Jane <jane@x.edu>" (Codex S217 #1).
   */
  static escapeSolrValue(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim().replace(/[+\-!(){}[\]^"~*?:\\/&|<>]/g, '\\$&');
  }

  /**
   * Get an access token using client credentials
   *
   * @param {string} clientId - ORCID API client ID
   * @param {string} clientSecret - ORCID API client secret
   * @returns {Promise<string>} Access token
   */
  static async getAccessToken(clientId, clientSecret, opts = {}) {
    // Return cached token if still valid
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    if (!clientId || !clientSecret) {
      throw new Error('ORCID client credentials not provided');
    }

    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
        scope: '/read-public',
      }),
      ...(opts?.signal ? { signal: opts.signal } : {}),
    });

    if (!response.ok) {
      const error = await response.text();
      const err = new Error(`ORCID authentication failed: ${error}`);
      err.status = response.status;
      throw err;
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    // Token typically expires in 20 minutes, refresh 1 minute early
    this.tokenExpiry = Date.now() + ((data.expires_in - 60) * 1000);

    return this.accessToken;
  }

  /**
   * Search ORCID for researchers by name and optionally affiliation
   *
   * @param {Object} params - Search parameters
   * @param {string} params.name - Researcher name (required)
   * @param {string} params.affiliation - Institution (optional, helps disambiguation)
   * @param {string} params.clientId - ORCID client ID
   * @param {string} params.clientSecret - ORCID client secret
   * @param {number} params.maxResults - Max results to return (default: 10)
   * @returns {Promise<Array>} Array of ORCID profiles
   */
  static async searchByName({ name, affiliation, clientId, clientSecret, maxResults = 10, signal }) {
    // Build SOLR query
    // ORCID uses SOLR syntax: https://info.orcid.org/documentation/api-tutorials/api-tutorial-searching-the-orcid-registry/
    // Every interpolated value is run through escapeSolrValue first so operator
    // characters in a name (hyphen, parens, quotes, …) can't 500 the parser.
    //
    // Parse name into parts, keeping only tokens with at least one letter/number
    // (drops empties + pure-punctuation tokens like "()" / a stray "-", which
    // carry no searchable signal and would only yield a useless escaped query).
    // Done before the token fetch so a junk/empty name abstains without an API
    // round trip (Codex S217 #5).
    const nameParts = (name || '').trim().split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p));
    if (nameParts.length === 0) {
      // Name was empty/whitespace/punctuation-only — nothing searchable, and a
      // bare wildcard query would 500. Abstain rather than hit the API.
      return [];
    }

    let query;
    if (nameParts.length >= 2) {
      // Assume "FirstName LastName" or "FirstName MiddleName LastName"
      const firstName = this.escapeSolrValue(nameParts[0]);
      const lastName = this.escapeSolrValue(nameParts[nameParts.length - 1]);

      // Search in given-names and family-name fields
      query = `given-names:${firstName}* AND family-name:${lastName}*`;
    } else {
      // Single name - search in both fields
      const single = this.escapeSolrValue(nameParts[0]);
      query = `(given-names:${single}* OR family-name:${single}*)`;
    }

    const token = signal
      ? await this.getAccessToken(clientId, clientSecret, { signal })
      : await this.getAccessToken(clientId, clientSecret);

    // Add affiliation if provided (helps narrow down common names).
    // Operator chars are escaped; spaces in a multi-word institution are left
    // as-is, so only the first token stays field-scoped (the rest fall to the
    // default field). That looseness is INTENTIONALLY kept (Codex S217 #3,
    // pre-existing): it errs toward MORE candidates, and the load-bearing
    // institution corroboration is established downstream by matching each
    // returned record's institutions against the affiliation — not by this
    // pre-filter. Tightening it (per-token AND clauses) could cut recall and
    // shift the resolver's `institutionCorroborated` strong anchor, so it gets
    // its own validation rather than riding this 500 fix.
    if (affiliation) {
      // Clean affiliation - extract key institution name
      const cleanAffiliation = this.extractInstitutionName(affiliation);
      if (cleanAffiliation) {
        query += ` AND affiliation-org-name:*${this.escapeSolrValue(cleanAffiliation)}*`;
      }
    }

    const searchUrl = `${this.baseUrl}/expanded-search/?q=${encodeURIComponent(query)}&rows=${maxResults}`;

    const response = await fetch(searchUrl, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      ...(signal ? { signal } : {}),
    });

    if (!response.ok) {
      const error = await response.text();
      const err = new Error(`ORCID search failed: ${error}`);
      err.status = response.status;
      throw err;
    }

    const data = await response.json();
    const results = data['expanded-result'] || [];

    // Map to simpler format
    return results.map(r => ({
      orcidId: r['orcid-id'],
      orcidUrl: `https://orcid.org/${r['orcid-id']}`,
      givenNames: r['given-names'],
      // ORCID expanded-search returns `family-names` (PLURAL); reading the
      // singular `family-name` left familyName undefined, so the downstream
      // name-match gate rejected every record and findContact always abstained
      // (ORCID never contributed an anchor). The /record endpoint (getProfile)
      // is a different schema and correctly uses singular family-name.
      familyName: r['family-names'],
      creditName: r['credit-name'],
      otherNames: r['other-name'] || [],
      emails: r['email'] || [],
      institutions: r['institution-name'] || [],
    }));
  }

  /**
   * Get full profile for a specific ORCID ID
   *
   * @param {string} orcidId - ORCID ID (e.g., "0000-0002-1234-5678")
   * @param {string} clientId - ORCID client ID
   * @param {string} clientSecret - ORCID client secret
   * @returns {Promise<Object>} Full profile with contact info
   */
  static async getProfile(orcidId, clientId, clientSecret, opts = {}) {
    const token = opts?.signal
      ? await this.getAccessToken(clientId, clientSecret, { signal: opts.signal })
      : await this.getAccessToken(clientId, clientSecret);

    // Fetch the full record
    const response = await fetch(`${this.baseUrl}/${orcidId}/record`, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      ...(opts?.signal ? { signal: opts.signal } : {}),
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      const error = await response.text();
      const err = new Error(`ORCID profile fetch failed: ${error}`);
      err.status = response.status;
      throw err;
    }

    const data = await response.json();

    // Extract relevant information
    const person = data.person || {};
    const activities = data['activities-summary'] || {};

    // Extract emails (if public)
    const emails = [];
    const emailsData = person.emails?.email || [];
    for (const email of emailsData) {
      if (email.email) {
        emails.push({
          email: email.email,
          primary: email.primary || false,
          verified: email.verified || false,
        });
      }
    }

    // Extract URLs/websites
    const urls = [];
    const urlsData = person['researcher-urls']?.['researcher-url'] || [];
    for (const url of urlsData) {
      if (url.url?.value) {
        urls.push({
          name: url['url-name'] || 'Website',
          url: url.url.value,
        });
      }
    }

    // Extract current affiliations
    const affiliations = [];
    const employments = activities.employments?.['affiliation-group'] || [];
    for (const group of employments) {
      const summaries = group.summaries || [];
      for (const summary of summaries) {
        const emp = summary['employment-summary'];
        if (emp) {
          affiliations.push({
            organization: emp.organization?.name || '',
            department: emp['department-name'] || '',
            role: emp['role-title'] || '',
            startYear: emp['start-date']?.year?.value,
            endYear: emp['end-date']?.year?.value,
            current: !emp['end-date'],
          });
        }
      }
    }

    // Get name info
    const name = person.name || {};

    return {
      orcidId,
      orcidUrl: `https://orcid.org/${orcidId}`,
      givenNames: name['given-names']?.value || '',
      familyName: name['family-name']?.value || '',
      creditName: name['credit-name']?.value || '',
      emails,
      urls,
      affiliations,
      // Return primary/first email for convenience
      primaryEmail: emails.find(e => e.primary)?.email || emails[0]?.email || null,
      // Return primary website for convenience
      primaryUrl: urls[0]?.url || null,
      // Return CURRENT affiliation for convenience — strictly an employment with
      // no end-date. No `affiliations[0]` fallback (S224 Codex post-impl HIGH):
      // findContact feeds this into the identity-gated `orcid_current` override,
      // so falling back to a past (ended) employment would pin a stale
      // postdoc-era institution as "current" — the exact bug Topic #2 exists to
      // kill. A profile with only ended employments yields null, and the
      // override correctly falls through to Scholar / PubMed-recency.
      currentAffiliation: affiliations.find(a => a.current)?.organization || null,
    };
  }

  /**
   * Search for a researcher and get their contact info
   * Convenience method that combines search + profile fetch
   *
   * @param {Object} params - Search parameters
   * @returns {Promise<Object|null>} Contact info or null if not found
   */
  /**
   * Does an ORCID search record's name match the target under the strict
   * comparator? Checks the structured given+family name, the credit name, and
   * any other-names — ORCID records are identity anchors, so a record whose
   * name doesn't match the target must not be selected even if it has a public
   * email or tops ORCID's relevance ranking (REVIEWER_IDENTITY_RESOLUTION_PLAN.md
   * Phase 1). Returns false defensively when the target name is unusable.
   */
  static _nameMatchesTarget(record, targetName) {
    const target = ContactParser.normalizeNameForMatch(
      ContactParser.stripHonorifics(targetName || ''),
    );
    if (!target) return false;
    const candidates = [
      `${record.givenNames || ''} ${record.familyName || ''}`,
      record.creditName || '',
      ...(Array.isArray(record.otherNames) ? record.otherNames : []),
    ];
    return candidates.some((n) =>
      n && ContactParser.namesMatch(target, ContactParser.normalizeNameForMatch(n)));
  }

  static async findContact({ name, affiliation, clientId, clientSecret, signal, throwOnError = false }) {
    try {
      // Search for the researcher
      const results = await this.searchByName({
        name,
        affiliation,
        clientId,
        clientSecret,
        maxResults: 5,
        signal,
      });

      if (results.length === 0) {
        return null;
      }

      // Identity gate: only consider records whose NAME matches the target.
      // Previously this took the first result with an email (or ORCID's top
      // result) regardless of name — which attached a homonym's ORCID iD/email.
      const nameMatches = results.filter((r) => this._nameMatchesTarget(r, name));
      if (nameMatches.length === 0) {
        return null; // abstain — no name-confident ORCID record
      }

      // Narrow by affiliation when it disambiguates among multiple name matches.
      let pool = nameMatches;
      const affToken = affiliation ? ContactParser.normalizeNameForMatch(this.extractInstitutionName(affiliation) || '') : '';
      if (pool.length > 1 && affToken) {
        const affMatches = pool.filter((r) =>
          (r.institutions || []).some((inst) => ContactParser.normalizeNameForMatch(inst).includes(affToken)));
        if (affMatches.length) pool = affMatches;
      }

      // Still ambiguous across DISTINCT ORCID iDs with no disambiguator → abstain
      // rather than guess (the plan: unresolved is acceptable, wrong-confident is not).
      const distinctIds = new Set(pool.map((r) => r.orcidId));
      if (distinctIds.size > 1) {
        const withEmail = pool.filter((r) => r.emails && r.emails.length > 0);
        if (withEmail.length === 1) {
          pool = withEmail; // a single contactable record breaks the tie
        } else {
          // Genuinely ambiguous. Return a STRUCTURED abstain (not bare null) so the
          // identity resolver can distinguish "multiple plausible ORCIDs" (→ ambiguous
          // status) from "no name-confident record at all" (null → unresolved). No
          // orcidId is set, so enrichment still won't attach anyone's identity.
          return { status: 'ambiguous', orcidId: null, candidateCount: distinctIds.size, source: 'orcid_search' };
        }
      }

      const selected = pool[0];

      // Institution corroboration of the selected name-matched record: does the
      // ORCID record's self-reported institution contain the reviewer's affiliation
      // token? Name-match + institution-match are two independent signals that this
      // is the right person, so the resolver can treat such an ORCID as an
      // authoritative (strong) anchor on its own (S215 — measured ~33% of reviewers;
      // see docs/REVIEWER_IDENTITY_RESOLVER_PHASE2_DESIGN.md §3.1). A bare name-match
      // with no corroboration stays a WEAK anchor (common-name false-match risk).
      const matchedInstitution = affToken
        ? ((selected.institutions || []).find((inst) =>
            ContactParser.normalizeNameForMatch(inst).includes(affToken)) || null)
        : null;
      const institutionCorroborated = !!matchedInstitution;

      // ALWAYS fetch the full profile of the selected name-matched record, even
      // when the search record already exposes a public email (S224, Topic #2):
      // the full record is the only place ORCID's dated employment → current
      // affiliation lives, and current affiliation is the whole point of the
      // recency-weighting work. The previous public-email fast-path returned
      // early and dropped affiliation on every email-bearing hit. One extra
      // ORCID call per candidate, accepted (Justin S223). The search-record
      // email is preserved as a fallback so removing the fast-path never loses a
      // contactable address the profile happens not to expose.
      const searchEmail = (selected.emails && selected.emails.length > 0) ? selected.emails[0] : null;
      const profile = signal
        ? await this.getProfile(selected.orcidId, clientId, clientSecret, { signal })
        : await this.getProfile(selected.orcidId, clientId, clientSecret);

      if (!profile) {
        return {
          status: 'resolved',
          orcidId: selected.orcidId,
          orcidUrl: selected.orcidUrl,
          name: `${selected.givenNames} ${selected.familyName}`.trim(),
          email: searchEmail,
          website: null,
          institutionCorroborated,
          matchedInstitution,
          source: 'orcid_search',
          identityStatus: 'probable',
        };
      }

      return {
        status: 'resolved',
        orcidId: profile.orcidId,
        orcidUrl: profile.orcidUrl,
        name: profile.creditName || `${profile.givenNames} ${profile.familyName}`.trim(),
        // Prefer the profile's maintained email; fall back to the search-record
        // public email so the always-fetch-profile change can't regress contact
        // coverage for records whose /record endpoint omits the email.
        email: profile.primaryEmail || searchEmail,
        website: profile.primaryUrl,
        affiliation: profile.currentAffiliation,
        institutionCorroborated,
        matchedInstitution,
        source: 'orcid_profile',
        identityStatus: 'probable',
      };
    } catch (error) {
      console.error('ORCID lookup error:', error.message);
      if (throwOnError) throw error;
      return null;
    }
  }

  /**
   * Extract institution name from full affiliation string
   * Helper to improve search accuracy
   */
  static extractInstitutionName(affiliation) {
    if (!affiliation) return null;

    // Split by comma and look for institution keywords
    const parts = affiliation.split(',').map(p => p.trim());

    // Look for "University", "Institute", "College", etc.
    const institutionPart = parts.find(p =>
      /university|institute|college|school|hospital|medical center|laboratory/i.test(p)
    );

    if (institutionPart) {
      // Clean up department prefixes
      return institutionPart
        .replace(/^(department of|dept\.? of|division of|school of)\s+/i, '')
        .trim();
    }

    // Fallback to first substantive part
    return parts[0] || null;
  }
}

module.exports = { ORCIDService };
