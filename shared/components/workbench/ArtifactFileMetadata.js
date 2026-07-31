function formatTimestamp(value) {
  if (!value) return null;
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return null;
  return timestamp.toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function snapshotDetails(file) {
  const details = [];
  if (file.versionId) details.push(`version ${file.versionId}`);
  const modified = formatTimestamp(file.lastModified);
  if (modified) details.push(`modified ${modified}`);
  return details.join(' · ');
}

export default function ArtifactFileMetadata({ file, linkLabel = null }) {
  if (!file) return null;

  const details = snapshotDetails(file);
  const canOpen = Boolean(linkLabel && file.webUrl && file.metadataStatus !== 'missing');
  const renderedLinkLabel = file.metadataStatus === 'current'
    ? linkLabel
    : `${linkLabel} (recorded link)`;

  const link = canOpen ? (
    <a
      href={file.webUrl}
      target="_blank"
      rel="noreferrer"
      className="inline-block mt-3 text-blue-700 hover:underline"
    >
      {renderedLinkLabel}
    </a>
  ) : null;

  if (file.metadataStatus === 'current') {
    return (
      <>
        {link}
        <p className="mt-2 text-xs text-emerald-700">
          Current in SharePoint{details ? ` · ${details}` : ''}
        </p>
      </>
    );
  }

  if (file.metadataStatus === 'missing') {
    return (
      <>
        {link}
        <p className="mt-2 text-xs text-amber-800">
          The registered SharePoint file could not be found.
          {details ? ` Registry snapshot: ${details}.` : ''}
        </p>
      </>
    );
  }

  if (file.metadataStatus === 'unavailable') {
    return (
      <>
        {link}
        <p className="mt-2 text-xs text-amber-800">
          Current SharePoint metadata is unavailable.
          {details ? ` Registry snapshot: ${details}.` : ''}
        </p>
      </>
    );
  }

  return (
    <>
      {link}
      <p className="mt-2 text-xs text-gray-500">
        Current SharePoint metadata has not been checked.
        {details ? ` Registry snapshot: ${details}.` : ''}
      </p>
    </>
  );
}
