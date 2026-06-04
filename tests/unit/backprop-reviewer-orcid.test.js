/**
 * @jest-environment node
 *
 * Reviewer→contact ORCID back-propagation, PR1 (docs/REVIEWER_ORCID_
 * BACKPROPAGATION_DESIGN.md §10). Locks the correctness-critical pieces:
 *  - the centralized ORCID normalizer + mod-11-2 checksum (valid / URL-form /
 *    no-hyphen / X check digit / checksum-invalid / junk / empty),
 *  - contact.setOrcidIfAbsent four §4 data-states + operational-error THROW +
 *    412 re-evaluate + If-Match conditional PATCH,
 *  - the ambiguity-aware resolveForBackprop (two contacts sharing a normalized
 *    email → ambiguous, no contactId — tests the concrete resolver, not just the
 *    classification table),
 *  - the shared helper's eligibility + pointer-fallback + skip semantics.
 */
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { normalizeOrcid } from '../../lib/utils/orcid-normalize.js';
import { setOrcidIfAbsent, resolveForBackprop } from '../../lib/dataverse/adapters/contact.js';
import { backPropReviewerOrcidToContact } from '../../lib/services/backprop-reviewer-orcid.js';

const VALID = '0000-0002-1825-0097';      // canonical (Josiah Carberry); check digit 7
const VALID_X = '0000-0002-1694-233X';    // valid, X check digit
const DIFFERENT = '0000-0001-5109-3700';  // a different valid iD (check 0)

function err(status, msg) { const e = new Error(msg || `HTTP ${status}`); e.status = status; return e; }

afterEach(() => jest.restoreAllMocks());

describe('normalizeOrcid — shape + mod-11-2 checksum', () => {
  test('canonical hyphenated → valid', () => {
    expect(normalizeOrcid(VALID)).toEqual({ state: 'valid', id: VALID });
  });
  test('orcid.org URL form → valid, canonical id', () => {
    expect(normalizeOrcid(`https://orcid.org/${VALID}`)).toEqual({ state: 'valid', id: VALID });
    expect(normalizeOrcid(`http://www.orcid.org/${VALID}`)).toEqual({ state: 'valid', id: VALID });
  });
  test('hyphen-stripped form → valid, re-hyphenated', () => {
    expect(normalizeOrcid('0000000218250097')).toEqual({ state: 'valid', id: VALID });
  });
  test('lowercase x check digit → valid (upper-cased)', () => {
    expect(normalizeOrcid(VALID_X.toLowerCase())).toEqual({ state: 'valid', id: VALID_X });
  });
  test('checksum-invalid (right shape) → malformed', () => {
    expect(normalizeOrcid('0000-0002-1825-0098')).toEqual({ state: 'malformed', raw: '0000-0002-1825-0098' });
  });
  test('junk like "1234567" → malformed', () => {
    expect(normalizeOrcid('1234567')).toEqual({ state: 'malformed', raw: '1234567' });
  });
  test('null / undefined / blank → empty', () => {
    expect(normalizeOrcid(null)).toEqual({ state: 'empty' });
    expect(normalizeOrcid(undefined)).toEqual({ state: 'empty' });
    expect(normalizeOrcid('   ')).toEqual({ state: 'empty' });
  });
});

describe('contact.setOrcidIfAbsent — §4 conflict policy', () => {
  test('empty target → WRITE (If-Match conditional, only wmkf_orcid)', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ contactid: 'c1', wmkf_orcid: null, _etag: 'W/"5"' });
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);

    const out = await setOrcidIfAbsent('c1', VALID, { actingUserSystemId: 'u1' });
    expect(out).toEqual({ action: 'write', orcid: VALID });
    expect(patch).toHaveBeenCalledTimes(1);
    const [entitySet, id, body, opts] = patch.mock.calls[0];
    expect(entitySet).toBe('contacts');
    expect(id).toBe('c1');
    expect(body).toEqual({ wmkf_orcid: VALID });
    expect(opts).toEqual({ actingUserSystemId: 'u1', ifMatch: 'W/"5"' });
  });

  test('same iD already present → noop, no PATCH', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ contactid: 'c1', wmkf_orcid: VALID });
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    const out = await setOrcidIfAbsent('c1', `https://orcid.org/${VALID}`);
    expect(out).toEqual({ action: 'noop', orcid: VALID });
    expect(patch).not.toHaveBeenCalled();
  });

  test('different valid iD present → conflict, NEVER overwrite', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ contactid: 'c1', wmkf_orcid: DIFFERENT });
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    const out = await setOrcidIfAbsent('c1', VALID);
    expect(out).toEqual({ action: 'conflict', existing: DIFFERENT, incoming: VALID });
    expect(patch).not.toHaveBeenCalled();
  });

  test('malformed target → malformed, no PATCH', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockResolvedValue({ contactid: 'c1', wmkf_orcid: '1234567' });
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue(undefined);
    const out = await setOrcidIfAbsent('c1', VALID);
    expect(out).toEqual({ action: 'malformed', existing: '1234567', incoming: VALID });
    expect(patch).not.toHaveBeenCalled();
  });

  test('operational error on read THROWS (not swallowed as a data-state)', async () => {
    jest.spyOn(DynamicsService, 'getRecord').mockRejectedValue(err(403, 'forbidden'));
    await expect(setOrcidIfAbsent('c1', VALID)).rejects.toThrow('forbidden');
  });

  test('invalid incoming ORCID THROWS (caller must pass a gated iD)', async () => {
    const getRec = jest.spyOn(DynamicsService, 'getRecord');
    await expect(setOrcidIfAbsent('c1', '1234567')).rejects.toThrow(/not valid/);
    expect(getRec).not.toHaveBeenCalled();
  });

  test('412 on PATCH → re-read + re-evaluate (now same iD → noop)', async () => {
    jest.spyOn(DynamicsService, 'getRecord')
      .mockResolvedValueOnce({ contactid: 'c1', wmkf_orcid: null, _etag: 'W/"1"' })
      .mockResolvedValueOnce({ contactid: 'c1', wmkf_orcid: VALID, _etag: 'W/"2"' });
    const patch = jest.spyOn(DynamicsService, 'updateRecord').mockRejectedValueOnce(err(412, 'Precondition Failed'));
    const out = await setOrcidIfAbsent('c1', VALID);
    expect(out).toEqual({ action: 'noop', orcid: VALID });
    expect(patch).toHaveBeenCalledTimes(1);
  });

  test('non-412 error whose message merely contains "412" THROWS, no retry (Codex adversarial 1c)', async () => {
    const getRec = jest.spyOn(DynamicsService, 'getRecord')
      .mockResolvedValue({ contactid: 'c1', wmkf_orcid: null, _etag: 'W/"1"' });
    const patch = jest.spyOn(DynamicsService, 'updateRecord')
      .mockRejectedValue(err(500, 'server error processing record 41200 (batch 412 abc)'));
    await expect(setOrcidIfAbsent('c1', VALID)).rejects.toThrow(/server error/);
    expect(patch).toHaveBeenCalledTimes(1);   // exactly one attempt — NOT re-read/retried
    expect(getRec).toHaveBeenCalledTimes(1);
  });

  test('missing contactId THROWS', async () => {
    await expect(setOrcidIfAbsent(null, VALID)).rejects.toThrow(/contactId required/);
  });
});

describe('contact.resolveForBackprop — ambiguity-aware (top:2)', () => {
  test('no match → none', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    expect(await resolveForBackprop('nobody@uni.edu')).toEqual({ none: true });
  });
  test('exactly one match → contactId', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [{ contactid: 'c9', emailaddress1: 'Jane@Uni.edu' }] });
    // Reviewer email differs only by case/whitespace — normalized compare matches.
    expect(await resolveForBackprop('  jane@uni.edu ')).toEqual({ contactId: 'c9' });
  });
  test('two contacts sharing a normalized email → ambiguous, no contactId', async () => {
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{ contactid: 'a', emailaddress1: 'dup@uni.edu' }, { contactid: 'b', emailaddress1: 'DUP@uni.edu' }],
    });
    const out = await resolveForBackprop('dup@uni.edu');
    expect(out).toEqual({ ambiguous: true, count: 2 });
    expect(out.contactId).toBeUndefined();
  });
  test('top:2 select is requested (so duplicates are visible)', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    await resolveForBackprop('x@y.edu');
    expect(q.mock.calls[0][1]).toMatchObject({ top: 2, select: 'contactid,emailaddress1' });
  });
  test('empty email → none (no query)', async () => {
    const q = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });
    expect(await resolveForBackprop('')).toEqual({ none: true });
    expect(q).not.toHaveBeenCalled();
  });
});

describe('backPropReviewerOrcidToContact — shared helper', () => {
  const fakeContacts = () => ({ setOrcidIfAbsent: jest.fn().mockResolvedValue({ action: 'write', orcid: VALID }) });

  test('eligible + explicit contactId → calls setOrcidIfAbsent with canonical iD', async () => {
    const contacts = fakeContacts();
    const out = await backPropReviewerOrcidToContact(
      { reviewer: { wmkf_orcid: `https://orcid.org/${VALID}`, wmkf_identitystatus: 'probable' }, contactId: 'c1', actingUserSystemId: 'u1' },
      { contacts },
    );
    expect(out).toEqual({ action: 'write', orcid: VALID });
    expect(contacts.setOrcidIfAbsent).toHaveBeenCalledWith('c1', VALID, { actingUserSystemId: 'u1' });
  });

  test('eligible + only pointer (_wmkf_contact_value) → uses the pointer', async () => {
    const contacts = fakeContacts();
    await backPropReviewerOrcidToContact(
      { reviewer: { wmkf_orcid: VALID, wmkf_identitystatus: 'confirmed', _wmkf_contact_value: 'cPtr' } },
      { contacts },
    );
    expect(contacts.setOrcidIfAbsent).toHaveBeenCalledWith('cPtr', VALID, { actingUserSystemId: undefined });
  });

  test('explicit contactId wins over the pointer', async () => {
    const contacts = fakeContacts();
    await backPropReviewerOrcidToContact(
      { reviewer: { wmkf_orcid: VALID, wmkf_identitystatus: 'probable', _wmkf_contact_value: 'cPtr' }, contactId: 'cNew' },
      { contacts },
    );
    expect(contacts.setOrcidIfAbsent).toHaveBeenCalledWith('cNew', VALID, { actingUserSystemId: undefined });
  });

  test('ineligible status (unresolved) → skip, never touch contact', async () => {
    const contacts = fakeContacts();
    const out = await backPropReviewerOrcidToContact(
      { reviewer: { wmkf_orcid: VALID, wmkf_identitystatus: 'unresolved' }, contactId: 'c1' },
      { contacts },
    );
    expect(out).toEqual({ skipped: 'ineligible' });
    expect(contacts.setOrcidIfAbsent).not.toHaveBeenCalled();
  });

  test('null status → ineligible (defensive against pre-gate values)', async () => {
    const contacts = fakeContacts();
    const out = await backPropReviewerOrcidToContact(
      { reviewer: { wmkf_orcid: VALID, wmkf_identitystatus: null }, contactId: 'c1' },
      { contacts },
    );
    expect(out).toEqual({ skipped: 'ineligible' });
    expect(contacts.setOrcidIfAbsent).not.toHaveBeenCalled();
  });

  test('no / malformed ORCID → ineligible (no contact read attempted)', async () => {
    const contacts = fakeContacts();
    expect(await backPropReviewerOrcidToContact({ reviewer: { wmkf_identitystatus: 'probable' }, contactId: 'c1' }, { contacts })).toEqual({ skipped: 'ineligible' });
    expect(await backPropReviewerOrcidToContact({ reviewer: { wmkf_orcid: '1234567', wmkf_identitystatus: 'probable' }, contactId: 'c1' }, { contacts })).toEqual({ skipped: 'ineligible' });
    expect(contacts.setOrcidIfAbsent).not.toHaveBeenCalled();
  });

  test('eligible but no contact anywhere → skip no_contact', async () => {
    const contacts = fakeContacts();
    const out = await backPropReviewerOrcidToContact({ reviewer: { wmkf_orcid: VALID, wmkf_identitystatus: 'probable' } }, { contacts });
    expect(out).toEqual({ skipped: 'no_contact' });
    expect(contacts.setOrcidIfAbsent).not.toHaveBeenCalled();
  });

  test('null reviewer → ineligible', async () => {
    const contacts = fakeContacts();
    expect(await backPropReviewerOrcidToContact({ reviewer: null, contactId: 'c1' }, { contacts })).toEqual({ skipped: 'ineligible' });
    expect(contacts.setOrcidIfAbsent).not.toHaveBeenCalled();
  });
});
