/** @jest-environment jsdom */
import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react';
import RetiredPage from '../../pages/expertise-finder';
import { APP_REGISTRY, APP_LIFECYCLE_REGISTRY } from '../../shared/config/appRegistry';

jest.mock('../../shared/components/Layout', () => function MockLayout({ children }) { return <div>{children}</div>; });

test('old bookmarks explain retirement and point to the independent Admin roster', () => {
  render(<RetiredPage />);
  expect(screen.getByRole('heading', { name: 'Expertise Finder has been retired' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open Admin roster' })).toHaveAttribute('href', '/admin?workspace=people&view=expertise-roster');
});

test('retired grants cannot expose standalone matching or history handlers', () => {
  expect(APP_REGISTRY.some(app => app.key === 'expertise-finder')).toBe(false);
  expect(APP_LIFECYCLE_REGISTRY['expertise-finder'].status).toBe('deprecated');
  for (const route of ['match', 'batch-match', 'history', 'roster', 'proposals', 'contact-search']) {
    expect(fs.existsSync(path.join(process.cwd(), 'pages/api/expertise-finder', `${route}.js`))).toBe(false);
  }
  expect(fs.existsSync(path.join(process.cwd(), 'pages/api/admin/expertise-roster.js'))).toBe(true);
});
