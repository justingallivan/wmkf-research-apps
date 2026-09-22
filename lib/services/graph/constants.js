/**
 * Shared Graph transport and SharePoint resolution constants.
 *
 * This module owns all immutable Graph transport and SharePoint resolution
 * configuration. Mutable operation state lives with its operation owner.
 */
import {
  REGISTERED_SHAREPOINT_SITES,
  SHAREPOINT_CANONICAL_SITE_URL as REGISTERED_SHAREPOINT_CANONICAL_SITE_URL,
} from '../sharepoint-target-registry.js';

export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
export const API_TIMEOUT = 30_000;
export const DOWNLOAD_TIMEOUT = 60_000;
export const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Keep the public Graph constant owned by this module while deriving its value
// from the tracked registry. This preserves the facade's ownership contract
// without duplicating the governed SharePoint target literal.
export const SHAREPOINT_CANONICAL_SITE_URL = REGISTERED_SHAREPOINT_CANONICAL_SITE_URL;

// Allowlisted SharePoint hosts. Any SHAREPOINT_SITE_URL env override must land
// on one of these — this prevents a mis-set env var (or a compromised env-var
// admin) from redirecting every Graph call at an attacker-controlled host,
// which would otherwise constitute SSRF via config.
export const ALLOWED_SHAREPOINT_HOSTS = new Set([
  ...REGISTERED_SHAREPOINT_SITES.map(site => site.hostname),
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
