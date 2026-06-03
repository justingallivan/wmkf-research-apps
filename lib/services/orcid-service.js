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
   * Get an access token using client credentials
   *
   * @param {string} clientId - ORCID API client ID
   * @param {string} clientSecret - ORCID API client secret
   * @returns {Promise<string>} Access token
   */
  static async getAccessToken(clientId, clientSecret) {
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
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ORCID authentication failed: ${error}`);
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
  static async searchByName({ name, affiliation, clientId, clientSecret, maxResults = 10 }) {
    const token = await this.getAccessToken(clientId, clientSecret);

    // Build SOLR query
    // ORCID uses SOLR syntax: https://info.orcid.org/documentation/api-tutorials/api-tutorial-searching-the-orcid-registry/
    let query = '';

    // Parse name into parts
    const nameParts = name.trim().split(/\s+/);
    if (nameParts.length >= 2) {
      // Assume "FirstName LastName" or "FirstName MiddleName LastName"
      const firstName = nameParts[0];
      const lastName = nameParts[nameParts.length - 1];

      // Search in given-names and family-name fields
      query = `given-names:${firstName}* AND family-name:${lastName}*`;
    } else {
      // Single name - search in both fields
      query = `(given-names:${name}* OR family-name:${name}*)`;
    }

    // Add affiliation if provided (helps narrow down common names)
    if (affiliation) {
      // Clean affiliation - extract key institution name
      const cleanAffiliation = this.extractInstitutionName(affiliation);
      if (cleanAffiliation) {
        query += ` AND affiliation-org-name:*${cleanAffiliation}*`;
      }
    }

    const searchUrl = `${this.baseUrl}/expanded-search/?q=${encodeURIComponent(query)}&rows=${maxResults}`;

    const response = await fetch(searchUrl, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ORCID search failed: ${error}`);
    }

    const data = await response.json();
    const results = data['expanded-result'] || [];

    // Map to simpler format
    return results.map(r => ({
      orcidId: r['orcid-id'],
      orcidUrl: `https://orcid.org/${r['orcid-id']}`,
      givenNames: r['given-names'],
      familyName: r['family-name'],
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
  static async getProfile(orcidId, clientId, clientSecret) {
    const token = await this.getAccessToken(clientId, clientSecret);

    // Fetch the full record
    const response = await fetch(`${this.baseUrl}/${orcidId}/record`, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      const error = await response.text();
      throw new Error(`ORCID profile fetch failed: ${error}`);
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
      // Return current affiliation for convenience
      currentAffiliation: affiliations.find(a => a.current)?.organization || affiliations[0]?.organization || null,
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

  static async findContact({ name, affiliation, clientId, clientSecret }) {
    try {
      // Search for the researcher
      const results = await this.searchByName({
        name,
        affiliation,
        clientId,
        clientSecret,
        maxResults: 5,
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
          return null; // genuinely ambiguous
        }
      }

      const selected = pool[0];

      // If the selected (name-matched) record has a public email, use it directly.
      if (selected.emails && selected.emails.length > 0) {
        return {
          orcidId: selected.orcidId,
          orcidUrl: selected.orcidUrl,
          name: `${selected.givenNames} ${selected.familyName}`.trim(),
          email: selected.emails[0],
          source: 'orcid_search',
          identityStatus: 'probable',
        };
      }

      // Otherwise, fetch the full profile of the selected name-matched record.
      const profile = await this.getProfile(selected.orcidId, clientId, clientSecret);

      if (!profile) {
        return {
          orcidId: selected.orcidId,
          orcidUrl: selected.orcidUrl,
          name: `${selected.givenNames} ${selected.familyName}`.trim(),
          email: null,
          website: null,
          source: 'orcid_search',
          identityStatus: 'probable',
        };
      }

      return {
        orcidId: profile.orcidId,
        orcidUrl: profile.orcidUrl,
        name: profile.creditName || `${profile.givenNames} ${profile.familyName}`.trim(),
        email: profile.primaryEmail,
        website: profile.primaryUrl,
        affiliation: profile.currentAffiliation,
        source: 'orcid_profile',
        identityStatus: 'probable',
      };
    } catch (error) {
      console.error('ORCID lookup error:', error.message);
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
