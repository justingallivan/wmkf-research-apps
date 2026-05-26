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
 * Respects AUTH_REQUIRED kill switch — when disabled, all requests pass through.
 * NextAuth's own routes (/api/auth/*) are excluded so the login flow works.
 *
 * Uses withAuth from next-auth/middleware (uses jose instead of Node.js crypto).
 * Proxy defaults to the Node.js runtime in Next 16; all primitives used here
 * (jose, crypto.getRandomValues, btoa, Headers, NextResponse) run there fine.
 */

import { NextResponse } from 'next/server';
import { withAuth } from 'next-auth/middleware';
import { isAuthRequired } from './lib/utils/auth-policy';

export default withAuth(
  function proxy(req) {
    // Generate a unique nonce for this request
    const nonceBytes = new Uint8Array(16);
    crypto.getRandomValues(nonceBytes);
    const nonce = btoa(String.fromCharCode(...nonceBytes));
    const isDev = process.env.NODE_ENV === 'development';

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

    const connectSrc = isDev
      ? `'self' https://*.public.blob.vercel-storage.com https://vercel.com https://*.vercel-insights.com ws://localhost:3000 ws://127.0.0.1:3000`
      : `'self' https://vercel.com https://*.vercel-insights.com`;

    const directives = [
      `default-src 'self'`,
      `script-src ${scriptSrc}`,
      `style-src ${styleSrc}`,
      `img-src 'self' data: https:`,
      `font-src 'self'`,
      `connect-src ${connectSrc}`,
      `frame-ancestors 'none'`,
    ];

    // Only upgrade insecure requests in production (localhost is HTTP)
    if (!isDev) {
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

        // Idle timeout — applies to both surfaces. Empty token from the JWT
        // callback's idle bail returns {} which fails the userType check below.
        if (token?.lastActivity && Date.now() - token.lastActivity > 2 * 60 * 60 * 1000) {
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
     */
    '/((?!_next/static|_next/image|favicon\\.ico|apple-touch-icon|api/auth|api/cron|api/irs|api/webhooks/bill$).*)',
  ],
};
