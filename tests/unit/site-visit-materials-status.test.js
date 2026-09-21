import { classifySiteVisitMaterialsStatus, MATERIALS_STATUS } from '../../shared/utils/site-visit-materials-status';

const summary = (overrides = {}) => ({
  state: 'missing', receivedCount: 1, requiredCount: 3, otherCount: 0,
  dueAt: null, closesAt: null, overdue: false, invited: true, ...overrides,
});

describe('classifySiteVisitMaterialsStatus', () => {
  test.each([
    [null, { hasSiteVisit: false }, MATERIALS_STATUS.NO_VISIT],
    [null, { hasSiteVisit: true }, MATERIALS_STATUS.NOT_REQUESTED],
    [summary({ invited: false }), {}, MATERIALS_STATUS.NOT_REQUESTED],
    [summary(), {}, MATERIALS_STATUS.WAITING],
    [summary({ overdue: true }), {}, MATERIALS_STATUS.LATE],
    [summary({ state: 'received', receivedCount: 3 }), {}, MATERIALS_STATUS.CHECK_FILES],
    [summary({ state: 'ready', receivedCount: 3 }), {}, MATERIALS_STATUS.READY],
    [summary({ state: 'closed' }), {}, MATERIALS_STATUS.CLOSED],
    [summary(), { availability: 'unavailable' }, MATERIALS_STATUS.UNAVAILABLE],
    [{ state: 'wat', invited: true, overdue: false, receivedCount: 0, requiredCount: 0 }, {}, MATERIALS_STATUS.UNAVAILABLE],
  ])('classifies the complete row state', (value, options, expected) => {
    expect(classifySiteVisitMaterialsStatus(value, options).key).toBe(expected);
  });

  test('does not treat a collection as no visit', () => {
    expect(classifySiteVisitMaterialsStatus(summary({ state: 'ready' }), { hasSiteVisit: false }).key).toBe(MATERIALS_STATUS.READY);
  });
});
