import {
  POST_PRESENTATION_MATERIALS_ACCESS_FLAG,
  POST_PRESENTATION_MATERIALS_SCHEMA_READY_FLAG,
  isPostPresentationMaterialsRequestAllowed,
  isPostPresentationMaterialsSchemaReady,
  postPresentationMaterialsAccess,
} from '../../lib/utils/post-presentation-materials-readiness.js';
import {
  POST_PRESENTATION_SELECT_FIELDS,
  requestDocumentSelect,
} from '../../lib/dataverse/adapters/request-document.js';

const REQUEST_ID = '4bfb6e40-678f-f111-8076-7ced8d3d15a6';

test('only literal on enables post-presentation Dataverse fields', () => {
  for (const value of [undefined, '', 'off', 'true', 'ON', 'invalid']) {
    expect(isPostPresentationMaterialsSchemaReady({
      ...(value === undefined ? {} : { [POST_PRESENTATION_MATERIALS_SCHEMA_READY_FLAG]: value }),
    })).toBe(false);
  }
  expect(isPostPresentationMaterialsSchemaReady({
    [POST_PRESENTATION_MATERIALS_SCHEMA_READY_FLAG]: 'on',
  })).toBe(true);
});

test('base Request Document projection stays compatible until readiness is explicit', () => {
  const base = requestDocumentSelect({ includePostPresentation: false }).split(',');
  const ready = requestDocumentSelect({ includePostPresentation: true }).split(',');
  for (const field of POST_PRESENTATION_SELECT_FIELDS) {
    expect(base).not.toContain(field);
    expect(ready).toContain(field);
  }
});

test('access accepts only off, on, or one exact test GUID', () => {
  for (const value of [undefined, '', 'off']) {
    expect(postPresentationMaterialsAccess({
      ...(value === undefined ? {} : { [POST_PRESENTATION_MATERIALS_ACCESS_FLAG]: value }),
    })).toEqual({ mode: 'off', requestId: null, valid: true });
  }
  expect(postPresentationMaterialsAccess({
    [POST_PRESENTATION_MATERIALS_ACCESS_FLAG]: 'on',
  })).toEqual({ mode: 'on', requestId: null, valid: true });
  expect(postPresentationMaterialsAccess({
    [POST_PRESENTATION_MATERIALS_ACCESS_FLAG]: `test:${REQUEST_ID.toUpperCase()}`,
  })).toEqual({ mode: 'test', requestId: REQUEST_ID, valid: true });

  for (const value of ['true', 'test:', 'test:not-a-guid', ` test:${REQUEST_ID}`, `test:${REQUEST_ID} `]) {
    expect(postPresentationMaterialsAccess({
      [POST_PRESENTATION_MATERIALS_ACCESS_FLAG]: value,
    })).toEqual({ mode: 'off', requestId: null, valid: false });
  }
});

test('test access compares only the trusted normalized request GUID', () => {
  const env = { [POST_PRESENTATION_MATERIALS_ACCESS_FLAG]: `test:${REQUEST_ID}` };
  expect(isPostPresentationMaterialsRequestAllowed(REQUEST_ID.toUpperCase(), env)).toBe(true);
  expect(isPostPresentationMaterialsRequestAllowed('11111111-1111-4111-8111-111111111111', env)).toBe(false);
  expect(isPostPresentationMaterialsRequestAllowed('not-a-guid', env)).toBe(false);
  expect(isPostPresentationMaterialsRequestAllowed(REQUEST_ID, {
    [POST_PRESENTATION_MATERIALS_ACCESS_FLAG]: 'invalid',
  })).toBe(false);
});
