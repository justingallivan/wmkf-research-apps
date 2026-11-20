/**
 * Proposal list link lifecycle
 * (docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md).
 *
 * One live personal link per cycle, list type, and recipient address. The link
 * opens a no-login page that lists every scored proposal in the cycle and
 * lets the holder open each one's staff version. Staff highlight the proposals
 * they want that person's view on; everyone can open every listed proposal.
 * During Scoring, staff tick the advisors who should see a proposal (advisor
 * picks); creating a list highlights the proposals ticked for its recipient.
 *
 * Tokens are audience-scoped JWTs from the shared external-token primitive.
 * The row stores the SHA-256 digest (checked on every external request) and
 * the token sealed with lib/utils/encryption.js so staff can copy the same
 * link again. The row's expiry governs: the end of the cycle's Board meeting
 * day. The JWT's own expiry is a later ceiling so the row can decide.
 *
 * Who may receive a list: an `ordinary` list goes to an active Board member on
 * the expertise roster who has an email address; a `test` list (Factory test
 * requests only) goes only to the signed-in staff member, so test data never
 * reaches a Board address.
 *
 * ASSUMES a trusted DAL context already exists.
 */
import crypto from 'node:crypto';
import { mintScopedToken, hashToken } from '../external-token';
import { encrypt, decrypt } from '../../utils/encryption';
import { ServiceHttpError } from '../service-http-error';
import { isGuid } from '../../utils/guid.js';
import { isProposalListSchemaReady } from '../../utils/proposal-list-readiness.js';
import { getBriefingBaseUrl } from '../deliberation-briefing/briefing-link-service';
import { getBoardSetupDatesByCode } from '../../dataverse/adapters/operations-grant-cycle.js';
import { CYCLE_CALENDAR_BOARD_DATE, dateOnly } from '../../../shared/config/cycleCalendar.js';
import { getSiteVisitRecipientDirectory, normalizeSiteVisitEmail } from '../site-visit/recipient-directory-service';
import { loadCycleProposalSnapshot, PROPOSAL_LIST_KINDS, SECTION_SOURCE } from './list-snapshot-service';
import * as store from './list-store';
import { getById as getRequestById } from '../../dataverse/adapters/grant-request.js';
import { linkedCycleCode, linkedCycleExpand } from '../../dataverse/adapters/operations-grant-cycle.js';
import { isDataverseRecordNotFound } from '../../dataverse/core/errors.js';
import { isJ27ScopeCycle } from '../workbench/j27-read-model.js';
import { isScoredRow } from './list-snapshot-service';
import { resolvePreviewReadOnly } from '../workbench/preview-read-only.js';

export const PROPOSAL_LIST_AUDIENCE = 'proposal-list';
export const PROPOSAL_LIST_OPS = Object.freeze(['view_proposal_list']);

const DAY_MS = 24 * 60 * 60 * 1000;
// The JWT outlives the row by this margin; the row's expiry is what is enforced.
const TOKEN_CEILING_DAYS = 30;

const DEFAULT_DEPENDENCIES = Object.freeze({
  schemaReady: isProposalListSchemaReady,
  getBoardDates: getBoardSetupDatesByCode,
  getDirectory: getSiteVisitRecipientDirectory,
  loadSnapshot: loadCycleProposalSnapshot,
  previewReadOnly: () => resolvePreviewReadOnly(),
  readRequest: (requestId) => getRequestById(requestId, {
    select: 'akoya_requestid,wmkf_phaseistatus',
    expand: linkedCycleExpand(),
  }).catch((error) => { if (isDataverseRecordNotFound(error)) return null; throw error; }),
  store,
  mint: mintScopedToken,
  seal: encrypt,
  unseal: decrypt,
  now: () => new Date(),
  randomUUID: () => crypto.randomUUID(),
});

function listError(message, code, httpStatus = 409) {
  return new ServiceHttpError(message, { httpStatus, code, body: { error: message, code } });
}

export function buildProposalListUrl(jwt, env = process.env) {
  return `${getBriefingBaseUrl(env)}/external/proposal-list/${jwt}`;
}

/**
 * The link stops at the end of the Board meeting day, Pacific time. Midnight
 * Pacific is 08:00 UTC in standard time and 07:00 UTC in daylight time; 08:00
 * UTC the next day is used year-round, so the link is never cut short and runs
 * at most one hour past midnight.
 */
export function computeProposalListExpiry(meetingDate) {
  const day = dateOnly(meetingDate);
  if (!day) return null;
  return new Date(Date.parse(`${day}T08:00:00Z`) + DAY_MS);
}

function normalizeCycle(cycleCode) {
  const code = String(cycleCode || '').trim().toUpperCase();
  if (!/^[JD]\d{2}$/.test(code)) throw listError('Choose a valid grant cycle.', 'proposal_list_cycle_invalid', 400);
  return code;
}

function assertReady(dependencies) {
  if (!dependencies.schemaReady()) {
    throw listError('Proposal lists are not enabled in this environment.', 'proposal_list_schema_not_ready', 503);
  }
}

function assertKind(listKind) {
  if (!PROPOSAL_LIST_KINDS.includes(listKind)) throw listError('Choose a valid list type.', 'proposal_list_kind_invalid', 400);
}

function assertActor(actor) {
  if (!isGuid(actor?.systemUserId)) {
    throw listError('Your staff account is not linked to a Dynamics identity.', 'proposal_list_actor_required', 403);
  }
}

async function readExpiry(code, dependencies) {
  const row = await dependencies.getBoardDates(code);
  const meetingDate = dateOnly(row?.[CYCLE_CALENDAR_BOARD_DATE.column]);
  return { meetingDate, expiresAt: computeProposalListExpiry(meetingDate) };
}

async function boardRecipients(dependencies) {
  const directory = await dependencies.getDirectory();
  return (directory?.external || [])
    .filter((row) => row.roleType === 'Board')
    .map((row) => ({
      rosterId: row.rosterId,
      name: row.name,
      email: row.email || null,
      affiliation: row.affiliation || null,
    }));
}

function tryUnsealUrl(row, dependencies) {
  let jwt = null;
  try {
    jwt = dependencies.unseal(row.token_ciphertext);
  } catch {
    jwt = null;
  }
  if (!jwt || hashToken(jwt) !== row.token_digest) return null;
  return buildProposalListUrl(jwt);
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : value || null;
}

/** Staff-facing projection: never includes the digest or ciphertext. */
function projectLink(row, dependencies) {
  const url = tryUnsealUrl(row, dependencies);
  return {
    id: row.id,
    cycleCode: row.cycle_code,
    listKind: row.list_kind,
    recipientName: row.recipient_name,
    recipientEmail: row.recipient_email,
    url,
    unreadable: !url,
    expired: new Date(row.expires_at).getTime() <= dependencies.now().getTime(),
    expiresAt: iso(row.expires_at),
    createdAt: iso(row.created_at),
    itemsBuiltAt: iso(row.items_built_at),
    itemCount: row.item_count ?? null,
    highlightedCount: row.highlighted_count ?? null,
  };
}

function projectItem(row) {
  return {
    requestId: row.request_id,
    requestNumber: row.request_number,
    title: row.title,
    institution: row.institution,
    projectLeader: row.project_leader,
    section: row.section,
    subsection: row.subsection || null,
    highlighted: row.highlighted === true,
    ownInstitution: row.own_institution === true,
  };
}

/** Staff read for the compose page: recipients, live links, and the expiry the cycle gives. */
export async function getProposalListOverview({ cycleCode, listKind, actor }, dependencies = DEFAULT_DEPENDENCIES) {
  assertReady(dependencies);
  assertKind(listKind);
  const code = normalizeCycle(cycleCode);
  const [expiry, recipients, links] = await Promise.all([
    readExpiry(code, dependencies),
    listKind === 'ordinary' ? boardRecipients(dependencies) : [],
    dependencies.store.listLiveLinks(code, listKind),
  ]);
  return {
    cycleCode: code,
    listKind,
    meetingDate: expiry.meetingDate,
    expiresAt: iso(expiry.expiresAt),
    sectionSource: SECTION_SOURCE,
    self: listKind === 'test'
      ? { name: actor?.name || null, email: normalizeSiteVisitEmail(actor?.email) || null }
      : null,
    recipients,
    links: links.map((row) => projectLink(row, dependencies)),
  };
}

/** Staff read of one live link with its items, for the highlight editor. */
export async function getProposalListDetail({ linkId }, dependencies = DEFAULT_DEPENDENCIES) {
  assertReady(dependencies);
  if (!isGuid(linkId)) throw listError('Choose a list.', 'proposal_list_link_invalid', 400);
  const row = await dependencies.store.getLinkById(linkId);
  if (!row || row.revoked_at) throw listError('This list is no longer available. Refresh the page.', 'proposal_list_link_not_found', 404);
  const items = await dependencies.store.listItems(linkId);
  const tickedFor = await advisorNamesByRequest(items.map((item) => String(item.request_id).toLowerCase()), dependencies);
  return {
    link: projectLink(row, dependencies),
    items: items.map((item) => ({ ...projectItem(item), tickedFor: tickedFor.get(String(item.request_id).toLowerCase()) || [] })),
  };
}

/**
 * Staff-only note for the highlight editor: the Board members ticked for each
 * request during Scoring, by name, sorted. A roster id no longer on the Board
 * roster is left out. Never part of the recipient page.
 */
async function advisorNamesByRequest(requestIds, dependencies) {
  const byRequest = new Map();
  if (!requestIds.length) return byRequest;
  const picks = await dependencies.store.listPicksForRequests(requestIds);
  if (!picks.length) return byRequest;
  const names = new Map((await boardRecipients(dependencies)).map((row) => [Number(row.rosterId), row.name]));
  for (const { requestId, rosterId } of picks) {
    const name = names.get(Number(rosterId));
    if (!name) continue;
    byRequest.set(requestId, [...(byRequest.get(requestId) || []), name].sort((a, b) => a.localeCompare(b)));
  }
  return byRequest;
}

async function resolveRecipient({ listKind, rosterId, actor }, dependencies) {
  if (listKind === 'test') {
    const email = normalizeSiteVisitEmail(actor?.email);
    if (!email) throw listError('Your staff account has no email address.', 'proposal_list_recipient_unresolved');
    return { name: String(actor?.name || email).trim().slice(0, 255), email, source: 'staff:self', affiliation: null, rosterId: null };
  }
  const match = (await boardRecipients(dependencies)).find((row) => String(row.rosterId) === String(rosterId));
  if (!match) throw listError('That Board member is not on the current roster.', 'proposal_list_recipient_unresolved');
  if (!match.email) throw listError(`${match.name} has no email address on the roster.`, 'proposal_list_recipient_no_email');
  return {
    name: String(match.name).trim().slice(0, 255),
    email: match.email,
    source: `expertise_roster:${match.rosterId}`,
    affiliation: match.affiliation,
    rosterId: Number(match.rosterId),
  };
}

/**
 * Suggested own-institution mark: the recipient's roster affiliation equals the
 * applicant institution after trimming and case-folding. It is a suggestion
 * staff confirm or change on the compose page, never a conflict determination.
 */
function suggestOwnInstitution(item, affiliation) {
  const a = String(affiliation || '').trim().toLowerCase();
  return Boolean(a) && a === String(item.institution || '').trim().toLowerCase();
}

/**
 * Whose advisor picks a link takes: a test list takes every pick (it goes to
 * the signed-in staff member); an ordinary list takes its roster recipient's;
 * any other source takes none.
 */
function pickRosterId(row) {
  if (row?.list_kind === 'test') return null;
  const match = /^expertise_roster:(\d+)$/.exec(String(row?.recipient_source || ''));
  return match ? Number(match[1]) : undefined;
}

/** Create the recipient's personal link and freeze the cycle's proposals onto it. */
export async function createProposalList({ cycleCode, listKind, rosterId, actor }, dependencies = DEFAULT_DEPENDENCIES) {
  assertReady(dependencies);
  assertKind(listKind);
  assertActor(actor);
  const code = normalizeCycle(cycleCode);
  const recipient = await resolveRecipient({ listKind, rosterId, actor }, dependencies);
  const { expiresAt } = await readExpiry(code, dependencies);
  const now = dependencies.now();
  if (!expiresAt) {
    throw listError('This cycle has no Board meeting date, so the link has no end date. Set the date first.', 'proposal_list_meeting_date_missing');
  }
  if (expiresAt.getTime() <= now.getTime()) {
    throw listError('This cycle’s Board meeting has passed.', 'proposal_list_meeting_date_passed');
  }
  const snapshot = await dependencies.loadSnapshot({ cycleCode: code, listKind });
  if (!snapshot.length) throw listError('This cycle has no proposals marked Scored yet.', 'proposal_list_empty');

  const { jwt, jti, hash } = await dependencies.mint({
    subject: dependencies.randomUUID(),
    audience: PROPOSAL_LIST_AUDIENCE,
    ops: [...PROPOSAL_LIST_OPS],
    expiresAt: new Date(expiresAt.getTime() + TOKEN_CEILING_DAYS * DAY_MS),
  });
  const link = {
    id: dependencies.randomUUID(),
    cycleCode: code,
    listKind,
    recipientName: recipient.name,
    recipientEmail: recipient.email,
    recipientSource: recipient.source,
    jti,
    tokenDigest: hash,
    tokenCiphertext: dependencies.seal(jwt),
    expiresAt,
    createdBy: actor.systemUserId,
  };
  const picked = new Set(await dependencies.store.listPickedRequestIds(recipient.rosterId));
  const items = snapshot.map((item) => ({
    ...item,
    highlighted: picked.has(item.requestId),
    ownInstitution: suggestOwnInstitution(item, recipient.affiliation),
  }));
  let row;
  try {
    row = await dependencies.store.insertLinkWithItems(link, items);
  } catch (error) {
    if (error?.code === '23505') {
      throw listError(`${recipient.name} already has a list for this cycle. Refresh the page.`, 'proposal_list_already_exists');
    }
    throw error;
  }
  const highlightedCount = items.filter((item) => item.highlighted).length;
  return { link: projectLink({ ...row, item_count: items.length, highlighted_count: highlightedCount }, dependencies) };
}

/**
 * Re-read the cycle's proposals onto an existing live link, keeping the link
 * (and so the URL the recipient holds) and the marks staff already set on
 * proposals that are still listed.
 */
export async function rebuildProposalList({ linkId, actor }, dependencies = DEFAULT_DEPENDENCIES) {
  assertReady(dependencies);
  assertActor(actor);
  if (!isGuid(linkId)) throw listError('Choose a list.', 'proposal_list_link_invalid', 400);
  const row = await dependencies.store.getLinkById(linkId);
  if (!row || row.revoked_at) throw listError('This list is no longer available. Refresh the page.', 'proposal_list_link_not_found', 404);
  const snapshot = await dependencies.loadSnapshot({ cycleCode: row.cycle_code, listKind: row.list_kind });
  if (!snapshot.length) throw listError('This cycle has no proposals marked Scored yet.', 'proposal_list_empty');
  // The store keeps existing marks, reading them under the link lock: marks
  // saved while the snapshot was being read are not overwritten.
  // Proposals new to the list are highlighted from advisor picks; the store
  // keeps the marks already on proposals that stay listed.
  const pickKey = pickRosterId(row);
  const picked = new Set(pickKey === undefined ? [] : await dependencies.store.listPickedRequestIds(pickKey));
  const fresh = snapshot.map((item) => ({ ...item, highlighted: picked.has(item.requestId) }));
  if (!await dependencies.store.replaceItems(linkId, fresh)) {
    throw listError('This list is no longer available. Refresh the page.', 'proposal_list_link_not_found', 404);
  }
  return getProposalListDetail({ linkId }, dependencies);
}

function guidList(value, label) {
  if (!Array.isArray(value) || value.length > 1000 || value.some((id) => !isGuid(id))) {
    throw listError(`${label} must be a list of proposals.`, 'proposal_list_marks_invalid', 400);
  }
  return [...new Set(value.map((id) => id.toLowerCase()))];
}

/** Replace the highlighted and own-institution marks of one live link. */
export async function setProposalListMarks({ linkId, highlightedRequestIds, ownInstitutionRequestIds, actor }, dependencies = DEFAULT_DEPENDENCIES) {
  assertReady(dependencies);
  assertActor(actor);
  if (!isGuid(linkId)) throw listError('Choose a list.', 'proposal_list_link_invalid', 400);
  const highlighted = guidList(highlightedRequestIds, 'Highlighted proposals');
  const own = guidList(ownInstitutionRequestIds, 'Own-institution proposals');
  const onList = new Set((await dependencies.store.listItems(linkId)).map((item) => String(item.request_id).toLowerCase()));
  if ([...highlighted, ...own].some((id) => !onList.has(id))) {
    throw listError('A marked proposal is not on this list. Refresh the page.', 'proposal_list_marks_not_on_list');
  }
  if (!await dependencies.store.setMarks(linkId, { highlightedRequestIds: highlighted, ownInstitutionRequestIds: own })) {
    throw listError('This list is no longer available. Refresh the page.', 'proposal_list_link_not_found', 404);
  }
  return getProposalListDetail({ linkId }, dependencies);
}

/** Switch one person's link off. Their page and every proposal on it stop opening. */
export async function revokeProposalList({ linkId, actor }, dependencies = DEFAULT_DEPENDENCIES) {
  assertReady(dependencies);
  assertActor(actor);
  if (!isGuid(linkId)) throw listError('Choose a list.', 'proposal_list_link_invalid', 400);
  const row = await dependencies.store.revokeLink(linkId, actor.systemUserId);
  if (!row) throw listError('This list was already switched off. Refresh the page.', 'proposal_list_link_not_found', 404);
  return { revoked: true, id: row.id };
}

async function readScoredRequest(requestId, dependencies) {
  if (!isGuid(requestId)) throw listError('Choose a request.', 'proposal_list_request_invalid', 400);
  const row = await dependencies.readRequest(requestId);
  if (!row?.akoya_requestid || !isJ27ScopeCycle(linkedCycleCode(row))) {
    throw listError('Request not found.', 'proposal_list_request_not_found', 404);
  }
  return { scored: isScoredRow(row) };
}

/**
 * Advisor picks for one request: every Board-role roster member, whether they
 * are ticked, and whether the request is Scored (picks open only then).
 */
export async function getAdvisorPicks({ requestId }, dependencies = DEFAULT_DEPENDENCIES) {
  assertReady(dependencies);
  const id = String(requestId || '').trim().toLowerCase();
  const { scored } = await readScoredRequest(id, dependencies);
  const [advisors, picks] = await Promise.all([
    boardRecipients(dependencies),
    dependencies.store.listPicksForRequest(id),
  ]);
  const ticked = new Set(picks.map(Number));
  return {
    scored,
    readOnly: dependencies.previewReadOnly(),
    advisors: advisors
      .map((row) => ({ rosterId: Number(row.rosterId), name: row.name, picked: ticked.has(Number(row.rosterId)) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Tick or untick one advisor on one Scored request. */
export async function setAdvisorPick({ requestId, rosterId, picked, actor }, dependencies = DEFAULT_DEPENDENCIES) {
  assertReady(dependencies);
  assertActor(actor);
  if (dependencies.previewReadOnly()) {
    throw listError('This preview is read-only.', 'proposal_list_preview_read_only', 403);
  }
  if (typeof picked !== 'boolean') throw listError('Choose whether to tick this person.', 'proposal_list_pick_invalid', 400);
  const id = String(requestId || '').trim().toLowerCase();
  const { scored } = await readScoredRequest(id, dependencies);
  if (!scored) throw listError('Advisors can be ticked only on a Scored request.', 'proposal_list_pick_not_scored');
  const advisor = (await boardRecipients(dependencies)).find((row) => String(row.rosterId) === String(rosterId));
  if (!advisor) throw listError('That Board member is not on the current roster.', 'proposal_list_recipient_unresolved');
  await dependencies.store.setPick(id, Number(advisor.rosterId), picked, actor.systemUserId);
  return getAdvisorPicks({ requestId: id }, dependencies);
}
