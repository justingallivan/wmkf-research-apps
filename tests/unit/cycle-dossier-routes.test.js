/** @jest-environment node */

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn(async (_caller, fn) => fn()),
}));
jest.mock('../../lib/services/cycle-dossier-service', () => ({
  getCycleDossierPage: jest.fn(),
  cycleDossierAction: jest.fn(),
  downloadCycleDossier: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { getCycleDossierPage, cycleDossierAction, downloadCycleDossier } from '../../lib/services/cycle-dossier-service';
import pageHandler from '../../pages/api/cycle-dossier/index';
import downloadHandler from '../../pages/api/cycle-dossier/download';

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 7, session: { user: { email: 'super@example.test' } } });
  getCycleDossierPage.mockResolvedValue({ dossier: { id: 'd1' }, candidates: [], runs: [], editions: [], configuration: { ready: false, error: 'awaiting activation' } });
  cycleDossierAction.mockResolvedValue({ run: { id: 'run-1', status: 'queued' } });
  downloadCycleDossier.mockResolvedValue({ bytes: Buffer.from('pdf'), contentType: 'application/pdf', filename: 'D26.pdf' });
});

test('GET derives identity from auth context and runs inside DAL context', async () => {
  const res = response();
  await pageHandler({ method: 'GET', query: {}, body: { profileId: 999 } }, res);
  expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), res, 'cycle-dossier');
  expect(withDalContext).toHaveBeenCalledWith('cycle-dossier', expect.any(Function));
  expect(getCycleDossierPage).toHaveBeenCalledWith(7);
  expect(res.statusCode).toBe(200);
});

test('POST forwards only action body to the service while authenticated profile stays server-derived', async () => {
  const res = response();
  const body = { action: 'preview', selectedRequestIds: ['request-1'], profileId: 999 };
  await pageHandler({ method: 'POST', query: {}, body }, res);
  expect(cycleDossierAction).toHaveBeenCalledWith(7, body);
  expect(res.body).toEqual({ run: { id: 'run-1', status: 'queued' } });
});

test('unknown actions surface the service error and unsupported methods are rejected', async () => {
  cycleDossierAction.mockRejectedValue(Object.assign(new Error('Unknown dossier action.'), { httpStatus: 400 }));
  const unknownRes = response();
  await pageHandler({ method: 'POST', query: {}, body: { action: 'unknown' } }, unknownRes);
  expect(unknownRes.statusCode).toBe(400);
  expect(unknownRes.body).toEqual({ error: 'Unknown dossier action.' });

  const methodRes = response();
  await pageHandler({ method: 'DELETE', query: {}, body: {} }, methodRes);
  expect(methodRes.statusCode).toBe(405);
  expect(methodRes.headers.Allow).toBe('GET, POST');
});

test('download route authenticates first, derives owner from auth, and supports PDF inline response', async () => {
  const res = response();
  await downloadHandler({ method: 'GET', query: { editionId: 'edition-1', format: 'pdf' } }, res);
  expect(downloadCycleDossier).toHaveBeenCalledWith(7, { editionId: 'edition-1', format: 'pdf' });
  expect(res.headers['Content-Type']).toBe('application/pdf');
  expect(res.headers['Content-Disposition']).toBe(`inline; filename="D26.pdf"; filename*=UTF-8''D26.pdf`);
  expect(res.body).toEqual(Buffer.from('pdf'));
});

test('download route escapes a filename carrying quotes and a CRLF header-injection attempt', async () => {
  const maliciousName = '1002852-Scientific "Briefing"\r\nX-Evil: 1.docx';
  downloadCycleDossier.mockResolvedValue({ bytes: Buffer.from('docx'), contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: maliciousName });
  const res = response();
  await downloadHandler({ method: 'GET', query: { editionId: 'edition-1', format: 'docx' } }, res);
  const header = res.headers['Content-Disposition'];
  expect(header).not.toMatch(/[\r\n]/);
  expect(header).toBe(`attachment; filename="1002852-Scientific BriefingX-Evil: 1.docx"; filename*=UTF-8''${encodeURIComponent(maliciousName.replace(/[\r\n]/g, ''))}`);
});

test('download rejects unsupported methods and preserves API errors', async () => {
  const methodRes = response();
  await downloadHandler({ method: 'POST', query: {} }, methodRes);
  expect(methodRes.statusCode).toBe(405);
  expect(methodRes.headers.Allow).toBe('GET');

  downloadCycleDossier.mockRejectedValue(Object.assign(new Error('Entry not found.'), { httpStatus: 404 }));
  const errorRes = response();
  await downloadHandler({ method: 'GET', query: { entryId: 'entry-1', format: 'docx' } }, errorRes);
  expect(errorRes.statusCode).toBe(404);
  expect(errorRes.body).toEqual({ error: 'Entry not found.' });
});
