/** Node 26 resolver for the existing Factory CLI's extensionless relative JS imports.
 * Does not load credentials, authorize writes, or change transport behavior.
 * Use only with scripts/rehearse-test-request-sandbox.mjs as documented in the trial packet.
 */
const { registerHooks } = require('node:module');
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
      return next(`${specifier}.js`, context);
    }
    throw error;
  }
} });
