export default function TestRequestBadge({ isTestRequest, className = '' }) {
  if (isTestRequest !== true) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-bold tracking-wide text-amber-900 ${className}`.trim()}
      aria-label="Test request"
    >
      TEST
    </span>
  );
}
