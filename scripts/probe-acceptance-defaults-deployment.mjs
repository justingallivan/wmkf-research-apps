/** Read-only, signed-out release probe. Public assets/GETs only; no credentials, DB, cron or email calls. */
const origin = 'https://applications.wmkeck.org';
const get = async (path, redirect = 'follow') => {
  const response = await fetch(new URL(path, origin), { redirect, signal: AbortSignal.timeout(20000) });
  return { response, text: await response.text() };
};
const protection = {};
for (const path of ['/profile-settings', '/api/reviewer-acceptance-email-preferences']) {
  const { response } = await get(path, 'manual');
  const location = response.headers.get('location');
  const guarded = [401, 403].includes(response.status)
    || ([302, 303, 307, 308].includes(response.status) && location && new URL(location, origin).pathname === '/auth/signin');
  if (!guarded) throw new Error(`Expected signed-out protection on ${path}: HTTP ${response.status}`);
  protection[path] = { status: response.status, signInRedirect: Boolean(location) };
}
const { response: signIn, text: html } = await get('/auth/signin');
if (signIn.status !== 200) throw new Error(`Sign-in unavailable: HTTP ${signIn.status}`);
const match = html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/);
const buildId = match && JSON.parse(match[1]).buildId;
if (typeof buildId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(buildId)) throw new Error('Missing public build identity');
const { response: manifestResponse, text: manifest } = await get(`/_next/static/${buildId}/_buildManifest.js`);
if (manifestResponse.status !== 200) throw new Error('Build manifest unavailable');
const entry = manifest.match(/"\/profile-settings"\s*:\s*(\[[^\]]*\])/);
if (!entry) throw new Error('Profile Settings absent from public manifest');
let queue = JSON.parse(entry[1]);
const seen = new Set();
let source = '';
for (let depth = 0; queue.length && depth < 3; depth++) {
  const paths = [...new Set(queue)].filter(path => !seen.has(path)); queue = [];
  if (seen.size + paths.length > 32) throw new Error('Unexpected asset graph size');
  const results = await Promise.all(paths.map(async path => {
    if (!/^static\/(?:immutable\/)?chunks\/[a-zA-Z0-9_.~-]+\.js$/.test(path)) throw new Error('Unexpected asset path');
    seen.add(path);
    const { response, text } = await get(`/_next/${path}`);
    if (response.status !== 200 || text.length > 8_000_000) throw new Error('Asset unavailable or oversized');
    return text;
  }));
  for (const text of results) {
    source += text;
    for (const child of text.matchAll(/["'](static\/(?:immutable\/)?chunks\/[a-zA-Z0-9_.~-]+\.js)["']/g)) queue.push(child[1]);
  }
}
const markers = Object.fromEntries(['/api/reviewer-acceptance-email-preferences', 'Default acceptance subject', 'may already be saved'].map(marker => [marker, source.includes(marker)]));
if (Object.values(markers).some(found => !found)) throw new Error('Acceptance settings/discard-warning code missing from served assets');
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), origin, buildId, signInStatus: signIn.status, protection, chunksChecked: seen.size, markers, limitation: 'Public assets and signed-out access only; no authenticated preference write or real email delivery tested.' }, null, 2));
