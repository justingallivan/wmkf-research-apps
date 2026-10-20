// Benchmark candidate only; application runtime never imports this file.
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  try {
    const mm = await import('music-metadata');
    const metadata = workerData.filename
      ? await mm.parseFile(workerData.filename, { duration: true, skipCovers: true })
      : await mm.parseBuffer(Buffer.from(workerData.audioBuffer), undefined, { duration: true, skipCovers: true });
    const format = metadata.format;
    parentPort.postMessage({ format, audioBuffer: workerData.audioBuffer },
      workerData.audioBuffer ? [workerData.audioBuffer] : []);
  } catch (error) { parentPort.postMessage({ error: error.code || error.name }); }
})();
