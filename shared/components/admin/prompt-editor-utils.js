/** Shared presentation and request identity helpers for the two prompt admin editors. */
export const TONE = {
  green: 'bg-green-50 text-green-800 border-green-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  red:   'bg-red-50   text-red-800   border-red-200',
  gray:  'bg-gray-50  text-gray-800  border-gray-200',
};
export function newRequestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
}

// Short timestamp; '—' when absent. Guards an unparseable value.
export function fmtTs(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export const fmtInt = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US') : '—');

export const ROW_DEFAULT_MAX_TOKENS = 16384; // BASE_CONFIG.MODEL_PARAMS.DEFAULT_MAX_TOKENS, applied by execute-prompt.js
