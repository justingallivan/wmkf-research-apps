#!/usr/bin/env node
/**
 * Read-only probe: are repeated downloads of one SharePoint file
 * byte-identical, and how does a second file (for example the Factory's
 * uploaded copy) differ from it?
 *
 * Owner-run. Graph reads only: item metadata and file content. No Dataverse,
 * no writes. Prints sizes, version markers, SHA-256 digests and, for Office
 * (zip) packages, the names of the parts that differ. Never prints file
 * content.
 *
 * Usage:
 *   node --env-file=/absolute/.env.local scripts/probe-sharepoint-download-stability.mjs \
 *     --drive-id=<driveId> --item-id=<sourceItemId> [--compare-item-id=<otherItemId>] [--repeats=3] [--attest]
 *
 * --attest (with --compare-item-id) also runs the Factory's source-baseline
 * package attestation with the compare item as the destination and reports
 * pass or its failure list, plus the custom-property names on each side
 * (names only). Run once by the owner on 2026-10-02 against the same pair: the
 * attestation passed; the copy had gained a `TaxKeyword` custom property.
 *
 * Written 2026-10-02 after production run 20407283 stopped at copy_file: the
 * uploaded copy of an .xlsx had the source's size but not its SHA-256. Run
 * once that day by the owner against that source and its copy: each was
 * byte-stable across three downloads, and they differed only in
 * `docProps/custom.xml`. The differing-repeat branch has not been exercised.
 */

import crypto from 'crypto';
import JSZip from 'jszip';
import { GraphService } from '../lib/services/graph-service.js';
import { attestDocxPackageAgainstSource } from '../lib/services/test-requests/docx-package-attestation.js';

const ID = /^[A-Za-z0-9!_-]{10,120}$/;

function parseArgs(argv) {
  const parsed = { driveId: null, itemId: null, compareItemId: null, repeats: 3, attest: false };
  for (const arg of argv) {
    const [key, value] = arg.split('=');
    if (key === '--drive-id' && ID.test(value || '')) parsed.driveId = value;
    else if (key === '--item-id' && ID.test(value || '')) parsed.itemId = value;
    else if (key === '--compare-item-id' && ID.test(value || '')) parsed.compareItemId = value;
    else if (key === '--repeats' && /^[1-9]$/.test(value || '')) parsed.repeats = Number(value);
    else if (key === '--attest' && value === undefined) parsed.attest = true;
    else throw new Error(`Unrecognized or malformed argument: ${key}`);
  }
  if (!parsed.driveId || !parsed.itemId) throw new Error('--drive-id and --item-id are required.');
  return parsed;
}

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Part name -> { size, sha256 } for a zip package; null when the bytes are not a zip. */
async function packageParts(buffer) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return null;
  }
  const parts = {};
  for (const name of Object.keys(zip.files).sort()) {
    const entry = zip.files[name];
    if (entry.dir) continue;
    const content = await entry.async('nodebuffer');
    parts[name] = { size: content.length, sha256: sha256(content).slice(0, 16), date: entry.date?.toISOString() ?? null };
  }
  return parts;
}

/** Names of the custom properties in docProps/custom.xml (never their values). */
async function customPropertyNames(buffer) {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const part = zip.files['docProps/custom.xml'];
    if (!part) return null;
    const xml = await part.async('string');
    return [...xml.matchAll(/<property\b[^>]*\bname="([^"]{1,128})"/g)].map((match) => match[1]);
  } catch {
    return null;
  }
}

function diffParts(left, right) {
  if (!left || !right) return { comparable: false };
  const names = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const onlyLeft = names.filter((name) => !right[name]);
  const onlyRight = names.filter((name) => !left[name]);
  const changed = names
    .filter((name) => left[name] && right[name] && left[name].sha256 !== right[name].sha256)
    .map((name) => ({ name, left: left[name], right: right[name] }));
  const dateOnly = names.filter((name) => left[name] && right[name]
    && left[name].sha256 === right[name].sha256 && left[name].date !== right[name].date);
  return { comparable: true, partCount: names.length, onlyLeft, onlyRight, changed, sameContentDifferentDate: dateOnly };
}

async function sample(driveId, itemId, repeats) {
  const downloads = [];
  for (let i = 0; i < repeats; i += 1) {
    if (i > 0) await sleep(3000);
    const before = await GraphService.getFileMetadataById(driveId, itemId);
    const downloaded = await GraphService.downloadFile(driveId, itemId);
    const after = await GraphService.getFileMetadataById(driveId, itemId);
    downloads.push({
      buffer: downloaded.buffer,
      report: {
        attempt: i + 1,
        name: before?.name ?? null,
        metadataSize: before?.size ?? null,
        downloadedBytes: downloaded.buffer.length,
        sha256: sha256(downloaded.buffer),
        eTagBefore: before?.eTag ?? null,
        eTagAfter: after?.eTag ?? null,
        cTagBefore: before?.cTag ?? null,
        cTagAfter: after?.cTag ?? null,
        versionId: before?.versionId ?? null,
        lastModified: before?.lastModified ?? null,
      },
    });
  }
  return downloads;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const first = await sample(args.driveId, args.itemId, args.repeats);
  const firstParts = await packageParts(first[0].buffer);
  const output = {
    mode: 'READ_ONLY_DOWNLOAD_STABILITY',
    item: {
      itemId: args.itemId,
      downloads: first.map((entry) => entry.report),
      repeatedDownloadsIdentical: new Set(first.map((entry) => entry.report.sha256)).size === 1,
      isZipPackage: firstParts !== null,
    },
  };
  // When repeated downloads of the same item differ, say where.
  for (let i = 1; i < first.length; i += 1) {
    if (first[i].report.sha256 !== first[0].report.sha256) {
      output.item.firstDifferingRepeat = { attempt: i + 1, ...diffParts(firstParts, await packageParts(first[i].buffer)) };
      break;
    }
  }
  if (args.compareItemId) {
    const second = await sample(args.driveId, args.compareItemId, args.repeats);
    output.compareItem = {
      itemId: args.compareItemId,
      downloads: second.map((entry) => entry.report),
      repeatedDownloadsIdentical: new Set(second.map((entry) => entry.report.sha256)).size === 1,
    };
    output.itemVersusCompareItem = {
      identicalBytes: first[0].report.sha256 === second[0].report.sha256,
      ...diffParts(firstParts, await packageParts(second[0].buffer)),
    };
    if (args.attest) {
      let attestation;
      try {
        const { normalizedParts } = await attestDocxPackageAgainstSource(second[0].buffer, first[0].buffer);
        attestation = { passes: true, normalizedParts };
      } catch (error) {
        attestation = { passes: false, failures: error.failures ?? [error.message] };
      }
      output.sourceBaselineAttestation = {
        ...attestation,
        itemCustomPropertyNames: await customPropertyNames(first[0].buffer),
        compareItemCustomPropertyNames: await customPropertyNames(second[0].buffer),
      };
    }
  }
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(`probe failed: ${error.message}`);
  process.exit(1);
});
