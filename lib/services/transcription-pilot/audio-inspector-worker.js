const { parentPort, workerData } = require('node:worker_threads');

(async () => {
  try {
    const { parseBuffer } = await import('music-metadata');
    const bytes = Buffer.from(workerData.audioBuffer);
    const metadata = await parseBuffer(bytes, undefined, {
      duration: true,
      skipCovers: true,
    });
    const format = metadata?.format || {};
    parentPort.postMessage({
      ok: true,
      format: {
        container: format.container,
        codec: format.codec,
        duration: format.duration,
        hasAudio: format.hasAudio,
        hasVideo: format.hasVideo,
        sampleRate: format.sampleRate,
        numberOfChannels: format.numberOfChannels,
      },
    });
  } catch {
    // Never send parser diagnostics or embedded tags back to the request path.
    parentPort.postMessage({ ok: false });
  }
})();
