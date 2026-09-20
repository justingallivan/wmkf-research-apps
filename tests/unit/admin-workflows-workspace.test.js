/**
 * @jest-environment jsdom
 *
 * T3 (Stage 3) per-call-site contract matrix for the inline admin sections
 * reachable through `WorkflowsWorkspace` (pages/admin.js), view="external-review":
 * HonorariumAmountSection (:2703, :2724), ReviewerReleaseAttachmentsSection
 * (:2796, :2814), ReviewerCampaignTimelineSection (:2877, :2919), and
 * ReviewerTimeBudgetSection (:3054, :3076). All four share one shape: bare
 * `.json()` read unconditionally (both branches), `data?.error || '<fixed
 * fallback>'`. Run against the unmigrated code first (must pass), then
 * unchanged after each migration commit.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { WorkflowsWorkspace } from '../../pages/admin';

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const partial = (text) => new RegExp(escapeRegex(text));
const sectionFor = (renderedText) => screen.getByText(partial(renderedText)).closest('div');

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const malformedResponse = (status) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
});

afterEach(() => {
  jest.restoreAllMocks();
});

function makeSectionSuite({
  name, getUrl, putUrl, saveButtonLabel, getFixture, getRenderedText, saveBody, putFixture, postSaveRenderedText,
}) {
  describe(`${name} (view="external-review")`, () => {
    test('(a) 2xx GET renders loaded data', async () => {
      global.fetch = jest.fn((url) => Promise.resolve(url === getUrl ? jsonResponse(200, getFixture) : jsonResponse(200, {})));
      render(<WorkflowsWorkspace view="external-review" />);
      expect(await screen.findByText(partial(getRenderedText))).toBeInTheDocument();
    });

    test('(b) GET non-2xx shows body.error via fallbackMessage', async () => {
      global.fetch = jest.fn((url) => Promise.resolve(url === getUrl ? jsonResponse(500, { error: 'load boom' }) : jsonResponse(200, {})));
      render(<WorkflowsWorkspace view="external-review" />);
      expect(await screen.findByText('load boom')).toBeInTheDocument();
    });

    test('(b2) GET non-2xx with no body.error falls back to "Failed to load"', async () => {
      global.fetch = jest.fn((url) => Promise.resolve(url === getUrl ? jsonResponse(500, {}) : jsonResponse(200, {})));
      render(<WorkflowsWorkspace view="external-review" />);
      expect(await screen.findByText('Failed to load')).toBeInTheDocument();
    });

    test('(c) GET network rejection shows err.message', async () => {
      global.fetch = jest.fn((url) => (url === getUrl ? Promise.reject(new Error('offline')) : Promise.resolve(jsonResponse(200, {}))));
      render(<WorkflowsWorkspace view="external-review" />);
      expect(await screen.findByText('offline')).toBeInTheDocument();
    });

    test('(d) GET malformed 2xx surfaces the native parse error', async () => {
      global.fetch = jest.fn((url) => Promise.resolve(url === getUrl ? malformedResponse(200) : jsonResponse(200, {})));
      render(<WorkflowsWorkspace view="external-review" />);
      expect(await screen.findByText('Unexpected end of JSON input')).toBeInTheDocument();
    });

    test('(e) GET unparseable non-2xx surfaces the native parse error too (today\'s bare .json() runs before the ok check), never silent', async () => {
      global.fetch = jest.fn((url) => Promise.resolve(url === getUrl ? malformedResponse(500) : jsonResponse(200, {})));
      render(<WorkflowsWorkspace view="external-review" />);
      expect(await screen.findByText('Unexpected end of JSON input')).toBeInTheDocument();
    });

    test('save: sends exact body/method/headers, shows body.error on non-2xx', async () => {
      let putCall = null;
      global.fetch = jest.fn((url, init) => {
        if (url === putUrl && init?.method === 'PUT') { putCall = init; return Promise.resolve(jsonResponse(400, { error: 'Save boom' })); }
        return Promise.resolve(jsonResponse(200, getFixture));
      });
      render(<WorkflowsWorkspace view="external-review" />);
      await screen.findByText(partial(getRenderedText));
      fireEvent.click(within(sectionFor(getRenderedText)).getByText(saveButtonLabel));
      await waitFor(() => expect(putCall).not.toBeNull());
      expect(putCall.method).toBe('PUT');
      expect(putCall.headers['Content-Type']).toBe('application/json');
      expect(putCall.body).toBe(JSON.stringify(saveBody));
      expect(await screen.findByText('Save boom')).toBeInTheDocument();
    });

    test('save: non-2xx with no body.error falls back to "Save failed"', async () => {
      global.fetch = jest.fn((url, init) => Promise.resolve(url === putUrl && init?.method === 'PUT' ? jsonResponse(500, {}) : jsonResponse(200, getFixture)));
      render(<WorkflowsWorkspace view="external-review" />);
      await screen.findByText(partial(getRenderedText));
      fireEvent.click(within(sectionFor(getRenderedText)).getByText(saveButtonLabel));
      expect(await screen.findByText('Save failed')).toBeInTheDocument();
    });

    test('save: network rejection shows err.message', async () => {
      global.fetch = jest.fn((url, init) => (url === putUrl && init?.method === 'PUT' ? Promise.reject(new Error('save offline')) : Promise.resolve(jsonResponse(200, getFixture))));
      render(<WorkflowsWorkspace view="external-review" />);
      await screen.findByText(partial(getRenderedText));
      fireEvent.click(within(sectionFor(getRenderedText)).getByText(saveButtonLabel));
      expect(await screen.findByText('save offline')).toBeInTheDocument();
    });

    test('save: unparseable non-2xx surfaces the native parse error too (bare .json() runs before the ok check), never silent', async () => {
      global.fetch = jest.fn((url, init) => Promise.resolve(url === putUrl && init?.method === 'PUT' ? malformedResponse(502) : jsonResponse(200, getFixture)));
      render(<WorkflowsWorkspace view="external-review" />);
      await screen.findByText(partial(getRenderedText));
      fireEvent.click(within(sectionFor(getRenderedText)).getByText(saveButtonLabel));
      expect(await screen.findByText('Unexpected end of JSON input')).toBeInTheDocument();
    });

    test('save: 2xx success reloads and reflects saved state', async () => {
      let phase = 'initial';
      global.fetch = jest.fn((url, init) => {
        if (url === putUrl && init?.method === 'PUT') { phase = 'saved'; return Promise.resolve(jsonResponse(200, putFixture)); }
        return Promise.resolve(jsonResponse(200, phase === 'saved' ? putFixture : getFixture));
      });
      render(<WorkflowsWorkspace view="external-review" />);
      await screen.findByText(partial(getRenderedText));
      fireEvent.click(within(sectionFor(getRenderedText)).getByText(saveButtonLabel));
      expect(await screen.findByText(postSaveRenderedText)).toBeInTheDocument();
    });
  });
}

makeSectionSuite({
  name: 'HonorariumAmountSection',
  getUrl: '/api/admin/honorarium-amount',
  putUrl: '/api/admin/honorarium-amount',
  saveButtonLabel: 'Save',
  getFixture: { amount: 250, isDefault: false, malformed: false },
  getRenderedText: 'Read live when a reviewer accepts',
  saveBody: { amount: 250 },
  putFixture: { amount: 250, isDefault: false, malformed: false },
  postSaveRenderedText: 'Saved',
});

makeSectionSuite({
  name: 'ReviewerReleaseAttachmentsSection',
  getUrl: '/api/review-manager/release-settings',
  putUrl: '/api/review-manager/release-settings',
  saveButtonLabel: 'Attach proposal/files to the release email (in addition to the portal link)',
  getFixture: { attachProposalEmail: false },
  getRenderedText: 'When ON, the release (materials) email',
  saveBody: { attachProposalEmail: true },
  putFixture: { attachProposalEmail: true },
  postSaveRenderedText: 'Saved',
});

makeSectionSuite({
  name: 'ReviewerCampaignTimelineSection',
  getUrl: '/api/review-manager/campaign-timeline-defaults',
  putUrl: '/api/review-manager/campaign-timeline-defaults',
  saveButtonLabel: 'Save',
  getFixture: { timeline: { cycleLabel: 'D26' }, isDefault: false, malformed: false },
  getRenderedText: 'Current-cycle defaults for reviewer invitation copy.',
  saveBody: { timeline: { cycleLabel: 'D26', inviteStartDate: '', respondOffsetDays: null, proposalReleaseDate: '', reviewDueDate: '', desiredCount: null } },
  putFixture: { timeline: { cycleLabel: 'D26' }, isDefault: false, malformed: false },
  postSaveRenderedText: 'Saved',
});

makeSectionSuite({
  name: 'ReviewerTimeBudgetSection',
  getUrl: '/api/admin/reviewer-time-budget',
  putUrl: '/api/admin/reviewer-time-budget',
  saveButtonLabel: 'Save',
  getFixture: { seconds: 600, isDefault: false, malformed: false, min: 120, max: 800 },
  getRenderedText: 'Maximum time a reviewer search',
  saveBody: { seconds: 600 },
  putFixture: { seconds: 600, isDefault: false, malformed: false, min: 120, max: 800 },
  postSaveRenderedText: 'Saved',
});
