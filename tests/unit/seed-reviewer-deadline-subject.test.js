/** @jest-environment node */
import { seedDeadlineSubject } from '../../scripts/seed-reviewer-deadline-subject.mjs';
const SUBJECT = 'email.reviewer_extension.subject';
const BODY = 'email.reviewer_extension.body';
const seed = 'Updated review deadline: {{proposalTitle}}';
function fixture(subject = null, body = '') {
  const state = { [SUBJECT]: { found: subject !== null, value: subject }, [BODY]: { found: true, value: body } };
  const read = jest.fn(async (key) => ({ ...state[key] }));
  const create = jest.fn(async (key, value) => { if (state[key].found) throw new Error('exists'); state[key] = { found: true, value }; });
  return { state, read, create };
}
test('dry-run reports only missing subject, never writes', async () => { const f = fixture(); expect(await seedDeadlineSubject(f)).toMatchObject({ action: 'would-create-subject', valid: true }); expect(f.create).not.toHaveBeenCalled(); });
test.each(['', '   ', null])('creates only subject, preserves present %p body and validates readback', async (body) => {
  const f = fixture(null, body); expect(await seedDeadlineSubject({ ...f, execute: true })).toMatchObject({ action: 'created-subject', bodyUnchanged: true }); expect(f.create).toHaveBeenCalledTimes(1); expect(f.create).toHaveBeenCalledWith(SUBJECT, seed, null); expect(f.state[BODY].value).toBe(body);
});
test('existing customized subject never overwritten on repeat', async () => { const f = fixture('Custom subject'); expect(await seedDeadlineSubject({ ...f, execute: true })).toMatchObject({ action: 'preserved-existing' }); expect(f.create).not.toHaveBeenCalled(); });
test('invalid/missing configuration fails before any create', async () => {
  const f = fixture(''); await expect(seedDeadlineSubject({ ...f, execute: true })).rejects.toThrow(); expect(f.create).not.toHaveBeenCalled();
  f.state[BODY].found = false; await expect(seedDeadlineSubject({ ...f, execute: true })).rejects.toThrow(); expect(f.create).not.toHaveBeenCalled();
});
test('readback detects concurrent body change and never writes body to repair it', async () => {
  const f = fixture(); f.create.mockImplementation(async (key, value) => { f.state[key] = { found: true, value }; f.state[BODY].value = 'Changed by another writer'; });
  await expect(seedDeadlineSubject({ ...f, execute: true })).rejects.toThrow('Readback differs'); expect(f.create).toHaveBeenCalledTimes(1);
});
