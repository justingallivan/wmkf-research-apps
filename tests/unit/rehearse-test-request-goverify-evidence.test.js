/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, readPreviousGoVerifyPdf } from '../../scripts/rehearse-test-request-sandbox.mjs';
const RUN = '11111111-1111-4111-8111-111111111111';
const argv = (...args) => ['node', 'script.mjs', ...args];
const evidence = '--previous-goverify-pdf-file=/private/evidence.txt';
test.each(['--run-recheck', '--advance', '--finalize-readiness', '--recover-readiness'])('allows evidence only for the explicit production verification mode %s', mode => {
  const args = [ '--target=production', `${mode}=${RUN}`, evidence ];
  if (mode !== '--run-recheck') args.push('--manifest=/private/manifest.json');
  if (mode === '--advance') args.push('--bundle=/private/bundle.json');
  expect(parseArgs(argv(...args)).previousGoVerifyPdfFile).toBe('/private/evidence.txt');
});
test.each([
  [`--run-recheck=${RUN}`, evidence],
  ['--target=production', `--run-inspect=${RUN}`, evidence],
  ['--target=production', `--run-recheck=${RUN}`, '--previous-goverify-pdf-file=relative'],
  ['--target=production', `--run-recheck=${RUN}`, '--previous-goverify-pdf-file='],
].map(args => [args]))('rejects out-of-scope or invalid evidence arguments %j', args => expect(() => parseArgs(argv(...args))).toThrow(/previous-goverify/));
test('reads a bounded private file without printing its contents', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-pdf-evidence-'));
  const file = path.join(dir, 'evidence.txt');
  try {
    expect(readPreviousGoVerifyPdf(null)).toBeNull();
    fs.writeFileSync(file, 'synthetic-prior-url\n');
    expect(readPreviousGoVerifyPdf(file)).toBe('synthetic-prior-url');
    fs.writeFileSync(file, 'x'.repeat(2049));
    expect(() => readPreviousGoVerifyPdf(file)).toThrow(/small private/);
    fs.writeFileSync(file, '');
    expect(() => readPreviousGoVerifyPdf(file)).toThrow(/empty/);
  } finally { fs.rmSync(dir, { recursive: true }); }
});
