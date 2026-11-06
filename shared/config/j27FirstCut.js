export const FIRST_CUT_STATUS = Object.freeze({ yes: 100000004, no: 100000005 });

export function isFirstCutEditable(status) {
  return status === null || status === 100000000
    || status === FIRST_CUT_STATUS.yes || status === FIRST_CUT_STATUS.no;
}

export const SEMI_FINALIST_STATUS = Object.freeze({ yes: 707510005, no: 707510006 });

export function isSemiFinalistEditable(status) {
  return status === FIRST_CUT_STATUS.yes
    || status === SEMI_FINALIST_STATUS.yes || status === SEMI_FINALIST_STATUS.no;
}
