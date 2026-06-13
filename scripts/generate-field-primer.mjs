// Generate a field primer for a proposal and write it as markdown.
// v1: reads proposal TEXT from a file (extract from the PDF first). A
// requestId→SharePoint fetch is a follow-up. Requires the field-primer.generate
// row to be seeded in Dataverse (scripts/seed-field-primer-prompt.js --execute).
// Makes a live (paid) Claude call via the Executor; run unsandboxed.
// Output is written to tmp/ (gitignored — proposal content + named experts stay local).
//
// Usage:
//   node scripts/generate-field-primer.mjs --text <proposal.txt> [--focus "the materials angle"]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

for (const envFile of ['.env', '.env.local']) {
  try {
    const c = readFileSync(resolve(process.cwd(), envFile), 'utf8');
    for (const line of c.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      if (!process.env[k]) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  } catch {}
}

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const textFile = arg('--text');
const focus = arg('--focus') || undefined;
if (!textFile) {
  console.error('Usage: node scripts/generate-field-primer.mjs --text <proposal.txt> [--focus "..."]');
  process.exit(2);
}

const proposalText = readFileSync(resolve(process.cwd(), textFile), 'utf8');

const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
enterDynamicsBypassForScript('generate-field-primer');
const { generateFieldPrimer, renderPrimerMarkdown } = await import('../lib/services/field-primer-service.js');

const t0 = Date.now();
const { primer, runId, model } = await generateFieldPrimer({ proposalText, focus, runSource: 'Vercel Test' });
const md = renderPrimerMarkdown(primer, {});

mkdirSync('tmp', { recursive: true });
const outPath = `tmp/field-primer-${runId || 'out'}.md`;
writeFileSync(outPath, md);

console.log(`✓ primer generated in ${((Date.now() - t0) / 1000).toFixed(1)}s (model=${model}, run=${runId})`);
console.log(`  → ${outPath}\n`);
console.log(md);
