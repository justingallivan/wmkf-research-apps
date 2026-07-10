/**
 * @jest-environment jsdom
 *
 * CampaignConfigModal — reviewer quota (`desiredCount`) UI (docs/REVIEWER_QUOTA_PD_EMAIL_PLAN.md
 * Change #1). Backend read/write already exist end-to-end
 * (lib/services/review-manager/campaign-config-service.js); this is UI-only coverage that the
 * modal loads, saves, and clears the quota target correctly.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CampaignConfigModal from '../../shared/components/reviewers/CampaignConfigModal';

const REQUEST_ID = 'req-1';

afterEach(() => { if (global.fetch && global.fetch.mockRestore) global.fetch.mockRestore(); });

function mockGet(config, defaultsTimeline = { reviewDueDate: '', desiredCount: 4 }, defaultsOk = true) {
  return jest.spyOn(global, 'fetch').mockImplementation((url, opts) => {
    if (!opts || opts.method === undefined) {
      if (String(url).includes('campaign-timeline-defaults')) {
        if (!defaultsOk) return Promise.resolve({ ok: false, json: async () => ({ error: 'nope' }) });
        return Promise.resolve({ ok: true, json: async () => ({ timeline: defaultsTimeline, isDefault: false, malformed: false }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ requestId: REQUEST_ID, config }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
  });
}

describe('CampaignConfigModal — reviewer quota (desiredCount)', () => {
  test('loads desiredCount from GET into the quota input', async () => {
    mockGet({ respondOffsetDays: 5, reviewDueDate: null, desiredCount: 4 });
    render(<CampaignConfigModal requestId={REQUEST_ID} onClose={jest.fn()} />);
    await waitFor(() => expect(screen.getByDisplayValue('4')).toBeInTheDocument());
  });

  test('saving posts desiredCount alongside the existing response-timing fields', async () => {
    const fetchSpy = mockGet({ respondOffsetDays: 5, reviewDueDate: '2026-08-01', desiredCount: 4 });
    render(<CampaignConfigModal requestId={REQUEST_ID} onClose={jest.fn()} onSaved={jest.fn()} />);
    await waitFor(() => expect(screen.getByDisplayValue('4')).toBeInTheDocument());

    fireEvent.change(screen.getByDisplayValue('4'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const postCall = fetchSpy.mock.calls.find(([, opts]) => opts && opts.method === 'POST');
      expect(postCall).toBeTruthy();
      const body = JSON.parse(postCall[1].body);
      expect(body).toEqual({
        requestId: REQUEST_ID,
        config: { respondOffsetDays: 5, reviewDueDate: '2026-08-01', desiredCount: 6 },
      });
    });
  });

  test('clearing the quota field posts desiredCount: null, not 0', async () => {
    const fetchSpy = mockGet({ respondOffsetDays: 5, reviewDueDate: '2026-08-01', desiredCount: 4 });
    render(<CampaignConfigModal requestId={REQUEST_ID} onClose={jest.fn()} onSaved={jest.fn()} />);
    await waitFor(() => expect(screen.getByDisplayValue('4')).toBeInTheDocument());

    fireEvent.change(screen.getByDisplayValue('4'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const postCall = fetchSpy.mock.calls.find(([, opts]) => opts && opts.method === 'POST');
      expect(postCall).toBeTruthy();
      const body = JSON.parse(postCall[1].body);
      expect(body.config.desiredCount).toBeNull();
    });
  });
});

describe('CampaignConfigModal — admin default prefill', () => {
  test('null request-level reviewDueDate and desiredCount prefill from admin defaults', async () => {
    mockGet(
      { respondOffsetDays: 5, reviewDueDate: null, desiredCount: null },
      { reviewDueDate: '2026-09-01', desiredCount: 8 },
    );
    render(<CampaignConfigModal requestId={REQUEST_ID} onClose={jest.fn()} />);
    await waitFor(() => expect(screen.getByDisplayValue('8')).toBeInTheDocument());
    expect(screen.getByDisplayValue('2026-09-01')).toBeInTheDocument();
  });

  test('non-null request-level values win over admin defaults', async () => {
    mockGet(
      { respondOffsetDays: 5, reviewDueDate: '2026-08-01', desiredCount: 6 },
      { reviewDueDate: '2026-09-01', desiredCount: 8 },
    );
    render(<CampaignConfigModal requestId={REQUEST_ID} onClose={jest.fn()} />);
    await waitFor(() => expect(screen.getByDisplayValue('6')).toBeInTheDocument());
    expect(screen.getByDisplayValue('2026-08-01')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('8')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('2026-09-01')).not.toBeInTheDocument();
  });

  test('admin defaults fetch failure leaves reviewDueDate and desiredCount empty', async () => {
    mockGet(
      { respondOffsetDays: 5, reviewDueDate: null, desiredCount: null },
      undefined,
      false,
    );
    render(<CampaignConfigModal requestId={REQUEST_ID} onClose={jest.fn()} />);
    await waitFor(() => expect(screen.getByDisplayValue('5')).toBeInTheDocument());
    expect(screen.queryByDisplayValue('2026-09-01')).not.toBeInTheDocument();
    // Both the quota and review-due-date inputs should be blank.
    const quotaInput = screen.getByLabelText(/reviewer quota/i);
    const dueDateInput = screen.getByLabelText(/review due date/i);
    expect(quotaInput).toHaveValue(null);
    expect(dueDateInput.value).toBe('');
  });
});
