import fs from 'node:fs';
import path from 'node:path';

const routeSource = fs.readFileSync(
  path.join(process.cwd(), 'pages/api/dynamics-explorer/chat.js'),
  'utf8',
);

function functionSource(name) {
  const start = routeSource.indexOf(`async function ${name}(`);
  const nextSection = routeSource.indexOf('\n// ───', start);
  if (start < 0 || nextSection < 0) throw new Error(`Could not isolate ${name}`);
  return routeSource.slice(start, nextSection);
}

test('interactive Explorer calls use the approved response headroom and low effort', () => {
  const source = functionSource('callClaude');
  expect(source).toMatch(/maxTokens:\s*16000/);
  expect(source).toMatch(/outputConfig:\s*\{\s*effort:\s*'low'\s*\}/);
});

test('batch export keeps its separate 4096-token posture', () => {
  expect(functionSource('callClaudeBatch')).toMatch(/maxTokens:\s*4096/);
});
