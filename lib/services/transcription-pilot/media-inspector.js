import { Worker } from 'node:worker_threads';

export const TRANSCRIPTION_MAX_AUDIO_BYTES = 50 * 1024 * 1024;
export const TRANSCRIPTION_MAX_AUDIO_SECONDS = 4 * 60 * 60;
export const AUDIO_INSPECTION_TIMEOUT_MS = 10_000;

const WORKER_RESOURCE_LIMITS = Object.freeze({
  maxOldGenerationSizeMb: 96,
  maxYoungGenerationSizeMb: 16,
  stackSizeMb: 4,
});

export class AudioInspectionError extends Error {
  constructor(code, { cause } = {}) {
    super(code, cause ? { cause } : undefined);
    this.name = 'AudioInspectionError';
    this.code = code;
  }
}

function validateParsedAudio(format) {
  const container = String(format?.container || '');
  const codec = String(format?.codec || '');
  const duration = Number(format?.duration);

  if (format?.hasAudio !== true || format?.hasVideo === true) {
    throw new AudioInspectionError('audio_malformed');
  }
  const isMp3 = container === 'MPEG' && /^MPEG (1|2|2\.5) Layer 3$/.test(codec);
  const isM4aAac = /^(M4A|MPEG-4)/.test(container) && /AAC/i.test(codec);
  if (!isMp3 && !isM4aAac) throw new AudioInspectionError('audio_format_not_allowed');
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new AudioInspectionError('audio_duration_invalid');
  }
  if (duration > TRANSCRIPTION_MAX_AUDIO_SECONDS) {
    throw new AudioInspectionError('audio_duration_too_long');
  }

  return {
    container,
    codec,
    durationSeconds: duration,
    sampleRate: Number.isFinite(format.sampleRate) ? format.sampleRate : null,
    channels: Number.isFinite(format.numberOfChannels) ? format.numberOfChannels : null,
  };
}

/**
 * Inspect untrusted audio in a disposable worker. `music-metadata` parses
 * container headers and reports codec/duration, but does not expose an abort
 * signal; terminating the worker enforces a hard wall-clock bound.
 */
export async function inspectAudioBuffer(input, { timeoutMs = AUDIO_INSPECTION_TIMEOUT_MS } = {}) {
  if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array)) {
    throw new AudioInspectionError('audio_invalid_input');
  }
  if (input.byteLength <= 0) throw new AudioInspectionError('audio_empty');
  if (input.byteLength > TRANSCRIPTION_MAX_AUDIO_BYTES) {
    throw new AudioInspectionError('audio_too_large');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new AudioInspectionError('audio_timeout_invalid');
  }

  // Copy into an exact-sized transferable buffer. This avoids transferring a
  // pooled Buffer's larger backing store and makes the parser's memory ceiling
  // explicit (at most the 50 MiB caller buffer plus this 50 MiB worker copy).
  const transferable = Uint8Array.from(input);
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(new URL('./audio-inspector-worker.js', import.meta.url), {
      // Turbopack attaches globals by spreading workerData into an object.
      // A named field preserves the transferable buffer through that wrapper.
      workerData: { audioBuffer: transferable.buffer },
      transferList: [transferable.buffer],
      resourceLimits: WORKER_RESOURCE_LIMITS,
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate().catch(() => {});
      reject(new AudioInspectionError('audio_inspection_timeout'));
    }, timeoutMs);
    timer.unref?.();

    worker.once('message', (message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      try {
        if (!message?.ok) throw new AudioInspectionError('audio_malformed');
        resolve(validateParsedAudio(message.format));
      } catch (error) {
        reject(error instanceof AudioInspectionError
          ? error
          : new AudioInspectionError('audio_inspection_failed', { cause: error }));
      }
    });
    worker.once('error', (cause) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new AudioInspectionError('audio_inspection_failed', { cause }));
    });
    worker.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new AudioInspectionError(code === 0 ? 'audio_malformed' : 'audio_inspection_failed'));
    });
  });
}

// Used by the worker and unit tests to keep the state mapping pure.
export const validateAudioMetadata = validateParsedAudio;
