/**
 * Characterization coverage for DynamicsService.checkRestriction (+ the
 * resolveLogicalName resolver and the private $expand parsers), landed BEFORE
 * the Stage 2 `restrictions.js` extraction (DynamicsService decomposition,
 * Checkpoint A) so the leaf move is behavior-frozen.
 *
 * Pins the fail-closed + denial matrix the plan calls out:
 *   - no context → throws (fail-closed);
 *   - table-level denial;
 *   - field-level denial (and a non-matching field passes);
 *   - $expand table-level denial (nav property contains the restricted table);
 *   - $expand nested-$select field-level denial;
 *   - requestId mismatch → console.warn (state-leak detection), no throw;
 *   - resolveLogicalName entity-set → logical mapping.
 */

import {
  withDynamicsContext,
  bypassDynamicsRestrictions,
} from '../../lib/services/dynamics-context.js';
import { DynamicsService } from '../../lib/services/dynamics-service.js';

describe('DynamicsService.checkRestriction — fail-closed + denial matrix (characterization)', () => {
  test('throws when called outside any context (fail-closed)', () => {
    expect(() => DynamicsService.checkRestriction('contact')).toThrow(
      /Restrictions not initialized/,
    );
  });

  test('table-level: throws for a restricted table', async () => {
    await withDynamicsContext(
      { restrictions: [{ table_name: 'contact' }], requestId: 'cr-table' },
      async () => {
        expect(() => DynamicsService.checkRestriction('contact')).toThrow(
          /table "contact" is restricted/,
        );
      },
    );
  });

  test('field-level: throws for the restricted field, passes for another field', async () => {
    await withDynamicsContext(
      {
        restrictions: [{ table_name: 'contact', field_name: 'emailaddress1' }],
        requestId: 'cr-field',
      },
      async () => {
        expect(() =>
          DynamicsService.checkRestriction('contact', 'fullname,emailaddress1'),
        ).toThrow(/field "emailaddress1" on "contact" is restricted/);
        // A select that does not include the restricted field is allowed.
        expect(() => DynamicsService.checkRestriction('contact', 'fullname')).not.toThrow();
      },
    );
  });

  test('$expand table-level: throws when a nav property references the restricted table', async () => {
    await withDynamicsContext(
      { restrictions: [{ table_name: 'contact' }], requestId: 'cr-expand-table' },
      async () => {
        expect(() =>
          DynamicsService.checkRestriction(
            'akoya_request',
            null,
            'contact_akoya_request($select=fullname)',
          ),
        ).toThrow(/\$expand references restricted table "contact"/);
      },
    );
  });

  test('$expand field-level: throws when a nested $select references the restricted field', async () => {
    await withDynamicsContext(
      {
        restrictions: [{ table_name: 'contact', field_name: 'emailaddress1' }],
        requestId: 'cr-expand-field',
      },
      async () => {
        expect(() =>
          DynamicsService.checkRestriction(
            'contact',
            null,
            'somerel($select=fullname,emailaddress1)',
          ),
        ).toThrow(/\$expand nested \$select references restricted field "emailaddress1"/);
      },
    );
  });

  test('requestId mismatch warns (state-leak detection) without throwing', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await withDynamicsContext(
        { restrictions: [], requestId: 'active-req' },
        async () => {
          // No restrictions → no denial; the mismatched requestId triggers the warn.
          expect(() =>
            DynamicsService.checkRestriction('contact', null, null, 'stale-req'),
          ).not.toThrow();
        },
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Restriction state mismatch/),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('unrestricted table passes inside a bypass scope', async () => {
    await bypassDynamicsRestrictions('cr-bypass', async () => {
      expect(() => DynamicsService.checkRestriction('contact', 'fullname')).not.toThrow();
    });
  });
});

describe('DynamicsService.resolveLogicalName (characterization)', () => {
  test('maps a known entity-set name to its logical name, passes others through', () => {
    // systemusers → systemuser is in ENTITY_SET_TO_LOGICAL; an unknown value
    // is returned unchanged (the `|| entitySet` fallback).
    expect(DynamicsService.resolveLogicalName('systemusers')).toBe('systemuser');
    expect(DynamicsService.resolveLogicalName('not_a_known_set')).toBe('not_a_known_set');
  });
});
