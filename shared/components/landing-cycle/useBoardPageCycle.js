import { conventionalCycles, resolveWorkingCycle } from '../../../lib/utils/cycle-code';
import { useLandingCycleDefault } from './useLandingCycleDefault';

/**
 * Cycle for the Board writeups / Board cycle setup pages: a valid `?cycle=` wins;
 * otherwise the server's Board default (the landing cycle when it has a Board
 * setup, else the nearest upcoming set-up Board date by the Pacific day;
 * docs/plans/LANDING_CYCLE_PLAN_2026-10-29.md). If that read fails or times out,
 * the conventional date rule. Returns null until the router and the read settle.
 */
export function useBoardPageCycle(router) {
  const urlCycle = typeof router.query.cycle === 'string' && /^[JD]\d{2}$/.test(router.query.cycle) ? router.query.cycle : null;
  const landing = useLandingCycleDefault({ view: 'board', skip: !router.isReady || Boolean(urlCycle) });
  if (!router.isReady) return null;
  if (urlCycle) return urlCycle;
  if (!landing.settled) return null;
  return landing.code || resolveWorkingCycle(conventionalCycles());
}
