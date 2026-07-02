/**
 * Renderer for docs/CANONICAL_COUNTS.md.
 *
 * Takes a snapshot of CANONICAL_FACTS with each entry's live value already
 * derived (so the gate controls when/how derives run) and produces the doc
 * body. Headings use the fact id as the anchor — the canonical-pointers gate
 * validates pointers against the registry by fact-id, not by heading prose,
 * so heading prose may evolve freely.
 */

const CANONICAL_COUNTS_REL = 'docs/CANONICAL_COUNTS.md';

const { parseFrontmatter, renderFrontmatter } = require('./docs-catalog');

function canonicalCountsFrontmatter(existingText) {
  const existing = existingText ? (parseFrontmatter(existingText).data || {}) : {};
  const data = {
    ...existing,
    title: 'Canonical Counts',
    domain: 'docs-governance',
    kind: 'source-of-truth',
    status: 'canonical',
    summary: 'Generated source of truth for code-derived scalar counts used by documentation gates.',
    canonical: true,
    cataloged: existing.cataloged || existing.last_verified || new Date().toISOString().slice(0, 10),
    owner: existing.owner || 'product-engineering',
    related: existing.related || [
      'scripts/lib/canonical-facts.js',
      'docs/CI_GATES_REFERENCE.md',
    ],
  };
  delete data.last_verified;
  return renderFrontmatter(data);
}

function renderCanonicalCountsDoc(facts, options = {}) {
  const lines = [];
  lines.push('# Canonical Counts');
  lines.push('');
  lines.push('> **Auto-generated.** Do not hand-edit.');
  lines.push('> Source: `scripts/lib/canonical-facts.js` (CANONICAL_FACTS registry).');
  lines.push('> Refresh: `npm run check:fact-consistency -- --write`.');
  lines.push('> Gated by `check:fact-consistency` (value drift, on-disk sync) and `check:canonical-pointers` (anchor rot).');
  lines.push('');
  lines.push('Each section below is the single source of truth for one code-derived scalar.');
  lines.push('Live docs/memory link to these anchors using markdown pointers of the form');
  lines.push('`[N](docs/CANONICAL_COUNTS.md#<fact-id>)`. Both the literal `N` and the anchor');
  lines.push('are machine-verified — `N` against the derive, the anchor against this registry.');
  lines.push('');
  for (const fact of facts) {
    lines.push(`## ${fact.id}`);
    lines.push('');
    lines.push(`- **Live value:** ${fact.live}`);
    lines.push(`- **Description:** ${fact.describe}`);
    lines.push(`- **Derive:** ${fact.derivePath}`);
    lines.push('');
  }
  return `${canonicalCountsFrontmatter(options.existingText)}${lines.join('\n')}`;
}

module.exports = {
  CANONICAL_COUNTS_REL,
  renderCanonicalCountsDoc,
};
