/** Pure validate + diff + changeset builder for the staff review-question editor. */
import { validateSubmittedSet, buildChangeset, missingParentBoundKeys, PARENT_BOUND_KEYS, MAX_QUESTIONS, ENTITY_SET, INACTIVE_STATE } from '../../lib/admin/review-question-save';

const richField = (key, over = {}) => ({ key, label: `Label ${key}`, type: 'richtext', required: true, ...over });
const pickField = (key, over = {}) => ({
  key, label: `Rate ${key}`, type: 'picklist', required: true,
  options: [{ value: 1, label: 'Low' }, { value: 2, label: 'High' }], ...over,
});
// A "current" row as readActiveSetWithIds would produce it (normalized + id).
const current = (id, key, order, over = {}) => ({ id, key, order, label: `Label ${key}`, type: 'richtext', required: true, ...over });

describe('validateSubmittedSet', () => {
  it('rejects an empty set', () => {
    expect(validateSubmittedSet([]).ok).toBe(false);
    expect(validateSubmittedSet(null).ok).toBe(false);
  });

  it('assigns order from list position (ignores any client order)', () => {
    const r = validateSubmittedSet([richField('a', { order: 99 }), richField('b', { order: 5 })]);
    expect(r.ok).toBe(true);
    expect(r.rows.map((x) => [x.key, x.order])).toEqual([['a', 0], ['b', 1]]);
  });

  it('rejects a bad key format and a duplicate key', () => {
    expect(validateSubmittedSet([richField('1bad')]).ok).toBe(false);
    expect(validateSubmittedSet([richField('Ok'), richField('Ok')]).ok).toBe(false);
    // camelCase allowed (the live overallRating key)
    expect(validateSubmittedSet([richField('overallRating')]).ok).toBe(true);
  });

  it('rejects missing label, bad type, non-boolean required', () => {
    expect(validateSubmittedSet([richField('a', { label: '   ' })]).ok).toBe(false);
    expect(validateSubmittedSet([richField('a', { type: 'date' })]).ok).toBe(false);
    expect(validateSubmittedSet([richField('a', { required: 'yes' })]).ok).toBe(false);
  });

  it.each(['picklist', 'multiselect'])('validates %s options (≥1, integer unique values, labelled)', (type) => {
    expect(validateSubmittedSet([pickField('r', { type, options: [] })]).ok).toBe(false);
    expect(validateSubmittedSet([pickField('r', { type, options: [{ value: 1.5, label: 'x' }] })]).ok).toBe(false);
    expect(validateSubmittedSet([pickField('r', { type, options: [{ value: 1, label: 'x' }, { value: 1, label: 'y' }] })]).ok).toBe(false);
    expect(validateSubmittedSet([pickField('r', { type, options: [{ value: 1, label: '' }] })]).ok).toBe(false);
    const ok = validateSubmittedSet([pickField('r', { type })]);
    expect(ok.ok).toBe(true);
    expect(ok.rows[0].options).toEqual([{ value: 1, label: 'Low' }, { value: 2, label: 'High' }]);
  });

  it('validates maxLength + hint bounds', () => {
    expect(validateSubmittedSet([richField('a', { maxLength: 0 })]).ok).toBe(false);
    expect(validateSubmittedSet([richField('a', { maxLength: 'abc' })]).ok).toBe(false);
    const ok = validateSubmittedSet([richField('a', { maxLength: 5000, hint: 'help' })]);
    expect(ok.rows[0]).toMatchObject({ maxLength: 5000, hint: 'help' });
  });

  it('rejects a set over the 100-row cap (Codex P1-2)', () => {
    const over = Array.from({ length: MAX_QUESTIONS + 1 }, (_, i) => richField(`q${i}`));
    const r = validateSubmittedSet(over);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/too many/i);
    // at the cap is fine
    expect(validateSubmittedSet(Array.from({ length: MAX_QUESTIONS }, (_, i) => richField(`q${i}`))).ok).toBe(true);
  });
});

describe('missingParentBoundKeys (Codex P1-3)', () => {
  it('lists affiliation and the two required core ratings that are absent', () => {
    expect(PARENT_BOUND_KEYS).toEqual(['affiliation', 'riskLevel', 'overallAssessment']);
    expect(missingParentBoundKeys([richField('priorWork')])).toEqual(PARENT_BOUND_KEYS);
    const full = PARENT_BOUND_KEYS.map((k) => ({ key: k }));
    expect(missingParentBoundKeys(full)).toEqual([]);
    expect(missingParentBoundKeys(full.filter((row) => row.key !== 'riskLevel'))).toEqual(['riskLevel']);
  });
});

describe('buildChangeset', () => {
  const v = (rows) => { const r = validateSubmittedSet(rows); if (!r.ok) throw new Error(r.errors.join('; ')); return r.rows; };

  it('emits a POST create for a new (id-less) row, with the key in the body', () => {
    const out = buildChangeset([], v([richField('q2')]));
    expect(out.ok).toBe(true);
    expect(out.operations).toHaveLength(1);
    expect(out.operations[0]).toMatchObject({ method: 'POST', entitySet: ENTITY_SET });
    expect(out.operations[0]).not.toHaveProperty('key');
    expect(out.operations[0].body.wmkf_questionkey).toBe('q2');
    // Primary name must be the LOWERCASE logical name; the schema-name casing
    // `wmkf_Name` is rejected by the Web API (0x80048d19) — caught in prod S304.
    expect(out.operations[0].body.wmkf_name).toBe('Label q2');
    expect(out.operations[0].body).not.toHaveProperty('wmkf_Name');
    expect(out.summary).toEqual({ created: 1, updated: 0, deleted: 0, reordered: 0 });
  });

  it('emits a PATCH-by-id update for an edited row, WITHOUT the key', () => {
    const cur = [current('id-1', 'q2', 0)];
    const out = buildChangeset(cur, v([{ id: 'id-1', ...richField('q2', { label: 'New text' }) }]));
    expect(out.operations).toHaveLength(1);
    expect(out.operations[0]).toMatchObject({ method: 'PATCH', entitySet: ENTITY_SET, key: 'id-1' });
    expect(out.operations[0].body.wmkf_questiontext).toBe('New text');
    expect(out.operations[0].body).not.toHaveProperty('wmkf_questionkey');
    expect(out.summary.updated).toBe(1);
  });

  it('serializes multiselect options into the same Dataverse option JSON column', () => {
    const submitted = pickField('impactAreas', {
      type: 'multiselect',
      label: 'Impact areas',
      options: [{ value: 4, label: 'Revise textbooks' }, { value: 1, label: 'Tools' }],
    });
    const out = buildChangeset([], v([submitted]));
    expect(out.operations[0].body).toMatchObject({
      wmkf_questiontype: 'multiselect',
      wmkf_options: JSON.stringify(submitted.options),
    });
  });

  it('REJECTS changing an existing row\'s key (immutability)', () => {
    const cur = [current('id-1', 'q2', 0)];
    const out = buildChangeset(cur, v([{ id: 'id-1', ...richField('q2_renamed') }]));
    expect(out.ok).toBe(false);
    expect(out.errors[0]).toMatch(/can't be changed/i);
  });

  it('REJECTS an unknown id (edited row that no longer exists)', () => {
    const out = buildChangeset([], v([{ id: 'ghost', ...richField('q2') }]));
    expect(out.ok).toBe(false);
    expect(out.errors[0]).toMatch(/no longer exists/i);
  });

  it('soft-deletes a removed row (current id not resubmitted)', () => {
    const cur = [current('id-1', 'q2', 0), current('id-2', 'q4', 1)];
    const out = buildChangeset(cur, v([{ id: 'id-1', ...richField('q2') }]));
    const del = out.operations.find((o) => o.key === 'id-2');
    expect(del).toMatchObject({ method: 'PATCH', body: INACTIVE_STATE });
    expect(out.summary.deleted).toBe(1);
  });

  it('attaches the row etag as If-Match on update + delete ops (Codex P1-1)', () => {
    const cur = [
      { ...current('id-1', 'q2', 0), etag: 'W/"11"' },
      { ...current('id-2', 'q4', 1), etag: 'W/"22"' },
    ];
    const out = buildChangeset(cur, v([{ id: 'id-1', ...richField('q2', { label: 'edited' }) }]));
    const upd = out.operations.find((o) => o.key === 'id-1' && o.body.wmkf_questiontext);
    const del = out.operations.find((o) => o.key === 'id-2' && o.body.statecode === 1);
    expect(upd.ifMatch).toBe('W/"11"');
    expect(del.ifMatch).toBe('W/"22"');
  });

  it('counts a pure reorder as reordered, not updated', () => {
    const cur = [current('id-1', 'a', 0), current('id-2', 'b', 1)];
    // Submit b first, a second → both rows change order only.
    const out = buildChangeset(cur, v([{ id: 'id-2', ...richField('b') }, { id: 'id-1', ...richField('a') }]));
    expect(out.summary).toMatchObject({ updated: 0, reordered: 2, created: 0, deleted: 0 });
    expect(out.operations).toHaveLength(2);
  });

  it('emits NO ops when nothing changed', () => {
    const cur = [current('id-1', 'q2', 0)];
    const out = buildChangeset(cur, v([{ id: 'id-1', ...richField('q2') }]));
    expect(out.ok).toBe(true);
    expect(out.operations).toHaveLength(0);
    expect(out.summary).toEqual({ created: 0, updated: 0, deleted: 0, reordered: 0 });
  });

  it('handles a mixed create + edit + delete + reorder in one changeset', () => {
    const cur = [current('id-1', 'a', 0), current('id-2', 'b', 1), current('id-3', 'c', 2)];
    const out = buildChangeset(cur, v([
      { id: 'id-2', ...richField('b', { label: 'edited b' }) }, // edit + moved to 0
      richField('d'),                                            // new
      { id: 'id-1', ...richField('a') },                         // moved to 2
      // id-3 'c' removed
    ]));
    expect(out.ok).toBe(true);
    expect(out.summary.created).toBe(1);
    expect(out.summary.deleted).toBe(1);
    // id-2 changed text AND order → counts as updated (not reordered)
    expect(out.summary.updated).toBe(1);
    // id-1 only moved → reordered
    expect(out.summary.reordered).toBe(1);
    expect(out.operations.some((o) => o.key === 'id-3' && o.body.statecode === 1)).toBe(true);
  });
});
