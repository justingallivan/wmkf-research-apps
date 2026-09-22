/** Browser-only sequential Graph upload loop used by the Preview proof page. */

export function nextExpectedStart(ranges, fallback = 0) {
  const first = Array.isArray(ranges) ? ranges[0] : null;
  const match = typeof first === 'string' ? first.match(/^(\d+)-/) : null;
  return match ? Number(match[1]) : fallback;
}

function abortError() {
  const error = new Error('Upload stopped.');
  error.name = 'AbortError';
  return error;
}

function uploadFragmentWithXhr({ uploadUrl, contentRange, body, signal, xhrFactory }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const xhr = xhrFactory();
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onSignalAbort);
      callback(value);
    };
    const onSignalAbort = () => xhr.abort();
    xhr.onload = () => finish(resolve, {
      ok: xhr.status >= 200 && xhr.status < 300,
      status: xhr.status,
      json: async () => JSON.parse(xhr.responseText || '{}'),
    });
    xhr.onerror = () => finish(reject, new Error('Microsoft upload connection failed before a response.'));
    xhr.onabort = () => finish(reject, abortError());
    xhr.ontimeout = () => finish(reject, new Error('Microsoft upload fragment timed out.'));
    signal?.addEventListener('abort', onSignalAbort, { once: true });
    try {
      xhr.open('PUT', uploadUrl, true);
      xhr.setRequestHeader('Content-Range', contentRange);
      xhr.send(body);
    } catch (error) {
      finish(reject, error);
    }
  });
}

export async function uploadPresentationMediaProofFile({
  file,
  uploadUrl,
  start = 0,
  chunkBytes,
  signal,
  shouldPause = () => false,
  onProgress = () => {},
  fetchImpl,
  xhrFactory = () => new XMLHttpRequest(),
}) {
  if (!file || !Number.isInteger(file.size) || file.size <= 0) throw new Error('A file is required.');
  if (!uploadUrl || !Number.isInteger(chunkBytes) || chunkBytes <= 0 || chunkBytes % (320 * 1024) !== 0) {
    throw new Error('The upload session contract is invalid.');
  }
  if (!Number.isInteger(start) || start < 0 || start > file.size) {
    throw new Error('The upload resume position is invalid.');
  }
  let offset = start;
  while (offset < file.size) {
    if (shouldPause()) return { complete: false, paused: true, nextStart: offset };
    const endExclusive = Math.min(offset + chunkBytes, file.size);
    const contentRange = `bytes ${offset}-${endExclusive - 1}/${file.size}`;
    const fragment = file.slice(offset, endExclusive);
    const response = fetchImpl
      ? await fetchImpl(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Range': contentRange },
        body: fragment,
        signal,
      })
      : await uploadFragmentWithXhr({ uploadUrl, contentRange, body: fragment, signal, xhrFactory });
    if (!response.ok) throw new Error(`Microsoft rejected upload fragment ${response.status}.`);
    if (response.status === 200 || response.status === 201) {
      onProgress({ uploaded: file.size, total: file.size });
      return { complete: true, paused: false, nextStart: file.size };
    }
    const body = await response.json();
    const next = nextExpectedStart(body.nextExpectedRanges, Number.NaN);
    if (!Number.isInteger(next) || next <= offset || next > file.size) {
      throw new Error('Microsoft returned an invalid next upload range.');
    }
    offset = next;
    onProgress({ uploaded: offset, total: file.size });
  }
  return { complete: true, paused: false, nextStart: file.size };
}
