/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import { ADMIN_PROMPT_CATALOG, getAdminPromptDescription } from '../../shared/config/adminPromptCatalog';

test('covers every name in the independently audited Production inventory', () => {
  const audit = fs.readFileSync(path.join(process.cwd(), 'docs/audits/prompt-descriptions-and-callers-2026-10-29.md'), 'utf8');
  const auditedKeys = [...audit.matchAll(/^\| `([^`]+)` \|/gm)].map(match => match[1]);
  expect(auditedKeys).toHaveLength(40);
  expect(Object.keys(ADMIN_PROMPT_CATALOG).sort()).toEqual(auditedKeys.sort());
});
