/** Local-only rehearsal of the real ranking UI and service, with memory adapters. */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const root = path.resolve(__dirname, '..');
const { webpack } = require('next/dist/compiled/webpack/webpack');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-ranking-rehearsal-'));
const port = Number(process.env.REHEARSAL_PORT || 3133);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid REHEARSAL_PORT');
const memory = path.join(root, 'scripts/rehearsal/proposal-ranking-memory.js');
const dependencies = [
  'lib/dataverse/adapters/proposal-ranking.js',
  'lib/dataverse/adapters/proposal-ranking-source.js',
  'lib/services/dataverse-identity-map.js',
  'lib/services/app-access-service.js',
  'lib/services/proposal-ranking/config.js',
];
const base = { mode: 'development', context: root, devtool: false,
  resolve: { modules: [path.join(root, 'node_modules'), 'node_modules'] },
  module: { rules: [{ test: /\.jsx?$/, exclude: /node_modules/, use: path.join(root, 'scripts/rehearsal/jsx-loader.js') }] },
};
const backend = { ...base, target: 'node', entry: path.join(root, 'scripts/rehearsal/proposal-ranking-service-entry.js'),
  output: { path: output, filename: 'service.cjs', library: { type: 'commonjs2' } },
  plugins: [new webpack.NormalModuleReplacementPlugin(/./, (resource) => {
    const resolved = path.resolve(resource.context, resource.request);
    if (dependencies.some((relative) => resolved === path.join(root, relative))) resource.request = memory;
  })],
};
// Use the real presentational exports without loading Next navigation/auth.
const layoutSource = fs.readFileSync(path.join(root, 'shared/components/Layout.js'), 'utf8');
const layoutStart = layoutSource.indexOf('export function PageHeader(');
if (layoutStart < 0) throw new Error('Layout presentation exports changed; review rehearsal build.');
const localLayout = path.join(output, 'layout.jsx');
fs.writeFileSync(localLayout, layoutSource.slice(layoutStart));
const frontend = { ...base, entry: path.join(root, 'scripts/rehearsal/proposal-ranking-entry.jsx'),
  output: { path: output, filename: 'bundle.js' },
  plugins: [new webpack.NormalModuleReplacementPlugin(/^\.\.\/Layout$/, localLayout)],
};
function compile(config) {
  return new Promise((resolve, reject) => {
    webpack(config, (error, stats) => {
      if (error || stats.hasErrors()) reject(error || new Error(stats.toString({ all: false, errors: true })));
      else resolve(stats);
    });
  });
}
async function main() {
  const stats = await compile(backend);
  // Fail closed if an unexpected live dependency slips into this standalone build.
  const modules = stats.toJson({ all: false, modules: true }).modules || [];
  const allowed = new Set([
    './lib/services/test-requests/isolation.js',
    ...['service', 'preview-service', 'calculations', 'readiness'].map((name) => `./lib/services/proposal-ranking/${name}.js`),
    './scripts/rehearsal/proposal-ranking-service-entry.js', './scripts/rehearsal/proposal-ranking-memory.js',
  ]);
  const unexpected = modules.filter((item) => item.name?.startsWith('./') && !allowed.has(item.name));
  if (unexpected.length) throw new Error(`Rehearsal refuses unexpected service dependencies: ${unexpected.map((item) => item.name).join(', ')}`);
  const service = require(path.join(output, 'service.cjs'));
  await compile(frontend);
  const config = require(path.join(root, 'tailwind.config.js'));
  config.content = [path.join(root, 'shared/**/*.{js,jsx}'), path.join(root, 'scripts/rehearsal/*.jsx')];
  const css = await require('postcss')([require('tailwindcss')(config)]).process('@tailwind base;@tailwind components;@tailwind utilities;', { from: undefined });
  fs.writeFileSync(path.join(output, 'styles.css'), css.css);
  const token = randomUUID();
  fs.writeFileSync(path.join(output, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="rehearsal-generation" content="__REHEARSAL_GENERATION__"><meta name="rehearsal-token" content="${token}"><title>Proposal Ranking rehearsal</title><link rel="stylesheet" href="/styles.css"></head><body class="bg-gray-50 text-gray-900"><div id="root"></div><script src="/bundle.js"></script></body></html>`);
  const files = { '/': 'index.html', '/bundle.js': 'bundle.js', '/styles.css': 'styles.css' };
  let queue = Promise.resolve();
  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; form-action 'none'");
    if (req.headers.host !== `127.0.0.1:${port}`) return res.writeHead(403).end();
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (files[url.pathname] && req.method === 'GET') {
      const file = files[url.pathname];
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
      if (file === 'index.html') res.end(fs.readFileSync(path.join(output, file), 'utf8').replace('__REHEARSAL_GENERATION__', String(service.getGeneration())));
      else fs.createReadStream(path.join(output, file)).pipe(res);
      return;
    }
    if (/^\/workbench\/[0-9a-f-]+$/.test(url.pathname) && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rehearsal proposal</title><link rel="stylesheet" href="/styles.css"><body class="p-8 bg-gray-50 text-gray-900"><h1 class="text-2xl font-bold">Fictional rehearsal proposal</h1><p class="my-4">Sample cards have no source documents. Your rehearsal rankings remain saved in memory.</p><a class="text-blue-800 underline" href="/">Return to the ranking rehearsal</a></body></html>');
      return;
    }
    if (!['/api/proposal-ranking', '/rehearsal/reset', '/rehearsal/simulate'].includes(url.pathname)
      || !['GET', 'POST'].includes(req.method)) return res.writeHead(404).end();
    if (req.headers['x-rehearsal-token'] !== token) return res.writeHead(403).end();
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > 65536) req.destroy(); });
    req.on('end', () => {
      queue = queue.then(async () => {
        try {
          const data = body ? JSON.parse(body) : {};
          const profileId = Number(req.headers['x-rehearsal-profile'] || 1);
          const generation = Number(req.headers['x-rehearsal-generation']);
          let result;
          if (url.pathname === '/rehearsal/reset' && req.method === 'POST') result = await service.reset();
          else if (url.pathname === '/rehearsal/simulate' && req.method === 'POST') result = await service.simulateOtherSubmissions(data, generation);
          else if (url.pathname === '/api/proposal-ranking' && req.method === 'GET') result = await service.get(Object.fromEntries(url.searchParams), profileId, generation);
          else if (url.pathname === '/api/proposal-ranking' && req.method === 'POST') result = await service.action(data, profileId, generation);
          else { res.writeHead(404).end(); return; }
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result ?? { ok: true }));
        } catch (error) {
          res.writeHead(error.status || 400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: error.message, code: error.code, current: error.current, retryable: error.retryable } }));
        }
      }).catch((error) => { console.error(error.message); if (!res.writableEnded) res.writeHead(500).end(); });
    });
  });
  server.listen(port, '127.0.0.1', () => console.log(`Proposal Ranking rehearsal: http://127.0.0.1:${port}\nSynthetic participants and proposals; memory only. Reset works after publication. No environment file or live service is loaded.`));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
