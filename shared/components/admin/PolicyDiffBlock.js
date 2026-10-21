export default function DiffBlock({ existing, submitted, fieldsMatch }) {
  const mark = (matches) => (matches === undefined ? '' : matches ? ' ✓' : ' ✗ differs');
  return (
    <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
      <div>
        <div className="font-semibold mb-1">Existing</div>
        <div>Label: {existing.versionLabel}</div>
        <div>Title{mark(fieldsMatch?.title)}: {existing.title}</div>
        <div>Effective{mark(fieldsMatch?.effectiveDate)}: {existing.effectiveDate}</div>
        <div>Body{mark(fieldsMatch?.body)} ({existing.bodyLength ?? '?'} chars):</div>
        <div className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-xs">
          {existing.bodyExcerpt}
        </div>
      </div>
      <div>
        <div className="font-semibold mb-1">Submitted</div>
        <div>Label: {submitted.versionLabel}</div>
        <div>Title{mark(fieldsMatch?.title)}: {submitted.title}</div>
        <div>Effective{mark(fieldsMatch?.effectiveDate)}: {submitted.effectiveDate}</div>
        <div>Body{mark(fieldsMatch?.body)} ({submitted.bodyLength ?? '?'} chars):</div>
        <div className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-xs">
          {submitted.bodyExcerpt}
        </div>
      </div>
    </div>
  );
}
