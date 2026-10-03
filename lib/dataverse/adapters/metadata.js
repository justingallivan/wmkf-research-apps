/**
 * Read-only adapter for Dataverse Web API metadata endpoints.
 *
 * Domain services may use this adapter for server-owned, constant metadata
 * paths without importing raw Dataverse transports. It never exposes writes.
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import { API_TIMEOUT } from '../../services/dynamics/constants.js';
import { buildHeaders, fetchWithTimeout } from '../../services/dynamics/http.js';
import { hasTrustedDalContext } from '../core/context.js';

function assertMetadataPath(path) {
  if (typeof path !== 'string'
      || !/^\/EntityDefinitions\([^)]*\)(?:\/|\?|$)/.test(path)
      || /\.\.|%2e|%2f|%5c|\\|[\r\n#]/i.test(path)) {
    throw new Error('Unsupported Dataverse metadata path.');
  }
}

export async function getMetadataBatch(paths) {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 12) {
    throw new Error('Dataverse metadata batch must contain 1–12 paths.');
  }
  paths.forEach(assertMetadataPath);
  if (!hasTrustedDalContext()) {
    throw new Error('Dataverse metadata reads require a trusted DAL context.');
  }
  const resourceUrl = process.env.DYNAMICS_URL;
  if (!resourceUrl) throw new Error('DYNAMICS_URL not set');
  const token = await DynamicsService.getAccessToken();
  return Promise.all(paths.map(async (path) => {
    const response = await fetchWithTimeout(
      `${resourceUrl}/api/data/v9.2${path}`,
      { headers: buildHeaders(token) },
      API_TIMEOUT,
    );
    if (!response.ok) {
      throw new Error(`Dataverse metadata read failed (${response.status}).`);
    }
    return response.json();
  }));
}

export async function getMetadata(path) {
  const [body] = await getMetadataBatch([path]);
  return body;
}
