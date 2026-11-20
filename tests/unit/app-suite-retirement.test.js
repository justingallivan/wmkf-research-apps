/** @jest-environment jsdom */
import fs from 'fs';
import path from 'path';
import { render, screen, cleanup } from '@testing-library/react';
import { APP_REGISTRY, APP_LIFECYCLE_REGISTRY } from '../../shared/config/appRegistry';
import { requireAppAccess } from '../../lib/utils/auth';

jest.mock('../../shared/components/Layout', () => function MockLayout({ children }) { return <div>{children}</div>; });
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
// A retired URL must never load execution infrastructure, even with a valid grant.
jest.mock('../../lib/services/llm-client', () => { throw new Error('Retired interface loaded LLM client'); });
jest.mock('../../lib/services/execute-prompt', () => { throw new Error('Retired interface loaded Executor'); });
jest.mock('../../lib/services/grant-reporting/extract-service', () => { throw new Error('Retired interface loaded extraction service'); });

const apps = [
  ['batch-phase-i-summaries', 'Batch Phase I Summaries'],
  ['batch-proposal-summaries', 'Batch Phase II Summaries'],
  ['phase-i-writeup', 'Create Phase I Writeup Draft'],
  ['phase-ii-writeup', 'Create Phase II Writeup Draft'],
  ['phase-i-dynamics', 'Phase I (Dynamics)'],
  ['multi-perspective-evaluator', 'Multi-Perspective Evaluator'],
  ['funding-gap-analyzer', 'Funding Analysis'],
  ['peer-review-summarizer', 'Summarize Peer Reviews'],
  ['grant-reporting', 'Grant Reporting'],
  ['literature-analyzer', 'Literature Analyzer'],
];
const routes = [
  ['process', ['batch-proposal-summaries', 'phase-ii-writeup']],
  ['process-phase-i', ['batch-phase-i-summaries']],
  ['process-phase-i-writeup', ['phase-i-writeup']],
  ['qa', ['phase-ii-writeup', 'batch-proposal-summaries']],
  ['refine', ['phase-ii-writeup', 'batch-proposal-summaries']],
  ['phase-i-dynamics/summarize', ['batch-phase-i-summaries']],
  ['phase-i-dynamics/summarize-v2', ['batch-phase-i-summaries']],
  ['evaluate-multi-perspective', ['multi-perspective-evaluator']],
  ['analyze-funding-gap', ['funding-gap-analyzer']],
  ['process-peer-reviews', ['peer-review-summarizer']],
  ['analyze-literature', ['literature-analyzer']],
  ['grant-reporting/extract', ['grant-reporting']],
  ['grant-reporting/lookup-grant', ['grant-reporting', 'batch-phase-i-summaries']],
];
const response = () => {
  const res = { status: jest.fn(), json: jest.fn(), setHeader: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
};
beforeEach(() => { jest.clearAllMocks(); });
afterEach(cleanup);

test.each(apps)('%s is unavailable in navigation/grants and old bookmarks explain retirement', (key, name) => {
  expect(APP_REGISTRY.some(app => app.key === key)).toBe(false);
  expect(APP_LIFECYCLE_REGISTRY[key].status).toBe('deprecated');
  expect(fs.existsSync(path.join(process.cwd(), APP_LIFECYCLE_REGISTRY[key].archivedTo))).toBe(true);
  const Page = require(`../../pages/${key}`).default;
  const { container } = render(<Page />);
  expect(screen.getByRole('heading', { name: `${name} has been retired` })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Return Home' })).toHaveAttribute('href', '/');
  expect(container.querySelector('input[type="file"]')).toBeNull();
});

describe.each(routes)('retired endpoint %s', (route, grants) => {
  const handler = require(`../../pages/api/${route}`).default;
  test('retained grants and superuser access cannot execute the old operation', async () => {
    for (const access of [{ profileId: 42 }, { profileId: 42, isSuperuser: true }]) {
      requireAppAccess.mockResolvedValue(access);
      const req = { method: 'POST', body: { files: [{ url: 'https://example.com/proposal.pdf' }], requestGuid: '12345678-1234-1234-1234-123456789012', overwrite: true } };
      const res = response();
      await handler(req, res);
      expect(requireAppAccess).toHaveBeenCalledWith(req, res, ...grants);
      expect(res.status).toHaveBeenCalledWith(410);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'APP_RETIRED' }));
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    }
  });
  test('denied access returns without overriding the auth response', async () => {
    requireAppAccess.mockResolvedValue(null);
    const res = response();
    await handler({ method: 'POST', body: {} }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
  test.each(['GET', 'PUT', 'DELETE', 'PATCH'])('%s cannot execute', async method => {
    const res = response();
    await handler({ method }, res);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(requireAppAccess).not.toHaveBeenCalled();
  });
});

test('Expense Reporter and the Workbench remain grantable', () => {
  expect(APP_REGISTRY.map(app => app.key)).toEqual(expect.arrayContaining(['expense-reporter', 'reviewers']));
});
