#!/usr/bin/env node
/**
 * Compile the strict-TypeScript bedside-mode client into a served JS string.
 *
 * `src/portal/client/bedside-mode.ts` is type-checked and compiled under its
 * own strict tsconfig (DOM lib, no Node types — see tsconfig.bedside.json),
 * separately from the backend's own Node-targeted build. The output is
 * wrapped into a generated .ts file exporting a string constant, the same
 * pattern `build-oui.js` uses for the OUI table: one committed generated
 * file, no runtime filesystem read, and `KidsController` serves the constant
 * directly at /kids/bedside.js — the same way it already serves the
 * hand-written service-worker script (KIDS_SW).
 *
 * Run via `npm run bedside:build` after editing bedside-mode.ts.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CLIENT_DIR = path.join(__dirname, '..', 'src', 'portal', 'client');
const TSCONFIG = path.join(CLIENT_DIR, 'tsconfig.bedside.json');
const OUT_JS = path.join(CLIENT_DIR, 'out', 'bedside-mode.js');
const GENERATED = path.join(CLIENT_DIR, 'bedside-mode.generated.ts');

function main() {
  // Invoked via `node <tsc-bin> -p ...` rather than the .bin/tsc(.cmd) shim —
  // spawning the .cmd shim directly fails with EINVAL under Git Bash on
  // Windows, where this repo is developed.
  const tsc = path.join(__dirname, '..', 'node_modules', 'typescript', 'bin', 'tsc');
  execFileSync(process.execPath, [tsc, '-p', TSCONFIG], { stdio: 'inherit' });

  const js = fs.readFileSync(OUT_JS, 'utf8');
  // A closing `</script>` sequence inside the payload would terminate the
  // <script> tag early if this were ever inlined instead of served as its
  // own file; harmless here (it is served with its own Content-Type) but
  // cheap enough to guard regardless of how a future caller uses the string.
  const safe = js.replace(/<\/script/gi, '<\\/script');

  const out = `// GENERATED FILE — do not edit by hand. Edit bedside-mode.ts, then run
// \`npm run bedside:build\`.
//
// Compiled from bedside-mode.ts under tsconfig.bedside.json (strict, DOM lib).

export const BEDSIDE_CLIENT_JS = ${JSON.stringify(safe)};
`;
  fs.writeFileSync(GENERATED, out);
  process.stderr.write(
    `wrote ${path.relative(process.cwd(), GENERATED)} (${(safe.length / 1024).toFixed(1)} KB)\n`,
  );
}

main();
