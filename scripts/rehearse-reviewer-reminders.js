/**
 * Local staff walkthrough of the real reviewer reminder composer.
 * Usage: node scripts/rehearse-reviewer-reminders.js
 *
 * Serves only static files on 127.0.0.1. The browser replaces the two composer
 * API calls with synthetic in-memory responses; unknown fetches throw. No env
 * file, app server, Dataverse, email transport, or external service is used.
 */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const fromRoot = require('module').createRequire(path.join(root, 'package.json'));
const { webpack } = fromRoot('next/dist/compiled/webpack/webpack');
const output = path.join(os.tmpdir(), 'wmkf-reviewer-reminder-rehearsal');
const port = Number(process.env.REHEARSAL_PORT || 3132);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid REHEARSAL_PORT');
fs.mkdirSync(output, { recursive: true });

webpack({
  mode: 'development',
  context: root,
  entry: path.join(root, 'scripts/rehearsal/reviewer-reminder-entry.jsx'),
  output: { path: output, filename: 'bundle.js' },
  devtool: false,
  resolve: { modules: [path.join(root, 'node_modules'), 'node_modules'] },
  module: { rules: [{ test: /\.jsx?$/, exclude: /node_modules/, use: path.join(root, 'scripts/rehearsal/jsx-loader.js') }] },
}, async (error, stats) => {
  if (error || stats.hasErrors()) {
    console.error(error || stats.toString({ all: false, errors: true }));
    process.exitCode = 1;
    return;
  }
  const postcss = fromRoot('postcss');
  const tailwind = fromRoot('tailwindcss');
  const config = fromRoot(path.join(root, 'tailwind.config.js'));
  config.content = [path.join(root, 'shared/**/*.{js,jsx}'), path.join(root, 'scripts/rehearsal/*.jsx')];
  const css = await postcss([tailwind(config)]).process('@tailwind base;@tailwind components;@tailwind utilities;', { from: undefined });
  fs.writeFileSync(path.join(output, 'styles.css'), css.css);
  fs.writeFileSync(path.join(output, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reviewer reminder staff rehearsal</title><link rel="stylesheet" href="/styles.css"></head><body class="bg-gray-50 text-gray-900"><div id="root"></div><script src="/bundle.js"></script></body></html>');

  const files = { '/': 'index.html', '/bundle.js': 'bundle.js', '/styles.css': 'styles.css' };
  http.createServer((req, res) => {
    const file = files[req.url];
    if (!file || req.method !== 'GET') {
      res.writeHead(404).end();
      return;
    }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(path.join(output, file)).pipe(res);
  }).listen(port, '127.0.0.1', () => {
    console.log(`Synthetic reviewer reminder rehearsal: http://127.0.0.1:${port}`);
    console.log('No live API or email calls. Press Ctrl-C to stop.');
  });
});
