/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import { FFMPEG_TARBALL_SHA256 } from '../../lib/services/meeting-tracker-recordings/presentation-video-split-worker.js';

test('the provisioning script pins the same FFmpeg SHA-256 as the worker', () => {
  const script = fs.readFileSync(path.join(__dirname, '../../scripts/stage4-provision-ffmpeg.mjs'), 'utf8');
  const pinned = script.match(/FFMPEG_TARBALL_SHA256 = '([0-9a-f]{64})'/)?.[1];
  expect(pinned).toBe(FFMPEG_TARBALL_SHA256);
});
