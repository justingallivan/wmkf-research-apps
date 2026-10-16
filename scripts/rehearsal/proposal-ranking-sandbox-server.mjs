/**
 * Operator-only loopback harness. Server-owned allowlisted personas, retained D98
 * synthetic rounds only. Not a deployed route or substitute for Microsoft SSO.
 * No app grants, profile writes or production operations; no transcript reader.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export async function startRankingSandboxServer({
  files,
  output
}) {
  const {
    loadEnvLocal
  } = require('../../lib/dataverse/client.js');
  loadEnvLocal();
  const target = 'https://orgd9e66399.crm.dynamics.com';
  process.env.DYNAMICS_URL = target;
  const {
    classifyTarget
  } = await import('../../lib/dataverse/core/interlock.js');
  assert.equal(classifyTarget(target), 'sandbox');
  assert.equal(process.env.DATAVERSE_TARGET_INTERLOCK, 'on');
  const {
    withDalContext
  } = await import('../../lib/dataverse/core/context.js');
  const adapter = await import('../../lib/dataverse/adapters/proposal-ranking.js');
  const workflow = await import('../../lib/services/proposal-ranking/workflow-service.js');
  const receiptPath = '/private/tmp/proposal-ranking-v2-sandbox-receipt.json';
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  assert.equal(receipt.target, target);
  assert.equal(receipt.cycle, 'D98');
  assert.equal(receipt.stage, 'passed');
  const roundIds = new Set(receipt.roundIds);
  const origin = 'http://127.0.0.1:3136';
  const json = (res, status, data) => {
    res.writeHead(status, {
      'Content-Type': 'application/json'
    }).end(JSON.stringify(data));
  };
  async function authorize(roundId) {
    assert.ok(roundIds.has(roundId), 'Round is outside this retained rehearsal');
    const row = await adapter.readRound(roundId);
    const snapshot = JSON.parse(row.wmkf_snapshotjson);
    assert.equal(snapshot.cycleCode, 'D98');
    assert.equal(snapshot.rehearsal?.synthetic, true);
    assert.deepEqual(snapshot.roster, receipt.roster);
  }
  http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.headers.host !== '127.0.0.1:3136' || !['none', 'same-origin', undefined].includes(req.headers['sec-fetch-site'])) return res.writeHead(403).end();
    const url = new URL(req.url, origin);
    if (req.method === 'GET' && url.pathname === '/') return res.writeHead(302, {
      Location: '/p/0'
    }).end();
    const match = url.pathname.match(/^\/p\/([0-3])(?:\/(state|action))?$/);
    if (req.method === 'GET' && (files[url.pathname] || match && !match[2])) {
      const file = match ? 'index.html' : files[url.pathname];
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
      fs.createReadStream(path.join(output, file)).pipe(res);
      return;
    }
    if (!match) return res.writeHead(404).end();
    const actor = receipt.roster[Number(match[1])].systemUserId;
    try {
      await withDalContext('ranking-sandbox-browser-persona', async () => {
        if (match[2] === 'state' && req.method === 'GET') {
          const coordinator = await adapter.findCycleCoordinator('D98');
          const roundId = url.searchParams.get('roundId') || coordinator.wmkf_activeroundid;
          await authorize(roundId);
          return json(res, 200, await workflow.readWorkflowRound({
            roundId,
            actor
          }));
        }
        if (match[2] !== 'action' || req.method !== 'POST' || req.headers.origin !== origin || req.headers['x-ranking-rehearsal'] !== 'sandbox') return res.writeHead(403).end();
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 65536) throw new Error('Request too large');
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        await authorize(body.roundId);
        let result;
        if (body.action === 'history') result = await workflow.readWorkflowHistory({
          roundId: body.roundId,
          actor,
          before: body.before
        });else if (body.action === 'sentiment') result = {
          status: 'available',
          sentiments: {}
        }; // Fictional proposals have no transcripts. Never reads live sentiment.
        else if (body.action === 'exportWorkbook') result = await workflow.readWorkflowSupplement({
          body,
          actor
        });else {
          if (!workflow.WORKFLOW_ACTIONS.includes(body.action)) return json(res, 400, {
            error: {
              message: 'Unsupported rehearsal action'
            }
          });
          result = await workflow.mutateWorkflow({
            body,
            actor
          });
          if (result.roundId !== body.roundId) {
            roundIds.add(result.roundId);
            receipt.roundId = result.roundId;
            receipt.roundIds = [...roundIds];
            fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', {
              mode: 0o600
            });
          }
        }
        json(res, 200, result);
      });
    } catch (error) {
      json(res, error.status || 500, {
        error: {
          code: error.code || 'rehearsal_failed',
          message: error.status ? error.message : 'Sandbox rehearsal request failed; see operator log.'
        }
      });
      console.error(error.code || error.message);
    }
  }).listen(3136, '127.0.0.1', () => console.log('Saved sandbox personas: http://127.0.0.1:3136/p/0 (Beth), /p/1 (Justin), /p/2 (Rob), /p/3 (Jean). No SSO claim.'));
}
