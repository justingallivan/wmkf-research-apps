/**
 * Unit tests for lib/services/admin/prompts-list-service.js (Stage 5 batch 1).
 * Logic-level, ai-prompt adapter mocked.
 *
 * @jest-environment node
 */

jest.mock('../../lib/dataverse/adapters/ai-prompt', () => ({
  listCurrent: jest.fn(),
  listNonCurrent: jest.fn(),
  PROMPTSTATUS_RETIRED: 682090002,
}));

import * as aiPrompt from '../../lib/dataverse/adapters/ai-prompt';
import { listPrompts } from '../../lib/services/admin/prompts-list-service';

const row = (name, version, iscurrent, over = {}) => ({
  wmkf_ai_promptid: `${name}-v${version}`, wmkf_ai_promptname: name,
  wmkf_promptversion: version, wmkf_ai_iscurrent: iscurrent, wmkf_ai_promptbody: 'b', ...over,
});

beforeEach(() => {
  aiPrompt.listCurrent.mockReset().mockResolvedValue({ records: [] });
  aiPrompt.listNonCurrent.mockReset().mockResolvedValue({ records: [] });
});

describe('listPrompts', () => {
  it('merges current rows with draft-only names; history rows of current names are skipped', async () => {
    aiPrompt.listCurrent.mockResolvedValue({ records: [row('a.current', 2, true)] });
    aiPrompt.listNonCurrent.mockResolvedValue({
      records: [row('a.current', 1, false), row('b.draft', 1, false)],
    });
    const { prompts } = await listPrompts();
    expect(prompts.map((p) => [p.name, p.hasCurrent])).toEqual([
      ['a.current', true],
      ['b.draft', false],
    ]);
  });

  it('draft-only names surface their HIGHEST version', async () => {
    aiPrompt.listNonCurrent.mockResolvedValue({
      records: [row('d.only', 1, false), row('d.only', 3, false), row('d.only', 2, false)],
    });
    const { prompts } = await listPrompts();
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({ name: 'd.only', version: 3, hasCurrent: false, isCurrent: false });
  });

  it('sorts by name and maps every field with nullish defaults', async () => {
    aiPrompt.listCurrent.mockResolvedValue({ records: [row('z', 1, true), row('a', 1, true)] });
    const { prompts } = await listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['a', 'z']);
    expect(prompts[0]).toEqual({
      id: 'a-v1', name: 'a', version: 1, isCurrent: true, hasCurrent: true, isRetired: false,
      status: null, systemPrompt: '', body: 'b', variables: null, outputSchema: null,
      model: null, temperature: null, maxTokens: null,
      createdOn: null, publishedAt: null, modifiedOn: null, modifiedById: null, modifiedByName: null,
      catalog: { title: null, description: null, group: null, section: null, usedBy: null, usage: null },
    });
  });

  it('adapter errors propagate raw for the shell to map to 500', async () => {
    aiPrompt.listCurrent.mockRejectedValue(new Error('cap hit'));
    await expect(listPrompts()).rejects.toThrow('cap hit');
  });
});

describe('retired prompts', () => {
  it('flags a name whose latest row is Retired, and not a newer draft', async () => {
    const aiPromptMock = require('../../lib/dataverse/adapters/ai-prompt');
    aiPromptMock.listCurrent.mockResolvedValue({ records: [] });
    aiPromptMock.listNonCurrent.mockResolvedValue({ records: [
      { wmkf_ai_promptname: 'r.only', wmkf_promptversion: 2, wmkf_ai_iscurrent: false, wmkf_ai_promptstatus: 682090002 },
      { wmkf_ai_promptname: 'r.only', wmkf_promptversion: 1, wmkf_ai_iscurrent: false, wmkf_ai_promptstatus: 682090001 },
      { wmkf_ai_promptname: 'd.newer', wmkf_promptversion: 3, wmkf_ai_iscurrent: false, wmkf_ai_promptstatus: 682090000 },
      { wmkf_ai_promptname: 'd.newer', wmkf_promptversion: 2, wmkf_ai_iscurrent: false, wmkf_ai_promptstatus: 682090002 },
    ] });
    const { listPrompts } = require('../../lib/services/admin/prompts-list-service');
    const { prompts } = await listPrompts();
    const byName = Object.fromEntries(prompts.map((p) => [p.name, p]));
    expect(byName['r.only'].isRetired).toBe(true);
    expect(byName['d.newer'].isRetired).toBe(false);
  });
});
