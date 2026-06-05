# Canonical Counts

> **Auto-generated.** Do not hand-edit.
> Source: `scripts/lib/canonical-facts.js` (CANONICAL_FACTS registry).
> Refresh: `npm run check:fact-consistency -- --write`.
> Gated by `check:fact-consistency` (value drift, on-disk sync) and `check:canonical-pointers` (anchor rot).

Each section below is the single source of truth for one code-derived scalar.
Live docs/memory link to these anchors using markdown pointers of the form
`[N](docs/CANONICAL_COUNTS.md#<fact-id>)`. Both the literal `N` and the anchor
are machine-verified — `N` against the derive, the anchor against this registry.

## app-definition-count

- **Live value:** 18
- **Description:** APP_REGISTRY application definitions
- **Derive:** `shared/config/appRegistry.js` → `APP_REGISTRY.length`

## requireappaccess-endpoint-count

- **Live value:** 56
- **Description:** pages/api files with requireAppAccess() call sites
- **Derive:** `pages/api/**/*.{js,mjs,cjs,jsx,ts,tsx}` → count of files containing at least one `requireAppAccess(...)` call

## api-route-file-count

- **Live value:** 103
- **Description:** pages/api route files (matches check:api-routes walker)
- **Derive:** `pages/api/**/*.js` → count of route files (same predicate `scripts/check-api-route-security-matrix.js` uses)
