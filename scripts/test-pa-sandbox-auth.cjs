#!/usr/bin/env node
/** Read-only authentication test for the November 12 Power Automate sandbox.
 * Requires Node.js 20 or newer.
 * Run: node scripts/test-pa-sandbox-auth.cjs /secure/path/credentials.json
 * The private JSON file contains clientSecret and shareSecret. Never commit it.
 * No job submission, model call, worker tick, or Dataverse write occurs.
 */
const fs = require('node:fs');
const endpoint = 'https://wmkfresearchapps-n7hku44p8-justin-gallivans-projects.vercel.app/api/automation/prompt-jobs/f7a2a5e4-9cc5-4a57-8dab-9e8898049608';
const tenant = 'baea89d4-d4a9-449a-b1d6-ec31fb5b380c';
const clientId = 'e4493960-9701-4c0b-ae21-7a9716af67ba';
const request = (url, options = {}) => fetch(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(20000) });
async function main() {
  if (process.argv.length !== 3) throw new Error('Supply the path to the private credentials JSON file.');
  let credentials;
  try { credentials = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); }
  catch { throw new Error('Could not read a valid credentials JSON file.'); }
  if (!['clientSecret', 'shareSecret'].every(key => typeof credentials[key] === 'string' && credentials[key].length > 20)) {
    throw new Error('Credentials file must contain clientSecret and shareSecret.');
  }
  // Shareable links use a cookie handshake, not the project-wide bypass header.
  const shareUrl = new URL(endpoint);
  shareUrl.searchParams.set('_vercel_share', credentials.shareSecret);
  const entry = await request(shareUrl);
  const cookie = entry.headers.getSetCookie().find(value => value.startsWith('_vercel_jwt='))?.split(';')[0];
  const location = entry.headers.get('location');
  if (entry.status !== 307 || !cookie || !location || new URL(location, endpoint).href !== endpoint) {
    throw new Error('Preview access failed; the deployment-specific share link may have expired.');
  }
  const tokenResponse = await request(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({ client_id: clientId, client_secret: credentials.clientSecret,
      scope: `api://${clientId}/.default`, grant_type: 'client_credentials' }),
  });
  if (!tokenResponse.ok) throw new Error(`Entra token request failed (${tokenResponse.status}); check the sandbox credential expiry.`);
  let token;
  try { token = (await tokenResponse.json()).access_token; }
  catch { throw new Error('Entra returned an invalid token response.'); }
  if (typeof token !== 'string' || !token) throw new Error('Entra did not return an access token.');
  for (const [label, authorization, expectedStatus, expectedError] of [
    ['Missing token rejected', null, 401, 'machine_auth_invalid'],
    ['Invalid token rejected', 'Bearer invalid', 401, 'machine_auth_invalid'],
    ['Valid token accepted by sandbox status route', `Bearer ${token}`, 404, 'machine_job_not_found'],
  ]) {
    const response = await request(endpoint, { headers: { cookie, ...(authorization ? { authorization } : {}) } });
    let body;
    try { body = await response.json(); } catch { throw new Error(`${label}: expected JSON, received HTTP ${response.status}.`); }
    if (response.status !== expectedStatus || body.error !== expectedError || response.headers.get('cache-control') !== 'private, no-store') {
      throw new Error(`${label}: unexpected HTTP response (${response.status}).`);
    }
    console.log(`PASS: ${label} (${expectedStatus} ${expectedError})`);
  }
  console.log('Authentication test passed. No job was created and no AI generation ran.');
}
main().catch(error => {
  // Do not print request objects, credentials, tokens, or response bodies.
  console.error(error.message);
  process.exitCode = 1;
});
