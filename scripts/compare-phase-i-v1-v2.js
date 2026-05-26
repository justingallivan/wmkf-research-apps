/**
 * Phase I v1 vs v2 Comparison Harness
 *
 * Runs both prompt variants against the same proposal PDF for each request
 * in the test set. Does NOT write back to Dynamics — calls Claude directly
 * using the same prompt-construction logic the API routes use.
 *
 * v1: shared/config/prompts/phase-i-summaries.js (single user message, no cache)
 * v2: PromptResolver → Dynamics (system+user split, cache_control)
 *
 * Usage:
 *   node scripts/compare-phase-i-v1-v2.js
 *
 * Output:
 *   tmp/phase-i-comparison/<requestNum>.md  — per-request v1 + v2 side-by-side
 *   tmp/phase-i-comparison/_index.md        — summary + stats
 */

const fs = require('fs');
const path = require('path');

// Load .env.local
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const [k, ...v] = t.split('=');
    if (!k || v.length === 0) return;
    let val = v.join('=');
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[k] = val;
  });
}

// May 2025 Phase I cohort, stratified across institution types and file sizes.
// All confirmed to have "Research Phase I Application*.pdf" via find-2025-phase-i.js.
const TEST_REQUESTS = [
  '1001473', // UT Austin — 1.9 MB
  '1001485', // Sanford Burnham Prebys — 1.1 MB
  '1001507', // SUNY Stony Brook — 14.3 MB (stress text extraction)
  '1001539', // Stanford — 845 KB
  '1001563', // Johns Hopkins — 934 KB
  '1001581', // Mayo Clinic — 915 KB
  '1001595', // Harvard — 772 KB
  '1001638', // St. Jude — 2.9 MB
];

const OUT_DIR = path.join(__dirname, '..', 'tmp', 'phase-i-comparison');
fs.mkdirSync(OUT_DIR, { recursive: true });

const SUMMARY_LENGTH = 1;
const SUMMARY_LEVEL = 'technical-non-expert';

const AUDIENCE_DESCRIPTIONS = {
  'general-audience': 'a general audience, avoiding technical jargon and explaining concepts in accessible terms',
  'technical-non-expert': 'a technical non-expert audience, using some technical terms but explaining complex concepts clearly',
  'technical-expert': 'a technical expert audience, using field-specific terminology and assuming domain knowledge',
};

(async () => {
  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
  const { GraphService } = await import('../lib/services/graph-service.js');
  const { getRequestSharePointBuckets } = await import('../lib/utils/sharepoint-buckets.js');
  const { loadFile } = await import('../lib/utils/file-loader.js');
  const { PromptResolver } = await import('../lib/services/prompt-resolver.js');
  const { createPhaseISummarizationPrompt } = await import('../shared/config/prompts/phase-i-summaries.js');
  const { KECK_GUIDELINES } = await import('../shared/config/keck-guidelines.js');
  const { BASE_CONFIG, getModelForApp, loadModelOverrides } = await import('../shared/config/baseConfig.js');

  await loadModelOverrides();
  enterDynamicsBypassForScript('compare-phase-i');

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) { console.error('CLAUDE_API_KEY not set'); process.exit(1); }

  const audienceDescription = AUDIENCE_DESCRIPTIONS[SUMMARY_LEVEL];
  const summaryLengthSuffix = SUMMARY_LENGTH > 1 ? 's' : '';
  const model = getModelForApp('batch-phase-i');
  console.log(`Model: ${model}`);
  console.log(`Output: ${OUT_DIR}\n`);

  const indexRows = [];

  for (const requestNum of TEST_REQUESTS) {
    console.log(`\n=== ${requestNum} ===`);
    const row = { requestNum };
    try {
      // ── Resolve request + find a PDF ──────────────────────────────────────
      const lookup = await DynamicsService.queryRecords('akoya_requests', {
        select: 'akoya_requestnum,akoya_requestid,akoya_title,_akoya_applicantid_value',
        filter: `akoya_requestnum eq '${requestNum}'`,
        top: 1,
      });
      if (lookup.records.length === 0) {
        console.log('  request not found'); row.error = 'request-not-found'; indexRows.push(row); continue;
      }
      const req = lookup.records[0];
      row.applicant = req._akoya_applicantid_value_formatted || '';
      row.title = (req.akoya_title || '').slice(0, 100);
      console.log(`  ${row.applicant}: ${row.title}`);

      const buckets = await getRequestSharePointBuckets(req.akoya_requestid, requestNum);
      let pickedFile = null;
      let pickedBucket = null;
      for (const b of buckets) {
        try {
          const files = await GraphService.listFiles(b.library, b.folder, { recursive: true, totalTimeoutMs: 15000 });
          if (!files.length) continue;
          // Phase I ONLY — "concepts" is a different (pre-Phase-I) grant stage
          // and must not be compared using the Phase I prompt.
          const pdfs = files.filter(f => {
            const n = (f.name || '').toLowerCase();
            if (!n.endsWith('.pdf')) return false;
            if (/concept/i.test(f.name)) return false; // hard exclude
            return true;
          });
          const preferredMatches = pdfs.filter(f => /proposal|narrative|phase.?i|research.phase/i.test(f.name));
          preferredMatches.sort((a, b) => (b.size || 0) - (a.size || 0));
          const chosen = preferredMatches[0] || pdfs[0];
          if (chosen) { pickedFile = chosen; pickedBucket = b; break; }
        } catch {}
      }
      if (!pickedFile) { console.log('  no PDF found'); row.error = 'no-pdf'; indexRows.push(row); continue; }

      row.library = pickedBucket.library;
      row.filename = pickedFile.name;
      console.log(`  PDF: ${pickedBucket.library}/${pickedFile.name} (${pickedFile.size || '?'} bytes)`);

      // ── Load + extract text ──────────────────────────────────────────────
      const fileLoad = await loadFile({
        source: 'sharepoint',
        library: pickedBucket.library,
        folder: pickedFile.folder || pickedBucket.folder,
        filename: pickedFile.name,
      });
      console.log(`  text: ${fileLoad.text.length} chars`);
      row.textChars = fileLoad.text.length;

      // ── v1 call ───────────────────────────────────────────────────────────
      const v1Prompt = createPhaseISummarizationPrompt(fileLoad.text, SUMMARY_LENGTH, SUMMARY_LEVEL, KECK_GUIDELINES);
      const v1 = await callClaude(apiKey, {
        model,
        max_tokens: BASE_CONFIG.MODEL_PARAMS.DEFAULT_MAX_TOKENS,
        temperature: BASE_CONFIG.MODEL_PARAMS.SUMMARIZATION_TEMPERATURE,
        messages: [{ role: 'user', content: v1Prompt }],
      });
      console.log(`  v1: ${v1.text.length} chars, in=${v1.usage.input_tokens} out=${v1.usage.output_tokens} (${v1.latencyMs}ms)`);
      row.v1 = { chars: v1.text.length, input: v1.usage.input_tokens, output: v1.usage.output_tokens, ms: v1.latencyMs };

      // ── v2 call ───────────────────────────────────────────────────────────
      const prompt = await PromptResolver.getPrompt('phase-i-dynamics-v2');
      const systemResolved = PromptResolver.interpolate(prompt.systemPrompt, {
        summary_length: SUMMARY_LENGTH,
        summary_length_suffix: summaryLengthSuffix,
        audience_description: audienceDescription,
      });
      const userResolved = PromptResolver.interpolate(prompt.userPromptTemplate, {
        proposal_text: fileLoad.text.substring(0, 100000),
      });
      const v2 = await callClaude(apiKey, {
        model,
        max_tokens: BASE_CONFIG.MODEL_PARAMS.DEFAULT_MAX_TOKENS,
        temperature: BASE_CONFIG.MODEL_PARAMS.SUMMARIZATION_TEMPERATURE,
        system: [{ type: 'text', text: systemResolved, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userResolved }],
      });
      console.log(`  v2: ${v2.text.length} chars, in=${v2.usage.input_tokens} out=${v2.usage.output_tokens} cache_create=${v2.usage.cache_creation_input_tokens || 0} cache_read=${v2.usage.cache_read_input_tokens || 0} (${v2.latencyMs}ms) [prompt source: ${prompt.source}]`);
      row.v2 = {
        chars: v2.text.length,
        input: v2.usage.input_tokens,
        output: v2.usage.output_tokens,
        cacheCreate: v2.usage.cache_creation_input_tokens || 0,
        cacheRead: v2.usage.cache_read_input_tokens || 0,
        ms: v2.latencyMs,
        promptSource: prompt.source,
      };

      // ── Write comparison file ────────────────────────────────────────────
      const md = [
        `# Phase I Summary Comparison — ${requestNum}`,
        ``,
        `**Applicant:** ${row.applicant}`,
        `**Title:** ${row.title}`,
        `**File:** \`${pickedBucket.library}/${pickedFile.name}\` (${fileLoad.text.length} chars extracted)`,
        `**Model:** ${model}`,
        `**Settings:** summaryLength=${SUMMARY_LENGTH}, summaryLevel=${SUMMARY_LEVEL}`,
        `**Prompt source (v2):** ${prompt.source}${prompt.recordGuid ? ` (\`${prompt.recordGuid}\`)` : ''}`,
        ``,
        `## Stats`,
        ``,
        `| | v1 | v2 |`,
        `|---|---|---|`,
        `| Output chars | ${v1.text.length} | ${v2.text.length} |`,
        `| Input tokens | ${v1.usage.input_tokens} | ${v2.usage.input_tokens} |`,
        `| Output tokens | ${v1.usage.output_tokens} | ${v2.usage.output_tokens} |`,
        `| Cache create | 0 | ${v2.usage.cache_creation_input_tokens || 0} |`,
        `| Cache read | 0 | ${v2.usage.cache_read_input_tokens || 0} |`,
        `| Latency (ms) | ${v1.latencyMs} | ${v2.latencyMs} |`,
        ``,
        `---`,
        ``,
        `## v1 (single-message, no cache)`,
        ``,
        v1.text,
        ``,
        `---`,
        ``,
        `## v2 (system+user split, Dynamics prompt, cached)`,
        ``,
        v2.text,
        ``,
      ].join('\n');
      fs.writeFileSync(path.join(OUT_DIR, `${requestNum}.md`), md);
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
      row.error = err.message;
    }
    indexRows.push(row);
  }

  // ── Index ──────────────────────────────────────────────────────────────────
  const index = [
    `# Phase I v1 vs v2 Comparison — Index`,
    ``,
    `Run date: ${new Date().toISOString()}`,
    ``,
    `| Request | Library | Applicant | v1 chars | v2 chars | v1 out-tok | v2 out-tok | v2 cache_read | File | Status |`,
    `|---------|---------|-----------|---------:|---------:|-----------:|-----------:|--------------:|------|--------|`,
    ...indexRows.map(r => `| [${r.requestNum}](./${r.requestNum}.md) | ${r.library || ''} | ${(r.applicant || '').slice(0, 30)} | ${r.v1?.chars || ''} | ${r.v2?.chars || ''} | ${r.v1?.output || ''} | ${r.v2?.output || ''} | ${r.v2?.cacheRead || ''} | ${(r.filename || '').slice(0, 40)} | ${r.error || 'ok'} |`),
    ``,
    `## Cache behavior`,
    ``,
    `v2 uses \`cache_control: ephemeral\` on the system prompt. The first call seeds the cache (cache_create > 0); subsequent calls within 5 min on the same system prompt should hit cache (cache_read > 0). Re-running this script immediately will show cache hits across the board.`,
    ``,
  ].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, '_index.md'), index);

  console.log(`\n\nDone. See ${OUT_DIR}/_index.md`);
})().catch(e => { console.error('FATAL:', e.message); console.error(e.stack); process.exit(1); });

async function callClaude(apiKey, body) {
  const start = Date.now();
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey.trim(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - start;
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Claude ${resp.status}: ${txt.slice(0, 500)}`);
  }
  const data = await resp.json();
  return { text: data.content?.[0]?.text || '', usage: data.usage || {}, model: data.model, latencyMs };
}
