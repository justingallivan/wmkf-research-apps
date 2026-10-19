/** @jest-environment node */
import { ReadableStream } from 'node:stream/web';
import { AudioReadError, readExactAudioBytes } from '../../lib/services/transcription-pilot/audio-read';

const args = (stream, over = {}) => ({ stream, expectedBytes: 4, maxBytes: 8, contentLength: '4', ...over });
const source = chunks => new ReadableStream({ start(c) { for (const chunk of chunks) c.enqueue(Buffer.from(chunk)); c.close(); } });

test('trusted exact metadata uses one allocation and no concatenation', async () => {
  const alloc = jest.spyOn(Buffer, 'allocUnsafe');
  const concat = jest.spyOn(Buffer, 'concat');
  try {
    const buffer = await readExactAudioBytes(args(source(['ab', 'cd'])));
    expect(buffer.toString()).toBe('abcd');
    expect(alloc).toHaveBeenCalledWith(4);
    expect(concat).not.toHaveBeenCalled();
  } finally { alloc.mockRestore(); concat.mockRestore(); }
});

test.each([
  { contentLength: null }, { contentLength: '4x' }, { contentLength: '9007199254740992' },
  { contentLength: '4', contentEncoding: 'gzip' }, { contentLength: '4', preallocate: false },
])('missing/invalid/encoded/non-opt-in metadata uses bounded fallback: %p', async over => {
  const concat = jest.spyOn(Buffer, 'concat');
  try {
    expect((await readExactAudioBytes(args(source(['ab', 'cd']), over))).toString()).toBe('abcd');
    expect(concat).toHaveBeenCalledTimes(1);
  } finally { concat.mockRestore(); }
});

test.each([0, -1, 9, 1.5, NaN, undefined])('invalid expected size %s fails before allocation/reader acquisition', async expectedBytes => {
  const stream = { getReader: jest.fn(), cancel: jest.fn() };
  await expect(readExactAudioBytes(args(stream, { expectedBytes }))).rejects.toMatchObject({ code: 'invalid_size' });
  expect(stream.getReader).not.toHaveBeenCalled();
  expect(stream.cancel).toHaveBeenCalled();
});

test.each([['3', 'size_mismatch'], ['0', 'size_mismatch'], ['9', 'too_large']])('known length %s rejects and cancels before allocation', async (contentLength, code) => {
  const stream = { getReader: jest.fn(), cancel: jest.fn() };
  const alloc = jest.spyOn(Buffer, 'allocUnsafe');
  try {
    await expect(readExactAudioBytes(args(stream, { contentLength }))).rejects.toMatchObject({ code });
    expect(stream.getReader).not.toHaveBeenCalled();
    expect(alloc).not.toHaveBeenCalled();
    expect(stream.cancel).toHaveBeenCalled();
  } finally { alloc.mockRestore(); }
});

test.each([true, false])('short/overflow EOF never returns a partial buffer; cap classification ignores chunking (%s)', async preallocate => {
  for (const chunks of [['ab'], ['abcde'], ['abcd', 'e']]) {
    const stream = source(chunks);
    await expect(readExactAudioBytes(args(stream, { preallocate }))).rejects.toMatchObject({ code: 'size_mismatch' });
    expect(stream.locked).toBe(false);
  }
  for (const chunks of [['abcdefghi'], ['abcd', 'e', 'fghi']]) {
    await expect(readExactAudioBytes(args(source(chunks), { preallocate }))).rejects.toMatchObject({ code: 'too_large' });
  }
});

test('a source failure after overflow wins over incomplete EOF classification and leaks no source details', async () => {
  let reads = 0;
  const reader = { read: jest.fn(async () => {
    if (reads++ === 0) return { value: Buffer.from('abcde'), done: false };
    throw new Error('SECRET source url');
  }), cancel: jest.fn(), releaseLock: jest.fn() };
  const error = await readExactAudioBytes(args({ getReader: () => reader })).catch(e => e);
  expect(error).toBeInstanceOf(AudioReadError);
  expect(error.code).toBe('read_failed');
  expect(error).not.toHaveProperty('status');
  expect(error).not.toHaveProperty('httpStatus');
  expect(JSON.stringify(error) + error.message).not.toContain('SECRET');
  expect(reader.releaseLock).toHaveBeenCalled();
});

test('pre-abort cancels without acquiring the reader', async () => {
  const c = new AbortController(); c.abort();
  const stream = { getReader: jest.fn(), cancel: jest.fn() };
  await expect(readExactAudioBytes(args(stream, { signal: c.signal }))).rejects.toMatchObject({ code: 'aborted' });
  expect(stream.getReader).not.toHaveBeenCalled();
});

test('stalled reads and cancellation cannot extend the cleanup bound', async () => {
  jest.useFakeTimers();
  const c = new AbortController();
  const reader = { read: () => new Promise(() => {}), cancel: jest.fn(() => new Promise(() => {})), releaseLock: jest.fn() };
  const done = readExactAudioBytes(args({ getReader: () => reader }, { signal: c.signal })).catch(e => e);
  c.abort();
  await jest.advanceTimersByTimeAsync(1001);
  expect(await done).toMatchObject({ code: 'aborted' });
  expect(reader.cancel).toHaveBeenCalledTimes(1);
  expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});
