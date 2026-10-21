/** Pure model-override mapping and ordered change calculation for the admin editor. */
export function buildModelOverrideMap(apps) {
  const serverDbOverrides = {};
  apps.forEach(app => {
    Object.entries(app.models).forEach(([type, info]) => {
      if (info.dbOverride) {
        serverDbOverrides[`${app.appKey}:${type}`] = info.dbOverride;
      }
    });
  });
  return serverDbOverrides;
}

export function diffModelOverrides(serverDbOverrides, localOverrides) {
  const changes = [];
  const allKeys = new Set([...Object.keys(serverDbOverrides), ...Object.keys(localOverrides)]);
  for (const key of allKeys) {
    const serverVal = serverDbOverrides[key] || null;
    const localVal = localOverrides[key] || null;
    if (serverVal !== localVal) {
      const [appKey, modelType] = [key.substring(0, key.lastIndexOf(':')), key.substring(key.lastIndexOf(':') + 1)];
      changes.push({ appKey, modelType, modelId: localVal });
    }
  }
  return changes;
}
