import fs from 'node:fs';
import path from 'node:path';
import {
  AudioInspectionError,
  AUDIO_INSPECTION_TIMEOUT_MS,
  TRANSCRIPTION_MAX_AUDIO_BYTES,
  TRANSCRIPTION_MAX_AUDIO_SECONDS,
  inspectAudioBuffer,
  validateAudioMetadata,
} from '../../lib/services/transcription-pilot/media-inspector';

const M4A_FIXTURE = fs.readFileSync(path.join(
  process.cwd(), 'tests/fixtures/transcription/synthetic-aac.m4a',
));

// A deterministic, silent MPEG-2 Layer III stream: 8 kbps / 22.05 kHz frames.
// Zeroed side information and main data make each frame a silent test packet.
function syntheticMp3Frames(count, {
  frameLength = 26,
  header = [0xff, 0xf3, 0x10, 0x64],
} = {}) {
  const frame = Buffer.alloc(frameLength);
  Buffer.from(header).copy(frame);
  const audio = Buffer.alloc(frameLength * count);
  for (let offset = 0; offset < audio.length; offset += frameLength) frame.copy(audio, offset);
  return audio;
}

describe('transcription media inspection', () => {
  test('parses the local synthetic M4A and reports only safe media facts', async () => {
    const result = await inspectAudioBuffer(M4A_FIXTURE);
    expect(result).toMatchObject({
      container: expect.stringMatching(/M4A|MPEG-4/),
      codec: expect.stringMatching(/AAC/i),
      sampleRate: 22050,
    });
    expect(result.durationSeconds).toBeGreaterThan(0);
    expect(result.durationSeconds).toBeLessThanOrEqual(TRANSCRIPTION_MAX_AUDIO_SECONDS);
    expect(result).not.toHaveProperty('tags');
  });

  test('parses a synthetic silent MP3 stream and reports MPEG Layer III', async () => {
    const result = await inspectAudioBuffer(syntheticMp3Frames(20));
    expect(result).toMatchObject({
      container: 'MPEG',
      codec: 'MPEG 2 Layer 3',
      sampleRate: 22050,
      durationSeconds: expect.any(Number),
    });
  });

  test('rejects malformed input and unsupported containers with stable codes', async () => {
    await expect(inspectAudioBuffer(Buffer.from('not an audio file')))
      .rejects.toMatchObject({ code: 'audio_malformed' });
    expect(() => validateAudioMetadata({
      container: 'WAVE', codec: 'PCM', duration: 1, hasAudio: true, hasVideo: false,
    })).toThrow(expect.objectContaining({ code: 'audio_format_not_allowed' }));
  });

  test('enforces the 50 MiB byte cap before starting the parser worker', async () => {
    await expect(inspectAudioBuffer(Buffer.alloc(TRANSCRIPTION_MAX_AUDIO_BYTES + 1)))
      .rejects.toMatchObject({ code: 'audio_too_large' });
  });

  test('completes a near-cap synthetic MP3 within a bounded observed RSS increase', async () => {
    const frameLength = 417;
    const frames = Math.floor(TRANSCRIPTION_MAX_AUDIO_BYTES / frameLength);
    const nearCap = syntheticMp3Frames(frames, {
      frameLength,
      header: [0xff, 0xfb, 0x90, 0x64],
    });
    expect(nearCap.length).toBeLessThanOrEqual(TRANSCRIPTION_MAX_AUDIO_BYTES);
    const baseline = process.memoryUsage().rss;
    let peak = baseline;
    const sampler = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().rss);
    }, 5);
    try {
      const media = await inspectAudioBuffer(nearCap);
      expect(media.codec).toMatch(/Layer 3/);
    } finally {
      clearInterval(sampler);
    }
    // The measured RSS includes both the caller's capped Buffer and one
    // transferable worker copy; it is a regression bound, not a V8 heap cap.
    expect(peak - baseline).toBeLessThan(256 * 1024 * 1024);
  });

  test('accepts a synthetic MP3 exactly at four hours and rejects one frame over', async () => {
    const framesPerHourLimit = Math.ceil(
      TRANSCRIPTION_MAX_AUDIO_SECONDS / (576 / 22050),
    );
    const atLimit = await inspectAudioBuffer(syntheticMp3Frames(framesPerHourLimit));
    expect(atLimit.durationSeconds).toBe(TRANSCRIPTION_MAX_AUDIO_SECONDS);
    await expect(inspectAudioBuffer(syntheticMp3Frames(framesPerHourLimit + 1)))
      .rejects.toMatchObject({ code: 'audio_duration_too_long' });
  });

  test('terminates a parser worker that cannot finish within its deadline', async () => {
    await expect(inspectAudioBuffer(M4A_FIXTURE, { timeoutMs: 1 }))
      .rejects.toBeInstanceOf(AudioInspectionError);
    await expect(inspectAudioBuffer(M4A_FIXTURE, { timeoutMs: 1 }))
      .rejects.toMatchObject({ code: 'audio_inspection_timeout' });
    expect(AUDIO_INSPECTION_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});
