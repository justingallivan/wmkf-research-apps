/**
 * @jest-environment jsdom
 *
 * PoliciesSection — unique-label guidance in the publish form (S356, label_conflict
 * UX). Server-side immutability and the label_conflict outcome are covered by
 * tests/unit/policies-service.test.js; this is UI-only coverage that the form
 * steers staff toward a unique label BEFORE they hit the 409:
 *   - the label field defaults to a label not already used by a version
 *   - typing/prefilling a taken label shows the inline warning + suggestion
 *   - applying the suggestion clears the warning
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PoliciesSection from '../../shared/components/admin/PoliciesSection';

const TODAY = new Date().toISOString().slice(0, 10);

function makeState({ versions }) {
  const active = versions.find(v => v.isActive) || null;
  return {
    slots: [{
      code: 'grantee-waiver',
      parentId: 'p-1',
      displayName: 'Grantee Publication Waiver',
      parentEtag: 'W/"1"',
      activeVersion: active && {
        id: active.id,
        versionLabel: active.versionLabel,
        title: active.title,
        body: active.body,
        effectiveDate: active.effectiveDate,
      },
      versions,
    }],
  };
}

function mockGet(state) {
  return jest.spyOn(global, 'fetch').mockImplementation(() =>
    Promise.resolve({ ok: true, status: 200, json: async () => state }));
}

afterEach(() => { if (global.fetch && global.fetch.mockRestore) global.fetch.mockRestore(); });

async function openForm() {
  await waitFor(() => expect(screen.getByText('Grantee Publication Waiver')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /publish new version/i }));
}

const version = (label, extra = {}) => ({
  id: `v-${label}`, versionLabel: label, title: 'Waiver', body: 'x'.repeat(60),
  effectiveDate: '2026-07-01', statecode: 0, statuscode: 1,
  isActive: false, isResidue: false, ...extra,
});

describe('PoliciesSection — unique-label guidance', () => {
  test('label defaults to a -2 suffix when today\'s label is already a version', async () => {
    mockGet(makeState({ versions: [version(TODAY, { isActive: true })] }));
    render(<PoliciesSection />);
    await openForm();
    expect(screen.getByDisplayValue(`${TODAY}-2`)).toBeInTheDocument();
    expect(screen.queryByText(/already used by a published version/i)).not.toBeInTheDocument();
  });

  test('label defaults to today unchanged when no version uses it', async () => {
    mockGet(makeState({ versions: [version('2026-01-01', { isActive: true })] }));
    render(<PoliciesSection />);
    await openForm();
    expect(screen.getByLabelText(/version label/i)).toHaveValue(TODAY);
  });

  test('prefill from active copies the taken label and shows the warning; the suggestion button resolves it', async () => {
    mockGet(makeState({ versions: [version('v1', { isActive: true }), version('v1-2')] }));
    render(<PoliciesSection />);
    await openForm();

    fireEvent.click(screen.getByRole('button', { name: /prefill from active version/i }));
    expect(screen.getByDisplayValue('v1')).toBeInTheDocument();
    expect(screen.getByText(/already used by a published version/i)).toBeInTheDocument();

    // v1 and v1-2 are taken → suggests v1-3
    fireEvent.click(screen.getByRole('button', { name: /use “v1-3”/i }));
    expect(screen.getByDisplayValue('v1-3')).toBeInTheDocument();
    expect(screen.queryByText(/already used by a published version/i)).not.toBeInTheDocument();
  });

  test('taken-label match is case-insensitive and trimmed, mirroring the server lookup', async () => {
    mockGet(makeState({ versions: [version('Spring-2026', { isActive: true })] }));
    render(<PoliciesSection />);
    await openForm();

    const input = screen.getByLabelText(/version label/i);
    fireEvent.change(input, { target: { value: '  spring-2026 ' } });
    expect(screen.getByText(/already used by a published version/i)).toBeInTheDocument();
  });
});
