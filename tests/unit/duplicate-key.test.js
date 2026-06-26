/**
 * translateDuplicateKeyError — pinned to the REAL Dataverse 412 body shape captured
 * from production by the chunk-5 alt-key ordering probe (S290). The earlier version
 * extracted the first <Id> as conflictingRecordId, which against the real error is
 * the `modifiedby` systemuser — not the conflicting owner (the owner is absent from
 * the 412 entirely). This fixture locks the parser to reality so it can't regress to
 * the fabricated-XML assumption: field/value parse from DuplicateAttributes, and NO
 * record id is returned (the route resolves the owner by value instead).
 */

import { translateDuplicateKeyError } from '../../lib/dataverse/duplicate-key';

// Sanitized but structurally faithful: the DuplicateEntity (record being written)
// carries a `modifiedby` systemuser <Id> BEFORE the entity-level <Id>, then the
// DuplicateAttributes carries the duplicate field/value. (GUIDs are placeholders.)
const SYSTEMUSER_ID = '11111111-1111-1111-1111-111111111111'; // modifiedby (first <Id>)
const WRITTEN_RECORD_ID = '22222222-2222-2222-2222-222222222222'; // the record being edited
const DUP_EMAIL = 'dup@example.invalid';

const REAL_412_BODY = `dataverse failed (412): {"error":{"code":"0x80060892","message":"Entity Key Email Address violated. A record with the same value for Email Address already exists. A duplicate record cannot be created. Select one or more unique values and try again.","@Microsoft.PowerApps.CDS.ErrorDetails.0":"Email Address","@Microsoft.PowerApps.CDS.ErrorDetails.1":"Email Address","@Microsoft.PowerApps.CDS.ErrorDetails.DuplicateEntity":"<?xml version=\\"1.0\\" encoding=\\"utf-16\\"?><Entity><Attributes><KeyValuePairOfstringanyType><d2p1:key>wmkf_emailaddress</d2p1:key><d2p1:value i:type=\\"d4p1:string\\">${DUP_EMAIL}</d2p1:value></KeyValuePairOfstringanyType><KeyValuePairOfstringanyType><d2p1:key>wmkf_potentialreviewersid</d2p1:key><d2p1:value i:type=\\"d4p1:guid\\">${WRITTEN_RECORD_ID}</d2p1:value></KeyValuePairOfstringanyType><KeyValuePairOfstringanyType><d2p1:key>modifiedby</d2p1:key><d2p1:value i:type=\\"EntityReference\\"><Id>${SYSTEMUSER_ID}</Id><LogicalName>systemuser</LogicalName></d2p1:value></KeyValuePairOfstringanyType></Attributes><Id>${WRITTEN_RECORD_ID}</Id><LogicalName>wmkf_potentialreviewers</LogicalName></Entity>","@Microsoft.PowerApps.CDS.ErrorDetails.DuplicateAttributes":"<DuplicateAttributes><wmkf_emailaddress>${DUP_EMAIL}</wmkf_emailaddress></DuplicateAttributes>"}}`;

const err412 = (message) => ({ status: 412, message });

describe('translateDuplicateKeyError — real Dataverse 412 shape', () => {
  test('parses the duplicate field + value from DuplicateAttributes', () => {
    const out = translateDuplicateKeyError(err412(REAL_412_BODY));
    expect(out).not.toBeNull();
    expect(out.error).toBe('duplicate_key');
    expect(out.field).toBe('wmkf_emailaddress');
    expect(out.value).toBe(DUP_EMAIL);
    expect(out.message).toMatch(/already has wmkf_emailaddress = "dup@example\.invalid"/);
  });

  test('does NOT return a conflictingRecordId (the 412 does not carry the owner)', () => {
    const out = translateDuplicateKeyError(err412(REAL_412_BODY));
    // Regression guard: the old parser returned the first <Id> (the modifiedby
    // systemuser). The new parser must not surface ANY record id.
    expect(out.conflictingRecordId).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain(SYSTEMUSER_ID);
    expect(JSON.stringify(out)).not.toContain(WRITTEN_RECORD_ID);
  });

  test('returns null for a non-412 error', () => {
    expect(translateDuplicateKeyError({ status: 500, message: 'boom' })).toBeNull();
    expect(translateDuplicateKeyError(null)).toBeNull();
  });

  test('returns null for a 412 that is not an alternate-key violation', () => {
    expect(translateDuplicateKeyError(err412('dataverse failed (412): concurrency mismatch'))).toBeNull();
  });

  test('falls back to a generic message when DuplicateAttributes is absent', () => {
    const out = translateDuplicateKeyError(err412('dataverse failed (412): {"error":{"code":"0x80060892","message":"Entity Key violated"}}'));
    expect(out).not.toBeNull();
    expect(out.field).toBeNull();
    expect(out.value).toBeNull();
    expect(out.message).toMatch(/alternate-key constraint/);
  });
});
