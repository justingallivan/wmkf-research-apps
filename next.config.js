const {
  LEGACY_HOST,
  CANONICAL_HOST,
} = require('./lib/utils/legacy-host-redirect');

const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), browsing-topics=()',
  },
  {
    key: 'Cross-Origin-Opener-Policy',
    value: 'same-origin',
  },
  {
    key: 'Cross-Origin-Resource-Policy',
    value: 'same-origin',
  },
  {
    key: 'X-Permitted-Cross-Domain-Policies',
    value: 'none',
  },
  {
    key: 'X-Robots-Tag',
    value: 'noindex, nofollow, noarchive',
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Keep `next dev` out of the canonical instruction file. Next's agent-rules
  // generator (`node_modules/next/dist/server/lib/generate-agent-files.js`)
  // upserts a managed block into AGENTS.md, and because AGENTS.md is a tracked
  // symlink to CLAUDE.md here, that write followed the link and appended vendor
  // instruction text to CLAUDE.md itself — the file whose authority is owned by
  // `docs/CLAUDE_INSTRUCTION_AUTHORITY.md`. Disabled so a build tool cannot edit
  // agent instructions; a Next.js upgrade would otherwise silently rewrite that
  // block on someone's next dev run. Next 16 guidance still lives in
  // `node_modules/next/dist/docs/` for anyone who needs it.
  agentRules: false,
  // Bundle sanitize-html and its htmlparser2 12 tree into the server chunks
  // instead of externalizing them. htmlparser2 >= 11 is ESM-only and Vercel's
  // 22.x function runtime cannot require() ESM (2026-09-01 incident: every
  // route importing sanitize-html 500'd at module load with ERR_REQUIRE_ESM
  // after PR #142). Bundling means no runtime require() of these packages;
  // next/jest also transforms transpilePackages, so Jest needs no separate
  // exemption. Memory: project-vercel-node22-no-require-esm.
  // The webpack builder (used by the Playwright e2e job via `next build
  // --webpack`) refuses a CommonJS require() of an ESM package even when both
  // are being bundled; 'loose' lets it bundle sanitize-html -> htmlparser2.
  // Turbopack panics on this key ("esmExternals = loose is not supported"),
  // so it is set only when Turbopack is not the active bundler. Next sets
  // process.env.TURBOPACK before loading this file for Turbopack builds and
  // leaves it unset for --webpack (verified empirically on Next 16.2).
  ...(process.env.TURBOPACK ? {} : { experimental: { esmExternals: 'loose' } }),
  transpilePackages: [
    'sanitize-html',
    'htmlparser2',
    'domhandler',
    'domutils',
    'dom-serializer',
    'domelementtype',
    'entities',
  ],
  // Both review DOCX endpoints load approved binary templates from disk at
  // runtime. Include them explicitly because the filenames are resolved by the
  // shared renderer rather than through a static JavaScript import.
  outputFileTracingIncludes: {
    '/api/review-manager/export-reviews': ['./shared/templates/reviews/*.docx'],
    '/api/cron/send-review-thankyous': ['./shared/templates/reviews/*.docx'],
  },
  async redirects() {
    return [
      // Legacy production host page navigations move to the canonical branded host.
      // API routes are excluded, especially /api/auth/*, because auth state cookies
      // are host-scoped; this prevents future old-host page loads from issuing
      // same-origin POSTs there but does not rescue an already-open old-host tab
      // until its next navigation. Owner production checks remain: confirm the live
      // Vercel alias with `vercel alias ls` and live NEXTAUTH_URL via /api/health.
      {
        source: '/:path((?!api(?:/|$)).*)',
        has: [
          {
            type: 'host',
            value: LEGACY_HOST,
          },
        ],
        destination: `https://${CANONICAL_HOST}/:path*`,
        permanent: false,
      },
      {
        source: '/proposal-summarizer',
        destination: '/phase-ii-writeup',
        permanent: true,
      },
    ]
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, max-age=0',
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig
