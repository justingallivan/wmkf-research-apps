export function Spinner() {
  return <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />;
}

// A Pill renders as a button when `onClick` is supplied, so a warning that has
// a remedy on the card is itself the way to reach it (the remedy links sit low
// in the card and read as decoration). Without onClick it stays a plain span —
// callers pass null when the remedy is unavailable (read-only, unresolved
// identity, missing conflict record), so a pill never offers a dead action.
export function Pill({ children, tone = 'gray', onClick = null, title }) {
  const tones = {
    gray: 'bg-gray-100 text-gray-700',
    red: 'bg-red-100 text-red-700',
    amber: 'bg-amber-100 text-amber-800',
    blue: 'bg-blue-100 text-blue-700',
    purple: 'bg-purple-100 text-purple-700',
    green: 'bg-green-100 text-green-700',
  };
  const base = `inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${tones[tone] || tones.gray}`;
  if (!onClick) return <span className={base} title={title}>{children}</span>;
  return (
    <button type="button" onClick={onClick} title={title} className={`${base} underline underline-offset-2 hover:brightness-95 cursor-pointer`}>
      {children}
    </button>
  );
}

export function IdentityDecision({ value }) {
  const tone = value === 'bind'
    ? 'bg-green-100 text-green-800'
    : value === 'review'
      ? 'bg-amber-100 text-amber-800'
      : 'bg-gray-100 text-gray-700';
  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium capitalize ${tone}`}>
      {value || 'unknown'}
    </span>
  );
}
