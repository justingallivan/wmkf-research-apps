/**
 * @jest-environment node
 *
 * Regression: the scholarly-API contact address must be separable from the
 * system-alert sender.
 *
 * `NOTIFICATION_EMAIL_FROM` historically served double duty — it is the Dynamics
 * sender mailbox for system-alert email AND the `email` contact parameter sent to
 * NCBI E-utilities and Europe PMC. Moving the alert sender to an unmonitored
 * role/noreply mailbox therefore silently turned those providers' only contact
 * path into a dead end. `SCHOLARLY_POLITE_MAILTO` now takes precedence, with the
 * old var kept as a fallback so unset environments are unchanged.
 */

const { PubMedService } = require('../../lib/services/pubmed-service');
const scholarlyEmail = require('../../lib/services/contact-enrichment/scholarly-email');

const ALERT_SENDER = 'noreply@example.org';
const MONITORED_CONTACT = 'research-ops@example.org';

const originalEnv = {
  scholarly: process.env.SCHOLARLY_POLITE_MAILTO,
  notification: process.env.NOTIFICATION_EMAIL_FROM,
};
const originalInterval = PubMedService.requestIntervalMs;

beforeEach(() => {
  PubMedService.requestIntervalMs = 0;
  PubMedService.resetRequestGovernorForTests();
  delete process.env.SCHOLARLY_POLITE_MAILTO;
  delete process.env.NOTIFICATION_EMAIL_FROM;
});

afterEach(() => {
  PubMedService.requestIntervalMs = originalInterval;
  PubMedService.resetRequestGovernorForTests();
  if (originalEnv.scholarly === undefined) delete process.env.SCHOLARLY_POLITE_MAILTO;
  else process.env.SCHOLARLY_POLITE_MAILTO = originalEnv.scholarly;
  if (originalEnv.notification === undefined) delete process.env.NOTIFICATION_EMAIL_FROM;
  else process.env.NOTIFICATION_EMAIL_FROM = originalEnv.notification;
  jest.restoreAllMocks();
});

/** Capture the URL of every outbound fetch, returning an empty-but-valid payload. */
function captureFetchUrls(payload) {
  const urls = [];
  jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
    urls.push(String(url));
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => payload,
      text: async () => '<?xml version="1.0"?><PubmedArticleSet></PubmedArticleSet>',
    };
  });
  return urls;
}

function emailParam(url) {
  return new URL(url).searchParams.get('email');
}

describe('PubMedService contact address', () => {
  test('prefers SCHOLARLY_POLITE_MAILTO over the alert sender', () => {
    process.env.NOTIFICATION_EMAIL_FROM = ALERT_SENDER;
    process.env.SCHOLARLY_POLITE_MAILTO = MONITORED_CONTACT;
    expect(PubMedService.contactEmail()).toBe(MONITORED_CONTACT);
  });

  test('falls back to NOTIFICATION_EMAIL_FROM when unset', () => {
    process.env.NOTIFICATION_EMAIL_FROM = ALERT_SENDER;
    expect(PubMedService.contactEmail()).toBe(ALERT_SENDER);
  });

  test('is null when neither var is set', () => {
    expect(PubMedService.contactEmail()).toBeNull();
  });

  test('esearch sends the monitored contact, not the alert sender', async () => {
    process.env.NOTIFICATION_EMAIL_FROM = ALERT_SENDER;
    process.env.SCHOLARLY_POLITE_MAILTO = MONITORED_CONTACT;
    const urls = captureFetchUrls({ esearchresult: { idlist: [] } });

    await PubMedService.searchPMIDs('Jane Roe[Author]', 5);

    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('esearch.fcgi');
    expect(emailParam(urls[0])).toBe(MONITORED_CONTACT);
  });

  test('efetch sends the monitored contact, not the alert sender', async () => {
    process.env.NOTIFICATION_EMAIL_FROM = ALERT_SENDER;
    process.env.SCHOLARLY_POLITE_MAILTO = MONITORED_CONTACT;
    const urls = captureFetchUrls({});

    await PubMedService.fetchArticleChunk(['111']);

    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('efetch.fcgi');
    expect(emailParam(urls[0])).toBe(MONITORED_CONTACT);
  });

  test('omits the email parameter entirely when neither var is set', async () => {
    const urls = captureFetchUrls({ esearchresult: { idlist: [] } });

    await PubMedService.searchPMIDs('Jane Roe[Author]', 5);

    expect(emailParam(urls[0])).toBeNull();
  });
});

describe('Europe PMC contact address', () => {
  test('prefers SCHOLARLY_POLITE_MAILTO over the alert sender', async () => {
    process.env.NOTIFICATION_EMAIL_FROM = ALERT_SENDER;
    process.env.SCHOLARLY_POLITE_MAILTO = MONITORED_CONTACT;
    jest.spyOn(PubMedService, 'search').mockResolvedValue([]);
    const urls = captureFetchUrls({ resultList: { result: [] } });

    await scholarlyEmail.findScholarlyEmail({
      name: 'Dr. Jane Roe',
      affiliation: 'Stanford University',
      publications: [],
    });

    const europePmcUrls = urls.filter((u) => u.includes('europepmc'));
    expect(europePmcUrls).toHaveLength(1);
    expect(emailParam(europePmcUrls[0])).toBe(MONITORED_CONTACT);
  });

  test('falls back to NOTIFICATION_EMAIL_FROM when unset', async () => {
    process.env.NOTIFICATION_EMAIL_FROM = ALERT_SENDER;
    jest.spyOn(PubMedService, 'search').mockResolvedValue([]);
    const urls = captureFetchUrls({ resultList: { result: [] } });

    await scholarlyEmail.findScholarlyEmail({
      name: 'Dr. Jane Roe',
      affiliation: 'Stanford University',
      publications: [],
    });

    const europePmcUrls = urls.filter((u) => u.includes('europepmc'));
    expect(europePmcUrls).toHaveLength(1);
    expect(emailParam(europePmcUrls[0])).toBe(ALERT_SENDER);
  });
});
