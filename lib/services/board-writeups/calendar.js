/** Board dates come from the cycle calendar, never from the stored setup (D47).
 * `boardEnds` is the calendar Board Meeting Date (the decision day, the meeting's
 * last day); `materialsDue` is its Board Mailing Date. Blank is null; a failed read
 * throws `board_calendar_unavailable`, never a guessed date.
 */
import { getBoardSetupDatesByCode } from '../../dataverse/adapters/operations-grant-cycle.js';
import { CYCLE_CALENDAR_BOARD_DATE, CYCLE_CALENDAR_MEANINGS, dateOnly } from '../../../shared/config/cycleCalendar.js';
import { cycleCode, fail } from './model.js';
export const BOARD_CALENDAR_TIMEOUT_MS = 8000;
export const BOARD_DATE_LABELS = Object.freeze({ boardEnds: CYCLE_CALENDAR_BOARD_DATE.label, materialsDue: 'Board Mailing Date' });
export async function cycleDates(cycle, { read = getBoardSetupDatesByCode, timeoutMs = BOARD_CALENDAR_TIMEOUT_MS } = {}) {
  let row;
  try { row = await read(cycleCode(cycle), { timeoutMs }); }
  catch (error) {
    if (error?.code === 'board_cycle_invalid') throw error;
    fail('board_calendar_unavailable', 'The cycle calendar could not be read. Try again shortly.', 503);
  }
  return { boardEnds: dateOnly(row?.[CYCLE_CALENDAR_BOARD_DATE.column]), materialsDue: dateOnly(row?.[CYCLE_CALENDAR_MEANINGS.boardMailing]) };
}
/** Dashboard and setup views: an unreadable calendar is reported, never shown as "Not set". */
export async function cycleDatesOrError(cycle, d) {
  try { return { ...(await d.cycleDates(cycle)), unavailable: false }; }
  catch (error) {
    if (error?.code !== 'board_calendar_unavailable') throw error;
    return { boardEnds: null, materialsDue: null, unavailable: true };
  }
}
