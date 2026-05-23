/**
 * Cron: /api/cron/log-analysis
 *
 * Runs every 6 hours. Fetches recent error logs from the Vercel REST API
 * and, if the error count exceeds a threshold, sends them to Claude Haiku
 * for root-cause analysis.
 *
 * Requires optional env vars:
 *   VERCEL_API_TOKEN   — Vercel personal access token
 *   VERCEL_PROJECT_ID  — Target project ID
 *
 * If either is missing, the cron returns 200 with { skipped: true }.
 * Cost: ~$0.01/analysis using Haiku; under $1/month.
 *
 * Auth: Vercel CRON_SECRET (dev mode bypasses)
 */

import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import NotificationService from '../../../lib/services/notification-service';
import { redactLogText, redactErrorList } from '../../../lib/utils/log-redactor';
import { LLMClient } from '../../../lib/services/llm-client';
import MaintenanceService from '../../../lib/services/maintenance-service';
import {
  DATA_CLASSES,
  wrapUntrustedContent,
  buildUntrustedContentPreamble,
} from '../../../lib/utils/ai-payload-boundary';

const ERROR_THRESHOLD = 10; // minimum errors to trigger AI analysis
const LOOKBACK_MS = 6 * 60 * 60 * 1000; // 6 hours

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!verifyCronSecret(req, res)) return;

  const token = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;

  if (!token || !projectId) {
    const runId = await MaintenanceService.startRun('log-analysis');
    await MaintenanceService.completeRun(runId, {
      status: 'completed',
      details: { skipped: true, reason: 'VERCEL_API_TOKEN or VERCEL_PROJECT_ID not configured' },
    });
    return res.json({ ok: true, skipped: true, reason: 'VERCEL_API_TOKEN or VERCEL_PROJECT_ID not configured' });
  }

  const runId = await MaintenanceService.startRun('log-analysis');

  try {
    // Fetch recent error logs from Vercel
    const since = Date.now() - LOOKBACK_MS;
    const logsUrl = `https://api.vercel.com/v2/projects/${projectId}/events?limit=100&types=error&since=${since}`;

    const logsResponse = await fetch(logsUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!logsResponse.ok) {
      const errText = await logsResponse.text();
      console.error(`Vercel API error: ${logsResponse.status} ${errText}`);
      return res.status(502).json({ error: 'Failed to fetch Vercel logs', status: logsResponse.status });
    }

    const logsData = await logsResponse.json();
    const events = logsData.events || [];

    // Extract error messages and redact credentials/PII before any value
    // leaves the system (Claude prompt, alert metadata).
    const errors = redactErrorList(
      events
        .filter(e => e.type === 'error' || e.type === 'stderr')
        .map(e => ({
          timestamp: e.created,
          message: e.text || e.payload?.text || JSON.stringify(e.payload || {}),
          path: e.payload?.path || e.proxy?.path || 'unknown',
        }))
    );

    if (errors.length < ERROR_THRESHOLD) {
      await MaintenanceService.completeRun(runId, {
        status: 'completed',
        recordsProcessed: errors.length,
        details: {
          errorCount: errors.length,
          threshold: ERROR_THRESHOLD,
          analysisTriggered: false,
        },
      });
      return res.json({
        ok: true,
        errorCount: errors.length,
        threshold: ERROR_THRESHOLD,
        analysis: null,
        message: `${errors.length} errors in last 6h (below threshold of ${ERROR_THRESHOLD})`,
      });
    }

    // Summarize errors for AI analysis (redaction already applied above)
    const errorSummary = errors
      .slice(0, 50) // limit to 50 for token efficiency
      .map(e => `[${new Date(e.timestamp).toISOString()}] ${e.path}: ${e.message}`)
      .join('\n');

    // Send to Claude Haiku for root-cause analysis
    let analysis = 'AI analysis unavailable';
    try {
      const claude = new LLMClient({
        apiKey: process.env.CLAUDE_API_KEY,
        model: 'claude-haiku-4-5-20251001',
        appName: 'cron-log-analysis',
      });
      // Log text can echo attacker-influenced request data (A7 Part 6) —
      // wrap it in nonce-bearing sentinels and harden the system prompt.
      const wrappedErrors = wrapUntrustedContent({
        text: errorSummary,
        source: 'cron-log-analysis.errorSummary',
        dataClass: DATA_CLASSES.EXTERNAL_API_TEXT,
        maxChars: 60_000,
        label: 'error log entries',
      });
      const { text } = await claude.complete({
        system: buildUntrustedContentPreamble([wrappedErrors.nonce]),
        messages: [{
          role: 'user',
          content: `You are a server ops assistant. Analyze these ${errors.length} error log entries from a Next.js application on Vercel. Identify patterns, probable root causes, and suggest fixes. Be concise.\n\n${wrappedErrors.text}`,
        }],
        maxTokens: 1024,
      });
      // Redact again on the way out — Claude responses occasionally echo
      // input substrings, and the analysis is stored in alerts that may be
      // read by less-privileged dashboards.
      analysis = redactLogText(text || 'No analysis returned');
    } catch (err) {
      console.warn('[cron/log-analysis] Claude analysis failed:', err.message);
    }

    // Create alert with analysis
    await NotificationService.notify({
      type: 'log_analysis',
      severity: errors.length >= 50 ? 'error' : 'warning',
      title: `${errors.length} server errors in last 6 hours`,
      message: analysis,
      metadata: {
        errorCount: errors.length,
        topPaths: getTopPaths(errors),
        sampleErrors: errors.slice(0, 5),
      },
      source: 'cron/log-analysis',
      category: 'ops',
    });

    await MaintenanceService.completeRun(runId, {
      status: 'completed',
      recordsProcessed: errors.length,
      details: {
        errorCount: errors.length,
        analysisTriggered: true,
      },
    });

    return res.json({
      ok: true,
      errorCount: errors.length,
      analysis,
    });
  } catch (error) {
    console.error('Log analysis cron error:', error);
    await MaintenanceService.completeRun(runId, {
      status: 'failed',
      errorMessage: error.message,
    });
    return res.status(500).json({ error: 'Log analysis failed', message: error.message });
  }
}

/**
 * Group errors by path and return top 5 most frequent
 */
function getTopPaths(errors) {
  const pathCounts = {};
  for (const e of errors) {
    pathCounts[e.path] = (pathCounts[e.path] || 0) + 1;
  }
  return Object.entries(pathCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([path, count]) => ({ path, count }));
}
