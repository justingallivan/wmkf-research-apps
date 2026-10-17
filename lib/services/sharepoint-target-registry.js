/**
 * Tracked SharePoint site registry.
 *
 * The akoyaGO site is shared by the production and sandbox Dataverse
 * environments, so it must never be described as a sandbox SharePoint site.
 * Exact host + site-path registration keeps preview/document reads from being
 * redirected by a same-tenant environment override to an unreviewed site.
 */

export const SHAREPOINT_CANONICAL_SITE_URL = 'https://appriver3651007194.sharepoint.com/sites/akoyaGO';

const REGISTERED_SITES = Object.freeze([
  Object.freeze({
    key: 'akoyago-shared',
    scope: 'shared',
    hostname: 'appriver3651007194.sharepoint.com',
    pathname: '/sites/akoyago',
    siteUrl: SHAREPOINT_CANONICAL_SITE_URL,
  }),
]);

function normalizePathname(pathname) {
  return (String(pathname || '').replace(/\/+$/, '') || '/').toLowerCase();
}

export function classifySharePointSite(siteUrl) {
  let parsed;
  try {
    parsed = new URL(siteUrl);
  } catch {
    return { key: null, scope: 'unknown', registered: false, hostname: null, pathname: null, siteUrl: null };
  }
  const hostname = parsed.hostname.toLowerCase();
  const pathname = normalizePathname(parsed.pathname);
  const match = REGISTERED_SITES.find(site => (
    parsed.protocol === 'https:'
      && !parsed.username
      && !parsed.password
      && !parsed.port
      && !parsed.search
      && !parsed.hash
      && hostname === site.hostname
      && pathname === site.pathname
  ));
  if (!match) {
    return { key: null, scope: 'unknown', registered: false, hostname, pathname, siteUrl: null };
  }
  return {
    key: match.key,
    scope: match.scope,
    registered: true,
    hostname: match.hostname,
    pathname: match.pathname,
    siteUrl: match.siteUrl,
  };
}

export function configuredSharePointTargetInfo(env = process.env) {
  return classifySharePointSite(env.SHAREPOINT_SITE_URL || SHAREPOINT_CANONICAL_SITE_URL);
}

export const REGISTERED_SHAREPOINT_SITES = REGISTERED_SITES;

/** Connor's exact Board Materials folder, live-resolved 2026-10-16.
 * Separate from the default-site registry: registering this destination must
 * not allow SHAREPOINT_SITE_URL to redirect existing AkoyaGo workflows.
 */
export const RESEARCH_BOARD_MATERIALS_TARGET = Object.freeze({
  siteId: 'appriver3651007194.sharepoint.com,b054330a-50fa-47ff-bbb5-3334931bba64,f715fd9e-9976-48d6-bb48-83796982874e',
  driveId: 'b!CjNUsPpQ_0e7tTM0kxu6ZJ79Ffd2mdZIu0iDeWmCh07Jfe3QPWzBQK4bHaey0TsY',
  folderId: '016CN7LDORXOJUYVKPFNE3P4DP5UIMWIVJ',
  webUrl: 'https://appriver3651007194.sharepoint.com/sites/Research/Shared%20Documents/Board%20Materials',
});
