/** @jest-environment node */

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn() }));
jest.mock('../../lib/services/service-http-error', () => ({ ServiceHttpError: class ServiceHttpError {} }));
jest.mock('../../lib/services/reviewer-finder/save-candidates-service', () => ({ saveCandidates: jest.fn() }));

import { config } from '../../pages/api/reviewer-finder/save-candidates';

test('save-candidates reserves the long reviewer-operation platform wall', () => {
  expect(config).toEqual({ maxDuration: 800 });
});
