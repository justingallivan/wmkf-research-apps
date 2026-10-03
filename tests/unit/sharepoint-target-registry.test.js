import {
  classifySharePointSite,
  configuredSharePointTargetInfo,
  SHAREPOINT_CANONICAL_SITE_URL,
} from '../../lib/services/sharepoint-target-registry.js';

test('classifies only the exact registered shared akoyaGO site', () => {
  expect(classifySharePointSite(SHAREPOINT_CANONICAL_SITE_URL)).toMatchObject({
    key: 'akoyago-shared',
    scope: 'shared',
    registered: true,
    hostname: 'appriver3651007194.sharepoint.com',
    pathname: '/sites/akoyago',
  });
  expect(classifySharePointSite(`${SHAREPOINT_CANONICAL_SITE_URL}/`)).toMatchObject({ registered: true });
});

test.each([
  'https://appriver3651007194.sharepoint.com/sites/unreviewed',
  'http://appriver3651007194.sharepoint.com/sites/akoyaGO',
  'https://appriver3651007194.sharepoint.com/sites/akoyaGO?redirect=1',
  'not-a-url',
])('fails closed for an unregistered SharePoint target: %s', (siteUrl) => {
  expect(classifySharePointSite(siteUrl)).toMatchObject({ registered: false, scope: 'unknown' });
});

test('uses the canonical site only when no override is configured', () => {
  expect(configuredSharePointTargetInfo({})).toMatchObject({ registered: true, key: 'akoyago-shared' });
  expect(configuredSharePointTargetInfo({ SHAREPOINT_SITE_URL: 'https://appriver3651007194.sharepoint.com/sites/other' }))
    .toMatchObject({ registered: false });
});
