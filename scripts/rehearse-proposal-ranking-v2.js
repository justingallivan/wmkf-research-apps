/** Static local-only build of the real ranking component with synthetic client data. */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const root = path.resolve(__dirname, '..');
const { webpack } = require('next/dist/compiled/webpack/webpack');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'ranking-v2-rehearsal-'));
const layout = fs.readFileSync(
  path.join(root, 'shared/components/Layout.js'),
  'utf8',
);
const start = layout.indexOf('export function PageHeader(');
if (start < 0) throw new Error('Layout changed');
fs.writeFileSync(path.join(output, 'layout.jsx'), layout.slice(start));
const config = {
  mode: 'development',
  context: root,
  devtool: false,
  entry: path.join(root, 'scripts/rehearsal/proposal-ranking-v2-entry.jsx'),
  output: { path: output, filename: 'bundle.js' },
  resolve: { modules: [path.join(root, 'node_modules'), 'node_modules'] },
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: path.join(root, 'scripts/rehearsal/jsx-loader.js'),
      },
    ],
  },
  plugins: [new webpack.NormalModuleReplacementPlugin(/^next\/router$/, path.join(root, 'scripts/rehearsal/router.js')),
    new webpack.NormalModuleReplacementPlugin(
      /^\.\.\/Layout$/,
      path.join(output, 'layout.jsx'),
    ),
    new webpack.NormalModuleReplacementPlugin(/^\.\/client$/, (resource) => {
      if (
        resource.context ===
        path.join(root, 'shared/components/proposal-ranking')
      )
        resource.request = path.join(
          root,
          'scripts/rehearsal/proposal-ranking-v2-client.js',
        );
    }),
  ],
};
webpack(config, async (error, stats) => {
  if (error || stats.hasErrors()) {
    console.error(error || stats.toString({ all: false, errors: true }));
    process.exitCode = 1;
    return;
  }
  const modules = stats.toJson({ all: false, modules: true }).modules || [];
  if (
    modules.some(
      (m) =>
        m.name?.includes('/dataverse/') || m.name?.includes('/api-request'),
    )
  )
    throw new Error('Unexpected live dependency in rehearsal');
  const tailwind = require(path.join(root, 'tailwind.config.js'));
  tailwind.content = [
    path.join(root, 'shared/**/*.{js,jsx}'),
    path.join(root, 'scripts/rehearsal/*.jsx'),
  ];
  const css = await require('postcss')([
    require('tailwindcss')(tailwind),
  ]).process('@tailwind base;@tailwind components;@tailwind utilities;', {
    from: undefined,
  });
  fs.writeFileSync(path.join(output, 'styles.css'), css.css);
  fs.writeFileSync(
    path.join(output, 'index.html'),
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ranking workflow rehearsal</title><link rel="stylesheet" href="/styles.css"></head><body class="bg-gray-50"><div id="root"></div><script src="/bundle.js"></script></body></html>',
  );
  const files = {
    '/': 'index.html',
    '/bundle.js': 'bundle.js',
    '/styles.css': 'styles.css',
  };
  http
    .createServer((req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      if (
        req.headers.host !== '127.0.0.1:3135' ||
        req.method !== 'GET' ||
        !files[req.url]
      )
        return res.writeHead(404).end();
      const file = files[req.url];
      res.setHeader(
        'Content-Type',
        file.endsWith('.js')
          ? 'text/javascript'
          : file.endsWith('.css')
            ? 'text/css'
            : 'text/html',
      );
      fs.createReadStream(path.join(output, file)).pipe(res);
    })
    .listen(3135, '127.0.0.1', () =>
      console.log(
        'Fictional UI rehearsal: http://127.0.0.1:3135 — no live services.',
      ),
    );
});
