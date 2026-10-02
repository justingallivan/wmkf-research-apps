import {
  sanitizeSiteVisitMaterialsScanRejection,
  siteVisitMaterialsScanRejectionMessage,
} from '../../shared/utils/site-visit-materials-scan-rejection.js';

test('scan rejection projection accepts allowlisted evidence and keeps provider text out', () => {
  expect(sanitizeSiteVisitMaterialsScanRejection({ category: 'blocked_content', flags: ['embedded_macro'] }))
    .toEqual({ category: 'blocked_content', flags: ['embedded_macro'] });
  expect(sanitizeSiteVisitMaterialsScanRejection({ category: 'blocked_content', flags: ['embedded_macro'], virusName: 'secret' })).toBeNull();
  expect(sanitizeSiteVisitMaterialsScanRejection({ category: 'blocked_content', flags: ['provider secret'] })).toBeNull();
  expect(sanitizeSiteVisitMaterialsScanRejection({ category: 'unspecified', flags: ['embedded_macro'] })).toBeNull();
  expect(sanitizeSiteVisitMaterialsScanRejection({ category: 'signature_match', flags: [] }))
    .toEqual({ category: 'signature_match', flags: [] });
});

test('user copy distinguishes evidence categories and explains an unspecified verdict', () => {
  expect(siteVisitMaterialsScanRejectionMessage({ category: 'blocked_content', flags: ['embedded_macro'] }))
    .toMatch(/Remove the blocked content and upload a new copy/);
  expect(siteVisitMaterialsScanRejectionMessage({ category: 'unspecified', flags: [] }))
    .toMatch(/scanner did not provide a specific reason/);
  expect(siteVisitMaterialsScanRejectionMessage(null)).toMatch(/scanner did not provide a specific reason/);
  expect(siteVisitMaterialsScanRejectionMessage({ category: 'signature_match', flags: [] })).not.toMatch(/EICAR|malware|virus/i);
});
