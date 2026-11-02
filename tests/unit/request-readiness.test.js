import { isRequestReadyForStaff, withRequestReadinessSelect } from '../../shared/config/requestReadiness.js';

const row = (code, ready) => ({ wmkf_GrantCycle: { wmkf_cyclecode: code }, wmkf_readyforreview: ready });

describe('post-automation discovery prerequisite', () => {
  test.each(['J00', 'J25', 'D25', 'J26', 'D26'])('preserves %s with any readiness value', (code) => {
    for (const value of [true, false, null, undefined, 0, 1, 'true']) {
      expect(isRequestReadyForStaff(row(code, value))).toBe(true);
    }
  });
  test.each(['J27', 'D27', 'J28', 'D28', 'J99', 'D99'])('%s requires literal Boolean true', (code) => {
    expect(isRequestReadyForStaff(row(code, true))).toBe(true);
    for (const value of [false, null, undefined, 0, 1, 'true', 'Yes', {}]) {
      expect(isRequestReadyForStaff(row(code, value))).toBe(false);
    }
  });
  test.each([null, undefined, '', 'R26', 'J2026', 'j26', ' D26 '])('does not exempt unclassifiable linked code %s', (code) => {
    expect(isRequestReadyForStaff(row(code, true))).toBe(false);
    expect(isRequestReadyForStaff(row(code, false))).toBe(false);
  });
  test('does not infer an era from request dates, status, triage, or test markers', () => {
    for (const code of [undefined, 'J27', 'D27']) {
      const record = { ...row(code, false), akoya_requeststatus: 'Phase II Pending', wmkf_triagestatus: 100000000, wmkf_istestrequest: true, wmkf_meetingdate: '2026-12-01', createdon: '2020-01-01' };
      expect(isRequestReadyForStaff(record)).toBe(false);
    }
  });
  test('adds the raw readiness field exactly once', () => {
    expect(withRequestReadinessSelect('akoya_requestid')).toBe('akoya_requestid,wmkf_readyforreview');
    expect(withRequestReadinessSelect('akoya_requestid,wmkf_readyforreview')).toBe('akoya_requestid,wmkf_readyforreview');
  });
});
