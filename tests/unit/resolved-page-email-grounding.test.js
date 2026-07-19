/**
 * @jest-environment node
 *
 * Resolved-page email tier (docs/RESOLVED_PAGE_EMAIL_TIER_DESIGN.md):
 * HTML email extraction, page-grounding selection, and the safe-fetch host/IP
 * guards + safeFetchInstitutionPage (dns + fetch mocked — no live network).
 */

jest.mock('node:dns/promises', () => {
  const lookup = jest.fn();
  return { __esModule: true, default: { lookup }, lookup };
});
jest.mock('undici', () => {
  const fetch = jest.fn();
  class Agent { close() { return Promise.resolve(); } }
  return { __esModule: true, fetch, Agent };
});
import dnsPromises from 'node:dns/promises';
import { fetch as undiciFetch } from 'undici';

import { ContactParser } from '../../lib/utils/contact-parser';
import { ContactEnrichmentService } from '../../lib/services/contact-enrichment-service';
import {
  hostWithinDomain,
  isPrivateAddress,
  safeFetchInstitutionPage,
} from '../../lib/utils/safe-fetch';

const select = (name, html, domain, opts = {}) => {
  const { text, identityText, emails } = ContactParser.extractEmailsFromHtml(html);
  return ContactEnrichmentService._selectGroundedEmail(name, text, emails, domain, { identityText, ...opts });
};

describe('ContactParser.extractEmailsFromHtml', () => {
  it('pulls a mailto href and keeps its anchor text adjacent', () => {
    const { text, emails } = ContactParser.extractEmailsFromHtml(
      '<a href="mailto:phbuck@stanford.edu">Philip Bucksbaum</a>',
    );
    expect(emails.map((e) => e.email)).toEqual(['phbuck@stanford.edu']);
    expect(text).toMatch(/philip bucksbaum phbuck@stanford\.edu/i);
  });

  it('decodes @-entities and conservative [at]/[dot] obfuscation', () => {
    const { emails } = ContactParser.extractEmailsFromHtml(
      '<p>jdoe&#64;mit.edu</p><p>asmith [at] berkeley [dot] edu</p>',
    );
    expect(emails.map((e) => e.email)).toEqual(['jdoe@mit.edu', 'asmith@berkeley.edu']);
  });

  it('does NOT rewrite prose containing the word "at" without a "dot" marker', () => {
    const { emails } = ContactParser.extractEmailsFromHtml('<p>Based at Stanford in the lab</p>');
    expect(emails).toEqual([]);
  });

  it('drops example/test false positives and dedups, preserving document order', () => {
    const { emails } = ContactParser.extractEmailsFromHtml(
      '<p>foo@example.com bar@mit.edu bar@mit.edu baz@test.com</p>',
    );
    expect(emails.map((e) => e.email)).toEqual(['bar@mit.edu']);
  });

  it('extracts <title> + <h1..3> into identityText', () => {
    const { identityText } = ContactParser.extractEmailsFromHtml(
      '<title>Phil CV</title><h1>Philip Bucksbaum</h1><h2>PULSE</h2>',
    );
    expect(identityText).toBe('Phil CV Philip Bucksbaum PULSE');
  });
});

describe('ContactEnrichmentService._selectGroundedEmail', () => {
  it('recovers an opaque local part via the URL-slug owner route (Bucksbaum class)', () => {
    // Name only in the body header (not <title>), email in a first-person block,
    // plus a group member's email — only the page owner (~phbuck) is selected.
    const html =
      '<title>Phil&#39;s CV</title>' +
      '<p>Philip Bucksbaum, PULSE Institute.</p>' +
      ' '.repeat(300) +
      '<p>contact me: <a href="mailto:phbuck@stanford.edu">e</a></p>' +
      '<p>James Cryan <a href="mailto:jcryan@stanford.edu">e</a></p>';
    expect(select('Philip Bucksbaum', html, 'stanford.edu', { pageUrl: 'https://web.stanford.edu/~phbuck/' }))
      .toBe('phbuck@stanford.edu');
  });

  it('abstains when an unrelated same-institution slug page merely names the candidate', () => {
    const html =
      '<title>Lab page</title>' +
      '<p>Philip Bucksbaum visited the lab for a seminar.</p>' +
      ' '.repeat(300) +
      '<p>Contact me: <a href="mailto:evil@stanford.edu">e</a></p>';
    expect(select('Philip Bucksbaum', html, 'stanford.edu', { pageUrl: 'https://web.stanford.edu/~evil/' }))
      .toBeNull();
  });

  it('recovers via name-adjacency when the name sits next to the email', () => {
    const html = '<p>Philip Bucksbaum <a href="mailto:phbuck@stanford.edu">e</a></p>';
    expect(select('Philip Bucksbaum', html, 'stanford.edu', { pageUrl: 'https://x.stanford.edu/people/p' }))
      .toBe('phbuck@stanford.edu');
  });

  it('does not attribute a preceding staff email to the candidate named in the next record', () => {
    const html =
      '<p>Laboratory Manager/Administrator: Emily Botelho ' +
      '<a href="mailto:emilybotelho@fas.harvard.edu">email</a> ' +
      'David R. Liu is a professor of chemistry.</p>';
    expect(select('David Liu', html, 'harvard.edu', { pageUrl: 'https://www.chemistry.harvard.edu/people/team' }))
      .toBeNull();
  });

  it('selects the page owner on the official David Liu profile despite adjacent staff contacts', () => {
    const html =
      '<title>David R. Liu | Harvard Chemistry</title><h1>David R. Liu</h1>' +
      '<p>David R. Liu, Professor of Chemistry and Chemical Biology</p>' +
      ' '.repeat(180) +
      '<p><a href="mailto:liu@chemistry.harvard.edu">Email Professor Liu</a></p>' +
      '<p>Laboratory Manager/Administrator: Emily Botelho ' +
      '<a href="mailto:emilybotelho@fas.harvard.edu">email</a> ' +
      'David R. Liu is a professor of chemistry.</p>' +
      ' '.repeat(180) +
      '<footer>Questions about this site: ' +
      '<a href="mailto:yahya_chaudhry@fas.harvard.edu">contact</a></footer>';
    expect(select('David Liu', html, 'harvard.edu', {
      pageUrl: 'https://www.chemistry.harvard.edu/people/david-r-liu',
    })).toBe('liu@chemistry.harvard.edu');
  });

  it('abstains on a lab/group page whose sole email is a non-owner admin', () => {
    const html =
      '<title>Philip Bucksbaum Lab</title><h1>Philip Bucksbaum Lab</h1>' +
      ' '.repeat(400) +
      '<footer><a href="mailto:webmaster@stanford.edu">site</a></footer>';
    expect(select('Philip Bucksbaum', html, 'stanford.edu', { pageUrl: 'https://x.stanford.edu/bucksbaum-lab' }))
      .toBeNull();
  });

  it('abstains on a department office address (no candidate association)', () => {
    const html = '<h2>Department of Physics</h2><a href="mailto:office@phys.ksu.edu">contact</a>';
    expect(select('Artem Rudenko', html, 'k-state.edu', { pageUrl: 'https://phys.ksu.edu/' })).toBeNull();
  });

  it('abstains on a same-surname namesake (forename gate)', () => {
    const html = '<title>Sarah Bucksbaum</title><h1>Sarah Bucksbaum</h1><a href="mailto:sbuck@stanford.edu">e</a>';
    expect(select('Philip Bucksbaum', html, 'stanford.edu', { pageUrl: 'https://web.stanford.edu/~sbuck' })).toBeNull();
  });

  it('rejects an email on an UNRELATED domain even if candidate-adjacent', () => {
    const html = '<p>Philip Bucksbaum <a href="mailto:phbuck@gmail.com">e</a></p>';
    expect(select('Philip Bucksbaum', html, 'stanford.edu', { pageUrl: 'https://x.stanford.edu/p' })).toBeNull();
  });

  it('abstains when two candidate-associated emails are ambiguous', () => {
    const html =
      '<p>Philip Bucksbaum <a href="mailto:phbuck@stanford.edu">e</a></p>' +
      '<p>Philip Bucksbaum <a href="mailto:bucksbaum@stanford.edu">e</a></p>';
    expect(select('Philip Bucksbaum', html, 'stanford.edu', { pageUrl: 'https://x.stanford.edu/p' })).toBeNull();
  });

  it('does not associate an email when forename and surname are distant colleague mentions', () => {
    const html =
      '<p>Philip leads a separate project in optics.</p>' +
      ' '.repeat(150) +
      '<p>Contact Sarah Bucksbaum <a href="mailto:sbuck@stanford.edu">e</a></p>';
    expect(select('Philip Bucksbaum', html, 'stanford.edu', { pageUrl: 'https://web.stanford.edu/people/sarah' }))
      .toBeNull();
  });
});

describe('safe-fetch host + IP guards (pure)', () => {
  it('hostWithinDomain accepts exact + subdomain, rejects parent and unrelated', () => {
    expect(hostWithinDomain('stanford.edu', 'stanford.edu')).toBe(true);
    expect(hostWithinDomain('web.stanford.edu', 'stanford.edu')).toBe(true);
    expect(hostWithinDomain('stanford.edu', 'cs.stanford.edu')).toBe(false); // parent escalation
    expect(hostWithinDomain('phys.ksu.edu', 'k-state.edu')).toBe(false); // multi-domain inst
    expect(hostWithinDomain('evil-stanford.edu', 'stanford.edu')).toBe(false); // label boundary
    expect(hostWithinDomain('.stanford.edu', 'stanford.edu')).toBe(false);
    expect(hostWithinDomain('web..stanford.edu', 'stanford.edu')).toBe(false);
    expect(hostWithinDomain('web.stanford.edu.', 'stanford.edu')).toBe(false);
  });

  it('isPrivateAddress flags loopback/RFC1918/link-local/CGNAT/IPv6/mapped', () => {
    expect(isPrivateAddress('127.0.0.1', 4)).toBe(true);
    expect(isPrivateAddress('10.1.2.3', 4)).toBe(true);
    expect(isPrivateAddress('172.16.0.1', 4)).toBe(true);
    expect(isPrivateAddress('192.168.1.1', 4)).toBe(true);
    expect(isPrivateAddress('169.254.169.254', 4)).toBe(true);
    expect(isPrivateAddress('100.64.0.1', 4)).toBe(true);
    expect(isPrivateAddress('0.0.0.0', 4)).toBe(true);
    expect(isPrivateAddress('::1', 6)).toBe(true);
    expect(isPrivateAddress('::', 6)).toBe(true);
    expect(isPrivateAddress('fe80::1', 6)).toBe(true);
    expect(isPrivateAddress('fd00::1', 6)).toBe(true);
    expect(isPrivateAddress('::ffff:10.0.0.1', 6)).toBe(true);
    expect(isPrivateAddress('::ffff:0a00:0001', 6)).toBe(true);
    expect(isPrivateAddress('::ffff:c0a8:0001', 6)).toBe(true);
    // public
    expect(isPrivateAddress('171.67.215.200', 4)).toBe(false); // stanford-ish public v4
    expect(isPrivateAddress('2606:4700::1111', 6)).toBe(false);
    expect(isPrivateAddress('::ffff:0808:0808', 6)).toBe(false);
  });
});

describe('safeFetchInstitutionPage (dns + fetch mocked)', () => {
  const publicV4 = [{ address: '171.67.1.1', family: 4 }];
  beforeEach(() => {
    dnsPromises.lookup.mockReset();
    dnsPromises.lookup.mockResolvedValue(publicV4);
    undiciFetch.mockReset();
  });

  const streamBody = (body, events = []) => {
    const chunks = [new TextEncoder().encode(body)];
    return {
      getReader: () => ({
        read: async () => {
          events.push('read');
          const value = chunks.shift();
          return value ? { done: false, value } : { done: true };
        },
        cancel: async () => {
          events.push('cancel');
        },
      }),
    };
  };

  const htmlResponse = (body, { status = 200, contentType = 'text/html' } = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? contentType : null) },
    body: streamBody(body),
  });

  it('fetches an allowed host and returns the body text', async () => {
    undiciFetch.mockResolvedValue(htmlResponse('<p>hi</p>'));
    const r = await safeFetchInstitutionPage('https://web.stanford.edu/~p/', { allowedDomain: 'stanford.edu' });
    expect(r).toMatchObject({ ok: true, status: 200, text: '<p>hi</p>' });
  });

  it('rejects non-HTTPS', async () => {
    await expect(safeFetchInstitutionPage('http://web.stanford.edu/', { allowedDomain: 'stanford.edu' }))
      .rejects.toThrow(/HTTPS required/);
  });

  it('rejects an off-domain host', async () => {
    await expect(safeFetchInstitutionPage('https://evil.com/', { allowedDomain: 'stanford.edu' }))
      .rejects.toThrow(/not within/);
  });

  it('rejects when the host resolves to a private address', async () => {
    dnsPromises.lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    await expect(safeFetchInstitutionPage('https://web.stanford.edu/', { allowedDomain: 'stanford.edu' }))
      .rejects.toThrow(/private\/reserved/);
  });

  it('re-validates redirect hops and rejects a redirect off-domain', async () => {
    undiciFetch.mockResolvedValue({
      status: 302,
      headers: { get: (k) => (k.toLowerCase() === 'location' ? 'https://evil.com/x' : null) },
      body: streamBody(''),
    });
    await expect(safeFetchInstitutionPage('https://web.stanford.edu/', { allowedDomain: 'stanford.edu' }))
      .rejects.toThrow(/not within/);
  });

  it('re-validates redirect DNS and rejects a same-domain second hop resolving private', async () => {
    dnsPromises.lookup
      .mockResolvedValueOnce(publicV4)
      .mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }]);
    undiciFetch.mockResolvedValue({
      status: 302,
      headers: { get: (k) => (k.toLowerCase() === 'location' ? 'https://web.stanford.edu/private' : null) },
      body: streamBody(''),
    });
    await expect(safeFetchInstitutionPage('https://web.stanford.edu/', { allowedDomain: 'stanford.edu' }))
      .rejects.toThrow(/private\/reserved/);
    expect(undiciFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-HTML content-type', async () => {
    undiciFetch.mockResolvedValue(htmlResponse('{}', { contentType: 'application/json' }));
    await expect(safeFetchInstitutionPage('https://web.stanford.edu/', { allowedDomain: 'stanford.edu' }))
      .rejects.toThrow(/non-HTML/);
  });

  it('requires allowedDomain', async () => {
    await expect(safeFetchInstitutionPage('https://web.stanford.edu/', {}))
      .rejects.toThrow(/allowedDomain is required/);
  });

  it('caps the body before appending an over-limit chunk', async () => {
    const events = [];
    undiciFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html' : null) },
      body: streamBody('abcdef', events),
    });
    const r = await safeFetchInstitutionPage('https://web.stanford.edu/~p/', {
      allowedDomain: 'stanford.edu',
      maxBytes: 5,
    });
    expect(r.text).toBe('abcde');
    expect(events).toContain('cancel');
  });

  it('aborts a stalled body read under the page deadline', async () => {
    undiciFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html' : null) },
      body: {
        getReader: () => ({
          read: () => new Promise(() => {}),
          cancel: async () => {},
        }),
      },
    });
    await expect(safeFetchInstitutionPage('https://web.stanford.edu/~p/', {
      allowedDomain: 'stanford.edu',
      timeoutMs: 10,
    })).rejects.toThrow(/institution_page_timeout/);
  });
});
