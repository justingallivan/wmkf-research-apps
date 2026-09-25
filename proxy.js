/**
 * Next.js Proxy - Server-side Authentication Gate + Nonce-based CSP
 *
 * (Formerly `middleware.js`; renamed to the `proxy` file convention in
 * Next.js 16 — the deprecated `middleware` convention still works but warns.)
 *
 * Intercepts all requests before any page content or JS bundle is delivered.
 * Unauthenticated users are redirected to /auth/signin before seeing anything.
 *
 * Generates a unique nonce per request for Content Security Policy.
 * Next.js automatically applies the nonce to framework scripts during SSR
 * when it detects 'nonce-{value}' in the CSP header.
 *
 * Respects the shared auth policy. `AUTH_REQUIRED=false` bypasses auth only when
 * `NODE_ENV !== 'production'`; production-mode runtimes (including Vercel
 * Preview and Production) additionally require
 * `EMERGENCY_AUTH_BYPASS=true`.
 * NextAuth's own routes (/api/auth/*) are excluded so the login flow works.
 *
 * Uses withAuth from next-auth/middleware (uses jose instead of Node.js crypto).
 * Proxy defaults to the Node.js runtime in Next 16; all primitives used here
 * (jose, crypto.getRandomValues, btoa, Headers, NextResponse) run there fine.
 */

import { NextResponse } from 'next/server';
import { withAuth } from 'next-auth/middleware';
import { isAuthRequired } from './lib/utils/auth-policy';
import { SHAREPOINT_CANONICAL_SITE_URL } from './lib/services/graph/constants';
import { classifyDeployment } from './lib/dataverse/core/interlock';

const SHAREPOINT_CANONICAL_ORIGIN = new URL(SHAREPOINT_CANONICAL_SITE_URL).origin;
const GRAPH_UPLOAD_ORIGIN = 'https://*.up.1drv.com';
const PRESENTATION_UPLOAD_PROOF_PATH = '/meeting-tracker/presentation-media-proof';
const PRESENTATION_UPLOAD_PAGE = /^\/meeting-tracker\/visits\/[^/]+\/?$/;
const PRESENTATION_PLAYBACK_PROOF_PREFIX = '/external/presentation-media-proof/';

export default withAuth(
  function proxy(req) {
    // Generate a unique nonce for this request
    const nonceBytes = new Uint8Array(16);
    crypto.getRandomValues(nonceBytes);
    const nonce = btoa(String.fromCharCode(...nonceBytes));
    const isDev = process.env.NODE_ENV === 'development';
    const hostname = req.nextUrl?.hostname;
    const pathname = req.nextUrl?.pathname || '';
    const isPreview = classifyDeployment() === 'preview';
    const isLoopbackHttp = req.nextUrl?.protocol === 'http:'
      && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
    const isPresentationUploadProof = isPreview && pathname === PRESENTATION_UPLOAD_PROOF_PATH;
    const isPresentationUploadPage = PRESENTATION_UPLOAD_PAGE.test(pathname);
    const playbackProofToken = pathname.startsWith(PRESENTATION_PLAYBACK_PROOF_PREFIX)
      ? pathname.slice(PRESENTATION_PLAYBACK_PROOF_PREFIX.length)
      : '';
    const isPresentationPlaybackProof = isPreview
      && playbackProofToken.length > 0
      && !playbackProofToken.includes('/');

    // Build CSP directives
    // Dev: Turbopack injects inline scripts without nonces, needs unsafe-inline + unsafe-eval.
    //      localhost is HTTP, so upgrade-insecure-requests would break all resource loads.
    // Prod: 'self' allows same-origin script chunks, nonce covers any inline scripts on
    //      SSR pages. No unsafe-inline or unsafe-eval — blocks injected scripts and eval.
    //      Note: 'strict-dynamic' is NOT used because SSG pages are pre-rendered at build
    //      time without nonces on script tags, so strict-dynamic would override 'self' and
    //      block all same-origin scripts.
    const scriptSrc = isDev
      ? `'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com`
      : `'self' 'nonce-${nonce}' https://va.vercel-scripts.com`;

    // style-src: 'unsafe-inline' in both modes — safe (no script execution vector),
    // avoids edge cases with framework-injected styles on SSG pages.
    const styleSrc = `'self' 'unsafe-inline'`;

    let connectSrc = isDev
      ? `'self' https://*.public.blob.vercel-storage.com https://vercel.com https://*.vercel-insights.com ws://localhost:3000 ws://127.0.0.1:3000`
      : `'self' https://vercel.com https://*.vercel-insights.com`;
    if (isPresentationUploadProof || isPresentationUploadPage) {
      // Graph upload sessions currently resolve to signed *.up.1drv.com URLs;
      // keep that egress capability confined to authenticated upload pages.
      // The canonical tenant origin is included because Microsoft may issue a
      // tenant-hosted session URL for the governed SharePoint drive.
      connectSrc += ` ${GRAPH_UPLOAD_ORIGIN} ${SHAREPOINT_CANONICAL_ORIGIN}`;
    }

    const directives = [
      `default-src 'self'`,
      `script-src ${scriptSrc}`,
      `style-src ${styleSrc}`,
      `img-src 'self' data: https:`,
      `font-src 'self'`,
      `connect-src ${connectSrc}`,
      `frame-ancestors 'none'`,
    ];

    if (isPresentationPlaybackProof) {
      // Graph's short-lived download URL for this governed drive is hosted on
      // the canonical tenant. Other pages retain default-src 'self'.
      directives.push(`media-src 'self' ${SHAREPOINT_CANONICAL_ORIGIN}`);
    }

    // Production deployments must upgrade insecure requests. A production build
    // exercised through `next start` on an HTTP loopback address is the sole
    // exception: Safari honors this directive by rewriting same-origin
    // `http://localhost/_next/*` scripts to HTTPS, but the local server has no TLS
    // listener, so the application bundle never loads.
    if (!isDev && !isLoopbackHttp) {
      directives.push(`upgrade-insecure-requests`);
    }

    const csp = directives.join('; ');

    // Clone request headers and add nonce + CSP
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('Content-Security-Policy', csp);

    // Return response with CSP set on both request and response headers
    const response = NextResponse.next({
      request: { headers: requestHeaders },
    });
    response.headers.set('Content-Security-Policy', csp);

    return response;
  },
  {
    callbacks: {
      authorized({ req, token }) {
        const pathname = req.nextUrl.pathname;
        if (pathname?.startsWith('/auth/')) return true;
        // External-party paths (reviewer magic-link, etc.) authenticate at the
        // route level via a signed token in the URL — see lib/services/external-token.js.
        // We bypass NextAuth here so the page/API can run without an AzureAD session,
        // but stay inside the proxy function so CSP headers are still applied.
        if (pathname?.startsWith('/external/') || pathname?.startsWith('/api/external/')) return true;
        // Single source of truth shared with API routes — fails closed in
        // production if AUTH_REQUIRED is missing or credentials are absent.
        if (!isAuthRequired()) return true;

        // Idle timeout — applies to both surfaces. **Fail-closed:** missing
        // `lastActivity` is treated as expired (B5-F2 audit hardening).
        //
        // Production safety verified (Codex sweep, S188): `lastActivity` was
        // introduced 2026-03-11 (commit 8671425). Our configured JWT `maxAge`
        // is 8 hours (`pages/api/auth/[...nextauth].js:301-304`), so any
        // session existing today was issued within the last 8h — i.e., long
        // after the lastActivity set-sites landed. No legitimate production
        // session lacks lastActivity.
        //
        // The fail-closed gate is therefore pure defense-in-depth for hypothetical
        // future code paths that might issue a token without going through one of
        // the three set-sites in pages/api/auth/[...nextauth].js (sign-in at
        // :217 / :226, post-idle refresh at :232).
        //
        // Pre-S188 shape was `if (token?.lastActivity && ...)` which silently
        // exempted any lastActivity-less token from idle timeout.
        const IDLE_MS = 2 * 60 * 60 * 1000;
        const lastActivity = token?.lastActivity;
        if (!lastActivity || Date.now() - lastActivity > IDLE_MS) {
          return false;
        }

        const isApplicantSurface = pathname?.startsWith('/apply') || pathname?.startsWith('/api/apply');

        if (isApplicantSurface) {
          // Applicant routes accept ONLY applicant sessions. A staff session
          // hitting /apply gets bounced (don't silently allow — different
          // identity model, different downstream auth assumptions).
          return token?.userType === 'applicant' && !!token?.contactOid;
        }

        // Staff surface (everything else). Reject applicant tokens explicitly
        // so they can't reach staff-side endpoints with a half-populated session.
        if (token?.userType === 'applicant') return false;
        return !!token?.azureId;
      },
    },
    pages: {
      signIn: '/auth/signin',
    },
  }
);

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico (browser icon)
     * - apple-touch-icon* (iOS home screen icons)
     * - /api/auth/* (NextAuth routes must be accessible for login flow)
     * - /api/cron/* (Vercel cron jobs authenticate via CRON_SECRET, not JWT)
     * - /api/irs/* (PowerAutomate authenticates via IRS_VERIFY_SECRET header, not JWT)
     * - /api/webhooks/bill (BILL.com x-bill-sha-signature HMAC). Exact
     *   match anchored with `$` — `/api/webhooks/billing` or
     *   `/api/webhooks/bill/sub-route` would NOT be exempted, forcing
     *   any future webhook route to be added here explicitly with its
     *   own per-route auth review.
     * - /api/bill/onboard-reviewer (internal HMAC; called by respond.js
     *   server-side, which has no staff NextAuth session). Same anchored-
     *   match safety as the webhook; auth is HMAC-of-body via
     *   BILL_INTEGRATION_SECRET. See lib/bill/internal-call-auth.js.
     * - /api/webhooks/vercel-log-drain (Vercel Log Drain x-vercel-signature
     *   HMAC-SHA1 of raw body via VERCEL_LOG_DRAIN_SECRET). Exact anchored
     *   match, same safety rationale as the BILL webhook.
     */
    '/((?!_next/static|_next/image|favicon\\.ico|apple-touch-icon|api/auth|api/cron|api/irs|api/webhooks/bill$|api/webhooks/vercel-log-drain$|api/bill/onboard-reviewer$).*)',
  ],
};
