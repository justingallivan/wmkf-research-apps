/**
 * @jest-environment jsdom
 *
 * Component + helper tests for the Stage 2a payment-address card (BILL chunk 5).
 * Covers the two behaviors a stop-time review asked to pin down: opt-out
 * suppression (no address collected when the reviewer declines the honorarium)
 * and the prefill roundtrip (Dataverse-sourced address → rendered field values).
 */

import { render, screen, fireEvent } from '@testing-library/react';
import Stage2aView, { missingAddressFields, buildAddressPayload } from '../../shared/components/external/Stage2aView';
import { COUNTRIES } from '../../shared/config/countries';

function makeData(overrides = {}) {
  const prefill = {
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.org',
    honorariumOptOut: false,
    address: {
      line1: '123 Main St',
      line2: 'Apt 4',
      city: 'Townsville',
      state: 'CA',
      postalCode: '94000',
      country: 'US',
      phone: '+1 555 123 4567',
    },
    ...(overrides.prefill || {}),
  };
  return {
    etag: 'W/"1"',
    proposal: {
      title: 'A Proposal',
      requestNumber: 'R-123',
      applicantInstitution: 'Example University',
      projectLeader: 'Dr. PI',
      coPIs: [],
      abstract: 'Abstract text.',
    },
    prefill,
    policies: {
      'reviewer-coi': { slotCode: 'reviewer-coi', title: 'Conflict of Interest', versionLabel: '1', body: 'COI body' },
      'reviewer-ai-use': { slotCode: 'reviewer-ai-use', title: 'AI Use', versionLabel: '1', body: 'AI body' },
    },
  };
}

function renderView(data) {
  return render(
    <Stage2aView
      data={data}
      token="tok"
      onRequestDecline={() => {}}
      onAccepted={() => {}}
    />,
  );
}

describe('Stage2aView payment-address card', () => {
  it('shows the address card prefilled when the reviewer is taking the honorarium', () => {
    renderView(makeData());
    expect(screen.getByText('Honorarium payment address')).toBeInTheDocument();
    // Prefill roundtrip: Dataverse-sourced values render in the inputs.
    expect(screen.getByDisplayValue('123 Main St')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Townsville')).toBeInTheDocument();
    expect(screen.getByDisplayValue('94000')).toBeInTheDocument();
    expect(screen.getByLabelText(/State \/ Province/)).toHaveValue('CA');
    expect(screen.getByLabelText(/State \/ Province/)).toBeRequired();
    // Phone is collected in the address card (required this cycle for manual payment).
    expect(screen.getByDisplayValue('+1 555 123 4567')).toBeInTheDocument();
    // Country select reflects the prefilled ISO-2 code.
    expect(screen.getByRole('combobox')).toHaveValue('US');
  });

  it('hides the address card when honorariumOptOut is prefilled true', () => {
    renderView(makeData({ prefill: { honorariumOptOut: true } }));
    expect(screen.queryByText('Honorarium payment address')).not.toBeInTheDocument();
  });

  it('hides the address card as soon as the reviewer opts out', () => {
    renderView(makeData());
    expect(screen.getByText('Honorarium payment address')).toBeInTheDocument();
    // The only checkbox on the form is the honorarium opt-out.
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.queryByText('Honorarium payment address')).not.toBeInTheDocument();
  });

  it('renders the full country list (territories selectable, not a curated subset)', () => {
    renderView(makeData());
    const select = screen.getByRole('combobox');
    // Every ISO country renders as a selectable option — not a curated subset. The
    // two non-country <option>s are chrome (the "Select a country…" placeholder and
    // a disabled divider under the pinned US entry), both with an empty value.
    const countryOptions = [...select.querySelectorAll('option')].filter((o) => o.value !== '');
    expect(countryOptions).toHaveLength(COUNTRIES.length);
    // A previously-omitted territory is present.
    expect(screen.getByRole('option', { name: 'Puerto Rico' })).toBeInTheDocument();
  });

  it('makes state/province optional outside the US and Canada', () => {
    renderView(makeData({
      prefill: {
        address: {
          line1: '1 Long Road',
          city: 'Oxford',
          state: '',
          postalCode: 'OX1 1AA',
          country: 'GB',
          phone: '+44 20 0000 0000',
        },
      },
    }));

    expect(screen.getByLabelText(/State \/ Province/)).not.toBeRequired();
    expect(screen.getByText('Optional outside the United States and Canada.')).toBeInTheDocument();
  });
});

describe('missingAddressFields', () => {
  const complete = { line1: '1 St', line2: '', city: 'T', state: 'CA', postalCode: '9', country: 'US', phone: '+1 555 0100' };

  it('returns [] for a complete US required set', () => {
    expect(missingAddressFields(complete)).toEqual([]);
  });

  it('flags each empty required field', () => {
    expect(missingAddressFields({ ...complete, line1: '' })).toContain('line1');
    expect(missingAddressFields({ ...complete, city: '  ' })).toContain('city');
    expect(missingAddressFields({ ...complete, postalCode: '' })).toContain('postalCode');
    expect(missingAddressFields({ ...complete, country: '' })).toContain('country');
    expect(missingAddressFields({ ...complete, phone: '' })).toContain('phone');
    expect(missingAddressFields({ ...complete, phone: '   ' })).toContain('phone');
  });

  it('requires state/province for US and Canada only', () => {
    expect(missingAddressFields({ ...complete, state: '' })).toEqual(['state']);
    expect(missingAddressFields({ ...complete, country: 'CA', state: '  ' })).toEqual(['state']);
    expect(missingAddressFields({ ...complete, country: 'GB', state: '' })).toEqual([]);
  });

  it('does not infer state/province is required before country is selected', () => {
    expect(missingAddressFields({ ...complete, country: '', state: '' })).toEqual(['country']);
  });

  it('flags a country that is not exactly 2 chars (server contract)', () => {
    expect(missingAddressFields({ ...complete, country: 'U' })).toContain('country');
    expect(missingAddressFields({ ...complete, country: 'USA' })).toContain('country');
    expect(missingAddressFields({ ...complete, country: 'US' })).not.toContain('country');
  });
});

describe('buildAddressPayload', () => {
  it('keeps only trimmed non-empty fields', () => {
    expect(
      buildAddressPayload({ line1: ' 1 St ', line2: '', city: 'T', state: '   ', postalCode: '9', country: 'GB' }),
    ).toEqual({ line1: '1 St', city: 'T', postalCode: '9', country: 'GB' });
  });

  it('returns {} for an all-empty address', () => {
    expect(buildAddressPayload({ line1: '', city: '', postalCode: '', country: '' })).toEqual({});
  });
});
