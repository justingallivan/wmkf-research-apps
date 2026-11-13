import { captureSummaryBaseline, prepareSummaryStaffEdit } from '../../lib/services/prompt-jobs/summary-edit-protection';

// Synthetic atomic row store only. No Dataverse mapping, auth or admission claim.
function record(text = null, staffEdited = false) {
  let row = { text, staffEdited, version: 'W/"1"' };
  let revision = 1;
  const patch = jest.fn(command => {
    if (command.ifMatch !== row.version) return { status: 412 };
    row = { ...row, ...command.patch, version: `W/"${++revision}"` };
    return { status: 204 };
  });
  return { read: () => ({ ...row }), patch };
}
const staffSave = (store, text) => store.patch(prepareSummaryStaffEdit({ text, version: store.read().version }));
const publish = (store, baseline) => store.patch({ ...baseline, patch: { text: 'Generated Summary' } });

test.each([null, '', 'Staff text', '   '])('explicit save of %p marks intent atomically', text => {
  const store = record(text);
  expect(staffSave(store, text).status).toBe(204);
  expect(store.read()).toEqual({ text: text === '' ? null : text, staffEdited: true, version: 'W/"2"' });
  expect(captureSummaryBaseline(store.read())).toBeNull();
  expect(store.patch).toHaveBeenCalledTimes(1);
});

test('edit then clear before capture remains protected', () => {
  const store = record();
  staffSave(store, 'Draft');
  staffSave(store, '');
  expect(store.read().text).toBeNull();
  expect(captureSummaryBaseline(store.read())).toBeNull();
});

test.each(['Draft', ''])('staff save after capture blocks original machine write: %p', text => {
  const store = record();
  const baseline = captureSummaryBaseline(store.read());
  staffSave(store, text);
  const saved = store.read();
  expect(publish(store, baseline).status).toBe(412);
  expect(store.read()).toEqual(saved);
  expect(store.patch).toHaveBeenCalledTimes(2);
});

test('edit and clear after capture cannot restore the old row version', () => {
  const store = record();
  const baseline = captureSummaryBaseline(store.read());
  staffSave(store, 'Draft');
  staffSave(store, null);
  expect(publish(store, baseline).status).toBe(412);
  expect(store.read().staffEdited).toBe(true);
});

test('machine wins first: stale staff command changes neither text nor marker', () => {
  const store = record();
  const command = prepareSummaryStaffEdit({ text: '', version: store.read().version });
  expect(publish(store, captureSummaryBaseline(store.read())).status).toBe(204);
  const generated = store.read();
  expect(store.patch(command).status).toBe(412);
  expect(store.read()).toEqual(generated);
  expect(staffSave(store, '').status).toBe(204);
  expect(store.read().staffEdited).toBe(true);
});

test('reads and omitted edit commands do not mark; captured version is immutable', () => {
  const store = record();
  const observed = store.read();
  const baseline = captureSummaryBaseline(observed);
  observed.version = 'W/"99"';
  expect(baseline).toEqual({ ifMatch: 'W/"1"' });
  expect(Object.isFrozen(baseline)).toBe(true);
  expect(store.read().staffEdited).toBe(false);
  expect(store.patch).not.toHaveBeenCalled();
});

test.each([undefined, null, true, 0, 'false', {}, []])('marker %p fails closed', staffEdited => {
  expect(captureSummaryBaseline({ text: null, staffEdited, version: 'W/"1"' })).toBeNull();
});
test.each([undefined, ' ', 'Existing', 0, false])('nonblank or malformed text %p fails closed', text => {
  expect(captureSummaryBaseline({ text, staffEdited: false, version: 'W/"1"' })).toBeNull();
});
test.each([undefined, '', '*', 'W/""', ' W/"1"'])('invalid version %p rejected by both guards', version => {
  expect(captureSummaryBaseline({ text: null, staffEdited: false, version })).toBeNull();
  expect(() => prepareSummaryStaffEdit({ text: '', version })).toThrow('invalid_summary_staff_edit');
});
test.each([undefined, 1, {}, 'x'.repeat(100001)])('invalid staff text rejected (%#)', text => {
  expect(() => prepareSummaryStaffEdit({ text, version: 'W/"1"' })).toThrow('invalid_summary_staff_edit');
});
test('commands copy and freeze intent before any future asynchronous adapter work', () => {
  const input = { text: 'Draft', version: 'W/"1"' };
  const command = prepareSummaryStaffEdit(input);
  input.text = 'Changed';
  input.version = 'W/"9"';
  expect(command).toEqual({ ifMatch: 'W/"1"', patch: { text: 'Draft', staffEdited: true } });
  expect(Object.isFrozen(command)).toBe(true);
  expect(Object.isFrozen(command.patch)).toBe(true);
});
