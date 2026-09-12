/** Cycle Dossier durable worker. Cron owns progress, browser polling is read-only.
 * A global run lease admits a pool of three entries; each stage is checkpointed
 * under that lease. No automatic retry repeats an ambiguous metered call.
 */
import * as store from './cycle-dossier-store';
import { dossierPool, loadDossierRoster } from './cycle-dossier-service';
import { generateResearch, generateEntry } from './cycle-dossier-generation';
import { renderDossierDocuments } from './cycle-dossier-documents';
import { dossierDigest, readDossierJSON, storeDossierJSON, storeDossierFile, readDossierFile, assertDossierStorageConfigured } from './cycle-dossier-storage';
import { GraphService } from './graph-service';
import JSZip from 'jszip';
import { createHash } from 'crypto';
import { resolveDossierDestination } from './cycle-dossier-sharepoint';
import { assertDossierWorkerOpen } from './cycle-dossier-rollout';

// SharePoint rewrites Office packages on upload (document property promotion):
// it adds customXml/ items carrying the library content-type schema, edits
// docProps/, the package rels and content types, and appends customXml
// relationships to word/_rels/document.xml.rels (observed on the 2026-09-12
// smoke: rId13–rId15 added). PDFs are stored verbatim. Compare OOXML by its
// decompressed document parts, with relationship parts normalised to an
// order-independent set that ignores customXml links.
const SHAREPOINT_OWNED_PART = /^(docProps\/|customXml\/|_rels\/\.rels$|\[Content_Types\]\.xml$)/;
const CUSTOM_XML_REL = /officeDocument\/2006\/relationships\/customXml/;
function normaliseRelationships(xml) {
  const rels = (xml.match(/<Relationship\b[^>]*\/?>/g) || []).filter(r => !CUSTOM_XML_REL.test(r));
  // Attribute order and self-closing whitespace vary between writers; compare each
  // relationship as its sorted attribute set.
  return rels.map(r => (r.match(/[\w:.-]+="[^"]*"/g) || []).sort().join(' ')).sort().join('\n');
}
async function ooxmlContentParts(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const parts = new Map();
  for (const name of Object.keys(zip.files).filter(n => !zip.files[n].dir && !SHAREPOINT_OWNED_PART.test(n)).sort()) {
    const content = await zip.files[name].async('nodebuffer');
    parts.set(name, name.endsWith('.rels') ? normaliseRelationships(content.toString('utf8')) : dossierDigest(content));
  }
  return parts;
}
async function ooxmlDifferingParts(frozen, observed) {
  const [a, b] = await Promise.all([ooxmlContentParts(frozen), ooxmlContentParts(observed)]);
  return [...new Set([...a.keys(), ...b.keys()])].filter(name => a.get(name) !== b.get(name)).sort();
}
async function assertPublishedMatchesFrozen(format, frozen, observed, name) {
  let differing;
  try {
    differing = format === 'docx'
      ? await ooxmlDifferingParts(frozen, observed)
      : (dossierDigest(observed) === dossierDigest(frozen) ? [] : ['<bytes>']);
  } catch (error) {
    differing = [`<unreadable: ${error?.message || error}>`];
  }
  if (differing.length) {
    console.warn(`[cycle-dossier] published ${name} differs from the frozen entry in: ${differing.join(', ')}`);
    throw store.dossierError('The published file differs from the frozen entry.');
  }
}
const TYPES = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf' };
const interruption = () => Object.assign(store.dossierError('Work is paused.'), { interrupted: true });

async function updateItem(run, requestId, fn) {
  const updated = await store.mutateDossierRun(run.id, (row, client) => {
    const item = row.data.items.find(i => i.requestId === requestId);
    if (!item) throw store.dossierError('Run item not found.');
    return fn(item, row, client);
  }, { leaseToken: run.lease_token });
  return updated.data.items.find(i => i.requestId === requestId);
}

async function checkWork(run, requestId, { paid = false } = {}) {
  await assertDossierWorkerOpen();
  let dispatched = false;
  const item = await updateItem(run, requestId, (i, row) => {
    if (row.status !== 'running') throw interruption();
    if (paid && !i.reserved) {
      const bound = i.estimate?.highUsd;
      if (row.data.budgetUsd != null && (!Number.isFinite(bound)
        || row.data.spentUsd + row.data.reservedUsd + bound > row.data.budgetUsd)) {
        row.status = 'paused'; row.data.pauseReason = Number.isFinite(bound)
          ? 'Spending limit reached. Raise the limit to continue.'
          : 'A reliable cost bound is unavailable. Review configuration before continuing with a limit.';
        row.data.cutCounter += 1; row.data.cutPending = true;
        return;
      }
      i.reserved = true; i.reservationUsd = Number.isFinite(bound) ? bound : 0;
      row.data.reservedUsd += i.reservationUsd;
    }
    if (paid) i.paidInFlight = true;
    dispatched = true;
  });
  // A budget pause must commit before throwing; throwing in the transaction
  // would roll back the pause and let sibling jobs keep dispatching.
  // This transaction is the dispatch linearization point. An already admitted
  // call may finish when a sibling subsequently pauses for budget; otherwise
  // that sibling could starve the affordable call indefinitely.
  if (!dispatched) throw interruption();
  return item;
}
async function checkpointResult(run, item, stage, result) {
  const payload = stage === 'research' ? result.research : result.payload;
  // Reauthorize immediately before private persistence. Retain an in-flight
  // result after Pause; a cancelled/paused run cannot start another paid call.
  await store.assertDossierActor(run.owner_profile_id);
  const ref = await storeDossierJSON(`cycle-dossier/entries/${item.revisionId}/${stage}-${dossierDigest(payload)}.json`, payload);
  return updateItem(run, item.requestId, (i, row) => {
    i[stage === 'research' ? 'researchRef' : 'payloadRef'] = ref;
    i.stage = stage; i.paidInFlight = false;
    if (Number.isFinite(result.costUsd) && result.costUsd >= 0) {
      i.costUsd = (i.costUsd || 0) + result.costUsd;
      row.data.spentUsd += result.costUsd;
      const allocated = Math.min(result.costUsd, i.reservationUsd || 0);
      row.data.reservedUsd = Math.max(0, row.data.reservedUsd - allocated);
      i.reservationUsd = Math.max(0, (i.reservationUsd || 0) - allocated);
    } else i.unknownCost = true;
  });
}

async function publishConstituent(run, item, format) {
  const ref = item.files[format];
  const bytes = await readDossierFile(ref);
  await checkWork(run, item.requestId);
  await assertDossierWorkerOpen();
  const current = await resolveDossierDestination(item.requestId, item.requestNumber);
  if (dossierDigest(current) !== item.destinationHash) throw store.dossierError('The request SharePoint destination changed. Preview again.');
  const folder = `${current.folder}/AI Artifacts/Cycle Dossier/D26/${item.revisionId}`;
  const createdFolder = await GraphService.ensureFolderPath(current.library, folder, { siteId: current.siteId, driveId: current.driveId });
  if (createdFolder.siteId !== current.siteId || createdFolder.driveId !== current.driveId) throw store.dossierError('SharePoint target identity changed.');
  const name = `${item.requestNumber}-Scientific-Briefing-v${item.revision}.${format}`;
  await checkWork(run, item.requestId);
  await assertDossierWorkerOpen();
  let file;
  try {
    file = await GraphService.uploadFile(current.library, folder, name, bytes, TYPES[format], { ...current, conflictBehavior: 'fail' });
  } catch (error) {
    file = await GraphService.getFileMetadataByPath(current.library, folder, name, current);
    if (!file) throw error;
  }
  const observed = await GraphService.downloadFile(file.driveId, file.id);
  await assertPublishedMatchesFrozen(format, bytes, observed.buffer, name);
  // `sha256`/`size` describe the frozen private artifact; `published*` describe
  // the bytes SharePoint actually serves after its own rewrite.
  return { ...file, sha256: ref.sha256, size: bytes.length, publishedSha256: dossierDigest(observed.buffer), publishedSize: observed.buffer.length };
}

async function processEntry(run, original) {
  let item = original;
  try {
    item = await checkWork(run, item.requestId);
    const input = await readDossierJSON(item.inputRef);
    const actor = await store.assertDossierActor(run.owner_profile_id);
    const options = { beforePaidCall: details => details?.stage === 'research-search'
      // Complete the already-started research stage's free retrieval after Pause.
      // No additional LLM call is permitted; all reads retain lease/actor checks.
      ? store.mutateDossierRun(run.id, () => {}, { leaseToken: run.lease_token })
      : checkWork(run, item.requestId, { paid: true }), actingUserSystemId: actor.actingUserSystemId,
    // Leave room after the provider returns for parsing, the audit row, the Blob
    // put, and the fenced checkpoint; a checkpoint past lease expiry costs a retry.
    deadlineMs: new Date(run.locked_until).getTime() - 60000 };
    if (!item.researchRef) {
      item = await checkpointResult(run, item, 'research', await generateResearch(input, run.data.config, options));
      await updateItem(run, item.requestId, i => { i.status = 'queued'; });
      return;
    }
    if (!item.payloadRef) {
      await checkWork(run, item.requestId);
      const research = await readDossierJSON(item.researchRef);
      item = await checkpointResult(run, item, 'entry', await generateEntry(input, research, run.data.config, options));
      await updateItem(run, item.requestId, i => { i.status = 'queued'; });
      return;
    }
    if (!item.files) {
      await checkWork(run, item.requestId);
      const payload = await readDossierJSON(item.payloadRef);
      const rendered = await renderDossierDocuments({ title: `${item.requestNumber} — Scientific Briefing`, entries: [payload] }, { includeIndividual: false });
      const files = {};
      for (const format of ['docx','pdf']) {
        await checkWork(run, item.requestId);
        const bytes = Buffer.from(rendered.combined[format]);
        files[format] = await storeDossierFile(`cycle-dossier/entries/${item.revisionId}/${dossierDigest(bytes)}.${format}`, bytes, TYPES[format]);
      }
      item = await updateItem(run, item.requestId, i => { i.files = files; i.stage = 'rendered'; });
    }
    for (const format of ['docx','pdf']) if (!item.sharepoint?.[format]) {
      const saved = await publishConstituent(run, item, format);
      item = await updateItem(run, item.requestId, i => { i.sharepoint = { ...i.sharepoint, [format]: saved }; i.stage = `${format}-saved`; });
    }
    await updateItem(run, item.requestId, async (i, row, client) => {
      await store.finishDossierEntry(i.revisionId, { request: { requestId: i.requestId, requestNumber: i.requestNumber, title: i.title,
        institution: i.institution, pi: i.pi, programDirector: i.programDirector, programDirectorId: i.programDirectorId },
      payloadRef: i.payloadRef, files: i.files, sharepoint: i.sharepoint, inputHash: i.inputHash }, client);
      i.status = 'ready'; i.stage = 'ready'; i.error = null;
      if (!i.unknownCost) { row.data.reservedUsd = Math.max(0, row.data.reservedUsd - (i.reservationUsd || 0)); i.reservationUsd = 0; }
    });
  } catch (error) {
    if (error.httpStatus === 403) throw error;
    await updateItem(run, item.requestId, i => {
      i.status = error.interrupted ? 'queued' : 'failed';
      i.error = error.interrupted ? null : (i.paidInFlight
        ? 'Generation did not return a saved result. A possible charge remains reserved; retry explicitly.'
        : error.httpStatus ? error.message : 'This entry could not finish. Retry from its saved checkpoint.');
    });
  }
}

async function assembleCut(run) {
  // Re-read the durable operator stop after the run was claimed and before
  // rendering or writing any private artifact.
  await assertDossierWorkerOpen();
  // The persisted cut pins exact revisions and metadata before any rendering.
  const row = await store.mutateDossierRun(run.id, async (current, client) => {
    if (current.data.items.some(i => i.status === 'running')) throw store.dossierError('Entries are still settling.');
    if (current.data.cut) return;
    const entries = []; const missing = []; const fallback = [];
    for (const item of current.data.items) {
      const id = item.status === 'ready' ? (item.reuseId || item.revisionId) : item.fallbackId;
      if (!id) { missing.push({ requestId: item.requestId, requestNumber: item.requestNumber, error: item.error || current.data.pauseReason || 'Not generated.' }); continue; }
      const entry = await store.getDossierEntry(id, client);
      if (!entry?.ready) { missing.push({ requestId: item.requestId, requestNumber: item.requestNumber, error: 'Saved entry unavailable.' }); continue; }
      entries.push({ id, revision: entry.revision, request: { requestId: item.requestId, requestNumber: item.requestNumber, title: item.title,
        institution: item.institution, pi: item.pi, programDirectorId: item.programDirectorId, programDirector: item.programDirector }, payloadRef: entry.data.payloadRef });
      if (item.status !== 'ready') fallback.push({ requestId: item.requestId, requestNumber: item.requestNumber, revision: entry.revision, error: item.error || current.data.pauseReason });
    }
    entries.sort((a,b) => String(a.request.programDirector).localeCompare(String(b.request.programDirector)) || String(a.request.requestNumber).localeCompare(String(b.request.requestNumber), undefined, { numeric: true }));
    const cutKey = String(current.data.cutCounter);
    const data = { entries, missing, fallback, status: missing.length || fallback.length ? 'partial' : 'complete', reason: current.data.pauseReason || null };
    current.data.cut = await store.reserveDossierEdition(current, cutKey, data, client);
  }, { leaseToken: run.lease_token });
  const edition = row.data.cut;
  if (!edition.data.entries.length) {
    await store.mutateDossierRun(run.id, current => {
      if (!['paused','cancelled'].includes(current.status)) current.status = 'failed';
      current.data.error = 'No usable entries were available. Review the failed entries and retry.';
      current.data.cutPending = false;
    }, { leaseToken: run.lease_token });
    return;
  }
  if (edition.ready) {
    await store.mutateDossierRun(run.id, current => {
      current.data.cutPending = false;
      if (!['paused','cancelled'].includes(current.status)) current.status = edition.data.status === 'partial' ? 'partial' : 'completed';
    }, { leaseToken: run.lease_token });
  } else {
    await store.assertDossierActor(row.owner_profile_id);
    const payloads = await dossierPool(edition.data.entries, async e => {
      const payload = await readDossierJSON(e.payloadRef);
      return { ...payload, ...e.request, revision: e.revision };
    });
    const rendered = await renderDossierDocuments({ title: 'D26 Scientific Dossier', partial: edition.data.status === 'partial',
      gaps: [...edition.data.missing, ...edition.data.fallback].map(g => `${g.requestNumber}: ${g.error || 'Earlier revision retained.'}`), entries: payloads }, { includeIndividual: false });
    const files = {};
    for (const format of ['docx','pdf']) {
      await store.mutateDossierRun(run.id, () => {}, { leaseToken: run.lease_token });
      await assertDossierWorkerOpen();
      const bytes = Buffer.from(rendered.combined[format]);
      files[format] = await storeDossierFile(`cycle-dossier/owners/${row.owner_profile_id}/${row.dossier_id}/${edition.id}/${dossierDigest(bytes)}.${format}`, bytes, TYPES[format]);
    }
    await store.mutateDossierRun(run.id, async (current, client) => {
      if (current.data.cut?.id !== edition.id) throw store.dossierError('The edition cut changed.');
      await store.publishDossierEdition(edition, { ...edition.data, files }, client);
      current.data.cut = { ...edition, ready: true, data: { ...edition.data, files } };
      current.data.cutPending = false;
      if (!['paused','cancelled'].includes(current.status)) current.status = edition.data.status === 'partial' ? 'partial' : 'completed';
    }, { leaseToken: run.lease_token });
  }
}

export async function drainCycleDossiers() {
  assertDossierStorageConfigured();
  const run = await store.claimDossierRun();
  if (!run) return { claimed: 0 };
  try {
    await store.assertDossierActor(run.owner_profile_id);
    if (run.status === 'running') {
      const roster = await loadDossierRoster();
      const eligible = new Set(roster.map(r => r.requestId));
      const selected = await store.mutateDossierRun(run.id, current => {
        for (const item of current.data.items) if (item.status === 'queued' && !eligible.has(item.requestId)) {
          item.status = 'failed'; item.error = 'Request is no longer in the D26 Workbench list.';
        }
        let count = 0;
        for (const item of current.data.items) if (item.status === 'queued' && count++ < 3) item.status = 'running';
      }, { leaseToken: run.lease_token });
      await dossierPool(selected.data.items.filter(i => i.status === 'running'), i => processEntry(run, i));
    }
    const current = await store.readDossierRun(run.owner_profile_id, run.id);
    if (current.data.cutPending || !current.data.items.some(i => ['queued','running'].includes(i.status))) {
      try { await assembleCut(run); }
      catch (error) {
        if (error.httpStatus === 403) throw error;
        await store.mutateDossierRun(run.id, r => {
          r.data.assemblyAttempts = (r.data.assemblyAttempts || 0) + 1;
          r.data.error = 'The combined document could not be saved. Completed entries are retained.';
          if (r.data.assemblyAttempts >= 3) {
            if (!['paused','cancelled'].includes(r.status)) r.status = 'failed';
            r.data.cutPending = false;
          }
        }, { leaseToken: run.lease_token });
      }
    }
    return { claimed: 1, runId: run.id };
  } catch (error) {
    if (error.httpStatus === 403) { await store.stopRevokedDossierRun(run.id, run.lease_token); return { claimed: 1, paused: true }; }
    throw error;
  } finally { await store.releaseDossierRun(run.id, run.lease_token); }
}
