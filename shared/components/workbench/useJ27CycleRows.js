/**
 * Loads the request list feed once for the J27 Research cycle page. The shell
 * owns one copy of the rows for the current program, cycle and scope; All
 * requests, the phase lists and the tab counts are filters over it
 * (docs/plans/J27_CYCLE_PAGE_BUILD_PLAN_2026-11-09.md, section 2).
 *
 * Same guards as the Request list panel: a newer request supersedes an older
 * one, a response for another program/cycle/scope is refused, and a failed
 * refresh keeps the rows already shown unless access was denied.
 *
 * Data: GET /api/workbench/dashboard?cycleCode=…&scope=…&programId=…
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { requestEnvelope } from '../../utils/api-request';

const keyOf = (programId, cycleCode, scope) => JSON.stringify([String(programId || '').toLowerCase(), cycleCode || '', scope || '']);

export function useJ27CycleRows({ enabled, programId, cycleCode, scope }) {
  const [state, setState] = useState({ key: null, rows: [], error: null, errorKey: null });
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);
  const currentKey = enabled && programId && cycleCode ? keyOf(programId, cycleCode, scope) : null;

  const load = useCallback(async (program, cycle, sc) => {
    const request = ++requestRef.current;
    const loadKey = keyOf(program, cycle, sc);
    setLoading(true);
    try {
      const { ok, status, data: body } = await requestEnvelope(
        `/api/workbench/dashboard?cycleCode=${encodeURIComponent(cycle)}&scope=${sc}&programId=${encodeURIComponent(program)}`,
        { tolerantBody: true },
      );
      if (requestRef.current !== request) return;
      if (!ok) {
        const error = new Error((body && typeof body === 'object' && body.error) || `Failed to load requests (${status})`);
        error.status = status;
        throw error;
      }
      const matches = body && typeof body === 'object' && Array.isArray(body.proposals)
        && String(body.programId || '').toLowerCase() === String(program).toLowerCase()
        && String(body.cycleCode || '') === String(cycle)
        && String(body.scope || '') === String(sc);
      if (!matches) {
        const error = new Error('The request list response did not match the selected program and cycle.');
        error.clearSnapshot = true;
        throw error;
      }
      setState({ key: loadKey, rows: body.proposals, error: null, errorKey: null });
    } catch (error) {
      if (requestRef.current !== request) return;
      const clear = error.status === 401 || error.status === 403 || error.clearSnapshot === true;
      setState((previous) => ({
        key: clear ? loadKey : previous.key,
        rows: clear ? [] : previous.rows,
        error: error.message,
        errorKey: loadKey,
      }));
    } finally {
      if (requestRef.current === request) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!currentKey) {
      requestRef.current += 1;
      setLoading(false);
      return undefined;
    }
    void load(programId, cycleCode, scope);
    return () => { requestRef.current += 1; };
  }, [currentKey, load, programId, cycleCode, scope]);

  const hasSnapshot = currentKey !== null && state.key === currentKey;
  const reload = useCallback(() => {
    if (enabled && programId && cycleCode) void load(programId, cycleCode, scope);
  }, [enabled, load, programId, cycleCode, scope]);

  return {
    rows: hasSnapshot ? state.rows : [],
    hasSnapshot,
    loading: currentKey !== null && loading,
    error: currentKey !== null && state.errorKey === currentKey ? state.error : null,
    reload,
  };
}

export default useJ27CycleRows;
