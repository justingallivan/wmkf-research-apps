const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  PROFILE_MARKER,
  PROFILE_VALUE,
  runCheck,
  validateArtifactPaths,
  validateConfig,
  validateEnvironmentNames,
} = require('../../scripts/check-transcription-pilot-deployment');

const manifest = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../vercel.transcription-pilot.json'),
  'utf8',
));

describe('dedicated transcription pilot deployment config', () => {
  test.each([
    ['--env-names'], ['--artifact-paths'], ['--config'],
    ['--env-names', '--artifact-paths', 'file'],
    ['--config', 'first', '--config', 'second'],
    ['--unknown-secret-value'], ['--self-test', '--env-names'],
  ])('CLI rejects malformed arguments without echoing input: %j', (...args) => {
    const result = spawnSync(process.execPath, [
      path.join(__dirname, '../../scripts/check-transcription-pilot-deployment.js'), ...args,
    ], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Invalid arguments/);
    expect(result.stderr).not.toContain('unknown-secret-value');
    expect(result.stdout).not.toMatch(/config valid/);
  });

  test('uses only the approved marker, two crons, disabled Git deploys, and 300-second function cap', () => {
    expect(manifest.env[PROFILE_MARKER]).toBe(PROFILE_VALUE);
    expect(validateConfig(manifest)).toEqual([]);
  });

  test('rejects missing marker or altered Function duration', () => {
    expect(validateConfig({ ...manifest, env: {} }).join('\n')).toMatch(/marker/);
    expect(validateConfig({
      ...manifest,
      functions: { ...manifest.functions, 'pages/api/cron/drain-transcriptions.js': { maxDuration: 301 } },
    }).join('\n')).toMatch(/maxDuration 300/);
  });

  test('rejects unknown top-level overrides and any committed config env value except the profile marker', () => {
    expect(validateConfig({ ...manifest, routes: [] }).join('\n')).toMatch(/top-level key/);
    expect(validateConfig({ ...manifest, env: { ...manifest.env, CRON_SECRET: 'value' } }).join('\n'))
      .toMatch(/non-allowlisted environment name/);
    expect(validateConfig({ ...manifest, env: { [PROFILE_MARKER]: 'wrong' } }).join('\n')).toMatch(/marker/);
  });

  test('environment inventory accepts names only and rejects unrelated credential names', () => {
    expect(validateEnvironmentNames([PROFILE_MARKER])).toEqual([]);
    expect(validateEnvironmentNames(['UNRELATED_PROVIDER_SECRET']).join('\n')).toMatch(/not allowlisted/);
    expect(validateEnvironmentNames(['ASSEMBLYAI_API_KEY=secret-value']).join('\n')).toMatch(/names, never values/);
    expect(validateConfig({ ...manifest, env: { ...manifest.env, UNRELATED_SECRET: 'secret-value' } }).join('\n'))
      .toMatch(/non-allowlisted environment name\(s\): UNRELATED_SECRET/);
  });

  test('rejects root and nested .env* paths in supplied artifact inventories', () => {
    expect(validateArtifactPaths(['pages/index.js', 'assets/.env.production'])).toHaveLength(1);
    expect(validateArtifactPaths(['pages/index.js'])).toEqual([]);
  });

  test('CLI checker consumes optional name-only and artifact-path inventories', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'transcription-pilot-config-'));
    try {
      const envNamesFile = path.join(directory, 'env-names.txt');
      const artifactPathsFile = path.join(directory, 'artifact-paths.txt');
      fs.writeFileSync(envNamesFile, `${PROFILE_MARKER}\nAUTH_REQUIRED\n`, 'utf8');
      fs.writeFileSync(artifactPathsFile, 'pages/index.js\n', 'utf8');
      expect(runCheck({ configPath: path.join(__dirname, '../../vercel.transcription-pilot.json'), environmentNamesPath: envNamesFile, artifactPathsPath: artifactPathsFile })).toEqual([]);

      fs.writeFileSync(envNamesFile, 'AUTH_REQUIRED\n', 'utf8');
      expect(runCheck({ configPath: path.join(__dirname, '../../vercel.transcription-pilot.json'), environmentNamesPath: envNamesFile }))
        .toContain('Supplied environment-name inventory must contain the dedicated profile marker.');

      fs.writeFileSync(envNamesFile, `${PROFILE_MARKER}\n`, 'utf8');
      fs.writeFileSync(artifactPathsFile, 'nested/.env.production\n', 'utf8');
      const errors = runCheck({ configPath: path.join(__dirname, '../../vercel.transcription-pilot.json'), environmentNamesPath: envNamesFile, artifactPathsPath: artifactPathsFile });
      expect(errors.join('\n')).toMatch(/must not contain \.env/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
