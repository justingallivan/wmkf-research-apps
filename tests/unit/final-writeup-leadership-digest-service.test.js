/**
 * @jest-environment node
 *
 * Leadership daily digest (Stage 5): program gate, writeup selection
 * (complete leadership checkpoint inside the lookback window), Leadership
 * persona recipients, at most one digest per recipient per day, frozen
 * membership, "already told" only from accepted digests, per-recipient
 * failure isolation, internal-only addresses and the day key across
 * daylight-saving changes.
 */

import {
  FINAL_WRITEUP_LEADERSHIP_DIGEST_BODY_KEY,
  FINAL_WRITEUP_LEADERSHIP_DIGEST_SUBJECT_KEY,
  LOOKBACK_DAYS,
  leadershipDigestCorrelationKey,
  leadershipDigestDay,
  renderLeadershipDigest,
  runLeadershipDigests,
} from '../../lib/services/final-writeup/leadership-digest-service.js';
import { REQUEST_DOCUMENT_LIFECYCLE_STATE } from '../../shared/config/requestDocument.js';

const RESEARCH_ID = '33333333-3333-4333-8333-333333333333';
const PRESIDENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const CSO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const PD_ONLY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const ACTOR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const NOW = new Date('2026-10-09T07:00:00Z');
const DAY = '2026-10-08';

function hoursAgo(hours) {
  return new Date(NOW.getTime() - hours * 3600 * 1000).toISOString().replace('.000Z', 'Z');
}

function request(n, extra = {}) {
  return {
    akoya_requestid: `11111111-1111-4111-8111-11111111111${n}`,
    akoya_requestnum: `100300${n}`,
    akoya_title: `Title ${n}`,
    wmkf_organizationname: `University ${n}`,
    _wmkf_programdirector_value_formatted: `Lead ${n}`,
    _wmkf_grantprogram_value: RESEARCH_ID,
    _wmkf_currentfinalwriteup_value: `22222222-2222-4222-8222-22222222222${n}`,
    ...extra,
  };
}

function final(n, extra = {}) {
  return {
    wmkf_requestdocumentid: `22222222-2222-4222-8222-22222222222${n}`,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL,
    wmkf_leadershipreviewstartedat: hoursAgo(5),
    _wmkf_leadershipreviewstartedby_value: ACTOR,
    wmkf_sharepointversionid: '3.0',
    wmkf_sharepointetag: '"etag"',
    wmkf_sharepointlastmodified: hoursAgo(6),
    wmkf_filesize: 1200,
    wmkf_contenthash: 'hash',
    ...extra,
  };
}

function fakeStore() {
  const rows = new Map();
  const keyOf = (recipient, day) => `${recipient}|${day}`;
  let tokens = 0;
  const leaseLive = (row) => row.lease_token && row.locked_until > Date.now();
  return {
    rows,
    getRow: async (recipient, day) => rows.get(keyOf(recipient, day)) || null,
    listTold: async (recipient, sinceDay) => [...rows.values()]
      .filter((row) => row.recipient_systemuser_id === recipient && row.digest_day >= sinceDay && row.accepted_at)
      .flatMap((row) => row.membership.map((item) => item.finalDocumentId)),
    claim: async ({ recipientSystemUserId, digestDay, recipientAddress, membership }) => {
      const key = keyOf(recipientSystemUserId, digestDay);
      const existing = rows.get(key);
      if (!existing) {
        const row = {
          recipient_systemuser_id: recipientSystemUserId,
          digest_day: digestDay,
          membership,
          recipient_address: recipientAddress,
          dynamics_email_id: null,
          attempt_count: 1,
          lease_token: `token-${++tokens}`,
          locked_until: Date.now() + 600000,
          accepted_at: null,
        };
        rows.set(key, row);
        return { claimed: true, row: { ...row } };
      }
      if (existing.accepted_at || leaseLive(existing)) return { claimed: false, row: { ...existing } };
      Object.assign(existing, {
        lease_token: `token-${++tokens}`,
        locked_until: Date.now() + 600000,
        attempt_count: existing.attempt_count + 1,
      });
      return { claimed: true, row: { ...existing } };
    },
    renew: async (recipient, day, token) => (rows.get(keyOf(recipient, day))?.lease_token === token ? 1 : 0),
    recordActivity: async (recipient, day, token, emailId) => {
      const row = rows.get(keyOf(recipient, day));
      if (row?.lease_token !== token || row.dynamics_email_id) return 0;
      row.dynamics_email_id = emailId;
      return 1;
    },
    markAccepted: async (recipient, day, token) => {
      const row = rows.get(keyOf(recipient, day));
      if (row?.lease_token !== token || !row.dynamics_email_id) return 0;
      Object.assign(row, { accepted_at: 'now', lease_token: null, locked_until: null });
      return 1;
    },
    recordFailure: async (recipient, day, token, code) => {
      const row = rows.get(keyOf(recipient, day));
      if (row?.lease_token !== token) return 0;
      Object.assign(row, { last_error_code: code, lease_token: null, locked_until: null });
      return 1;
    },
  };
}

function harness({ requests = [request(1)], documents = [final(1)], personas, users, copy, overrides = {} } = {}) {
  const store = fakeStore();
  const emails = new Map();
  let emailCount = 0;
  const dependencies = {
    schemaReady: () => true,
    programIds: () => [RESEARCH_ID],
    queryAllRequests: jest.fn(async () => ({ records: requests, capped: false })),
    findDocumentsByIds: jest.fn(async (ids) => ({
      records: documents.filter((doc) => ids.includes(doc.wmkf_requestdocumentid)),
      capped: false,
    })),
    personaState: jest.fn(async () => ({
      assignments: personas || [
        { reviewerId: PRESIDENT, roles: ['leadership'] },
        { reviewerId: CSO, roles: ['program-director', 'leadership'] },
        { reviewerId: PD_ONLY, roles: ['program-director'] },
      ],
    })),
    getSystemUser: jest.fn(async (id) => (users || {
      [PRESIDENT]: { systemuserid: PRESIDENT, internalemailaddress: 'president@wmkeck.org', isdisabled: false },
      [CSO]: { systemuserid: CSO, internalemailaddress: 'cso@wmkeck.org', isdisabled: false },
    })[id] || Promise.reject(Object.assign(new Error('nf'), { status: 404 }))),
    getSettingStrict: jest.fn(async (key) => ({
      found: true,
      value: (copy || {
        [FINAL_WRITEUP_LEADERSHIP_DIGEST_SUBJECT_KEY]: 'Sent to leadership: {{count}} {{writeupWord}}',
        [FINAL_WRITEUP_LEADERSHIP_DIGEST_BODY_KEY]: 'Intro for {{count}} {{writeupWord}}.',
      })[key],
    })),
    createEmailActivity: jest.fn(async (input) => {
      const id = `email-${++emailCount}`;
      emails.set(id, { activityid: id, statuscode: 1, subcategory: input.correlationKey, input });
      return id;
    }),
    getEmailActivity: jest.fn(async (id) => (emails.has(id) ? { ...emails.get(id) } : null)),
    findEmailByCorrelation: jest.fn(async (key) => [...emails.values()].filter((email) => email.subcategory === key)),
    sendEmail: jest.fn(async (id) => { emails.get(id).statuscode = 3; }),
    ...store,
    sender: () => 'notifications@wmkeck.org',
    baseUrl: () => 'https://apps.example',
    notify: jest.fn(async () => {}),
    now: () => NOW,
    ...overrides,
  };
  return { dependencies, store, emails };
}

test('no listed program means no digest and no reads', async () => {
  const { dependencies } = harness({ overrides: { programIds: () => [] } });
  await expect(runLeadershipDigests(dependencies)).resolves.toMatchObject({ status: 'disabled', results: [] });
  expect(dependencies.queryAllRequests).not.toHaveBeenCalled();
  expect(dependencies.createEmailActivity).not.toHaveBeenCalled();
});

test('the request query is limited to listed programs with a current Final', async () => {
  const { dependencies } = harness();
  await runLeadershipDigests(dependencies);
  const { filter } = dependencies.queryAllRequests.mock.calls[0][0];
  expect(filter).toContain('_wmkf_currentfinalwriteup_value ne null');
  expect(filter).toContain(`_wmkf_grantprogram_value eq ${RESEARCH_ID}`);
});

test('each Leadership-persona recipient gets one digest from the system mailbox; PD-only staff do not', async () => {
  const { dependencies, store } = harness();
  const run = await runLeadershipDigests(dependencies);
  expect(run).toMatchObject({ status: 'ran', digestDay: DAY });
  expect(run.results).toEqual([
    { recipientSystemUserId: PRESIDENT, status: 'sent', count: 1 },
    { recipientSystemUserId: CSO, status: 'sent', count: 1 },
  ]);
  expect(dependencies.getSystemUser).not.toHaveBeenCalledWith(PD_ONLY);
  const inputs = dependencies.createEmailActivity.mock.calls.map(([input]) => input);
  expect(inputs.map((input) => input.to)).toEqual(['president@wmkeck.org', 'cso@wmkeck.org']);
  expect(inputs.every((input) => input.from === 'notifications@wmkeck.org')).toBe(true);
  expect(inputs[0].correlationKey).toBe(leadershipDigestCorrelationKey(PRESIDENT, DAY));
  expect(inputs[0].subject).toBe('Sent to leadership: 1 writeup');
  expect(store.rows.get(`${PRESIDENT}|${DAY}`).accepted_at).toBeTruthy();
});

test('a second run on the same day sends nothing more', async () => {
  const { dependencies } = harness();
  await runLeadershipDigests(dependencies);
  const again = await runLeadershipDigests(dependencies);
  expect(again.results.map((result) => result.status)).toEqual(['already_sent', 'already_sent']);
  expect(dependencies.createEmailActivity).toHaveBeenCalledTimes(2);
  expect(dependencies.sendEmail).toHaveBeenCalledTimes(2);
});

test('only writeups with a complete leadership checkpoint inside the lookback window are listed', async () => {
  const requests = [request(1), request(2), request(3), request(4), request(5)];
  const documents = [
    final(1),
    final(2, { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW }),
    final(3, { wmkf_contenthash: '' }),
    final(4, { wmkf_leadershipreviewstartedat: hoursAgo(LOOKBACK_DAYS * 24 + 1) }),
    final(5, { wmkf_leadershipreviewstartedat: hoursAgo(LOOKBACK_DAYS * 24 - 1) }),
  ];
  const { dependencies, store } = harness({ requests, documents });
  await runLeadershipDigests(dependencies);
  const listed = store.rows.get(`${PRESIDENT}|${DAY}`).membership.map((item) => item.requestNumber);
  expect(listed).toEqual(['1003005', '1003001']);
});

test('a request whose current Final belongs to an unlisted program is not listed', async () => {
  const other = '33333333-3333-4333-8333-333333333334';
  const { dependencies } = harness({ requests: [request(1, { _wmkf_grantprogram_value: other })] });
  await expect(runLeadershipDigests(dependencies)).resolves.toMatchObject({ status: 'nothing_new' });
  expect(dependencies.createEmailActivity).not.toHaveBeenCalled();
});

test('nothing new sends nothing and does not read staffing', async () => {
  const { dependencies } = harness({ documents: [final(1, { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW })] });
  await expect(runLeadershipDigests(dependencies)).resolves.toMatchObject({ status: 'nothing_new' });
  expect(dependencies.personaState).not.toHaveBeenCalled();
  expect(dependencies.createEmailActivity).not.toHaveBeenCalled();
});

test('a writeup in an accepted earlier digest is not listed again; one in an unaccepted digest is', async () => {
  const { dependencies, store } = harness({ requests: [request(1), request(2)], documents: [final(1), final(2)] });
  store.rows.set(`${PRESIDENT}|2026-10-07`, {
    recipient_systemuser_id: PRESIDENT, digest_day: '2026-10-07', accepted_at: 'then',
    membership: [{ finalDocumentId: final(1).wmkf_requestdocumentid }],
  });
  store.rows.set(`${CSO}|2026-10-07`, {
    recipient_systemuser_id: CSO, digest_day: '2026-10-07', accepted_at: null,
    membership: [{ finalDocumentId: final(1).wmkf_requestdocumentid }],
  });
  await runLeadershipDigests(dependencies);
  expect(store.rows.get(`${PRESIDENT}|${DAY}`).membership.map((item) => item.requestNumber)).toEqual(['1003002']);
  expect(store.rows.get(`${CSO}|${DAY}`).membership.map((item) => item.requestNumber)).toEqual(['1003001', '1003002']);
});

test('a recipient whose address is outside the foundation domain is not emailed and is alerted; others still get theirs', async () => {
  const { dependencies } = harness({
    users: {
      [PRESIDENT]: { systemuserid: PRESIDENT, internalemailaddress: 'president@example.com', isdisabled: false },
      [CSO]: { systemuserid: CSO, internalemailaddress: 'cso@wmkeck.org', isdisabled: false },
    },
  });
  const run = await runLeadershipDigests(dependencies);
  expect(run.results.map((result) => result.status)).toEqual(['recipient_unavailable', 'sent']);
  expect(dependencies.createEmailActivity).toHaveBeenCalledTimes(1);
  expect(dependencies.notify).toHaveBeenCalledWith(expect.objectContaining({
    type: 'final_writeup_leadership_digest_undelivered',
    metadata: expect.objectContaining({ recipientSystemUserId: PRESIDENT, reason: 'recipient_unavailable' }),
  }));
});

test('a recipient lookup outage fails only that recipient and alerts', async () => {
  const { dependencies } = harness();
  dependencies.getSystemUser.mockImplementationOnce(async () => { throw Object.assign(new Error('down'), { status: 503 }); });
  const run = await runLeadershipDigests(dependencies);
  expect(run.results).toEqual([
    { recipientSystemUserId: PRESIDENT, status: 'failed', code: 'leadership_digest_recipient_lookup_failed' },
    { recipientSystemUserId: CSO, status: 'sent', count: 1 },
  ]);
  expect(dependencies.notify).toHaveBeenCalledTimes(1);
});

test('a failed send is retried the same day with the frozen membership and no second activity', async () => {
  const { dependencies, store } = harness({ personas: [{ reviewerId: PRESIDENT, roles: ['leadership'] }] });
  dependencies.sendEmail.mockRejectedValueOnce(new Error('transport'));
  const first = await runLeadershipDigests(dependencies);
  expect(first.results[0]).toMatchObject({ status: 'failed', code: 'leadership_digest_send_failed' });
  const row = store.rows.get(`${PRESIDENT}|${DAY}`);
  expect(row).toMatchObject({ accepted_at: null, last_error_code: 'leadership_digest_send_failed', lease_token: null });

  // A writeup that arrives after the first claim waits for tomorrow's digest.
  dependencies.queryAllRequests.mockResolvedValue({ records: [request(1), request(2)], capped: false });
  dependencies.findDocumentsByIds.mockResolvedValue({ records: [final(1), final(2)], capped: false });
  const second = await runLeadershipDigests(dependencies);
  expect(second.results[0]).toMatchObject({ status: 'sent', count: 1 });
  expect(dependencies.createEmailActivity).toHaveBeenCalledTimes(1);
  expect(store.rows.get(`${PRESIDENT}|${DAY}`).membership.map((item) => item.requestNumber)).toEqual(['1003001']);
});

test('an activity created before its id was recorded is recovered by correlation, not duplicated', async () => {
  const { dependencies, store } = harness({ personas: [{ reviewerId: PRESIDENT, roles: ['leadership'] }] });
  dependencies.recordActivity = jest.fn(async () => { throw new Error('postgres down'); });
  const first = await runLeadershipDigests(dependencies);
  expect(first.results[0].status).toBe('failed');
  dependencies.recordActivity = store.recordActivity;
  const second = await runLeadershipDigests(dependencies);
  expect(second.results[0].status).toBe('sent');
  expect(dependencies.createEmailActivity).toHaveBeenCalledTimes(1);
  expect(dependencies.sendEmail).toHaveBeenCalledTimes(1);
});

test('an ambiguous send error whose readback shows acceptance counts as sent', async () => {
  const { dependencies, emails } = harness({ personas: [{ reviewerId: PRESIDENT, roles: ['leadership'] }] });
  dependencies.sendEmail.mockImplementationOnce(async (id) => {
    emails.get(id).statuscode = 3;
    throw new Error('timeout after accept');
  });
  const run = await runLeadershipDigests(dependencies);
  expect(run.results[0]).toMatchObject({ status: 'sent' });
});

test('blank copy sends nothing, claims nothing, and alerts', async () => {
  const { dependencies, store } = harness({
    copy: { [FINAL_WRITEUP_LEADERSHIP_DIGEST_SUBJECT_KEY]: '  ', [FINAL_WRITEUP_LEADERSHIP_DIGEST_BODY_KEY]: 'x' },
  });
  const run = await runLeadershipDigests(dependencies);
  expect(run.results.map((result) => result.status)).toEqual(['copy_missing', 'copy_missing']);
  expect(store.rows.size).toBe(0);
  expect(dependencies.createEmailActivity).not.toHaveBeenCalled();
  expect(dependencies.notify).toHaveBeenCalledTimes(2);
});

test('no Leadership persona while writeups are waiting raises an alert', async () => {
  const { dependencies } = harness({ personas: [{ reviewerId: PD_ONLY, roles: ['program-director'] }] });
  await expect(runLeadershipDigests(dependencies)).resolves.toMatchObject({ status: 'no_recipients' });
  expect(dependencies.notify).toHaveBeenCalledWith(expect.objectContaining({
    metadata: expect.objectContaining({ reason: 'no_leadership_recipients' }),
  }));
});

test('a capped request scan fails the run instead of freezing a partial list', async () => {
  const { dependencies } = harness({ overrides: { queryAllRequests: jest.fn(async () => ({ records: [request(1)], capped: true })) } });
  await expect(runLeadershipDigests(dependencies)).rejects.toMatchObject({ code: 'leadership_digest_request_scan_capped' });
});

test('the digest day is the UTC day before the run, so daily runs get consecutive keys across DST changes', () => {
  const runs = [
    '2026-10-31T07:00:00Z', '2026-11-01T07:00:00Z', '2026-11-02T07:00:00Z',
    '2027-03-13T07:00:00Z', '2027-03-14T07:00:00Z', '2027-03-15T07:00:00Z',
  ].map((iso) => leadershipDigestDay(new Date(iso)));
  expect(runs).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2027-03-12', '2027-03-13', '2027-03-14']);
});

test('the rendered digest escapes staff-entered text and links each request to its Final writeup tab', () => {
  const { subject, html } = renderLeadershipDigest({
    subjectTemplate: 'Sent to leadership: {{count}} {{writeupWord}}',
    bodyTemplate: 'Hello.\n\nSecond paragraph.',
    membership: [{ requestId: 'r-1', requestNumber: '1003001', title: '<b>Cells</b>', institution: 'A & B', leadProgramDirector: 'Lead' }],
    baseUrl: 'https://apps.example',
  });
  expect(subject).toBe('Sent to leadership: 1 writeup');
  expect(html).toContain('<p>Hello.</p>');
  expect(html).toContain('href="https://apps.example/workbench/r-1?tab=final-writeup"');
  expect(html).toContain('&lt;b&gt;Cells&lt;/b&gt;');
  expect(html).toContain('A &amp; B · Lead PD: Lead');
});
