/**
 * Verify the Anthropic Files API works with our API key + beta header, and
 * print a PA-ready recipe so Connor can replicate the calls in PowerAutomate.
 *
 * Three steps, one per HTTP action:
 *   1. Upload PDF       → POST /v1/files            (multipart/form-data)
 *   2. Reference file   → POST /v1/messages         (file_id in document block)
 *   3. Delete           → DELETE /v1/files/{id}
 *
 * Each step logs the exact URL, headers, and body shape. If all three return
 * 2xx, the PA flow will work — PA's HTTP action supports custom headers and
 * multipart/form-data. Any 4xx points at the real problem.
 *
 * Usage:
 *   node scripts/test-files-api.js --pdf /path/to/local.pdf
 *   node scripts/test-files-api.js   # fetches SUNY PDF from SharePoint as fallback
 */

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  const t = line.trim(); if (!t || t.startsWith('#')) return;
  const [k, ...v] = t.split('='); if (!k || v.length === 0) return;
  let val = v.join('=');
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
  process.env[k] = val;
});

const BETA_HEADER = 'files-api-2025-04-14';
const MODEL = 'claude-sonnet-4-6';

const args = process.argv.slice(2);
const pdfArgIdx = args.indexOf('--pdf');
const localPdfPath = pdfArgIdx >= 0 ? args[pdfArgIdx + 1] : null;
const keepFile = args.includes('--keep'); // skip delete for manual inspection

(async () => {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) { console.error('CLAUDE_API_KEY not set'); process.exit(1); }

  // ── Load a PDF ──────────────────────────────────────────────────────────
  let pdfBuf;
  let pdfLabel;
  if (localPdfPath) {
    if (!fs.existsSync(localPdfPath)) {
      console.error(`PDF not found: ${localPdfPath}`); process.exit(1);
    }
    pdfBuf = fs.readFileSync(localPdfPath);
    pdfLabel = path.basename(localPdfPath);
  } else {
    console.log('No --pdf provided; fetching SUNY Stony Brook Phase I from SharePoint...');
    const { DynamicsService } = await import('../lib/services/dynamics-service.js');
    const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
    const { GraphService } = await import('../lib/services/graph-service.js');
    const { getRequestSharePointBuckets } = await import('../lib/utils/sharepoint-buckets.js');
    enterDynamicsBypassForScript('test-files-api');

    const lookup = await DynamicsService.queryRecords('akoya_requests', {
      select: 'akoya_requestid',
      filter: `akoya_requestnum eq '1001507'`,
      top: 1,
    });
    if (!lookup.records.length) { console.error('request 1001507 not found'); process.exit(1); }
    const buckets = await getRequestSharePointBuckets(lookup.records[0].akoya_requestid, '1001507');
    let picked = null;
    for (const b of buckets) {
      const files = await GraphService.listFiles(b.library, b.folder, { recursive: true, totalTimeoutMs: 15000 });
      const match = files.find(f => /phase.?i/i.test(f.name) && f.name.toLowerCase().endsWith('.pdf') && !/concept/i.test(f.name));
      if (match) { picked = { bucket: b, file: match }; break; }
    }
    if (!picked) { console.error('no Phase I PDF found in SharePoint'); process.exit(1); }
    const dl = await GraphService.downloadFileByPath(picked.bucket.library, picked.file.folder || picked.bucket.folder, picked.file.name);
    pdfBuf = dl.buffer;
    pdfLabel = dl.filename || picked.file.name;
  }
  console.log(`PDF: ${pdfLabel} (${(pdfBuf.length / 1024 / 1024).toFixed(2)} MB)\n`);

  // ── Step 1: upload ──────────────────────────────────────────────────────
  console.log('━━━ STEP 1: Upload to Files API ━━━');
  console.log(`POST https://api.anthropic.com/v1/files`);
  console.log(`Headers:`);
  console.log(`  x-api-key: <secret>`);
  console.log(`  anthropic-version: 2023-06-01`);
  console.log(`  anthropic-beta: ${BETA_HEADER}`);
  console.log(`Body: multipart/form-data, field name "file"`);
  console.log('');

  const form = new FormData();
  form.append('file', new Blob([pdfBuf], { type: 'application/pdf' }), pdfLabel);
  const uploadStart = Date.now();
  const uploadResp = await fetch('https://api.anthropic.com/v1/files', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey.trim(),
      'anthropic-version': '2023-06-01',
      'anthropic-beta': BETA_HEADER,
    },
    body: form,
  });
  const uploadMs = Date.now() - uploadStart;
  if (!uploadResp.ok) {
    console.error(`  ✗ HTTP ${uploadResp.status}: ${(await uploadResp.text()).slice(0, 500)}`);
    console.error('\n  Most likely causes:');
    console.error('    - API key lacks Files API access (uncommon — usually auto-granted)');
    console.error('    - Beta header name changed (check Anthropic docs for current value)');
    process.exit(1);
  }
  const uploadData = await uploadResp.json();
  console.log(`  ✓ HTTP ${uploadResp.status} (${uploadMs}ms)`);
  console.log(`  file_id:     ${uploadData.id}`);
  console.log(`  filename:    ${uploadData.filename}`);
  console.log(`  size_bytes:  ${uploadData.size_bytes}`);
  console.log(`  type:        ${uploadData.type}`);
  console.log(`  created_at:  ${uploadData.created_at}\n`);

  const fileId = uploadData.id;

  // ── Step 2: use file_id in /v1/messages ─────────────────────────────────
  console.log('━━━ STEP 2: Call /v1/messages with file_id reference ━━━');
  console.log(`POST https://api.anthropic.com/v1/messages`);
  console.log(`Headers:`);
  console.log(`  x-api-key: <secret>`);
  console.log(`  anthropic-version: 2023-06-01`);
  console.log(`  anthropic-beta: ${BETA_HEADER}`);
  console.log(`  Content-Type: application/json`);
  console.log(`Body:`);
  console.log(JSON.stringify({
    model: MODEL,
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'file', file_id: fileId } },
        { type: 'text', text: 'In one short sentence, what is this document about?' },
      ],
    }],
  }, null, 2).split('\n').map(l => '  ' + l).join('\n'));
  console.log('');

  const msgStart = Date.now();
  const msgResp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey.trim(),
      'anthropic-version': '2023-06-01',
      'anthropic-beta': BETA_HEADER,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'file', file_id: fileId } },
          { type: 'text', text: 'In one short sentence, what is this document about?' },
        ],
      }],
    }),
  });
  const msgMs = Date.now() - msgStart;
  if (!msgResp.ok) {
    console.error(`  ✗ HTTP ${msgResp.status}: ${(await msgResp.text()).slice(0, 500)}`);
    process.exit(1);
  }
  const msgData = await msgResp.json();
  const responseText = msgData.content?.[0]?.text || '';
  const u = msgData.usage || {};
  console.log(`  ✓ HTTP ${msgResp.status} (${msgMs}ms)`);
  console.log(`  Model:          ${msgData.model}`);
  console.log(`  input_tokens:   ${u.input_tokens}`);
  console.log(`  output_tokens:  ${u.output_tokens}`);
  console.log(`  Response:       "${responseText.slice(0, 200)}"\n`);

  // ── Step 3: delete (optional) ───────────────────────────────────────────
  if (keepFile) {
    console.log(`━━━ STEP 3: Skipped (--keep flag set, file_id=${fileId}) ━━━\n`);
  } else {
    console.log('━━━ STEP 3: Delete the file ━━━');
    console.log(`DELETE https://api.anthropic.com/v1/files/${fileId}`);
    console.log(`Headers:`);
    console.log(`  x-api-key: <secret>`);
    console.log(`  anthropic-version: 2023-06-01`);
    console.log(`  anthropic-beta: ${BETA_HEADER}`);
    console.log('');
    const delResp = await fetch(`https://api.anthropic.com/v1/files/${fileId}`, {
      method: 'DELETE',
      headers: {
        'x-api-key': apiKey.trim(),
        'anthropic-version': '2023-06-01',
        'anthropic-beta': BETA_HEADER,
      },
    });
    if (!delResp.ok) {
      console.error(`  ✗ HTTP ${delResp.status}: ${(await delResp.text()).slice(0, 500)}`);
      process.exit(1);
    }
    console.log(`  ✓ HTTP ${delResp.status}\n`);
  }

  // ── PA-ready recipe ─────────────────────────────────────────────────────
  console.log('═══ Summary ═══');
  console.log('All three HTTP actions returned 2xx. The Files API works with our API key.');
  console.log('');
  console.log('PA replication checklist:');
  console.log('  1. Three HTTP actions in sequence: Upload → Message → (Delete or keep).');
  console.log('  2. All three require the custom header  anthropic-beta: ' + BETA_HEADER);
  console.log('  3. Upload is multipart/form-data with form field name "file".');
  console.log('     PA "HTTP" action: body type = Form-data, key=file, value=<bytes from prior step>.');
  console.log('  4. Message body references the upload response\'s  id  as  file_id  in a');
  console.log('     document content block (no base64 — Anthropic serves bytes from its own store).');
  console.log('  5. Delete is a plain DELETE to /v1/files/{id}.');
  console.log('');
  console.log('If PA throws on the beta header, it is blocking custom headers on HTTP action,');
  console.log('not the Files API itself — that is a tenant / connector config issue, escalatable');
  console.log('without Anthropic involvement.');
})().catch(e => { console.error('FATAL:', e.message); console.error(e.stack); process.exit(1); });
