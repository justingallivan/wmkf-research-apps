/** @jest-environment node */

import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(__dirname, '../..');

const retiredRuntimePaths = [
  'pages/meeting-tracker/presentation-media-proof.js',
  'pages/api/meeting-tracker/presentation-media-proof.js',
  'pages/external/presentation-media-proof/[token].js',
  'pages/api/external/presentation-media-proof/[token]/context.js',
  'pages/api/external/presentation-media-proof/[token]/open.js',
  'shared/components/meeting-tracker/PresentationMediaProofHarness.js',
  'shared/utils/presentation-media-proof-upload.js',
  'lib/services/post-presentation-materials/presentation-media-proof-service.js',
  'lib/external/presentation-media-proof-rate-limit.js',
];

test.each(retiredRuntimePaths)('Preview proof runtime stays retired: %s', (relativePath) => {
  expect(fs.existsSync(path.join(repoRoot, relativePath))).toBe(false);
});

test('proof-only route and header exception strings stay absent', () => {
  const proxy = fs.readFileSync(path.join(repoRoot, 'proxy.js'), 'utf8');
  const nextConfig = fs.readFileSync(path.join(repoRoot, 'next.config.js'), 'utf8');

  expect(proxy).not.toContain('/meeting-tracker/presentation-media-proof');
  expect(proxy).not.toContain('/external/presentation-media-proof/');
  expect(nextConfig).not.toContain('/presentation-media-proof/');
});
