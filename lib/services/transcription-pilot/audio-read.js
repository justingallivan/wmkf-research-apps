/** Internal bounded audio reader. No HTTP, credentials, persistence or authored route errors.
 * Callers validate response metadata and translate AudioReadError categories themselves.
 */
export class AudioReadError extends Error {
  constructor(code) { super(code); this.code = code; this.name = 'AudioReadError'; }
}

/** Dispose a rejected body/owned reader without masking the primary failure or hanging cleanup. */
export async function cancelAudioBody(body) {
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(() => body?.cancel?.()).catch(() => {}),
      new Promise(resolve => { timer = setTimeout(resolve, 1000); }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function readExactAudioBytes({ stream, expectedBytes, maxBytes, contentLength, contentEncoding, preallocate = true, signal }) {
  let reader;
  try {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(expectedBytes)
      || expectedBytes < 1 || expectedBytes > maxBytes) throw new AudioReadError('invalid_size');
    if (signal?.aborted) throw new AudioReadError('aborted');
    const unencoded = !contentEncoding || String(contentEncoding).toLowerCase() === 'identity';
    const numeric = typeof contentLength === 'string' && /^\d+$/.test(contentLength);
    const declared = numeric ? Number(contentLength) : NaN;
    const known = unencoded && numeric && Number.isSafeInteger(declared);
    if (known && declared > maxBytes) throw new AudioReadError('too_large');
    if (known && declared !== expectedBytes) throw new AudioReadError('size_mismatch');
    if (!stream?.getReader) throw new AudioReadError('read_failed');
    reader = stream.getReader();
    const buffer = preallocate && known ? Buffer.allocUnsafe(expectedBytes) : null;
    const chunks = buffer ? null : [];
    let total = 0;
    for (;;) {
      // A shared pending abort promise retains every resolved race (and chunk).
      // Remove the per-read listener before the next chunk so streaming stays bounded.
      let onAbort;
      let chunk;
      try {
        chunk = await Promise.race([reader.read(), new Promise((_, reject) => {
          onAbort = () => reject(new AudioReadError('aborted'));
          signal?.addEventListener('abort', onAbort, { once: true });
          if (signal?.aborted) onAbort();
        })]);
      } finally { signal?.removeEventListener('abort', onAbort); }
      const { done, value } = chunk;
      if (signal?.aborted) throw new AudioReadError('aborted');
      if (done) break;
      if (!ArrayBuffer.isView(value) || value.BYTES_PER_ELEMENT !== 1) throw new AudioReadError('read_failed');
      total += value.byteLength;
      if (total > maxBytes) throw new AudioReadError('too_large');
      // Once mismatched, only count/discard: retain no overflow and preserve cap precedence.
      if (total <= expectedBytes) {
        if (buffer) buffer.set(value, total - value.byteLength);
        else chunks.push(Buffer.from(value));
      }
    }
    if (total !== expectedBytes) throw new AudioReadError('size_mismatch');
    return buffer || Buffer.concat(chunks, total);
  } catch (error) {
    await cancelAudioBody(reader || stream);
    throw error instanceof AudioReadError ? error : new AudioReadError('read_failed');
  } finally {
    try { reader?.releaseLock(); } catch { /* A hostile source cannot extend cleanup. */ }
  }
}
