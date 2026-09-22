/** Browser-only sequential Graph upload loop used by the Preview proof page. */

export function nextExpectedStart(ranges, fallback = 0) {
  const first = Array.isArray(ranges) ? ranges[0] : null;
  const match = typeof first === 'string' ? first.match(/^(\d+)-/) : null;
  return match ? Number(match[1]) : fallback;
}

export async function uploadPresentationMediaProofFile({
  file,
  uploadUrl,
  start = 0,
  chunkBytes,
  signal,
  shouldPause = () => false,
  onProgress = () => {},
  fetchImpl = fetch,
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
    const response = await fetchImpl(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes ${offset}-${endExclusive - 1}/${file.size}` },
      body: file.slice(offset, endExclusive),
      signal,
    });
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
