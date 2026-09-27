/**
 * Test Request Factory slice 4a/4b: the CLI's `--recipe` validation
 * (scripts/rehearse-test-request-sandbox.mjs `parseArgs`) fails closed for a
 * `final_writeup`/`site_visit_materials` reservation BEFORE any Dataverse
 * read or ledger write. These tokens are valid `LEDGER_RECIPES` members (the
 * ledger's own enum accepts them), but have no built `RECIPE_STEP_ORDER`
 * entry yet -- `parseArgs` itself must refuse them, not merely fail later
 * inside a step handler. `pre_site_visit` gained its step order in slice 4b
 * and moved to the "accepted" list below.
 *
 * Importing the script is safe: `main()` is guarded behind an
 * `import.meta.url === argv[1]` entrypoint check.
 *
 * @jest-environment node
 */
import { parseArgs, buildGraphContext } from '../../scripts/rehearse-test-request-sandbox.mjs';

function reserveArgv(recipe) {
  return [
    'node', 'rehearse-test-request-sandbox.mjs',
    '--reserve',
    '--source-request-number=1003222',
    '--bundle=/absolute/does-not-need-to-exist/bundle.json',
    `--manifest-out=/absolute/does-not-need-to-exist/manifest-${recipe}.json`,
    '--idempotency-key=test-key-1',
    `--recipe=${recipe}`,
  ];
}

describe('slice 4a/4b: --recipe fails closed for a not-yet-built recipe', () => {
  test.each(['final_writeup', 'site_visit_materials'])(
    '--reserve --recipe=%s is refused by parseArgs, before any Dataverse read',
    (recipe) => {
      expect(() => parseArgs(reserveArgv(recipe))).toThrow(/has no built step order yet/);
    },
  );

  test.each(['basic', 'initial_assessment', 'reviews', 'pre_site_visit'])(
    '--reserve --recipe=%s (a built recipe) is accepted by parseArgs\' step-order gate',
    (recipe) => {
      // reviews additionally requires reviewer-address resolution inputs;
      // this test only asserts parseArgs does NOT throw the step-order
      // refusal for a recipe that legitimately has one.
      let error = null;
      try {
        parseArgs(reserveArgv(recipe));
      } catch (caught) {
        error = caught;
      }
      if (error) {
        expect(error.message).not.toMatch(/has no built step order yet/);
      }
    },
  );

  test('an unrecognized recipe token is refused by the LEDGER_RECIPES check first', () => {
    expect(() => parseArgs(reserveArgv('not_a_real_recipe'))).toThrow(/--recipe must be one of/);
  });
});

describe('slice 4b P3 (Opus round 1): the CLI Graph object includes deleteFile through the sandbox-bound wrapper', () => {
  test('buildGraphContext() returns a deleteFile function alongside every other Graph method', async () => {
    const { graph } = await buildGraphContext();
    expect(typeof graph.deleteFile).toBe('function');
  });
});
