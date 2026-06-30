/**
 * @jest-environment node
 *
 * capture-self-reported-reviewer-identity — writes the reviewer's self-reported
 * board-writeup identity (rank/department/institution) onto the person at accept.
 */

import { captureSelfReportedReviewerIdentity } from '../../lib/services/capture-self-reported-reviewer-identity';

const PID = '11111111-1111-1111-1111-111111111111';

function fakeReviewers() {
  return { update: jest.fn(async () => undefined) };
}

describe('captureSelfReportedReviewerIdentity', () => {
  it('writes the three trimmed fields to the person via the adapter', async () => {
    const reviewers = fakeReviewers();
    const out = await captureSelfReportedReviewerIdentity(
      { potentialReviewerId: PID, academicRank: ' Professor ', primaryDepartment: 'Chemistry', mainInstitution: 'MIT', actingUserSystemId: 'u1' },
      { reviewers },
    );
    expect(reviewers.update).toHaveBeenCalledWith(
      PID,
      { academicRank: 'Professor', primaryDepartment: 'Chemistry', mainInstitution: 'MIT' },
      { actingUserSystemId: 'u1' },
    );
    expect(out).toEqual({ persisted: true, fields: ['academicRank', 'primaryDepartment', 'mainInstitution'] });
  });

  it('writes only the supplied non-empty fields', async () => {
    const reviewers = fakeReviewers();
    await captureSelfReportedReviewerIdentity(
      { potentialReviewerId: PID, academicRank: 'Investigator', primaryDepartment: '  ', mainInstitution: '' },
      { reviewers },
    );
    expect(reviewers.update).toHaveBeenCalledWith(PID, { academicRank: 'Investigator' }, { actingUserSystemId: undefined });
  });

  it('skips when there is no person id', async () => {
    const reviewers = fakeReviewers();
    const out = await captureSelfReportedReviewerIdentity({ academicRank: 'Professor' }, { reviewers });
    expect(out).toEqual({ skipped: 'no_person' });
    expect(reviewers.update).not.toHaveBeenCalled();
  });

  it('skips (no write) when nothing usable was supplied', async () => {
    const reviewers = fakeReviewers();
    const out = await captureSelfReportedReviewerIdentity({ potentialReviewerId: PID, academicRank: '   ' }, { reviewers });
    expect(out).toEqual({ skipped: 'nothing_to_write' });
    expect(reviewers.update).not.toHaveBeenCalled();
  });
});
