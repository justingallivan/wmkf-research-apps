/** @jest-environment node */
import handler from '../../pages/api/process-expenses';
import { readUploadedBlobBuffer } from '../../lib/utils/uploaded-blob';
import { LLMClient } from '../../lib/services/llm-client';
import { createFileProcessor } from '../../shared/api/handlers/fileProcessor';

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn(async () => ({ profileId: 'staff' })) }));
jest.mock('../../shared/api/middleware/rateLimiter', () => ({ nextRateLimiter: () => jest.fn(async () => true) }));
jest.mock('../../lib/utils/uploaded-blob', () => ({ readUploadedBlobBuffer: jest.fn() }));
jest.mock('../../lib/services/llm-client', () => ({ LLMClient: jest.fn() }));
jest.mock('../../shared/api/handlers/fileProcessor', () => ({ createFileProcessor: jest.fn() }));
jest.mock('../../lib/services/tool-prompt-resolver', () => ({
  resolveToolPrompt: jest.fn(async (_name, def) => ({ ...def, model: 'test-model' })),
  toolPromptUnavailable: () => null,
}));

const savedKey = process.env.CLAUDE_API_KEY;
const complete = jest.fn();
const processFile = jest.fn();
const receipt = (vendor, date = null) => ({ text: JSON.stringify({ vendor, date, amount: '$12.00', confidence: 'high' }) });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const file = (filename) => ({ filename, access: 'private', pathname: `receipts/${filename}` });
function start(files) {
  const res = {
    headersSent: false,
    writeHead: jest.fn(() => { res.headersSent = true; }),
    write: jest.fn(), end: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn(),
  };
  return { res, done: handler({ method: 'POST', body: { files } }, res) };
}
function frames(res) {
  return res.write.mock.calls.map(([chunk]) => chunk.replace(/^data: /, '').trim());
}
function finalResult(res) {
  const out = frames(res);
  const results = out.filter(frame => frame !== '[DONE]').map(frame => JSON.parse(frame)).filter(frame => frame.type === 'result');
  expect(results).toHaveLength(1);
  expect(out.slice(-2)).toEqual([JSON.stringify(results[0]), '[DONE]']);
  expect(res.end).toHaveBeenCalledTimes(1);
  return results[0];
}
beforeEach(() => {
  jest.clearAllMocks();
  process.env.CLAUDE_API_KEY = 'test-placeholder';
  complete.mockReset().mockResolvedValue(receipt('Cafe'));
  processFile.mockReset().mockResolvedValue({ text: 'A sufficiently long receipt document' });
  readUploadedBlobBuffer.mockReset().mockImplementation(async f => Buffer.from(f.filename));
  LLMClient.mockImplementation(() => ({ complete }));
  createFileProcessor.mockReturnValue({ processFile });
});
afterAll(() => {
  if (savedKey === undefined) delete process.env.CLAUDE_API_KEY;
  else process.env.CLAUDE_API_KEY = savedKey;
});

test('bounds entire file pipelines to two and refills a free worker before the other finishes', async () => {
  const files = ['first.jpg', 'second.jpg', 'third.jpg', 'fourth.jpg'].map(file);
  const loads = files.map(deferred);
  const models = files.map(deferred);
  const starts = [];
  readUploadedBlobBuffer.mockImplementation(f => {
    const index = files.indexOf(f);
    starts.push(index);
    return loads[index].promise;
  });
  complete.mockImplementation(({ messages }) => {
    const name = Buffer.from(messages[0].content[0].source.data, 'base64').toString();
    return models[files.findIndex(f => f.filename === name)].promise;
  });
  const run = start(files);
  try {
    await tick();
    expect(starts).toEqual([0, 1]);
    loads[0].resolve(Buffer.from(files[0].filename));
    loads[1].resolve(Buffer.from(files[1].filename));
    await tick();
    expect(complete).toHaveBeenCalledTimes(2);
    expect(starts).toEqual([0, 1]);
    models[1].resolve(receipt('second', '2026-10-02'));
    await tick();
    expect(starts).toEqual([0, 1, 2]);
    loads[2].resolve(Buffer.from(files[2].filename));
    await tick();
    expect(complete).toHaveBeenCalledTimes(3);
    models[2].resolve(receipt('third', '2026-10-01'));
    await tick();
    expect(starts).toEqual([0, 1, 2, 3]);
    loads[3].resolve(Buffer.from(files[3].filename));
    models[3].resolve(receipt('fourth'));
    await tick();
    expect(resHasResult(run.res)).toBe(false);
    expect(run.res.end).not.toHaveBeenCalled();
    models[0].resolve(receipt('first', '2026-10-02'));
    await run.done;
    expect(finalResult(run.res).expenses.map(e => e.sourceFile)).toEqual(['third.jpg', 'first.jpg', 'second.jpg', 'fourth.jpg']);
  } finally {
    loads.forEach((gate, i) => gate.resolve(Buffer.from(files[i].filename)));
    models.forEach((gate, i) => gate.resolve(receipt(`cleanup-${i}`)));
    await run.done;
  }
});
const resHasResult = res => frames(res).some(frame => frame.includes('"type":"result"'));

test('keeps missing-date rows in input order despite reversed model completion', async () => {
  const first = deferred();
  complete.mockImplementationOnce(() => first.promise).mockResolvedValueOnce(receipt('second'));
  const run = start([file('first.jpg'), file('second.jpg')]);
  try {
    await tick();
    expect(complete).toHaveBeenCalledTimes(2);
    expect(run.res.end).not.toHaveBeenCalled();
    first.resolve(receipt('first'));
    await run.done;
    expect(finalResult(run.res).expenses.map(e => e.vendor)).toEqual(['first', 'second']);
  } finally { first.resolve(receipt('first')); await run.done; }
});

test('mixed failures produce one row per file and do not prevent later receipts from completing', async () => {
  const names = ['read.jpg', 'bad.jpg', 'empty.pdf', 'model.pdf', 'bad.pdf', 'good.jpg', 'good.pdf'];
  readUploadedBlobBuffer.mockImplementation(async f => {
    if (f.filename === 'read.jpg') throw new Error('read failed');
    return Buffer.from(f.filename);
  });
  processFile.mockImplementation(async (_bytes, name) => ({ text: name === 'empty.pdf' ? '' : `Receipt content for ${name}` }));
  complete.mockImplementation(async ({ messages }) => {
    const content = messages[0].content;
    const name = typeof content === 'string' ? content : Buffer.from(content[0].source.data, 'base64').toString();
    if (name.includes('model.pdf')) throw new Error('model failed');
    if (name.includes('bad.')) return { text: 'not json' };
    return receipt('Good');
  });
  const run = start(names.map(file));
  await run.done;
  const result = finalResult(run.res);
  expect(result.expenses.map(e => e.sourceFile)).toEqual(names);
  expect(result.expenses.map(e => e.vendor)).toEqual(['Processing Error', 'Parse Error', 'Extraction Error', 'Processing Error', 'Parse Error', 'Good', 'Good']);
  expect(result.expenses[0].notes).toBe('read failed');
  expect(result.expenses[2].notes).toBe('Could not extract text from PDF');
  expect(result.expenses[3].notes).toBe('model failed');
  expect(result.processedFiles).toBe(7);
  expect(result.summary).toBe('Processed 7 file(s). Extracted 2 valid expense(s). 5 file(s) had processing issues.');
  expect(readUploadedBlobBuffer).toHaveBeenCalledTimes(7);
  expect(complete).toHaveBeenCalledTimes(5);
});

test('drains an in-flight file after a fatal worker error without starting another or writing after end', async () => {
  const loading = deferred();
  readUploadedBlobBuffer.mockImplementation(() => loading.promise);
  const run = start([file('pending.pdf'), null, file('never.pdf')]);
  let ended = false;
  const lateWrites = [];
  run.res.end.mockImplementation(() => { ended = true; });
  run.res.write.mockImplementation(chunk => { if (ended) lateWrites.push(chunk); });
  try {
    await tick();
    expect(readUploadedBlobBuffer).toHaveBeenCalledTimes(1);
    expect(run.res.end).not.toHaveBeenCalled();
    loading.resolve(Buffer.from('pending receipt'));
    await run.done;
    expect(readUploadedBlobBuffer).toHaveBeenCalledTimes(1);
    const out = frames(run.res);
    expect(out.filter(f => f.includes('"type":"error"'))).toHaveLength(1);
    expect(out.some(f => f.includes('"type":"result"') || f === '[DONE]')).toBe(false);
    expect(run.res.end).toHaveBeenCalledTimes(1);
    expect(lateWrites).toEqual([]);
  } finally { loading.resolve(Buffer.from('receipt')); await run.done; }
});

test('serializes PDF parsing, recovers from parse rejection, and overlaps later model calls', async () => {
  const parsing = deferred();
  const model = deferred();
  processFile.mockImplementationOnce(() => parsing.promise).mockResolvedValue({ text: 'Long receipt content' });
  complete.mockImplementationOnce(() => model.promise).mockResolvedValue(receipt('third'));
  const run = start(['first.pdf', 'second.pdf', 'third.pdf'].map(file));
  try {
    await tick();
    expect(readUploadedBlobBuffer).toHaveBeenCalledTimes(2);
    expect(processFile).toHaveBeenCalledTimes(1);
    parsing.reject(new Error('parser failed'));
    await tick();
    expect(processFile).toHaveBeenCalledTimes(3);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(run.res.end).not.toHaveBeenCalled();
    model.resolve(receipt('second'));
    await run.done;
    const result = finalResult(run.res);
    expect(result.expenses.map(e => e.sourceFile)).toEqual(['first.pdf', 'second.pdf', 'third.pdf']);
    expect(result.expenses[0]).toMatchObject({ vendor: 'Processing Error', notes: 'parser failed' });
  } finally { parsing.resolve({ text: 'Long receipt content' }); model.resolve(receipt('second')); await run.done; }
});
