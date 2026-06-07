/**
 * Registers an ESM resolver hook so a raw-`node` script can import the app's
 * extensionless relative imports (e.g. `from '../../shared/config/baseConfig'`).
 *
 * The app relies on Next/webpack to resolve these; Node ESM does not, and the
 * old `--experimental-specifier-resolution=node` flag was removed. The hook only
 * runs AFTER the default resolver fails, and only for relative specifiers with
 * no extension — so it can't mask unrelated resolution errors.
 *
 * Uses the synchronous, same-thread `registerHooks` API (Node 22.15+/23.5+),
 * which avoids the `module.register()` deprecation warning.
 *
 * Usage:
 *   node --import ./scripts/lib/use-extensionless.mjs scripts/<your-script>.mjs [args]
 */
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
      const hasExt = /\.[a-z0-9]+$/i.test(specifier);
      if (isRelative && !hasExt && context.parentURL) {
        for (const cand of [`${specifier}.js`, `${specifier}.mjs`, `${specifier}/index.js`]) {
          if (existsSync(fileURLToPath(new URL(cand, context.parentURL)))) {
            return nextResolve(cand, context);
          }
        }
      }
      throw err;
    }
  },
});
