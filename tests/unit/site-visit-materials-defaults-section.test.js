/**
 * @jest-environment jsdom
 *
 * SiteVisitMaterialsDefaultsSection — T3 per-call-site matrix (Stage 3,
 * group A) ahead of migrating its two fetch sites (GET load, PUT save)
 * onto shared/utils/api-request.js. Both sites are tolerant-`.json()`,
 * `!ok` throw with a fallback message.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SiteVisitMaterialsDefaultsSection from '../../shared/components/admin/SiteVisitMaterialsDefaultsSection';

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

function unparseableResponse(status) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.reject(new SyntaxError('bad json')) };
}

describe('SiteVisitMaterialsDefaultsSection', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  describe('GET /api/admin/site-visit-materials-defaults (load)', () => {
    test('(a) 2xx populates the field from the default', async () => {
      global.fetch.mockResolvedValueOnce(jsonResponse(200, { maxMb: 500, limits: { min: 1, max: 500 }, defaultMb: 500, source: 'default' }));
      render(<SiteVisitMaterialsDefaultsSection />);
      expect(await screen.findByLabelText('Upload cap (MB)')).toHaveValue(500);
      expect(screen.getByText(/Using the default of 500 MB/)).toBeInTheDocument();
      expect(global.fetch.mock.calls[0][0]).toBe('/api/admin/site-visit-materials-defaults');
    });

    test('(b) non-2xx {error} shows that message verbatim', async () => {
      global.fetch.mockResolvedValueOnce(jsonResponse(403, { error: 'Admin access required' }));
      render(<SiteVisitMaterialsDefaultsSection />);
      expect(await screen.findByRole('alert')).toHaveTextContent('Admin access required');
    });

    test('(c) network rejection surfaces the rejection\'s own message', async () => {
      global.fetch.mockRejectedValueOnce(new Error('network down'));
      render(<SiteVisitMaterialsDefaultsSection />);
      expect(await screen.findByRole('alert')).toHaveTextContent('network down');
    });

    test('(d) malformed 2xx body (tolerant) becomes {} and crashes into the fallback', async () => {
      global.fetch.mockResolvedValueOnce(unparseableResponse(200));
      render(<SiteVisitMaterialsDefaultsSection />);
      // data = {}; setMaxMb(String(undefined)) -> "undefined"; no throw, no error.
      expect(await screen.findByLabelText('Upload cap (MB)')).toHaveValue(null);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    test('(e) non-2xx unparseable body (502) still shows the fallback message, never silent', async () => {
      global.fetch.mockResolvedValueOnce(unparseableResponse(502));
      render(<SiteVisitMaterialsDefaultsSection />);
      expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load the upload cap.');
    });
  });

  describe('PUT /api/admin/site-visit-materials-defaults (save)', () => {
    async function setup() {
      global.fetch.mockResolvedValueOnce(jsonResponse(200, { maxMb: 500, limits: { min: 1, max: 500 }, defaultMb: 500, source: 'default' }));
      render(<SiteVisitMaterialsDefaultsSection />);
      await screen.findByLabelText('Upload cap (MB)');
      fireEvent.change(screen.getByLabelText('Upload cap (MB)'), { target: { value: '80' } });
    }

    test('(a) 2xx updates baseline and shows the saved status; exact request bytes', async () => {
      await setup();
      global.fetch.mockResolvedValueOnce(jsonResponse(200, { maxMb: 80, source: 'setting' }));
      fireEvent.click(screen.getByText('Save upload cap'));
      expect(await screen.findByRole('status')).toHaveTextContent('Saved. New uploads use this cap.');

      const [, putCall] = global.fetch.mock.calls;
      expect(putCall[0]).toBe('/api/admin/site-visit-materials-defaults');
      expect(putCall[1].method).toBe('PUT');
      expect(putCall[1].headers).toEqual({ 'Content-Type': 'application/json' });
      expect(putCall[1].body).toBe(JSON.stringify({ maxMb: 80 }));
    });

    test('(b) non-2xx {error} shows that message verbatim', async () => {
      await setup();
      global.fetch.mockResolvedValueOnce(jsonResponse(403, { error: 'Admin access required' }));
      fireEvent.click(screen.getByText('Save upload cap'));
      expect(await screen.findByRole('alert')).toHaveTextContent('Admin access required');
    });

    test('(c) network rejection surfaces the rejection\'s own message', async () => {
      await setup();
      global.fetch.mockRejectedValueOnce(new Error('network down'));
      fireEvent.click(screen.getByText('Save upload cap'));
      expect(await screen.findByRole('alert')).toHaveTextContent('network down');
    });

    test('(d) malformed 2xx body (tolerant) becomes {} and shows "Saved" with maxMb = undefined', async () => {
      await setup();
      global.fetch.mockResolvedValueOnce(unparseableResponse(200));
      fireEvent.click(screen.getByText('Save upload cap'));
      expect(await screen.findByRole('status')).toHaveTextContent('Saved. New uploads use this cap.');
      expect(screen.getByLabelText('Upload cap (MB)')).toHaveValue(null);
    });

    test('(e) non-2xx unparseable body (502) shows the fallback message, never silent', async () => {
      await setup();
      global.fetch.mockResolvedValueOnce(unparseableResponse(502));
      fireEvent.click(screen.getByText('Save upload cap'));
      expect(await screen.findByRole('alert')).toHaveTextContent('Failed to save the upload cap.');
    });
  });
});


test('offset and upload cap save independently; blank and fractional offsets cannot be saved', async () => {
  global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(200, { maxMb: 500, dueBusinessDays: 2, source: 'default' }));
  render(<SiteVisitMaterialsDefaultsSection />);
  const days = await screen.findByLabelText('Materials due (business days before the site visit)');
  const save = screen.getByRole('button', { name: 'Save due-date offset' });
  expect(days).toHaveValue(2);
  for (const value of ['', '1.5', '0', '31']) {
    fireEvent.change(days, { target: { value } });
    expect(save).toBeDisabled();
  }
  fireEvent.change(screen.getByLabelText('Upload cap (MB)'), { target: { value: '200' } });
  fireEvent.change(days, { target: { value: '5' } });
  global.fetch.mockResolvedValueOnce(jsonResponse(200, { success: true, dueBusinessDays: 5, dueDaysSource: 'setting' }));
  fireEvent.click(save);
  expect(await screen.findByRole('status')).toHaveTextContent('Existing deadlines are unchanged');
  expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({ dueBusinessDays: 5 });
  expect(screen.getByLabelText('Upload cap (MB)')).toHaveValue(200);
  expect(screen.getByRole('button', { name: 'Save upload cap' })).toBeEnabled();
});

test('an offset save failure keeps the edit retryable and never claims success', async () => {
  global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(200, { maxMb: 500, dueBusinessDays: 2 }));
  render(<SiteVisitMaterialsDefaultsSection />);
  const days = await screen.findByLabelText('Materials due (business days before the site visit)');
  fireEvent.change(days, { target: { value: '5' } });
  global.fetch.mockResolvedValueOnce(jsonResponse(503, { error: 'Setting unavailable' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save due-date offset' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Setting unavailable');
  expect(days).toHaveValue(5);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save due-date offset' })).toBeEnabled();
});


test.each([{}, { success: true }, { success: true, dueBusinessDays: 0 }])('incomplete offset save response %p does not claim success', async (response) => {
  global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(200, { maxMb: 500, dueBusinessDays: 2 }));
  render(<SiteVisitMaterialsDefaultsSection />);
  const days = await screen.findByLabelText('Materials due (business days before the site visit)');
  fireEvent.change(days, { target: { value: '5' } });
  global.fetch.mockResolvedValueOnce(jsonResponse(200, response));
  fireEvent.click(screen.getByRole('button', { name: 'Save due-date offset' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('The save could not be confirmed');
  expect(days).toHaveValue(5);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save due-date offset' })).toBeEnabled();
});
