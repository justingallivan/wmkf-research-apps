---
name: project-jsdom-serverless-esm-incompat
description: "jsdom can't load in the Vercel/Turbopack serverless runtime (ESM-require); for server-side HTML sanitization use a DOM-free sanitizer (sanitize-html), never DOMPurify+jsdom. All 3 markdown utils fixed S284."
metadata: 
  node_type: memory
  type: project
  status: active
  originSessionId: 51fa87ad-4c64-4fca-9f37-7ee9dd40ea02
---

## Recall Rule

Read this when: adding server-side HTML/Markdown sanitization, introducing a DOM
library into a server bundle, or changing `app-markdown.js` consumers.

Do:
- Use a statically imported DOM-free server sanitizer (`sanitize-html`) and keep
  its allowlist aligned with the browser renderer.
- Verify the relevant production function trace, not only local dev/build.

Do not:
- Use DOMPurify plus `jsdom` on a server route.
- Rewrite the remaining client-only `app-markdown.js` branch unless it gains an
  SSR/API consumer.

Ground truth: `shared/utils/policy-markdown-server.js`,
`shared/utils/grantee-markdown.js`, and the S284 production incident retained
below.

**Symptom (S284):** `POST /api/admin/policies` 500'd in prod with `Cannot find
module 'jsdom'` → after forcing it into the trace, `ERR_REQUIRE_ESM` on
`@exodus/bytes` (via `html-encoding-sniffer@6`). Local `next dev`/`next build`
do NOT reproduce it — the dev box runs Node 26 (which supports `require(esm)`);
Vercel's function runtime is older and can't.

**Root cause:** `shared/utils/*-markdown.js` loaded jsdom server-side via
`eval('require')('jsdom')` so DOMPurify has a DOM. The eval hid jsdom from the
build tracer (so it kept jsdom out of the CLIENT bundle), but it also meant
jsdom was never bundled into the lambda. jsdom@29's transitive tree is full of
ESM-only pkgs (`@exodus/bytes`, `entities`, `parse5`, `tough-cookie`,
`@asamuzakjp/css-color`); Vercel's runtime can't `require()` any of them.
`serverExternalPackages:['jsdom']`, force-tracing via `import 'jsdom'`, pinning
`html-encoding-sniffer`, and swapping to `linkedom` ALL failed (linkedom is
also ESM-laden). The fix that worked: **don't externalize a DOM lib at all.**

**The fix pattern (commit e597747e):** split the shared markdown module into
`-client.js` (browser-only `renderPolicyMarkdown`, DOMPurify + `window`) and
`-server.js` (server-only `validatePolicyMarkdown` using `sanitize-html` — no
DOM, no jsdom, no eval). `sanitize-html` is a NORMAL static require, so
Turbopack BUNDLES it + deps into the function chunk → no runtime `require()` of
ESM. Keep both allowlists IDENTICAL so validator(server) ↔ renderer(client)
don't drift (they're now different engines: sanitize-html vs DOMPurify).
Verify: real bodies through the server validator + that build trace has the
sanitizer and NOT jsdom.

**Surfaces fixed (S284):** `policy-markdown` (split into -client/-server) and
`grantee-markdown.js` — the latter was server-only (4 live routes: grantee
website-html / cycle-export / abstract / external context) so it was converted
wholesale to `sanitize-html` (no client split needed). Verified: build trace
shows jsdom:0 + sanitize-html in those route bundles.

**Remaining (LOW risk, NOT actually broken):** `shared/utils/app-markdown.js:141`
still uses `eval('require')('jsdom')`, BUT its only consumer is `Phase2QAModal`
(client component, `if (!isOpen) return null`, client-fetched messages) — so the
jsdom branch is dead code in prod, never hit. Convert to the client/server split
only if it ever gains a server-side (SSR or API) caller. Its sanitization is
intricate (DOMPurify hooks: Tailwind class-value allowlist + href scheme), so
don't rush a sanitize-html rewrite for zero current benefit.
See [[feedback-codex-build-gate-turbopack-sandbox]].
