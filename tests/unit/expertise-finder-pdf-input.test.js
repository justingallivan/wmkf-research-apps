/** @jest-environment node */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { runInThisContext } from 'node:vm';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import pdf from 'pdf-parse';
import { requireAppAccess } from '../../lib/utils/auth';
import { fetchPublicBlob } from '../../lib/utils/public-blob-fetch';
import { GraphService } from '../../lib/services/graph-service';
import { LLMClient } from '../../lib/services/llm-client';
import match from '../../pages/api/expertise-finder/match';
import { batchMatch } from '../../lib/services/expertise-finder/batch-match-service';

jest.mock('pdf-parse', () => jest.fn(bytes => jest.requireActual('pdf-parse/lib/pdf-parse')(bytes)));
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/utils/public-blob-fetch', () => ({ fetchPublicBlob: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/sharepoint-document-location.js', () => ({
  findByRegardingObject: jest.fn(async () => ({ records: [{ relativeurl: 'Synthetic' }] })),
}));
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: { listFiles: jest.fn(), downloadFileByPath: jest.fn() },
}));
jest.mock('../../lib/services/llm-client', () => ({ LLMClient: jest.fn() }));
jest.mock('../../lib/utils/usage-logger', () => ({ logUsage: jest.fn(), estimateCostCents: jest.fn() }));

// The suite setup replaces the Jest sandbox's global fetch.
const nodeFetch = runInThisContext('fetch');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('both matching paths parse exact typed bytes from a fetched PDF before model admission', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const line = 'Synthetic research proposal for the offline PDF extraction check.';
  for (let i = 0; i < 3; i++) page.drawText(line, { font, x: 30, y: 720 - i * 22, size: 11 });
  const source = await doc.save({ useObjectStreams: false });
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': source.length });
    response.end(source);
  });
  const originalKey = process.env.CLAUDE_API_KEY;
  delete process.env.CLAUDE_API_KEY;

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const url = `http://127.0.0.1:${server.address().port}/proposal.pdf`;
    requireAppAccess.mockResolvedValue({ profileId: 1 });
    fetchPublicBlob.mockImplementation(() => nodeFetch(url));
    GraphService.listFiles.mockResolvedValue([{ name: 'Phase_I_Staff_Version.pdf' }]);
    GraphService.downloadFileByPath.mockImplementation(async () => {
      const body = Buffer.from(await (await nodeFetch(url)).arrayBuffer());
      const padded = Buffer.alloc(body.length + 32, 0xff);
      body.copy(padded, 16);
      return { buffer: padded.subarray(16, 16 + body.length) };
    });

    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await match({ method: 'POST', body: { file: { url } } }, res);
    expect(res.json).toHaveBeenCalledWith({ error: 'Claude API key not configured on server' });
    await expect(batchMatch({ requestId: '11111111-1111-4111-8111-111111111111', profileId: 1 }))
      .rejects.toThrow('Claude API key not configured on server');

    expect(pdf).toHaveBeenCalledTimes(2);
    for (const [input] of pdf.mock.calls) {
      expect(input).toBeInstanceOf(Uint8Array);
      expect(Buffer.isBuffer(input)).toBe(false);
      expect(hash(input)).toBe(hash(source));
    }
    for (const { value } of pdf.mock.results) {
      const parsed = await value;
      expect(parsed.text).toContain(line);
      expect(parsed.text.length).toBeGreaterThan(100);
    }
    expect(LLMClient).not.toHaveBeenCalled();
  } finally {
    if (originalKey === undefined) delete process.env.CLAUDE_API_KEY;
    else process.env.CLAUDE_API_KEY = originalKey;
    if (server.listening) {
      await new Promise(resolve => {
        server.close(resolve);
        server.closeAllConnections();
      });
    }
  }
});
