/** @jest-environment node */
import crypto from 'node:crypto';
import { jest } from '@jest/globals';
import {
  classifyUploadError,
  copyBundleFiles,
  planBundleFileCopies,
  verifyCopiedFiles,
} from '../../lib/services/test-requests/bundle-file-copy.js';

const SITE = { key: 'akoyago-shared', hostname: 'appriver3651007194.sharepoint.com', pathname: '/sites/akoyago' };
const TARGET = { ...SITE, registered: true };
const SITE_ID = 'site-1';
const REQUEST_DRIVE = 'drive-request';
const ARCHIVE_DRIVE = 'drive-archive';
const REQUEST_FOLDER = '1000400_AAAAAAAAAAAA4AAA8AAAAAAAAAAAAAAA';

const bytes = (text) => Buffer.from(text);
const hash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const NARRATIVE = bytes('narrative bytes');
const PROPOSAL = bytes('proposal bytes');

function doc(over = {}) {
  return {
    id: 'inv-1',
    kind: 'proposalNarrative',
    library: 'akoya_request',
    folder: '1003222_E43AE6EA/AI Materials',
    name: 'ProposalNarrative_1003222.pdf',
    driveId: 'stale-drive',
    graphItemId: 'item-1',
    sharePointSite: SITE,
    size: NARRATIVE.length,
    mimeType: 'application/pdf',
    eTag: '"etag-1"',
    versionId: '3.0',
    contentHash: hash(NARRATIVE),
    ...over,
  };
}
const proposalDoc = () => doc({
  id: 'inv-2', kind: 'reviewerProposal', folder: '1003222_E43AE6EA/Reviewer Materials',
  name: 'Proposal_1003222.pdf', graphItemId: 'item-2', size: PROPOSAL.length,
  eTag: '"etag-2"', versionId: null, contentHash: hash(PROPOSAL), library: 'wmkf_archive',
});
const bundle = (documents = [doc(), proposalDoc()]) => ({
  source: { request: { akoya_requestnum: '1003222' } },
  documents,
});

function fakeDependencies(overrides = {}) {
  const contents = { 'item-1': NARRATIVE, 'item-2': PROPOSAL };
  const destination = new Map(); // "folder/filename" -> item
  const calls = [];
  const deps = {
    clearGraphCaches: jest.fn(() => calls.push('clear')),
    configuredSharePointTarget: jest.fn(() => TARGET),
    getSiteId: jest.fn(async () => SITE_ID),
    getDriveId: jest.fn(async (library) => (library === 'akoya_request' ? REQUEST_DRIVE : ARCHIVE_DRIVE)),
    getFileMetadataById: jest.fn(async (driveId, itemId) => {
      if (itemId === 'item-1') return { id: 'item-1', name: 'ProposalNarrative_1003222.pdf', size: NARRATIVE.length, mimeType: 'application/pdf', eTag: '"etag-1"', versionId: '3.0' };
      if (itemId === 'item-2') return { id: 'item-2', name: 'Proposal_1003222.pdf', size: PROPOSAL.length, mimeType: 'application/pdf', eTag: '"etag-2"', versionId: '1.0' };
      for (const item of destination.values()) if (item.id === itemId) return item;
      return null;
    }),
    downloadFile: jest.fn(async (driveId, itemId) => {
      if (contents[itemId]) return { buffer: contents[itemId] };
      for (const item of destination.values()) if (item.id === itemId) return { buffer: item.buffer };
      throw new Error('missing');
    }),
    getFileMetadataByPath: jest.fn(async (library, folder, filename) => destination.get(`${folder}/${filename}`) ?? null),
    ensureFolderPath: jest.fn(async (library, folder) => { calls.push(`folder:${folder}`); return { id: `folder:${folder}` }; }),
    uploadFile: jest.fn(async (library, folder, filename, buffer, mimeType, options) => {
      calls.push(`upload:${folder}/${filename}`);
      const item = { id: `new-${filename}`, name: filename, size: buffer.length, mimeType, eTag: '"new"', versionId: '1.0', buffer };
      destination.set(`${folder}/${filename}`, item);
      return { id: item.id, name: filename, size: buffer.length };
    }),
    ...overrides,
  };
  return { deps, destination, calls };
}

const params = (plannedFiles) => ({
  plannedFiles, requestFolder: REQUEST_FOLDER, expectedSiteId: SITE_ID, expectedDestinationDriveId: REQUEST_DRIVE,
});

describe('planBundleFileCopies', () => {
  test('keeps numbered destinations as templates until the request number is known', () => {
    const plan = planBundleFileCopies(bundle());
    expect(plan.map((file) => file.destination)).toEqual([
      { library: 'akoya_request', folder: 'AI Materials', filename: null, filenameTemplate: 'ProposalNarrative_{new-request-number}.pdf' },
      { library: 'akoya_request', folder: 'Reviewer Materials', filename: null, filenameTemplate: 'Proposal_{new-request-number}.pdf' },
    ]);
    expect(plan[0].source.graphItemId).toBe('item-1');
    expect(plan[0].source.sharePointSite).toEqual(SITE);
  });

  test('resolves numbered filenames to the destination request number', () => {
    const plan = planBundleFileCopies(bundle(), { destinationRequestNumber: '1000400' });
    expect(plan.map((file) => file.destination.filename)).toEqual(['ProposalNarrative_1000400.pdf', 'Proposal_1000400.pdf']);
  });

  test('refuses a document whose name does not match its kind', () => {
    expect(() => planBundleFileCopies(bundle([doc({ name: 'Other.pdf' })]))).toThrow(/blocked/);
  });
});

describe('classifyUploadError', () => {
  test.each([
    [{ status: 409 }, 'conflict'],
    [{ status: 400 }, 'rejected'],
    [{ status: 403 }, 'rejected'],
    [{ status: 408 }, 'ambiguous'],
    [{ status: 429 }, 'ambiguous'],
    [{ status: 503 }, 'ambiguous'],
    [{ name: 'AbortError' }, 'ambiguous'],
  ])('%o -> %s', (error, expected) => {
    expect(classifyUploadError(error)).toBe(expected);
  });
});

describe('copyBundleFiles', () => {
  test('copies each file create-only after journaling, re-resolving drives and verifying bytes', async () => {
    const { deps, calls } = fakeDependencies();
    const journal = jest.fn(async (copies) => calls.push(`journal:${copies.map((c) => `${c.status}:${c.outcome ?? '-'}:${c.uploadAttempted ? 'u' : ''}`).join(',')}`));
    const plan = planBundleFileCopies(bundle(), { destinationRequestNumber: '1000400' });
    const copies = await copyBundleFiles(params(plan), deps, journal);

    expect(copies.map((c) => [c.status, c.outcome, c.destination.folder, c.destination.filename])).toEqual([
      ['verified', 'created', `${REQUEST_FOLDER}/AI Materials`, 'ProposalNarrative_1000400.pdf'],
      ['verified', 'created', `${REQUEST_FOLDER}/Reviewer Materials`, 'Proposal_1000400.pdf'],
    ]);
    expect(copies[0].item.id).toBe('new-ProposalNarrative_1000400.pdf');
    expect(copies[1].sourceDriveId).toBe(ARCHIVE_DRIVE);
    expect(copies[1].destinationDriveId).toBe(REQUEST_DRIVE);
    expect(copies[0]).not.toHaveProperty('file');

    // Destination journaled before any Graph write; upload attempt journaled before each PUT.
    const firstUpload = calls.indexOf(`upload:${REQUEST_FOLDER}/AI Materials/ProposalNarrative_1000400.pdf`);
    const firstFolder = calls.indexOf(`folder:${REQUEST_FOLDER}/AI Materials`);
    expect(calls[0]).toMatch(/^journal:planned:-:,planned:-:$/);
    expect(firstFolder).toBeGreaterThan(0);
    expect(calls.slice(0, firstFolder).filter((c) => c.startsWith('journal')).length).toBeGreaterThanOrEqual(3);
    expect(calls[firstUpload - 1]).toMatch(/^journal:planned:-:u,/);
    expect(deps.uploadFile).toHaveBeenCalledTimes(2);
    for (const call of deps.uploadFile.mock.calls) {
      expect(call[5]).toEqual({ conflictBehavior: 'fail', siteId: SITE_ID, driveId: REQUEST_DRIVE });
    }
    expect(deps.clearGraphCaches).toHaveBeenCalledTimes(2);
    expect(deps.getDriveId).toHaveBeenCalledWith('wmkf_archive', { siteId: SITE_ID });
    // Source bytes and destination bytes were both downloaded and hashed.
    expect(deps.downloadFile).toHaveBeenCalledTimes(4);
  });

  test('refuses on source eTag drift without writing', async () => {
    const { deps } = fakeDependencies();
    const base = deps.getFileMetadataById;
    deps.getFileMetadataById = jest.fn(async (driveId, itemId) => ({ ...(await base(driveId, itemId)), eTag: '"changed"' }));
    const plan = planBundleFileCopies(bundle([doc()]), { destinationRequestNumber: '1000400' });
    const journal = jest.fn(async () => {});
    await expect(copyBundleFiles(params(plan), deps, journal)).rejects.toThrow(/changed since export \(eTag\)/);
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.ensureFolderPath).not.toHaveBeenCalled();
    expect(journal.mock.calls.at(-1)[0][0].status).toBe('failed');
  });

  test('refuses on source SHA-256 mismatch without writing', async () => {
    const { deps } = fakeDependencies();
    deps.downloadFile = jest.fn(async () => ({ buffer: bytes('different but same length') }));
    const plan = planBundleFileCopies(bundle([doc({ size: 'different but same length'.length })]), { destinationRequestNumber: '1000400' });
    const base = deps.getFileMetadataById;
    deps.getFileMetadataById = jest.fn(async (d, i) => ({ ...(await base(d, i)), size: 'different but same length'.length }));
    await expect(copyBundleFiles(params(plan), deps, jest.fn(async () => {}))).rejects.toThrow(/SHA-256 does not match/);
    expect(deps.uploadFile).not.toHaveBeenCalled();
  });

  test('refuses when the site or drive is not the preflight identity', async () => {
    const plan = planBundleFileCopies(bundle([doc()]), { destinationRequestNumber: '1000400' });
    const other = fakeDependencies({ getSiteId: jest.fn(async () => 'site-other') });
    await expect(copyBundleFiles(params(plan), other.deps, jest.fn(async () => {}))).rejects.toThrow(/site identity changed/);
    const drive = fakeDependencies({ getDriveId: jest.fn(async () => 'drive-other') });
    await expect(copyBundleFiles(params(plan), drive.deps, jest.fn(async () => {}))).rejects.toThrow(/Destination drive identity changed/);
    const site = fakeDependencies({ configuredSharePointTarget: jest.fn(() => ({ ...TARGET, pathname: '/sites/other' })) });
    await expect(copyBundleFiles(params(plan), site.deps, jest.fn(async () => {}))).rejects.toThrow(/registered akoyaGO site/);
    expect(other.deps.uploadFile).not.toHaveBeenCalled();
    expect(drive.deps.uploadFile).not.toHaveBeenCalled();
    expect(site.deps.uploadFile).not.toHaveBeenCalled();
  });

  test('refuses a preexisting destination before uploading', async () => {
    const { deps, destination } = fakeDependencies();
    destination.set(`${REQUEST_FOLDER}/AI Materials/ProposalNarrative_1000400.pdf`, { id: 'stranger', size: 1, eTag: '"x"' });
    const plan = planBundleFileCopies(bundle([doc()]), { destinationRequestNumber: '1000400' });
    const journal = jest.fn(async () => {});
    await expect(copyBundleFiles(params(plan), deps, journal)).rejects.toThrow(/already exists; refusing/);
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(journal.mock.calls.at(-1)[0][0]).toMatchObject({ status: 'failed', outcome: 'conflict', recoveryItem: { id: 'stranger' } });
  });

  test('a receipt failure right before the PUT blocks the upload', async () => {
    const { deps } = fakeDependencies();
    const plan = planBundleFileCopies(bundle([doc()]), { destinationRequestNumber: '1000400' });
    const journal = jest.fn(async (copies) => {
      if (copies[0].uploadAttempted) throw new Error('disk full');
    });
    await expect(copyBundleFiles(params(plan), deps, journal)).rejects.toThrow(/disk full/);
    expect(deps.uploadFile).not.toHaveBeenCalled();
  });

  test('a 409 conflict refuses and never retries', async () => {
    const { deps } = fakeDependencies();
    deps.uploadFile = jest.fn(async () => { throw Object.assign(new Error('graph failed (409)'), { status: 409 }); });
    const plan = planBundleFileCopies(bundle([doc()]), { destinationRequestNumber: '1000400' });
    const journal = jest.fn(async () => {});
    await expect(copyBundleFiles(params(plan), deps, journal)).rejects.toThrow(/409/);
    expect(deps.uploadFile).toHaveBeenCalledTimes(1);
    expect(journal.mock.calls.at(-1)[0][0]).toMatchObject({ status: 'failed', outcome: 'conflict', uploadErrorStatus: 409 });
  });

  test('an ambiguous upload is recovered only by exact item with matching bytes', async () => {
    const { deps, destination } = fakeDependencies();
    deps.uploadFile = jest.fn(async (library, folder, filename, buffer) => {
      destination.set(`${folder}/${filename}`, { id: 'server-side', name: filename, size: buffer.length, eTag: '"s"', versionId: '1.0', buffer });
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });
    const plan = planBundleFileCopies(bundle([doc()]), { destinationRequestNumber: '1000400' });
    const journal = jest.fn(async () => {});
    const copies = await copyBundleFiles(params(plan), deps, journal);
    expect(copies[0]).toMatchObject({ status: 'verified', outcome: 'recovered', recoveredByExactItem: true, item: { id: 'server-side' } });
    expect(deps.uploadFile).toHaveBeenCalledTimes(1);
  });

  test('an ambiguous upload with a size-mismatched item is not recovered and not retried', async () => {
    const { deps, destination } = fakeDependencies();
    deps.uploadFile = jest.fn(async (library, folder, filename) => {
      destination.set(`${folder}/${filename}`, { id: 'partial', name: filename, size: 3, eTag: '"p"', buffer: bytes('abc') });
      throw Object.assign(new Error('graph failed (503)'), { status: 503 });
    });
    const plan = planBundleFileCopies(bundle([doc()]), { destinationRequestNumber: '1000400' });
    const journal = jest.fn(async () => {});
    await expect(copyBundleFiles(params(plan), deps, journal)).rejects.toThrow(/ambiguous outcome and no matching item/);
    expect(deps.uploadFile).toHaveBeenCalledTimes(1);
    expect(journal.mock.calls.at(-1)[0][0]).toMatchObject({ status: 'failed', outcome: 'ambiguous-unrecovered', recoveryItem: { id: 'partial', size: 3 } });
  });

  test('an ambiguous upload with nothing at the path is not retried', async () => {
    const { deps } = fakeDependencies();
    deps.uploadFile = jest.fn(async () => { throw new Error('socket hang up'); });
    const plan = planBundleFileCopies(bundle([doc()]), { destinationRequestNumber: '1000400' });
    await expect(copyBundleFiles(params(plan), deps, jest.fn(async () => {}))).rejects.toThrow(/do not retry/);
    expect(deps.uploadFile).toHaveBeenCalledTimes(1);
  });

  test('stops at the first failure and leaves later files planned', async () => {
    const { deps } = fakeDependencies();
    deps.uploadFile = jest.fn(async () => { throw Object.assign(new Error('forbidden'), { status: 403 }); });
    const plan = planBundleFileCopies(bundle(), { destinationRequestNumber: '1000400' });
    const journal = jest.fn(async () => {});
    await expect(copyBundleFiles(params(plan), deps, journal)).rejects.toThrow(/rejected \(403\)/);
    const last = journal.mock.calls.at(-1)[0];
    expect(last.map((c) => c.status)).toEqual(['failed', 'planned']);
    expect(deps.uploadFile).toHaveBeenCalledTimes(1);
  });

  test('requires resolved destinations and a well-formed request folder', async () => {
    const { deps } = fakeDependencies();
    const unresolved = planBundleFileCopies(bundle([doc()]));
    await expect(copyBundleFiles(params(unresolved), deps, jest.fn())).rejects.toThrow(/unresolved/);
    const plan = planBundleFileCopies(bundle([doc()]), { destinationRequestNumber: '1000400' });
    await expect(copyBundleFiles({ ...params(plan), requestFolder: '../etc' }, deps, jest.fn())).rejects.toThrow(/request folder is invalid/);
    expect(deps.uploadFile).not.toHaveBeenCalled();
  });
});

describe('verifyCopiedFiles', () => {
  const verifiedCopies = [
    { status: 'verified', item: { id: 'a' }, destination: { folder: `${REQUEST_FOLDER}/AI Materials`, filename: 'ProposalNarrative_1000400.pdf' }, source: { size: 10 } },
    { status: 'verified', item: { id: 'b' }, destination: { folder: `${REQUEST_FOLDER}/Reviewer Materials`, filename: 'Proposal_1000400.pdf' }, source: { size: 20 } },
  ];
  const listing = [
    { id: 'a', name: 'ProposalNarrative_1000400.pdf', size: 10, folder: `${REQUEST_FOLDER}/AI Materials` },
    { id: 'b', name: 'Proposal_1000400.pdf', size: 20, folder: `${REQUEST_FOLDER}/Reviewer Materials` },
  ];

  test('passes when the listing is exactly the verified copies', () => {
    expect(verifyCopiedFiles(verifiedCopies, listing)).toEqual([]);
  });

  test('fails on missing, extra, drifted or unverified files', () => {
    expect(verifyCopiedFiles(verifiedCopies, listing.slice(0, 1))).toEqual(['Proposal_1000400.pdf not present in the destination folder']);
    expect(verifyCopiedFiles(verifiedCopies, [...listing, { id: 'c', name: 'x', size: 1, folder: REQUEST_FOLDER }])).toEqual(['1 unexpected file(s) in the destination folder']);
    expect(verifyCopiedFiles(verifiedCopies, [{ ...listing[0], size: 11 }, listing[1]])).toEqual(['ProposalNarrative_1000400.pdf listing does not match the journaled copy']);
    expect(verifyCopiedFiles([{ ...verifiedCopies[0], status: 'failed' }], [])).toEqual(['1 planned file(s) not verified']);
    expect(verifyCopiedFiles(verifiedCopies, null)).toEqual(['SharePoint folder could not be inspected']);
  });
});
