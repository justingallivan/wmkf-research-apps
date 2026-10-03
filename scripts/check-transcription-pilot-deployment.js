#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'vercel.transcription-pilot.json');
const SHARED_CONFIG_PATH = path.join(__dirname, '..', 'vercel.json');
const PROFILE_MARKER = 'TRANSCRIPTION_PILOT_DEPLOYMENT_PROFILE';
const PROFILE_VALUE = 'transcription-pilot';
const ALLOWED_CONFIG_KEYS = new Set(['$schema', 'env', 'build', 'git', 'functions', 'crons']);
const EXPECTED_CRONS = [
  { path: '/api/cron/drain-transcriptions', schedule: '0 3 * * *' },
  { path: '/api/cron/drain-transcriptions?recovery=1', schedule: '0 * * * *' },
];

// Direct pilot runtime names reported by the service owner, plus Vercel system names.
// It is intentionally not described as a complete whole-application environment inventory.
// Values are never read or logged.
const ALLOWED_ENV_NAMES = new Set([
  PROFILE_MARKER,
  'ASSEMBLYAI_API_KEY',
  'ASSEMBLYAI_WEBHOOK_SECRET',
  'AUTH_REQUIRED',
  'AZURE_AD_CLIENT_ID',
  'AZURE_AD_CLIENT_SECRET',
  'AZURE_AD_TENANT_ID',
  'CRON_SECRET',
  'DATABASE_URL',
  'DATAVERSE_ALLOW_PROD_READS',
  'DATAVERSE_DAL_ENFORCEMENT',
  'DATAVERSE_TARGET_INTERLOCK',
  'EMERGENCY_AUTH_BYPASS',
  'NEXTAUTH_SECRET',
  'NEXTAUTH_URL',
  'POSTGRES_URL',
  'TRANSCRIPTION_PILOT_ENABLED',
  'TRANSCRIPTION_CALLBACK_URL',
  'TRANSCRIPTION_REFERENCE_ENCRYPTION_KEY',
  'TRANSCRIPTION_SUBMISSIONS_ENABLED',
  'UPLOADS_BLOB_RW_TOKEN',
  'VERCEL_ENV',
  'VERCEL_PROJECT_ID',
  'VERCEL_URL',
]);

function validateConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return ['Dedicated Vercel config must be a top-level object.'];
  }

  const unexpectedConfigKeys = Object.keys(config).filter((key) => !ALLOWED_CONFIG_KEYS.has(key));
  if (unexpectedConfigKeys.length) {
    errors.push(`Dedicated config contains non-allowlisted top-level key(s): ${unexpectedConfigKeys.join(', ')}.`);
  }

  for (const section of ['env', 'build']) {
    const env = section === 'build' ? config.build?.env : config.env;
    if (section === 'build' && (!config.build || typeof config.build !== 'object' || Array.isArray(config.build))) {
      errors.push('Dedicated config must define build.env with the non-secret profile marker.');
      continue;
    }
    if (section === 'build' && Object.keys(config.build).some((key) => key !== 'env')) {
      errors.push('Dedicated config may define only build.env under build.');
    }
    if (!env || typeof env !== 'object' || Array.isArray(env) || env[PROFILE_MARKER] !== PROFILE_VALUE) {
      errors.push(`Dedicated config ${section} must set the non-secret ${PROFILE_MARKER} marker.`);
      continue;
    }
    const unexpectedEnvNames = Object.keys(env).filter((name) => name !== PROFILE_MARKER);
    if (unexpectedEnvNames.length) {
      errors.push(`Dedicated config ${section} contains non-allowlisted environment name(s): ${unexpectedEnvNames.join(', ')}.`);
    }
  }

  if (!config.git || typeof config.git !== 'object' || Array.isArray(config.git)
    || config.git.deploymentEnabled !== false) {
    errors.push('Dedicated Git deployments must be explicitly disabled.');
  }
  if (config.git && Object.keys(config.git).some((key) => key !== 'deploymentEnabled')) {
    errors.push('Dedicated config may define only git.deploymentEnabled.');
  }

  const functionConfig = config.functions?.['pages/api/cron/drain-transcriptions.js'];
  if (!functionConfig || functionConfig.maxDuration !== 300) {
    errors.push('The transcription drain Function must have maxDuration 300.');
  }
  if (Object.keys(config.functions || {}).length !== 1) {
    errors.push('Dedicated config must define only the transcription drain Function override.');
  }
  if (Object.keys(functionConfig || {}).some((key) => key !== 'maxDuration')) {
    errors.push('The transcription drain Function override may define only maxDuration.');
  }
  if (Object.keys(config.functions || {}).some((key) => key !== 'pages/api/cron/drain-transcriptions.js')) {
    errors.push('Dedicated config may override only the transcription drain Function.');
  }

  if (!Array.isArray(config.crons) || config.crons.length !== EXPECTED_CRONS.length) {
    errors.push('Dedicated config must contain exactly the two approved transcription crons.');
  } else {
    for (const expected of EXPECTED_CRONS) {
      const matches = config.crons.filter((entry) => entry?.path === expected.path);
      if (matches.length !== 1 || matches[0]?.schedule !== expected.schedule) {
        errors.push(`Cron ${expected.path} must appear exactly once with its approved schedule.`);
      }
    }
  }

  return errors;
}

function validateSharedConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config) || !Array.isArray(config.crons)) {
    return ['Standard Vercel config must define a crons array.'];
  }
  const transcriptionCrons = config.crons.filter((entry) => {
    const pathOnly = typeof entry?.path === 'string' ? entry.path.split('?')[0] : '';
    return pathOnly === '/api/cron/drain-transcriptions';
  });
  return transcriptionCrons.length
    ? ['Standard Vercel config must not schedule the transcription drain; use the isolated pilot profile.']
    : [];
}

function validateEnvironmentNames(environmentNames) {
  const errors = [];
  if (!Array.isArray(environmentNames)) {
    return ['Environment inventory must be an array of variable names only.'];
  }
  for (const name of environmentNames) {
    if (typeof name !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(name)) {
      errors.push('Environment inventory entries must be variable names, never values.');
      continue;
    }
    if (!ALLOWED_ENV_NAMES.has(name)) errors.push(`Environment name is not allowlisted: ${name}.`);
  }
  return errors;
}

function validateArtifactPaths(artifactPaths) {
  const errors = [];
  if (artifactPaths === undefined) return errors;
  if (!Array.isArray(artifactPaths)) return ['Artifact inventory must be an array of paths.'];
  for (const artifactPath of artifactPaths) {
    if (typeof artifactPath !== 'string') {
      errors.push('Artifact inventory entries must be paths.');
      continue;
    }
    const segments = artifactPath.replace(/\\/g, '/').split('/');
    if (segments.some((segment) => segment.toLowerCase().startsWith('.env'))) {
      errors.push('Deployment artifact inventory must not contain .env* files.');
    }
  }
  return errors;
}

function validateDeploymentProfile({ config, environmentNames, artifactPaths } = {}) {
  const markerErrors = Array.isArray(environmentNames) && !environmentNames.includes(PROFILE_MARKER)
    ? ['Supplied environment-name inventory must contain the dedicated profile marker.']
    : [];
  return [
    ...validateConfig(config),
    ...validateEnvironmentNames(environmentNames),
    ...markerErrors,
    ...validateArtifactPaths(artifactPaths),
  ];
}

function readInventoryFile(filename, description) {
  if (!filename) return undefined;
  try {
    return fs.readFileSync(filename, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    throw new Error(`Unable to read ${description} inventory file.`);
  }
}

function runCheck({ configPath = CONFIG_PATH, environmentNamesPath, artifactPathsPath } = {}) {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return ['Unable to read valid JSON from vercel.transcription-pilot.json.'];
  }
  let sharedConfig;
  try {
    sharedConfig = JSON.parse(fs.readFileSync(SHARED_CONFIG_PATH, 'utf8'));
  } catch {
    return ['Unable to read valid JSON from standard vercel.json.'];
  }
  let environmentNames;
  let artifactPaths;
  try {
    environmentNames = readInventoryFile(environmentNamesPath, 'environment-name');
    artifactPaths = readInventoryFile(artifactPathsPath, 'artifact-path');
  } catch (error) {
    return [error.message];
  }
  // If no external inventory is provided, validate only the committed, name-only env keys.
  environmentNames ??= [
    ...Object.keys(config.env || {}),
    ...Object.keys(config.build?.env || {}),
  ];
  return [
    ...validateDeploymentProfile({ config, environmentNames, artifactPaths }),
    ...validateSharedConfig(sharedConfig),
  ];
}

function runSelfTest() {
  const good = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const expectError = (candidate, pattern, label) => {
    const errors = validateDeploymentProfile(candidate);
    if (!errors.some((error) => pattern.test(error))) throw new Error(`${label} did not fail as expected.`);
  };
  if (validateDeploymentProfile({ config: good, environmentNames: [PROFILE_MARKER] }).length) {
    throw new Error('Approved dedicated manifest fixture should pass.');
  }
  const shared = JSON.parse(fs.readFileSync(SHARED_CONFIG_PATH, 'utf8'));
  if (validateSharedConfig(shared).length) throw new Error('Standard config must keep transcription schedules isolated.');
  const scheduledSharedConfig = {
    ...shared,
    crons: [...shared.crons,
      { path: '/api/cron/drain-transcriptions', schedule: '0 3 * * *' },
      { path: '/api/cron/drain-transcriptions?recovery=1', schedule: '0 * * * *' },
    ],
  };
  if (!validateSharedConfig(scheduledSharedConfig).some((error) => /must not schedule/.test(error))) {
    throw new Error('A transcription cron added to the standard config must be rejected.');
  }
  expectError({ config: { ...good, crons: [...good.crons, { path: '/api/cron/unrelated', schedule: '* * * * *' }] }, environmentNames: [PROFILE_MARKER] }, /exactly the two/, 'extra cron');
  expectError({ config: { ...good, git: { deploymentEnabled: true } }, environmentNames: [PROFILE_MARKER] }, /explicitly disabled/, 'Git automation');
  expectError({ config: { ...good, env: { ...good.env, UNRELATED_SECRET: 'must-not-be-printed' } }, environmentNames: [PROFILE_MARKER] }, /non-allowlisted environment name/, 'config env allowlist');
  expectError({ config: { ...good, build: { ...good.build, env: {} } }, environmentNames: [PROFILE_MARKER] }, /build must set/, 'build marker');
  expectError({ config: { ...good, rewrites: [] }, environmentNames: [PROFILE_MARKER] }, /non-allowlisted top-level key/, 'rewrite override');
  expectError({ config: good, environmentNames: ['AUTH_REQUIRED'] }, /must contain the dedicated profile marker/, 'missing environment marker');
  expectError({ config: good, environmentNames: [PROFILE_MARKER, 'UNRELATED_PROVIDER_SECRET'] }, /not allowlisted/, 'unrelated credential name');
  expectError({ config: good, environmentNames: [PROFILE_MARKER, 'TOKEN=do-not-print'] }, /names, never values/, 'environment value');
  expectError({ config: good, environmentNames: [PROFILE_MARKER], artifactPaths: ['build/nested/.env.production'] }, /must not contain \.env/, 'nested env artifact');
  console.log('Dedicated transcription pilot deployment self-test passed.');
}

function parseArguments(args) {
  const options = {};
  const keys = { '--config': 'configPath', '--env-names': 'environmentNamesPath', '--artifact-paths': 'artifactPathsPath' };
  if (args.length === 1 && args[0] === '--self-test') return { selfTest: true };
  for (let index = 0; index < args.length; index += 2) {
    const key = keys[args[index]];
    const value = args[index + 1];
    if (!key || Object.prototype.hasOwnProperty.call(options, key)
        || !value || value.startsWith('--')) {
      // Do not echo arguments: a mistakenly supplied value could be a secret.
      throw new Error('Invalid arguments: use each of --config, --env-names, --artifact-paths once with a filename, or --self-test alone.');
    }
    options[key] = value;
  }
  return options;
}

if (require.main === module) {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (options.selfTest) {
    runSelfTest();
  } else {
    const errors = runCheck(options);
    if (errors.length) {
      console.error('Dedicated transcription pilot deployment check failed:');
      errors.forEach((error) => console.error(`- ${error}`));
      process.exit(1);
    }
    console.log(`Dedicated transcription pilot config valid; environment inventory ${options.environmentNamesPath ? 'checked' : 'not supplied'}; artifact inventory ${options.artifactPathsPath ? 'checked' : 'not supplied'}. Target binding is owned by the runtime deployment registry.`);
  }
}

module.exports = {
  ALLOWED_ENV_NAMES,
  PROFILE_MARKER,
  PROFILE_VALUE,
  runCheck,
  validateArtifactPaths,
  validateConfig,
  validateDeploymentProfile,
  validateSharedConfig,
  validateEnvironmentNames,
};
