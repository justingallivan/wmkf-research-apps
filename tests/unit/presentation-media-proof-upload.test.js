/** @jest-environment node */

import {
  nextExpectedStart,
  uploadPresentationMediaProofFile,
} from '../../shared/utils/presentation-media-proof-upload';

const CHUNK = 320 * 1024;

function fakeFile(size) {
  return {
    size,
    slice: jest.fn((start, end) => ({ start, end, size: end - start })),
  };
}

function response(status, body = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn(async () => body),
  };
}

test('parses the first resumable range and falls back when absent', () => {
  expect(nextExpectedStart(['655360-'], 7)).toBe(655360);
  expect(nextExpectedStart([], 7)).toBe(7);
  expect(nextExpectedStart(['bad'], 7)).toBe(7);
});

test('uploads sequential 320 KiB-aligned fragments directly to the supplied URL', async () => {
  const file = fakeFile(CHUNK * 2 + 17);
  const fetchImpl = jest.fn()
    .mockResolvedValueOnce(response(202, { nextExpectedRanges: [`${CHUNK}-`] }))
    .mockResolvedValueOnce(response(202, { nextExpectedRanges: [`${CHUNK * 2}-`] }))
    .mockResolvedValueOnce(response(201, { id: 'item' }));
  const progress = jest.fn();

  await expect(uploadPresentationMediaProofFile({
    file,
    uploadUrl: 'https://upload.example/session',
    chunkBytes: CHUNK,
    fetchImpl,
    onProgress: progress,
  })).resolves.toEqual({ complete: true, paused: false, nextStart: file.size });

  expect(fetchImpl).toHaveBeenCalledTimes(3);
  expect(fetchImpl.mock.calls.map(([, init]) => init.headers['Content-Range'])).toEqual([
    `bytes 0-${CHUNK - 1}/${file.size}`,
    `bytes ${CHUNK}-${CHUNK * 2 - 1}/${file.size}`,
    `bytes ${CHUNK * 2}-${file.size - 1}/${file.size}`,
  ]);
  expect(fetchImpl.mock.calls.every(([url]) => url === 'https://upload.example/session')).toBe(true);
  expect(progress).toHaveBeenLastCalledWith({ uploaded: file.size, total: file.size });
});

test('pauses only at a committed chunk boundary and rejects invalid progress', async () => {
  const file = fakeFile(CHUNK * 2);
  let pause = false;
  const fetchImpl = jest.fn(async () => {
    pause = true;
    return response(202, { nextExpectedRanges: [`${CHUNK}-`] });
  });
  await expect(uploadPresentationMediaProofFile({
    file,
    uploadUrl: 'https://upload.example/session',
    chunkBytes: CHUNK,
    fetchImpl,
    shouldPause: () => pause,
  })).resolves.toEqual({ complete: false, paused: true, nextStart: CHUNK });
  expect(fetchImpl).toHaveBeenCalledTimes(1);

  await expect(uploadPresentationMediaProofFile({
    file,
    uploadUrl: 'https://upload.example/session',
    chunkBytes: CHUNK,
    fetchImpl: jest.fn(async () => response(202, { nextExpectedRanges: ['0-'] })),
  })).rejects.toThrow('invalid next upload range');

  await expect(uploadPresentationMediaProofFile({
    file,
    uploadUrl: 'https://upload.example/session',
    start: CHUNK * 3,
    chunkBytes: CHUNK,
    fetchImpl,
  })).rejects.toThrow('resume position is invalid');
});
