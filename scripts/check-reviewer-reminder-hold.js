#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const HELD_CRON_PATH = '/api/cron/reviewer-reminders';
const ALTERNATE_CONFIG_FILENAMES = [
  'vercel.ts',
  'vercel.js',
  'vercel.mjs',
  'vercel.cjs',
];

function validateVercelConfig(config) {
  const errors = [];

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return ['vercel.json must contain a top-level object.'];
  }

  if (!Array.isArray(config.crons)) {
    return [
      'vercel.json must contain a crons array while the reviewer-reminder incident hold is active.',
    ];
  }

  config.crons.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`vercel.json crons[${index}] must be an object.`);
      return;
    }

    if (typeof entry.path !== 'string' || entry.path.trim() === '') {
      errors.push(`vercel.json crons[${index}].path must be a non-empty string.`);
      return;
    }

    const routePath = entry.path.split(/[?#]/, 1)[0];
    if (routePath === HELD_CRON_PATH) {
      errors.push(
        `${HELD_CRON_PATH} is under an incident hold and must not be registered as a Vercel cron.`,
      );
    }
  });

  return errors;
}

function checkReviewerReminderHold(configPath = path.join(process.cwd(), 'vercel.json')) {
  let config;

  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    return [`Unable to read valid JSON from ${configPath}: ${error.message}`];
  }

  const errors = validateVercelConfig(config);
  const configDirectory = path.dirname(configPath);
  for (const filename of ALTERNATE_CONFIG_FILENAMES) {
    const alternatePath = path.join(configDirectory, filename);
    if (fs.existsSync(alternatePath)) {
      errors.push(
        `${alternatePath} could supersede vercel.json; the incident-hold gate must be deliberately updated before an alternate Vercel config is introduced.`,
      );
    }
  }

  return errors;
}

if (require.main === module) {
  const errors = checkReviewerReminderHold();

  if (errors.length > 0) {
    console.error('Reviewer reminder incident hold check failed:');
    errors.forEach((error) => console.error(`- ${error}`));
    console.error(
      'Do not restore the schedule until the reactivation prerequisites in docs/REVIEWER_ENGAGEMENT_SPEC.md are complete and the hold is deliberately retired.',
    );
    process.exit(1);
  }

  console.log(
    `Reviewer reminder incident hold active: ${HELD_CRON_PATH} is absent from the Vercel cron registry.`,
  );
}

module.exports = {
  ALTERNATE_CONFIG_FILENAMES,
  HELD_CRON_PATH,
  checkReviewerReminderHold,
  validateVercelConfig,
};
