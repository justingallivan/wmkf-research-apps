/**
 * Read-only adapter for Dataverse Web API metadata endpoints.
 *
 * Domain services may use this adapter for server-owned, constant metadata
 * paths without importing raw Dataverse transports. It never exposes writes.
 */

import { createClient, getAccessToken } from '../client.js';

function assertMetadataPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/EntityDefinitions(')) {
    throw new Error('Unsupported Dataverse metadata path.');
  }
}

export async function getMetadataBatch(paths) {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 12) {
    throw new Error('Dataverse metadata batch must contain 1–12 paths.');
  }
  paths.forEach(assertMetadataPath);
  const resourceUrl = process.env.DYNAMICS_URL;
  if (!resourceUrl) throw new Error('DYNAMICS_URL not set');
  const token = await getAccessToken(resourceUrl);
  const client = createClient({ resourceUrl, token });
  return Promise.all(paths.map(async (path) => {
    const response = await client.get(path);
    if (!response.ok) {
      throw new Error(`Dataverse metadata read failed (${response.status}).`);
    }
    return response.body;
  }));
}

export async function getMetadata(path) {
  const [body] = await getMetadataBatch([path]);
  return body;
}
