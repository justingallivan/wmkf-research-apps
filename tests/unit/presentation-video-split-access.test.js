import {
  PRESENTATION_VIDEO_SPLIT_ACCESS_FLAG,
  isPresentationVideoSplitRequestAllowed,
  presentationVideoSplitAccess,
} from '../../lib/utils/presentation-video-split-access.js';

const REQUEST_ID = '4bfb6e40-678f-f111-8076-7ced8d3d15a6';
const OTHER_ID = '5bfb6e40-678f-f111-8076-7ced8d3d15a6';
const env = value => (value === undefined ? {} : { [PRESENTATION_VIDEO_SPLIT_ACCESS_FLAG]: value });

test('access accepts only off, on, or one exact lowercase test: GUID', () => {
  for (const value of [undefined, '', 'off']) {
    expect(presentationVideoSplitAccess(env(value))).toEqual({ mode: 'off', requestId: null, valid: true });
  }
  expect(presentationVideoSplitAccess(env('on'))).toEqual({ mode: 'on', requestId: null, valid: true });
  expect(presentationVideoSplitAccess(env(`test:${REQUEST_ID.toUpperCase()}`)))
    .toEqual({ mode: 'test', requestId: REQUEST_ID, valid: true });
  for (const value of [
    'true', 'ON', 'Off', 'test:', 'test:not-a-guid', `TEST:${REQUEST_ID}`, `Test:${REQUEST_ID}`,
    ` test:${REQUEST_ID}`, `test:${REQUEST_ID} `, `test: ${REQUEST_ID}`, ' on', 'on ', 5,
  ]) {
    expect(presentationVideoSplitAccess(env(value))).toEqual({ mode: 'off', requestId: null, valid: false });
  }
});

test('a request is allowed only by on or its own test GUID, case-insensitively', () => {
  expect(isPresentationVideoSplitRequestAllowed(REQUEST_ID, env(undefined))).toBe(false);
  expect(isPresentationVideoSplitRequestAllowed(REQUEST_ID, env('off'))).toBe(false);
  expect(isPresentationVideoSplitRequestAllowed(REQUEST_ID, env('bogus'))).toBe(false);
  expect(isPresentationVideoSplitRequestAllowed(REQUEST_ID, env('on'))).toBe(true);
  expect(isPresentationVideoSplitRequestAllowed(REQUEST_ID.toUpperCase(), env(`test:${REQUEST_ID}`))).toBe(true);
  expect(isPresentationVideoSplitRequestAllowed(REQUEST_ID, env(`test:${REQUEST_ID.toUpperCase()}`))).toBe(true);
  expect(isPresentationVideoSplitRequestAllowed(OTHER_ID, env(`test:${REQUEST_ID}`))).toBe(false);
  for (const bad of [undefined, null, '', 'not-a-guid', 5]) {
    expect(isPresentationVideoSplitRequestAllowed(bad, env('on'))).toBe(false);
  }
});
