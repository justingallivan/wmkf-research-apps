/** @jest-environment node */
// No network: planSeed/seedPromptRow are injected fakes. Never run the script's
// --execute here (.env.local points at PRODUCTION Dataverse).
import {
  APP_MANIFEST_FILES, PROMPTSTATUS_PUBLISHED, recordDataFor, loadManifestRows, planToolSeed, executeToolSeed,
} from '../../scripts/seed-tool-prompts.js';
import { SeedRefused } from '../../lib/services/prompt-seed';
import { spawnSync } from 'child_process';

const ROW = {
  promptName: 'fixture.step', systemPrompt: 'sys {{a}}', body: 'body {{b}}', model: 'sonnet', maxTokens: 4096,
  variables: { variables: [{ name: 'a' }, { name: 'b' }] },
  outputSchema: { outputs: [{ name: 'response_text', type: 'string', target: { kind: 'none' } }], parseMode: 'raw' },
  notes: 'n', temperature: 0.3,
};
const ROW2 = { ...ROW, promptName: 'fixture.other' };

test('recordDataFor maps wmkf_ai_* columns, stringifies contracts, omits temperature', () => {
  const r = recordDataFor(ROW);
  expect(r).toEqual({
    wmkf_ai_promptname: 'fixture.step', wmkf_ai_systemprompt: 'sys {{a}}', wmkf_ai_promptbody: 'body {{b}}',
    wmkf_ai_promptvariables: JSON.stringify(ROW.variables, null, 2),
    wmkf_ai_promptoutputschema: JSON.stringify(ROW.outputSchema, null, 2),
    wmkf_ai_model: 'sonnet', wmkf_ai_maxtokens: 4096, wmkf_ai_promptstatus: PROMPTSTATUS_PUBLISHED, wmkf_ai_notes: 'n',
  });
  expect(r).not.toHaveProperty('wmkf_ai_temperature');
});

test('planToolSeed reports per-row details without writing', async () => {
  const planSeed = jest.fn(async () => ({ action: 'create', rows: [], current: [], targetVersion: 1 }));
  const seedPromptRow = jest.fn();
  const out = await planToolSeed({ rows: [ROW, ROW2], planSeed });
  expect(out[0]).toEqual({ promptName: 'fixture.step', model: 'sonnet', maxTokens: 4096, variables: ['a', 'b'], action: 'create', targetVersion: 1 });
  expect(out).toHaveLength(2);
  expect(seedPromptRow).not.toHaveBeenCalled();
});

test('executeToolSeed seeds every row with the mapped record', async () => {
  const planSeed = jest.fn(async () => ({ action: 'create' }));
  const seedPromptRow = jest.fn(async ({ promptName }) => ({ action: 'create', version: 1, id: `id-${promptName}` }));
  const res = await executeToolSeed({ rows: [ROW, ROW2], planSeed, seedPromptRow, SeedRefused, force: false });
  expect(res.map((r) => r.id)).toEqual(['id-fixture.step', 'id-fixture.other']);
  expect(seedPromptRow.mock.calls[0][0]).toMatchObject({ promptName: 'fixture.step', force: false, recordData: recordDataFor(ROW) });
});

test('executeToolSeed preflights: one refusal writes nothing', async () => {
  const planSeed = jest.fn(async ({ promptName }) => ({ action: promptName === 'fixture.other' ? 'refuse' : 'create', rows: [], current: [] }));
  const seedPromptRow = jest.fn();
  await expect(executeToolSeed({ rows: [ROW, ROW2], planSeed, seedPromptRow, SeedRefused })).rejects.toBeInstanceOf(SeedRefused);
  expect(seedPromptRow).not.toHaveBeenCalled();
});

test('manifest table covers the five apps; unknown key or missing file errors clearly', async () => {
  expect(Object.keys(APP_MANIFEST_FILES).sort()).toEqual(
    ['expense-reporter', 'expertise-finder', 'funding-gap', 'literature-analyzer', 'multi-perspective']);
  await expect(loadManifestRows('nope')).rejects.toThrow(/Unknown app "nope"/);
  await expect(loadManifestRows('literature-analyzer')).rejects.toThrow(/does not exist yet/);
});

test('CLI exits 1 for an unknown app key without touching Dataverse', () => {
  const r = spawnSync(process.execPath, ['scripts/seed-tool-prompts.js', '--app', 'nope'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/Unknown app "nope"/);
});
