/** Display only. Sender provenance and recipient permissions belong to each service. */
export default function EmailAddressSummary({ from, to, cc = [] }) {
  const text = (value) => Array.isArray(value) ? value.filter(Boolean).join(', ') : value;
  return <dl className="space-y-1 break-words text-sm text-gray-700" aria-label="Email addressing">
    <div><dt className="inline font-medium">From: </dt><dd className="inline">{text(from) || 'Unavailable — reload before sending'}</dd></div>
    <div><dt className="inline font-medium">To: </dt><dd className="inline">{text(to) || 'None'}</dd></div>
    <div><dt className="inline font-medium">Cc: </dt><dd className="inline">{text(cc) || 'None'}</dd></div>
  </dl>;
}
