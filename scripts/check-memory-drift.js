#!/usr/bin/env node
/**
 * CI gate for memory/Atlas reconciliation drift.
 *
 * This checker is deliberately read-only. Live probes and report regeneration
 * belong to the explicit `npm run refresh:memory-drift` command.
 *
 * `--no-write` remains accepted as a compatibility no-op for older callers.
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const reportPath = path.join(repoRoot, 'docs', 'RECONCILIATION_REPORT.json');
const maxAgeMs = 24 * 60 * 60 * 1000;

function reportIsFresh(targetPath = reportPath, now = Date.now()) {
  if (!fs.existsSync(targetPath)) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    const generated = Date.parse(parsed.generated);
    const probeErrors = parsed.summary?.probe_errors;
    const probesCompleted = parsed.probe_notes?.dataverse === 'completed'
      && parsed.probe_notes?.postgres === 'completed';
    return Number.isFinite(generated)
      && now - generated < maxAgeMs
      && Number.isFinite(probeErrors)
      && probeErrors === 0
      && probesCompleted;
  } catch {
    return false;
  }
}

function checkMemoryDrift(targetPath = reportPath, { now = Date.now(), logger = console } = {}) {
  const displayPath = path.relative(repoRoot, targetPath) || targetPath;

  if (!fs.existsSync(targetPath)) {
    logger.error(`memory drift check failed: ${displayPath} does not exist; run npm run refresh:memory-drift explicitly to create it`);
    return false;
  }

  if (!reportIsFresh(targetPath, now)) {
    logger.warn('note: evaluating the committed reconciliation report read-only; it is stale or incomplete and was NOT regenerated. Run npm run refresh:memory-drift explicitly when an authorized live refresh is needed.');
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  } catch (e) {
    logger.error(`memory drift check failed: unable to read valid ${displayPath}: ${e.message}`);
    return false;
  }

  const summary = report.summary || {};
  const probeErrors = summary.probe_errors;
  const probesCompleted = report.probe_notes?.dataverse === 'completed'
    && report.probe_notes?.postgres === 'completed';
  if (!Number.isFinite(probeErrors) || !probesCompleted) {
    logger.error('memory drift check failed: committed report is incomplete or non-authoritative; run npm run refresh:memory-drift explicitly after confirming live-probe authorization');
    return false;
  }

  const buckets = report.drift_buckets || {};
  const specWithoutEntity = buckets.spec_without_entity || [];
  if (specWithoutEntity.length > 0) {
    logger.error(`memory drift check failed: ${specWithoutEntity.length} Wave 2 spec(s) probed as probe_404 in Dataverse`);
    for (const item of specWithoutEntity) logger.error(`  - ${item.entity} (${item.spec_file})`);
    return false;
  }

  const largeStaleCounts = (buckets.stale_row_count || []).filter((item) => {
    const claim = Number(item.atlas_claim);
    const live = Number(item.live_count);
    if (!Number.isFinite(claim) || !Number.isFinite(live)) return false;
    if (claim === 0) return live !== 0;
    return Math.abs(live - claim) > Math.abs(claim) * 0.5;
  });
  if (largeStaleCounts.length > 0) {
    logger.error(`memory drift check failed: ${largeStaleCounts.length} Atlas row-count claim(s) differ from live by >50%`);
    for (const item of largeStaleCounts) logger.error(`  - ${item.entity}: atlas=${item.atlas_claim}, live=${item.live_count}`);
    return false;
  }

  // Codex#2 found: original gate ignored doc-label collisions and probe errors.
  // Both surfaced findings should fail the gate, not pass silently.
  const docCollisions = buckets.doc_label_collision || [];
  if (docCollisions.length > 0) {
    logger.error(`memory drift check failed: ${docCollisions.length} doc-label collision(s) — resolve before proceeding`);
    for (const item of docCollisions) {
      logger.error(`  - ${item.label || 'collision'}: ${item.summary || JSON.stringify(item)}`);
    }
    return false;
  }

  if (probeErrors > 0) {
    logger.error(`memory drift check failed: ${probeErrors} probe error(s) — report is non-authoritative until probes succeed`);
    const notes = report.probe_notes || {};
    for (const [src, val] of Object.entries(notes)) {
      if (val && (val.status === 'error' || val.status === 'partial' || val.errors)) {
        logger.error(`  - ${src}: ${typeof val === 'string' ? val : JSON.stringify(val)}`);
      }
    }
    return false;
  }

  const liveDriftFindings = Number.isFinite(Number(summary.live_drift_findings))
    ? Number(summary.live_drift_findings)
    : Object.values(buckets).reduce((total, bucket) => total + (Array.isArray(bucket) ? bucket.length : 0), 0);
  logger.log(`memory drift clean: ${liveDriftFindings} live drift findings; ${specWithoutEntity.length} spec/entity blockers; ${largeStaleCounts.length} large row-count drifts; ${docCollisions.length} doc collisions; ${probeErrors} probe errors.`);
  return true;
}

function main() {
  if (!checkMemoryDrift()) process.exitCode = 1;
}

module.exports = { checkMemoryDrift, reportIsFresh };

if (require.main === module) main();
