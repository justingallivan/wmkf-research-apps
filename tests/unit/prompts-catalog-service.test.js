/**
 * lib/services/admin/prompts-catalog-service.js — in-place catalog-details edit.
 *
 * @jest-environment node
 */
jest.mock('../../lib/dataverse/adapters/ai-prompt', () => ({
  listVersions: jest.fn(),
  getIdOnly: jest.fn(),
  updateCatalog: jest.fn(),
  queryCurrentIdVersions: jest.fn(),
}));
jest.mock('@vercel/postgres', () => ({ sql: jest.fn(async () => ({ rows: [] })) }));

import fs from 'node:fs';
import path from 'node:path';
import * as aiPrompt from '../../lib/dataverse/adapters/ai-prompt';
import { sql } from '@vercel/postgres';
import { updatePromptCatalog, normalizeCatalog } from '../../lib/services/admin/prompts-catalog-service';

const NAME = 'reviewer-finder.analyze';
const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const STORED = {
  wmkf_ai_displaytitle: 'Analyze a proposal', wmkf_ai_description: 'Finds context.',
  wmkf_ai_groupkey: 'reviewers', wmkf_ai_sectionkey: null,
  wmkf_ai_usedby: 'Reviewer Finder', wmkf_ai_usagecategory: 'application',
};
const LOADED = { title: 'Analyze a proposal', description: 'Finds context.', group: 'reviewers', section: null, usedBy: 'Reviewer Finder', usage: 'application' };
const row = (over = {}) => ({ wmkf_ai_promptid: ID, wmkf_ai_promptname: NAME, wmkf_promptversion: 3, wmkf_ai_iscurrent: true, ...STORED, ...over });
const args = (over = {}) => ({ name: NAME, rowId: ID, expected: LOADED, catalog: { ...LOADED, title: 'New title' }, profileId: 7, ...over });

beforeEach(() => {
  jest.clearAllMocks();
  sql.mockReset();
  sql.mockResolvedValue({ rows: [] });
  aiPrompt.listVersions.mockResolvedValue({ records: [row(), row({ wmkf_ai_promptid: OTHER, wmkf_promptversion: 2, wmkf_ai_iscurrent: false })] });
  aiPrompt.getIdOnly.mockResolvedValue({ wmkf_ai_promptid: ID, _etag: 'W/"5"' });
  aiPrompt.updateCatalog.mockResolvedValue({});
  aiPrompt.queryCurrentIdVersions.mockResolvedValue({ records: [{ wmkf_ai_promptid: ID }] });
});

const sqlText = (i) => sql.mock.calls[i][0].join('?');

describe('normalizeCatalog', () => {
  test('trims, blanks to null, and accepts known placement/usage', () => {
    expect(normalizeCatalog({ title: '  T  ', description: '   ', group: 'reviews', section: 'human', usage: 'reference' }))
      .toEqual({ title: 'T', description: null, group: 'reviews', section: 'human', usedBy: null, usage: 'reference' });
  });
  test.each([
    [{ bogus: 'x' }, /Unknown catalog field/],
    [{ title: 5 }, /must be text/],
    [{ title: 'x'.repeat(201) }, /at most 200/],
    [{ group: 'not-a-group' }, /Unknown group/],
    [{ group: 'reviews' }, /needs one of its sections/],
    [{ group: 'reviews', section: 'nope' }, /needs one of its sections/],
    [{ group: 'tools', section: 'human' }, /has no sections/],
    [{ section: 'human' }, /needs a group/],
    [{ usage: 'bogus' }, /Unknown usage/],
  ])('rejects %j', (input, message) => {
    expect(() => normalizeCatalog(input)).toThrow(message);
  });
});

describe('updatePromptCatalog', () => {
  test('happy path: pending audit, then If-Match PATCH of only the six columns, then final audit', async () => {
    const r = await updatePromptCatalog(args());
    expect(r).toMatchObject({ status: 'catalog_updated', rowId: ID, catalog: { title: 'New title' } });
    expect(aiPrompt.updateCatalog).toHaveBeenCalledWith(ID, {
      wmkf_ai_displaytitle: 'New title', wmkf_ai_description: 'Finds context.', wmkf_ai_groupkey: 'reviewers',
      wmkf_ai_sectionkey: null, wmkf_ai_usedby: 'Reviewer Finder', wmkf_ai_usagecategory: 'application',
    }, { ifMatch: 'W/"5"' });
    expect(sql).toHaveBeenCalledTimes(2);
    expect(sqlText(0)).toMatch(/'pending', 'pending'/);
    expect(sql.mock.invocationCallOrder[0]).toBeLessThan(aiPrompt.updateCatalog.mock.invocationCallOrder[0]);
    expect(sql.mock.calls[1].slice(1)).toContain('catalog_updated');
    expect(sqlText(1)).toMatch(/'final'/);
  });

  test('rejects a non-GUID rowId before any read', async () => {
    await expect(updatePromptCatalog(args({ rowId: 'x' }))).rejects.toMatchObject({ httpStatus: 400, body: { status: 'invalid_catalog' } });
    expect(aiPrompt.listVersions).not.toHaveBeenCalled();
  });

  test('404 when the prompt has no rows', async () => {
    aiPrompt.listVersions.mockResolvedValue({ records: [] });
    await expect(updatePromptCatalog(args())).rejects.toMatchObject({ httpStatus: 404 });
  });

  test('duplicate current rows refuse without writing', async () => {
    aiPrompt.listVersions.mockResolvedValue({ records: [row(), row({ wmkf_ai_promptid: OTHER })] });
    await expect(updatePromptCatalog(args())).rejects.toMatchObject({ httpStatus: 500, body: { status: 'duplicate_current_rows' } });
    expect(aiPrompt.updateCatalog).not.toHaveBeenCalled();
  });

  test('stale row (a new version was published) → 409, no audit, no write', async () => {
    await expect(updatePromptCatalog(args({ rowId: OTHER }))).rejects.toMatchObject({ httpStatus: 409, body: { status: 'catalog_conflict' } });
    expect(sql).not.toHaveBeenCalled();
    expect(aiPrompt.updateCatalog).not.toHaveBeenCalled();
  });

  test('stale values (edited elsewhere since loading) → 409, no write', async () => {
    aiPrompt.listVersions.mockResolvedValue({ records: [row({ wmkf_ai_displaytitle: 'Someone else' })] });
    await expect(updatePromptCatalog(args())).rejects.toMatchObject({ httpStatus: 409, body: { status: 'catalog_conflict' } });
    expect(aiPrompt.updateCatalog).not.toHaveBeenCalled();
  });

  test('no change → success without audit or write', async () => {
    await expect(updatePromptCatalog(args({ catalog: { ...LOADED, title: '  Analyze a proposal ' } })))
      .resolves.toMatchObject({ status: 'catalog_updated', unchanged: true });
    expect(sql).not.toHaveBeenCalled();
    expect(aiPrompt.updateCatalog).not.toHaveBeenCalled();
  });

  test('pending audit failure hard-aborts before the Dataverse write', async () => {
    sql.mockRejectedValueOnce(new Error('check constraint'));
    await expect(updatePromptCatalog(args())).rejects.toMatchObject({ httpStatus: 500, body: { status: 'audit_unavailable' } });
    expect(aiPrompt.updateCatalog).not.toHaveBeenCalled();
  });

  test('412 on PATCH → 409 catalog_conflict with a final audit', async () => {
    aiPrompt.updateCatalog.mockRejectedValue(Object.assign(new Error('precondition'), { status: 412 }));
    await expect(updatePromptCatalog(args())).rejects.toMatchObject({ httpStatus: 409, body: { status: 'catalog_conflict' } });
    expect(sql.mock.calls[1].slice(1)).toContain('catalog_conflict');
  });

  test('a publish that superseded the row mid-edit returns catalog_superseded', async () => {
    aiPrompt.queryCurrentIdVersions.mockResolvedValue({ records: [{ wmkf_ai_promptid: OTHER }] });
    await expect(updatePromptCatalog(args())).resolves.toMatchObject({ status: 'catalog_superseded' });
    expect(sql.mock.calls[1].slice(1)).toContain('catalog_superseded');
  });

  test('no current row: edits the highest-version row and stays updated while none is current', async () => {
    aiPrompt.listVersions.mockResolvedValue({ records: [
      row({ wmkf_ai_promptid: OTHER, wmkf_promptversion: 1, wmkf_ai_iscurrent: false }),
      row({ wmkf_promptversion: 2, wmkf_ai_iscurrent: false }),
    ] });
    aiPrompt.queryCurrentIdVersions.mockResolvedValue({ records: [] });
    await expect(updatePromptCatalog(args())).resolves.toMatchObject({ status: 'catalog_updated', rowId: ID });
  });

  test('missing ETag fails closed after the pending audit, with a failed final audit', async () => {
    aiPrompt.getIdOnly.mockResolvedValue({ wmkf_ai_promptid: ID });
    await expect(updatePromptCatalog(args())).rejects.toMatchObject({ httpStatus: 500, body: { status: 'failed' } });
    expect(aiPrompt.updateCatalog).not.toHaveBeenCalled();
    expect(sql.mock.calls[1].slice(1)).toContain('failed');
  });
});

test('migration 093 allows every status this service writes to prompt_publish_audit', () => {
  const migration = fs.readFileSync(path.join(process.cwd(), 'lib/db/migrations/093_prompt_publish_audit_catalog_status.sql'), 'utf8');
  for (const status of ['pending', 'failed', 'catalog_updated', 'catalog_conflict', 'catalog_superseded']) {
    expect(migration).toContain(`'${status}'`);
  }
  for (const status of ['completed', 'partial', 'already_published', 'concurrency_conflict', 'invalid_body', 'no_current_row', 'duplicate_current_rows', 'audit_unavailable']) {
    expect(migration).toContain(`'${status}'`);
  }
});
