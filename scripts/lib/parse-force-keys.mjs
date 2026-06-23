export function parseForceKeys(argv, validKeys) {
  const validKeySet = new Set(validKeys);
  const forceArg = argv.find((a) => a.startsWith('--force-keys='));
  const forceRaw = forceArg ? forceArg.slice('--force-keys='.length).trim() : '';
  const forceAll = forceRaw === 'all';
  const forceKeys = new Set(
    forceRaw && !forceAll ? forceRaw.split(',').map((s) => s.trim()).filter(Boolean) : [],
  );

  for (const key of forceKeys) {
    if (!validKeySet.has(key)) {
      const error = new Error(`Unknown --force-keys catalog key: ${key}`);
      error.code = 'UNKNOWN_FORCE_KEY';
      error.key = key;
      error.validKeys = [...validKeySet];
      throw error;
    }
  }

  return { forceAll, forceKeys };
}
