// Optional remote browser run for the applicant materials UX. The regular
// playwright.config.js remains local-only and owns its own webServer.
const { defineConfig } = require('@playwright/test');
const { webServer: _webServer, ...localConfig } = require('./playwright.config');

const rawPreviewUrl = process.env.MATERIALS_PREVIEW_URL;
if (!rawPreviewUrl) {
  throw new Error('MATERIALS_PREVIEW_URL must name the immutable Preview deployment URL.');
}

let previewUrl;
try {
  previewUrl = new URL(rawPreviewUrl);
} catch {
  throw new Error('MATERIALS_PREVIEW_URL must be an absolute HTTPS URL.');
}

const hostname = previewUrl.hostname.toLowerCase();
const productionAliases = new Set([
  'applications.wmkeck.org',
  'wmkfresearch.vercel.app',
  'wmkfresearchapps-preview.vercel.app',
]);
if (previewUrl.protocol !== 'https:' || previewUrl.username || previewUrl.password
  || previewUrl.pathname !== '/' || previewUrl.search || previewUrl.hash
  || productionAliases.has(hostname)
  || hostname.includes('-git-main-')
  || !/^wmkfresearchapps-[a-z0-9]{8,12}-justin-gallivans-projects\.vercel\.app$/.test(hostname)) {
  throw new Error('MATERIALS_PREVIEW_URL must be an immutable non-production Vercel Preview deployment URL.');
}

module.exports = defineConfig({
  ...localConfig,
  use: { ...localConfig.use, baseURL: previewUrl.origin },
  webServer: undefined,
});
