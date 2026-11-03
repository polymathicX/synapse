import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const result = spawnSync(process.execPath, ['node_modules/web-ext/bin/web-ext.js', 'lint', '--source-dir', '.output/firefox-mv3', '--output=json'], { encoding: 'utf8' });
let report;
try { report = JSON.parse(result.stdout); } catch { throw new Error(result.stderr || result.stdout); }
// PDF.js contains variable imports for optional fake-worker and decoder fallbacks.
// We supply a packaged port, disable WASM/rendering, and enforce 'self' CSP.
// Keep this narrow exception visible; any different finding fails the gate.
const reviewed = warning => warning.code === 'UNSAFE_VAR_ASSIGNMENT' && warning.message === 'Unsafe call to import for argument 0' && /^assets\/pdf\.worker(?:\.min)?-[\w-]+\.(?:js|mjs)$/.test(warning.file);
const unexpected = [...(report.errors ?? []), ...(report.warnings ?? []).filter(warning => !reviewed(warning))];
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/firefox-lint.json', JSON.stringify(report, null, 2));
console.log(`Firefox validation: ${report.errors?.length ?? 0} errors; ${report.warnings?.length ?? 0} reviewed PDF.js warnings; ${unexpected.length} unexpected findings.`);
if (unexpected.length) { console.error(unexpected); process.exitCode = 1; }
