'use strict';

function assertFreshDatabase(existingTableNames, allowPopulatedSetup = false) {
  if (!Array.isArray(existingTableNames)) {
    throw new TypeError('existingTableNames must be an array');
  }
  if (existingTableNames.length === 0 || allowPopulatedSetup) return;

  const names = existingTableNames.slice(0, 10).join(', ');
  throw new Error(
    `Refusing fresh-install setup on a populated database (found: ${names}). ` +
    'Use `node scripts/apply-migrations.js` for an existing environment. ' +
    'Set ALLOW_POPULATED_DATABASE_SETUP=true only for a deliberate bootstrap recovery.'
  );
}

module.exports = { assertFreshDatabase };
