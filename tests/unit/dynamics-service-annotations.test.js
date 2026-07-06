/**
 * Characterization coverage for DynamicsService.processAnnotations, landed
 * BEFORE the Stage 3 `annotations.js` extraction (DynamicsService
 * decomposition, Checkpoint A) so the leaf move is behavior-frozen.
 *
 * Pins the annotation-mapping contract:
 *   - `@odata.etag` → `_etag` (preserved for optimistic-concurrency callers);
 *   - `…@OData.Community.Display.V1.FormattedValue` → `<base>_formatted`;
 *   - `…@Microsoft.Dynamics.CRM.lookuplogicalname` → `<base>_entity`;
 *   - all other `@odata` / `@Microsoft` annotations stripped;
 *   - plain fields passed through untouched;
 *   - non-object input returned as-is.
 */

import { DynamicsService } from '../../lib/services/dynamics-service.js';

describe('DynamicsService.processAnnotations (characterization)', () => {
  test('preserves @odata.etag as _etag', () => {
    const out = DynamicsService.processAnnotations({
      '@odata.etag': 'W/"123456"',
      name: 'Acme',
    });
    expect(out._etag).toBe('W/"123456"');
    expect(out.name).toBe('Acme');
  });

  test('maps FormattedValue annotation to <base>_formatted', () => {
    const out = DynamicsService.processAnnotations({
      _ownerid_value: 'guid-1',
      '_ownerid_value@OData.Community.Display.V1.FormattedValue': 'Jane Doe',
    });
    expect(out._ownerid_value).toBe('guid-1');
    expect(out._ownerid_value_formatted).toBe('Jane Doe');
  });

  test('maps lookuplogicalname annotation to <base>_entity', () => {
    const out = DynamicsService.processAnnotations({
      _ownerid_value: 'guid-1',
      '_ownerid_value@Microsoft.Dynamics.CRM.lookuplogicalname': 'systemuser',
    });
    expect(out._ownerid_value_entity).toBe('systemuser');
  });

  test('strips other @odata / @Microsoft annotations', () => {
    const out = DynamicsService.processAnnotations({
      '@odata.context': 'https://x/$metadata#contacts',
      '@Microsoft.Dynamics.CRM.totalrecordcount': 42,
      fullname: 'Bob',
    });
    expect(out).toEqual({ fullname: 'Bob' });
    expect(out['@odata.context']).toBeUndefined();
  });

  test('returns non-object input unchanged', () => {
    expect(DynamicsService.processAnnotations(null)).toBeNull();
    expect(DynamicsService.processAnnotations('str')).toBe('str');
    expect(DynamicsService.processAnnotations(7)).toBe(7);
  });
});
