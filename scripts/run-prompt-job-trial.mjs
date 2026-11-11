/** Controlled local drain client. No env-file loading, admission, retries, deployment, or live configuration changes. */
const args = process.argv.slice(2);
if (!args.length || (args.length === 1 && args[0] === '--help')) {
  console.log('Usage: node scripts/run-prompt-job-trial.mjs --run --origin http://127.0.0.1:<port>');
  console.log('Requires CRON_SECRET in the process environment and an explicitly approved, configured trial on that local server.');
  console.log('Advances at most eight stages. May consume Anthropic API credits and write audit records. Inspect staff results afterward.');
  process.exit(0);
}
if (args.length !== 3 || args[0] !== '--run' || args[1] !== '--origin') {
  console.error('Expected --run --origin http://127.0.0.1:<port>.'); process.exit(2);
}
let origin;
try {
  origin = new URL(args[2]);
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error();
} catch { console.error('An explicit numeric loopback HTTP origin is required.'); process.exit(2); }
if (!process.env.CRON_SECRET) {console.error('CRON_SECRET is required; no environment files are loaded.');process.exit(2);}
const progress = new Set(['snapshot_saved','validated','failed_pre_dispatch','failed_validation','audit_delivered']);
const stops = new Set(['expired','disabled','idle','unavailable','waiting','complete','needs_attention','unknown','audit_failed','audit_unknown','audit_content_expired','snapshot_unavailable','audit_pending']);
try {
  for (let tick = 1; tick <= 8; tick++) {
    const response = await fetch(new URL('/api/cron/drain-prompt-jobs',origin), {
      method:'POST',redirect:'error',headers:{Authorization:`Bearer ${process.env.CRON_SECRET}`},signal:AbortSignal.timeout(305000),
    });
    if (!response.ok) throw new Error('worker_http_error');
    const value = await response.json();
    if (!value || Object.keys(value).length !== 1 || typeof value.stage !== 'string' || (!progress.has(value.stage) && !stops.has(value.stage))) throw new Error('worker_response_invalid');
    console.log(`Stage ${tick}: ${value.stage}`);
    if (stops.has(value.stage)) {
      console.log('Drain stopped. Inspect the staff job status and saved drafts; idle alone is not a success receipt.');
      process.exit(value.stage==='complete'?0:['idle','disabled'].includes(value.stage)?2:1);
    }
  }
  console.error('Stage limit reached. Inspect the receipt before running again.');process.exitCode=1;
} catch {
  console.error('Drain interrupted. Do not start another job. Check the existing receipt; a dispatched operation may have completed.');process.exitCode=1;
}
