/**
 * @jest-environment jsdom
 *
 * MeetingTrackerDefaultsSection — T3 per-call-site matrix (Stage 3, group A)
 * ahead of migrating its two fetch sites (GET load, PUT save) onto
 * shared/utils/api-request.js. Both sites are tolerant-`.json()`, `!ok`
 * throw with a fallback message.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import MeetingTrackerDefaultsSection from '../../shared/components/admin/MeetingTrackerDefaultsSection';

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

function unparseableResponse(status) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.reject(new SyntaxError('bad json')) };
}

const staff = [{ name: 'Alice', ref: { profileId: 1 } }, { name: 'Bob', ref: { profileId: 2 } }];

describe('MeetingTrackerDefaultsSection', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  describe('GET /api/admin/meeting-tracker-defaults (load)', () => {
    test('(a) 2xx populates staff and default selection', async () => {
      global.fetch.mockResolvedValueOnce(jsonResponse(200, { staff, defaultAttendeeRefs: [{ profileId: 1 }] }));
      render(<MeetingTrackerDefaultsSection />);
      expect(await screen.findByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Alice')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByText('Bob')).toHaveAttribute('aria-pressed', 'false');
      expect(global.fetch.mock.calls[0][0]).toBe('/api/admin/meeting-tracker-defaults');
    });

    test('(b) non-2xx {error} shows that message verbatim', async () => {
      global.fetch.mockResolvedValueOnce(jsonResponse(403, { error: 'Admin access required' }));
      render(<MeetingTrackerDefaultsSection />);
      expect(await screen.findByRole('alert')).toHaveTextContent('Admin access required');
    });

    test('(c) network rejection surfaces the rejection\'s own message', async () => {
      global.fetch.mockRejectedValueOnce(new Error('network down'));
      render(<MeetingTrackerDefaultsSection />);
      expect(await screen.findByRole('alert')).toHaveTextContent('network down');
    });

    test('(d) malformed 2xx body (tolerant) becomes {} with no staff and no error', async () => {
      global.fetch.mockResolvedValueOnce(unparseableResponse(200));
      render(<MeetingTrackerDefaultsSection />);
      expect(await screen.findByText('No active staff profiles are available.')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    test('(e) non-2xx unparseable body (502) still shows the fallback message, never silent', async () => {
      global.fetch.mockResolvedValueOnce(unparseableResponse(502));
      render(<MeetingTrackerDefaultsSection />);
      expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load Meeting Tracker defaults.');
    });
  });

  describe('PUT /api/admin/meeting-tracker-defaults (save)', () => {
    async function setup() {
      global.fetch.mockResolvedValueOnce(jsonResponse(200, { staff, defaultAttendeeRefs: [{ profileId: 1 }] }));
      render(<MeetingTrackerDefaultsSection />);
      await screen.findByText('Alice');
      fireEvent.click(screen.getByText('Bob'));
    }

    test('(a) 2xx updates baseline and status; exact request bytes', async () => {
      await setup();
      global.fetch.mockResolvedValueOnce(jsonResponse(200, { defaultAttendeeRefs: [{ profileId: 1 }, { profileId: 2 }] }));
      fireEvent.click(screen.getByText('Save default attendees'));
      expect(await screen.findByRole('status')).toHaveTextContent('Saved. New sessions start with this list.');

      const [, putCall] = global.fetch.mock.calls;
      expect(putCall[0]).toBe('/api/admin/meeting-tracker-defaults');
      expect(putCall[1].method).toBe('PUT');
      expect(putCall[1].headers).toEqual({ 'Content-Type': 'application/json' });
      expect(putCall[1].body).toBe(JSON.stringify({ attendees: [{ kind: 'staff', profileId: 1 }, { kind: 'staff', profileId: 2 }] }));
    });

    test('(b) non-2xx {error} shows that message verbatim', async () => {
      await setup();
      global.fetch.mockResolvedValueOnce(jsonResponse(403, { error: 'Admin access required' }));
      fireEvent.click(screen.getByText('Save default attendees'));
      expect(await screen.findByRole('alert')).toHaveTextContent('Admin access required');
    });

    test('(c) network rejection surfaces the rejection\'s own message', async () => {
      await setup();
      global.fetch.mockRejectedValueOnce(new Error('network down'));
      fireEvent.click(screen.getByText('Save default attendees'));
      expect(await screen.findByRole('alert')).toHaveTextContent('network down');
    });

    test('(e) non-2xx unparseable body (502) shows the fallback message, never silent', async () => {
      await setup();
      global.fetch.mockResolvedValueOnce(unparseableResponse(502));
      fireEvent.click(screen.getByText('Save default attendees'));
      expect(await screen.findByRole('alert')).toHaveTextContent('Failed to save the default attendee list.');
    });
  });
});
