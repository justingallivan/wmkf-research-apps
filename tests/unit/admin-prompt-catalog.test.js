/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import { ADMIN_PROMPT_CATALOG, ADMIN_PROMPT_GROUPS, getAdminPromptDescription } from '../../shared/config/adminPromptCatalog';

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
