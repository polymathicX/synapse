import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';

async function hashes(root) {
  const files = await readdir(root, { recursive: true, withFileTypes: true }); const results = {};
  for (const file of files.filter(entry => entry.isFile())) {
    const absolute = path.join(file.parentPath, file.name);
    results[path.relative(root, absolute).replaceAll('\\', '/')] = createHash('sha256').update(await readFile(absolute)).digest('hex');
  }
  return Object.fromEntries(Object.entries(results).sort(([a], [b]) => a.localeCompare(b)));
}
for (const browser of ['chrome', 'firefox']) {
  const build = () => {
    const result = spawnSync(process.execPath, ['node_modules/wxt/bin/wxt.mjs', 'build', '-b', browser, '--mv3'], { stdio: 'pipe' });
    if (result.status !== 0) throw new Error(result.stderr.toString() || result.stdout.toString());
  };
  build(); const first = await hashes(`.output/${browser}-mv3`); build(); const second = await hashes(`.output/${browser}-mv3`);
  assert.deepEqual(first, second, `${browser} build output changed between identical builds`);
  console.log(`${browser}: ${Object.keys(first).length} files reproduced byte-for-byte`);
}
