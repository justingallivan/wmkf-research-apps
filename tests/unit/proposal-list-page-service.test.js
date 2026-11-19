/**
 * Proposal list page service — list shape and the one file a link may open
 * (docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md).
 *
 * @jest-environment node
 */
import { buildProposalListContext, resolveProposalListDocument } from '../../lib/services/proposal-lists/list-page-service';

const LINK = { id: 'link-a', cycle_code: 'J27', recipient_name: 'Dr. Example', expires_at: new Date('2027-06-10T08:00:00Z') };
const REQ_A = '11111111-1111-4111-8111-111111111111';
const PDF = { buffer: Buffer.from('%PDF-1.7'), mimeType: 'application/pdf', filename: 'UNIV_Staff-Version_1001.pdf', size: 8 };
const STAFF_VERSION = { key: 'staffVersion', found: true, library: 'akoya_request', folder: '1001_AAAA', name: 'UNIV_Staff-Version_1001.pdf' };

function item(overrides = {}) {
  return {
    request_id: REQ_A, request_number: '1001', title: 'A proposal', institution: 'Univ', project_leader: 'P. Leader',
    section: 'Physics', highlighted: false, own_institution: false, ...overrides,
  };
}

function documentDeps({ itemsByLink = { 'link-a': { 1001: item() } }, documents = { staffVersion: STAFF_VERSION }, file = PDF } = {}) {
  return {
    getItem: jest.fn(async (linkId, number) => itemsByLink[linkId]?.[number] || null),
    listDocuments: jest.fn(async () => documents),
    download: jest.fn(async () => file),
  };
}

describe('buildProposalListContext', () => {
  test('highlighted proposals appear only at the top; the rest are grouped by section', async () => {
    const rows = [
      item({ request_number: '1001', section: 'Physics', highlighted: true }),
      item({ request_number: '1002', section: 'Physics', own_institution: true }),
      item({ request_number: '1003', section: 'Neuroscience' }),
    ];
    const context = await buildProposalListContext({ link: LINK }, { listItems: jest.fn(async () => rows) });
    expect(context.total).toBe(3);
    expect(context.highlighted.map((p) => p.requestNumber)).toEqual(['1001']);
    expect(context.sections.map((s) => s.name)).toEqual(['Neuroscience', 'Physics']);
    expect(context.sections[1].proposals.map((p) => p.requestNumber)).toEqual(['1002']);
    expect(context.sections[1].proposals[0].ownInstitution).toBe(true);
  });

  test('never exposes the request GUID to the page', async () => {
    const context = await buildProposalListContext({ link: LINK }, { listItems: jest.fn(async () => [item()]) });
    expect(JSON.stringify(context)).not.toContain(REQ_A);
  });
});

describe('resolveProposalListDocument', () => {
  test('serves the staff version of a listed request, resolved from the item, not the caller', async () => {
    const deps = documentDeps();
    const file = await resolveProposalListDocument({ link: LINK, requestNumber: '1001' }, deps);
    expect(file.mimeType).toBe('application/pdf');
    expect(deps.listDocuments).toHaveBeenCalledWith(REQ_A, '1001', 'J27');
    expect(deps.download).toHaveBeenCalledWith('akoya_request', '1001_AAAA', 'UNIV_Staff-Version_1001.pdf');
  });

  test('refuses a request that is on another person’s list, before any SharePoint call', async () => {
    // 2002 exists and is listed, but only on link-b.
    const deps = documentDeps({
      itemsByLink: {
        'link-a': { 1001: item() },
        'link-b': { 2002: item({ request_number: '2002', request_id: '22222222-2222-4222-8222-222222222222' }) },
      },
    });
    await expect(resolveProposalListDocument({ link: LINK, requestNumber: '2002' }, deps))
      .rejects.toMatchObject({ httpStatus: 404, code: 'not_on_list' });
    expect(deps.getItem).toHaveBeenCalledWith('link-a', '2002');
    expect(deps.listDocuments).not.toHaveBeenCalled();
    expect(deps.download).not.toHaveBeenCalled();
  });

  test.each(['', 'abc', '10/01', '1001; drop', '../1001'])('rejects the malformed request number %p without a lookup', async (bad) => {
    const deps = documentDeps();
    await expect(resolveProposalListDocument({ link: LINK, requestNumber: bad }, deps))
      .rejects.toMatchObject({ httpStatus: 400 });
    expect(deps.getItem).not.toHaveBeenCalled();
  });

  test('a missing staff version is a 404 and downloads nothing, even when other files exist', async () => {
    const deps = documentDeps({
      documents: {
        staffVersion: { key: 'staffVersion', found: false },
        reviewerMaterials: [{ library: 'akoya_request', folder: '1001_AAAA/Reviewer Materials', name: 'Proposal_1001.pdf' }],
        otherDocuments: [{ library: 'akoya_request', folder: '1001_AAAA', name: 'Research Phase I Application_1001.pdf' }],
      },
    });
    await expect(resolveProposalListDocument({ link: LINK, requestNumber: '1001' }, deps))
      .rejects.toMatchObject({ httpStatus: 404, code: 'document_not_ready' });
    expect(deps.download).not.toHaveBeenCalled();
  });

  test('a cycle layout with no staff version slot is a 404 and downloads nothing', async () => {
    const deps = documentDeps({ documents: { slots: [], otherDocuments: [] } });
    await expect(resolveProposalListDocument({ link: LINK, requestNumber: '1001' }, deps))
      .rejects.toMatchObject({ httpStatus: 404, code: 'document_not_ready' });
    expect(deps.download).not.toHaveBeenCalled();
  });

  test('refuses a non-PDF file under the staff-version name', async () => {
    const deps = documentDeps({ file: { ...PDF, mimeType: 'text/html' } });
    await expect(resolveProposalListDocument({ link: LINK, requestNumber: '1001' }, deps))
      .rejects.toMatchObject({ httpStatus: 404 });
  });

  test('a SharePoint failure is a 502, not a server crash', async () => {
    const deps = documentDeps();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    deps.download.mockRejectedValue(new Error('graph down'));
    await expect(resolveProposalListDocument({ link: LINK, requestNumber: '1001' }, deps))
      .rejects.toMatchObject({ httpStatus: 502 });
  });
});
