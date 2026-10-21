/** @jest-environment node */
import { buildModelOverrideMap, diffModelOverrides } from '../../shared/components/admin/model-override-utils';

test('mapping includes only truthy DB overrides, preserving values and encounter order', () => {
  const models = Object.freeze({
    model: Object.freeze({ dbOverride: 'Sonnet' }),
    visionModel: Object.freeze({ dbOverride: '' }),
    fallback: Object.freeze({ dbOverride: null }),
    empty: Object.freeze({}),
    falseValue: Object.freeze({ dbOverride: false }),
    zero: Object.freeze({ dbOverride: 0 }),
    whitespace: Object.freeze({ dbOverride: ' ' }),
  });
  const apps = Object.freeze([
    Object.freeze({ appKey: 'app:one', models }),
    Object.freeze({ appKey: 'panel', models: Object.freeze({ chair: Object.freeze({ dbOverride: 'model-id' }) }) }),
  ]);
  const first = buildModelOverrideMap(apps);
  expect(first).toEqual({ 'app:one:model': 'Sonnet', 'app:one:whitespace': ' ', 'panel:chair': 'model-id' });
  expect(Object.keys(first)).toEqual(['app:one:model', 'app:one:whitespace', 'panel:chair']);
  const second = buildModelOverrideMap(apps);
  expect(second).toEqual(first);
  expect(second).not.toBe(first);
  first['app:one:model'] = 'changed';
  expect(buildModelOverrideMap(apps)).toEqual(second);
  expect(buildModelOverrideMap([])).toEqual({});
});

test('diff preserves server-first order, includes additions, updates and clears, and splits at the last colon', () => {
  const server = Object.freeze({ 'app:one:model': 'old', 'app:one:vision': 'remove', 'same:model': 'same' });
  const local = Object.freeze({ 'new:chair': 'new', 'same:model': 'same', 'app:one:model': 'updated', 'new:fallback': 'pinned' });
  expect(diffModelOverrides(server, local)).toEqual([
    { appKey: 'app:one', modelType: 'model', modelId: 'updated' },
    { appKey: 'app:one', modelType: 'vision', modelId: null },
    { appKey: 'new', modelType: 'chair', modelId: 'new' },
    { appKey: 'new', modelType: 'fallback', modelId: 'pinned' },
  ]);
});

test('empty and falsy overrides retain existing default equivalence without normalizing truthy strings', () => {
  expect(diffModelOverrides({ 'a:model': '', 'b:model': false }, { 'a:model': null, 'c:model': 0 })).toEqual([]);
  expect(diffModelOverrides({ 'a:model': 'value' }, { 'a:model': '' })).toEqual([{ appKey: 'a', modelType: 'model', modelId: null }]);
  expect(diffModelOverrides({ 'a:model': 'Sonnet' }, { 'a:model': 'sonnet' })).toEqual([{ appKey: 'a', modelType: 'model', modelId: 'sonnet' }]);
  expect(diffModelOverrides({}, {})).toEqual([]);
});
