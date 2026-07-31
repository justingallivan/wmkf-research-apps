/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import ArtifactFileMetadata from '../../shared/components/workbench/ArtifactFileMetadata';

const snapshot = {
  versionId: '1.0',
  lastModified: '2026-07-30T18:00:00Z',
};

it('labels successful Graph readback as current SharePoint metadata', () => {
  render(<ArtifactFileMetadata file={{
    ...snapshot,
    metadataStatus: 'current',
    versionId: '2.0',
    webUrl: 'https://example.sharepoint.com/current',
  }} linkLabel="Open document →" />);

  expect(screen.getByText(/Current in SharePoint · version 2\.0 · modified/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open document →' })).toHaveAttribute(
    'href',
    'https://example.sharepoint.com/current',
  );
  expect(screen.queryByText(/Registry snapshot/)).not.toBeInTheDocument();
});

it.each([
  ['missing', 'The registered SharePoint file could not be found.'],
  ['unavailable', 'Current SharePoint metadata is unavailable.'],
])('does not present %s metadata as current', (metadataStatus, warning) => {
  render(<ArtifactFileMetadata file={{
    ...snapshot,
    metadataStatus,
    webUrl: 'https://example.sharepoint.com/recorded',
  }} linkLabel="Open document →" />);

  expect(screen.getByText(new RegExp(warning))).toBeInTheDocument();
  expect(screen.getByText(/Registry snapshot: version 1\.0 · modified/)).toBeInTheDocument();
  expect(screen.queryByText(/Current in SharePoint/)).not.toBeInTheDocument();
  if (metadataStatus === 'missing') {
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  } else {
    expect(screen.getByRole('link', { name: 'Open document → (recorded link)' }))
      .toHaveAttribute('href', 'https://example.sharepoint.com/recorded');
  }
});

it('treats absent or upload-time status as an unchecked registry snapshot', () => {
  render(<ArtifactFileMetadata file={snapshot} />);

  expect(screen.getByText(/Current SharePoint metadata has not been checked/)).toBeInTheDocument();
  expect(screen.getByText(/Registry snapshot: version 1\.0 · modified/)).toBeInTheDocument();
  expect(screen.queryByText(/Current in SharePoint/)).not.toBeInTheDocument();
});

it('does not render an invalid timestamp', () => {
  render(<ArtifactFileMetadata file={{
    metadataStatus: 'current',
    versionId: '2.0',
    lastModified: 'not-a-date',
  }} />);

  expect(screen.getByText('Current in SharePoint · version 2.0')).toBeInTheDocument();
  expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
});
