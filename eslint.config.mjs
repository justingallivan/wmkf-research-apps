import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'

// Flat-config ESLint setup for a Next 16 project (`next lint` was removed in
// Next 16; this replaces it). Run with `npm run lint` / `npm run lint:fix`.
//
// Calibration rationale — this codebase had never been linted, so the bundled
// recommended rules surfaced ~100 findings. To make linting *usable* (a
// green-able baseline that flags real bugs rather than 100 ignored errors) the
// rule severities are tuned on one principle: correctness rules stay ERRORS;
// stylistic and React-Compiler-eligibility rules become WARNINGS (visible, but
// non-blocking — a ratchet to clean up over time, not suppression).
const eslintConfig = defineConfig([
  ...nextVitals,
  {
    rules: {
      // Stylistic only (literal ' and " in JSX text). Not a correctness issue;
      // Next's own docs use this as the canonical "rule to disable" example.
      'react/no-unescaped-entities': 'off',

      // React-Compiler-eligibility rules introduced in react-hooks v6. They flag
      // patterns that block the React Compiler's auto-memoization, not runtime
      // bugs — this app does not use the React Compiler. Demoted to warn so they
      // stay visible without blocking. Revisit if/when the Compiler is adopted.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',

      // NOTE: `react-hooks/rules-of-hooks` is deliberately left at its default
      // (error). It already caught a real latent bug (conditional hooks in
      // shared/components/RequireAuth.js). Do not demote it.
    },
  },
  {
    // Client Request Layer closeout ratchet
    // (docs/plans/CLIENT_REQUEST_LAYER_PLAN_2026-09-19.md §6 Stage 6, §2.6
    // allowlist). Every client `fetch(` call site under shared/components/**
    // and pages/** (excluding pages/api/**, which is server code) has been
    // migrated to shared/utils/api-request.js's requestJson/requestEnvelope,
    // except the sites listed in plan §2.6 (SSE streams, blob-download
    // sites reading Content-Disposition, and two fire-and-forget beacons).
    // Those sites carry `// eslint-disable-next-line no-restricted-syntax --
    // <reason>` naming the exemption; this is a site-level ratchet, not a
    // file-level one, so an un-annotated raw fetch( elsewhere in an
    // allowlisted file still fires.
    files: ['shared/components/**/*.js', 'pages/**/*.js'],
    ignores: ['pages/api/**'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: "CallExpression[callee.name='fetch']",
        message: 'Use requestJson/requestEnvelope from shared/utils/api-request.js; raw fetch is allowlisted only per CLIENT_REQUEST_LAYER_PLAN §2.6 with an eslint-disable comment naming the reason.',
      }, {
        selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='fetch'][callee.object.name=/^(globalThis|window)$/]",
        message: 'Use requestJson/requestEnvelope from shared/utils/api-request.js; raw fetch is allowlisted only per CLIENT_REQUEST_LAYER_PLAN §2.6 with an eslint-disable comment naming the reason.',
      }],
    },
  },
  globalIgnores([
    // eslint-config-next defaults
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Build/vendor/coverage artifacts
    'node_modules/**',
    'coverage/**',
    'public/**',
    '.claude/worktrees/**',
  ]),
])

export default eslintConfig
