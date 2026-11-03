/**
 * Unit tests for lib/services/admin/prompt-groups-service.js and the shared
 * group helpers. Settings service mocked.
 *
 * @jest-environment node
 */
jest.mock('../../lib/services/settings-service', () => ({
  getSettingStrict: jest.fn(),
  setSettingIfUnchanged: jest.fn(),
}));

import { getSettingStrict, setSettingIfUnchanged } from '../../lib/services/settings-service';
import {
  getPromptGroups, getPromptGroupsStrict, savePromptGroups, validateGroupList,
} from '../../lib/services/admin/prompt-groups-service';
import { normalizeCatalog } from '../../lib/services/admin/prompts-catalog-service';
import {
  ADMIN_PROMPT_GROUPS, defaultEditablePromptGroups, promptGroupIdFromLabel, resolveAdminPromptDescription,
} from '../../shared/config/adminPromptCatalog';

const stored = (groups) => ({ found: true, value: JSON.stringify({ version: 1, groups }), revision: 'W/"5"' });
const defaults = defaultEditablePromptGroups();

beforeEach(() => {
  jest.clearAllMocks();
  getSettingStrict.mockResolvedValue({ found: false, value: null, revision: null });
  setSettingIfUnchanged.mockResolvedValue(true);
});

describe('reading groups', () => {
  it('uses the code list, in order, until a list is saved', async () => {
    const r = await getPromptGroupsStrict();
    expect(r.stored).toBe(false);
    expect(r.revision).toBeNull();
    expect(r.groups.map((g) => g.id)).toEqual(ADMIN_PROMPT_GROUPS.map((g) => g.id));
  });

  it('follows the stored order and labels, keeps code sections by id, and pins the fixed groups last', async () => {
    getSettingStrict.mockResolvedValue(stored([
      { id: 'reviews', label: 'Reviews' },
      { id: 'grant-reporting', label: 'Grant reporting' },
      ...defaults.filter((g) => g.id !== 'reviews'),
    ]));
    const r = await getPromptGroupsStrict();
    expect(r.groups[0]).toMatchObject({ id: 'reviews', label: 'Reviews' });
    expect(r.groups[0].sections.map((s) => s.id)).toEqual(['human', 'panel', 'perspectives']);
    expect(r.groups[1]).toEqual({ id: 'grant-reporting', label: 'Grant reporting' });
    expect(r.groups.slice(-2).map((g) => g.id)).toEqual(['uncataloged', 'reference']);
    expect(r.revision).toBe('W/"5"');
  });

  it('falls back to the code list with a warning when the stored value is unreadable', async () => {
    getSettingStrict.mockResolvedValue({ found: true, value: 'not json', revision: 'W/"9"' });
    const r = await getPromptGroupsStrict();
    expect(r.stored).toBe(false);
    expect(r.revision).toBe('W/"9"');
    expect(r.storageWarning).toMatch(/unreadable/);
    expect(r.editable).toEqual(defaults);
  });

  it('the best-effort read falls back on an outage instead of throwing', async () => {
    getSettingStrict.mockRejectedValue(new Error('dataverse down'));
    const r = await getPromptGroups();
    expect(r.editable).toEqual(defaults);
    expect(r.storageWarning).toMatch(/could not be loaded/);
  });
});

describe('validateGroupList', () => {
  const ok = [...defaults, { id: 'grant-reporting', label: 'Grant reporting' }];
  it('accepts an added group and trims labels', () => {
    expect(validateGroupList(ok.map((g) => ({ ...g, label: ` ${g.label} ` })), defaults)).toEqual(ok);
  });
  it.each([
    ['a removed group', defaults.slice(1), /can't be removed/],
    ['a pinned group', [...defaults, { id: 'reference', label: 'Legacy' }], /fixed group/],
    ['a blank label', [...defaults.slice(0, -1), { ...defaults.at(-1), label: '  ' }], /blank/],
    ['a duplicate label', [...defaults, { id: 'pre-flight-2', label: 'pre-flight' }], /Two groups/],
    ['a bad id', [...defaults, { id: 'Bad Id', label: 'Bad' }], /not valid/],
    ['a duplicate id', [...defaults, { ...defaults[0], label: 'Other' }], /appears twice/],
    ['an empty list', [], /non-empty/],
  ])('refuses %s', (_label, list, message) => {
    expect(() => validateGroupList(list, defaults)).toThrow(message);
  });
});

describe('savePromptGroups', () => {
  const next = [...defaults, { id: 'grant-reporting', label: 'Grant reporting' }];

  it('first save creates the setting with a null expected revision', async () => {
    getSettingStrict
      .mockResolvedValueOnce({ found: false, value: null, revision: null })
      .mockResolvedValueOnce(stored(next));
    const r = await savePromptGroups({ groups: next, expectedRevision: null, profileId: 7 });
    expect(setSettingIfUnchanged).toHaveBeenCalledWith('promptLibrary.groups', JSON.stringify({ version: 1, groups: next }), null, 7);
    expect(r).toMatchObject({ status: 'groups_saved', revision: 'W/"5"' });
    expect(r.groups.map((g) => g.id)).toContain('grant-reporting');
  });

  it('refuses a stale revision before writing', async () => {
    getSettingStrict.mockResolvedValue(stored(defaults));
    await expect(savePromptGroups({ groups: next, expectedRevision: 'W/"4"', profileId: 7 }))
      .rejects.toMatchObject({ httpStatus: 409, body: expect.objectContaining({ status: 'groups_conflict' }) });
    expect(setSettingIfUnchanged).not.toHaveBeenCalled();
  });

  it('maps a conditional-write conflict to groups_conflict', async () => {
    getSettingStrict.mockResolvedValue(stored(defaults));
    setSettingIfUnchanged.mockRejectedValue(Object.assign(new Error('changed'), { code: 'setting_conflict' }));
    await expect(savePromptGroups({ groups: next, expectedRevision: 'W/"5"', profileId: 7 }))
      .rejects.toMatchObject({ httpStatus: 409, body: expect.objectContaining({ status: 'groups_conflict' }) });
  });

  it('refuses removing a group without writing', async () => {
    await expect(savePromptGroups({ groups: defaults.slice(1), expectedRevision: null, profileId: 7 }))
      .rejects.toMatchObject({ httpStatus: 400, body: expect.objectContaining({ status: 'invalid_groups' }) });
    expect(setSettingIfUnchanged).not.toHaveBeenCalled();
  });
});

describe('a group added in Admin is usable', () => {
  it('prompt details accept it only when it is in the stored list', async () => {
    getSettingStrict.mockResolvedValue(stored([...defaults, { id: 'grant-reporting', label: 'Grant reporting' }]));
    const { groups } = await getPromptGroupsStrict();
    expect(normalizeCatalog({ group: 'grant-reporting' }, groups).group).toBe('grant-reporting');
    expect(() => normalizeCatalog({ group: 'grant-reporting' })).toThrow(/Unknown group/);
  });

  it('the page places a prompt in it, and falls back when the group is unknown', async () => {
    getSettingStrict.mockResolvedValue(stored([...defaults, { id: 'grant-reporting', label: 'Grant reporting' }]));
    const { groups } = await getPromptGroupsStrict();
    const prompt = { name: 'x.y', catalog: { group: 'grant-reporting' } };
    expect(resolveAdminPromptDescription(prompt, groups).group).toBe('grant-reporting');
    expect(resolveAdminPromptDescription(prompt).group).toBe('uncataloged');
  });

  it('makes a stable id from a label', () => {
    expect(promptGroupIdFromLabel('Grant reporting')).toBe('grant-reporting');
    expect(promptGroupIdFromLabel('  Café & Q&A! ')).toBe('cafe-q-a');
  });
});

it('maps a missing row revision on save to a typed 503', async () => {
  getSettingStrict.mockResolvedValue(stored(defaults));
  setSettingIfUnchanged.mockRejectedValue(Object.assign(new Error('no etag'), { code: 'setting_revision_unavailable' }));
  await expect(savePromptGroups({ groups: [...defaults, { id: 'x', label: 'X' }], expectedRevision: 'W/"5"', profileId: 7 }))
    .rejects.toMatchObject({ httpStatus: 503, body: expect.objectContaining({ status: 'groups_unavailable' }) });
});
