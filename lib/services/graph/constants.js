/**
 * Shared Graph transport and SharePoint resolution constants.
 *
 * S1 owns only immutable configuration. Operation and cache state remains in
 * the facade until its named extraction stage.
 */
export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
export const API_TIMEOUT = 30_000;
export const DOWNLOAD_TIMEOUT = 60_000;
export const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Default SharePoint site URL (confirmed via testing)
export const SHAREPOINT_CANONICAL_SITE_URL = 'https://appriver3651007194.sharepoint.com/sites/akoyaGO';

// Allowlisted SharePoint hosts. Any SHAREPOINT_SITE_URL env override must land
// on one of these — this prevents a mis-set env var (or a compromised env-var
// admin) from redirecting every Graph call at an attacker-controlled host,
// which would otherwise constitute SSRF via config.
export const ALLOWED_SHAREPOINT_HOSTS = new Set([
  'appriver3651007194.sharepoint.com',
]);

// Allowlist of document libraries on the akoyaGO SharePoint site.
// Each entry corresponds to a Dynamics entity with server-side document management enabled.
export const ALLOWED_LIBRARIES = new Set([
  'akoya_request',
  'akoya_concept',
  'akoya_phase',
  'akoya_requestpayment',
  'akoya_akoyaapply',
  'akoya_akoyaapplycontact',
  'akoya_goapplystatustracking',
  'akoya_lettertemplatesession',
  'contact',
  'account',
  'requestarchive1',
  'requestarchive2',
  'requestarchive3',
]);
