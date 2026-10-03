import {
  acquireLargeUploadAdmission,
  releaseLargeUploadAdmission,
} from '../../lib/services/large-upload-admission.js';

afterEach(() => {
  const lease = acquireLargeUploadAdmission(Date.now() + 7 * 60 * 1000);
  if (lease) releaseLargeUploadAdmission(lease.token);
});

test('one holder is admitted and only its token can release the process slot', () => {
  const first = acquireLargeUploadAdmission(1_000);
  expect(first).toMatchObject({ acquiredAt: 1_000 });
  expect(acquireLargeUploadAdmission(2_000)).toBeNull();
  expect(releaseLargeUploadAdmission('other-holder')).toBe(false);
  expect(acquireLargeUploadAdmission(2_001)).toBeNull();
  expect(releaseLargeUploadAdmission(first.token)).toBe(true);
  expect(acquireLargeUploadAdmission(2_002)).toMatchObject({ acquiredAt: 2_002 });
});

test('a holder older than the function limit plus margin can be reclaimed', () => {
  const first = acquireLargeUploadAdmission(10_000);
  const recovered = acquireLargeUploadAdmission(10_000 + 6 * 60 * 1000);
  expect(recovered).toMatchObject({ acquiredAt: 10_000 + 6 * 60 * 1000 });
  expect(recovered.token).not.toBe(first.token);
  expect(releaseLargeUploadAdmission(first.token)).toBe(false);
  expect(acquireLargeUploadAdmission(10_000 + 6 * 60 * 1000 + 1)).toBeNull();
  expect(releaseLargeUploadAdmission(recovered.token)).toBe(true);
});
