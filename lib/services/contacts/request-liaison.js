/**
 * Research Liaison of record for a Request.
 *
 * For Research programs (`RESEARCH_PROGRAM_IDS`) the Liaison belongs to the
 * applicant institution: the account's Primary Contact, reached through the
 * Request's `_akoya_applicantid_value`. The Request's own copy
 * (`_akoya_primarycontactid_value`) goes stale when an institution changes
 * its Liaison and is never used for Research, not even as a fallback. Every
 * other program, including a blank one, keeps the Request copy.
 *
 * Results are discriminated, never a bare null:
 *   { status: 'found', contactId, source, displayName }
 *   { status: 'none', source }          a successful read found no Liaison
 * Any read failure, or an account read that does not return a requested row,
 * throws. `displayName` is the formatted lookup label (display only; never
 * email or send authority). Email-producing callers read the contact
 * themselves and treat a failed contact read as a failure, not `none`.
 *
 * Callers pass Request rows that carry all three input keys; an omitted key
 * is a projection bug and throws, while an explicit null is a blank value.
 *
 * Plan: docs/plans/LIAISON_FROM_INSTITUTION_PLAN_2026-09-29.md (*The rule, precisely*).
 */

import * as accountAdapter from '../../dataverse/adapters/account.js';
import * as odata from '../../dataverse/core/odata.js';
import { RESEARCH_PROGRAM_IDS } from '../../../shared/config/researchPrograms.js';

const INPUT_KEYS = ['_akoya_programid_value', '_akoya_applicantid_value', '_akoya_primarycontactid_value'];
const ACCOUNT_CHUNK = 25;
const RESEARCH = new Set(RESEARCH_PROGRAM_IDS.map((id) => id.toLowerCase()));

export const LIAISON_SOURCE = Object.freeze({ institution: 'institution', requestCopy: 'request_copy' });

/** The Request fields every caller's projection must select. */
export const REQUEST_LIAISON_FIELDS = Object.freeze([...INPUT_KEYS]);

function lower(value) {
  return typeof value === 'string' && value ? value.toLowerCase() : null;
}

export function isResearchProgram(programId) {
  const id = lower(programId);
  return id !== null && RESEARCH.has(id);
}

function assertInputRow(row, index) {
  if (!row || typeof row !== 'object') {
    throw new Error(`request-liaison: row ${index} is not a Request record`);
  }
  for (const key of INPUT_KEYS) {
    if (!Object.hasOwn(row, key)) {
      throw new Error(`request-liaison: row ${index} omits ${key} (the Request projection must select it)`);
    }
  }
}

function found(contactId, source, displayName) {
  return { status: 'found', contactId, source, displayName: displayName || null };
}

function none(source) {
  return { status: 'none', source };
}

async function readPrimaryContacts(accountIds) {
  const byId = new Map();
  for (let i = 0; i < accountIds.length; i += ACCOUNT_CHUNK) {
    const chunk = accountIds.slice(i, i + ACCOUNT_CHUNK);
    const result = await accountAdapter.queryAccounts({
      select: 'accountid,_primarycontactid_value',
      filter: odata.or(chunk.map((id) => odata.eqGuid('accountid', id))),
      top: chunk.length,
    });
    const records = result?.records;
    if (!Array.isArray(records)) {
      throw new Error('request-liaison: malformed account response');
    }
    if (result.hasMore === true || !Number.isFinite(result.totalCount) || result.totalCount > records.length) {
      throw new Error('request-liaison: account read was truncated');
    }
    for (const record of records) {
      // A returned account missing the selected lookup is malformed, not a blank Liaison.
      if (!record || !Object.hasOwn(record, '_primarycontactid_value')) {
        throw new Error('request-liaison: account response omits _primarycontactid_value');
      }
      const id = lower(record.accountid);
      if (id) byId.set(id, record);
    }
    for (const id of chunk) {
      if (!byId.has(id)) {
        throw new Error(`request-liaison: account ${id} was not returned`);
      }
    }
  }
  return byId;
}

/**
 * Resolve the Liaison for each Request row, in input order.
 *
 * @param {object[]} rows  Request records carrying REQUEST_LIAISON_FIELDS.
 * @returns {Promise<Array<{status: 'found', contactId: string, source: string, displayName: string|null} | {status: 'none', source: string}>>}
 */
export async function resolveRequestLiaisons(rows) {
  if (!Array.isArray(rows)) throw new Error('request-liaison: rows must be an array');
  rows.forEach(assertInputRow);

  const accountIds = [...new Set(
    rows
      .filter((row) => isResearchProgram(row._akoya_programid_value))
      .map((row) => lower(row._akoya_applicantid_value))
      .filter(Boolean),
  )];
  const accounts = accountIds.length ? await readPrimaryContacts(accountIds) : new Map();

  return rows.map((row) => {
    if (!isResearchProgram(row._akoya_programid_value)) {
      const copy = row._akoya_primarycontactid_value || null;
      return copy
        ? found(copy, LIAISON_SOURCE.requestCopy, row._akoya_primarycontactid_value_formatted)
        : none(LIAISON_SOURCE.requestCopy);
    }
    const applicantId = lower(row._akoya_applicantid_value);
    if (!applicantId) return none(LIAISON_SOURCE.institution);
    const account = accounts.get(applicantId);
    const contactId = account._primarycontactid_value || null;
    return contactId
      ? found(contactId, LIAISON_SOURCE.institution, account._primarycontactid_value_formatted)
      : none(LIAISON_SOURCE.institution);
  });
}

/** Single-row form of resolveRequestLiaisons. */
export async function resolveRequestLiaison(row) {
  const [result] = await resolveRequestLiaisons([row]);
  return result;
}
