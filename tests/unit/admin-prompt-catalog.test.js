/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import { ADMIN_PROMPT_CATALOG, ADMIN_PROMPT_GROUPS, ADMIN_PROMPT_USAGES, getAdminPromptDescription, resolveAdminPromptDescription } from '../../shared/config/adminPromptCatalog';

test('covers every name in the independently audited Production inventory', () => {
  const audit = fs.readFileSync(path.join(process.cwd(), 'docs/audits/prompt-descriptions-and-callers-2026-10-29.md'), 'utf8');
  const auditedKeys = [...audit.matchAll(/^\| `([^`]+)` \|/gm)].map(match => match[1]);
  expect(auditedKeys).toHaveLength(40);
  expect(Object.keys(ADMIN_PROMPT_CATALOG).sort()).toEqual(auditedKeys.sort());
});


test('every catalog entry has a known workflow and a valid subgroup when required', () => {
  expect(new Set(ADMIN_PROMPT_GROUPS.map(group => group.id)).size).toBe(ADMIN_PROMPT_GROUPS.length);
  for (const entry of Object.values(ADMIN_PROMPT_CATALOG)) {
    const group = ADMIN_PROMPT_GROUPS.find(group => group.id === entry.group);
    expect(group).toBeDefined();
    if (group.sections) expect(group.sections.map(section => section.id)).toContain(entry.section);
  }
  expect(getAdminPromptDescription('new.prompt').group).toBe('uncataloged');
  expect(ADMIN_PROMPT_GROUPS.find(group => group.id === 'uncataloged')).toBeDefined();
});

describe('resolveAdminPromptDescription (stored catalog columns first)', () => {
  const coded = 'reviewer-finder.analyze';

  test('no stored values: identical to the code catalog', () => {
    const fallback = getAdminPromptDescription(coded);
    expect(resolveAdminPromptDescription({ name: coded })).toEqual({
      title: fallback.title, description: fallback.description, usedBy: fallback.usedBy,
      usage: fallback.usage, group: fallback.group,
    });
  });

  test('stored values win field by field; blanks fall back', () => {
    const r = resolveAdminPromptDescription({
      name: coded,
      catalog: { title: 'Stored title', description: '   ', group: null, section: null, usedBy: null, usage: 'reference' },
    });
    expect(r.title).toBe('Stored title');
    expect(r.description).toBe(getAdminPromptDescription(coded).description);
    expect(r.usage).toBe('reference');
    expect(r.group).toBe('reviewers');
  });

  test('a new prompt with only stored values is described and placed by them', () => {
    const r = resolveAdminPromptDescription({
      name: 'connor.new-flow',
      catalog: { title: 'New flow', description: 'Does a thing.', group: 'reviews', section: 'human', usedBy: 'Power Automate', usage: 'unconnected' },
    });
    expect(r).toEqual({ title: 'New flow', description: 'Does a thing.', usedBy: 'Power Automate', usage: 'unconnected', group: 'reviews', section: 'human' });
  });

  test('unknown or incomplete placement and unknown usage fall back instead of hiding the prompt', () => {
    expect(resolveAdminPromptDescription({ name: 'x.y', catalog: { group: 'not-a-group', usage: 'bogus' } }))
      .toMatchObject({ group: 'uncataloged', usage: 'uncataloged' });
    expect(resolveAdminPromptDescription({ name: 'x.y', catalog: { group: 'reviews', section: null } }).group)
      .toBe('uncataloged');
    expect(resolveAdminPromptDescription({ name: 'x.y', catalog: { group: 'reviews', section: 'nope' } }).group)
      .toBe('uncataloged');
  });

  test('every usage badge value used by the code catalog is a known usage', () => {
    for (const entry of Object.values(ADMIN_PROMPT_CATALOG)) expect(ADMIN_PROMPT_USAGES).toContain(entry.usage);
  });
});
