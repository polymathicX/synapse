import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';

async function initialBytes(root, file, seen = new Set()) {
  if (seen.has(file)) return 0;
  seen.add(file);
  const source = await readFile(path.join(root, file), 'utf8');
  let total = gzipSync(source).length;
  for (const match of source.matchAll(/(?:import|export)\s*(?:[^;"']*?from\s*)?["']([^"']+)["']/g)) {
    const dependency = match[1]; if (!dependency.endsWith('.js')) continue;
    const resolved = dependency.startsWith('/') ? dependency.slice(1) : path.posix.join(path.posix.dirname(file), dependency);
    total += await initialBytes(root, resolved, seen);
  }
  return total;
}

for (const browser of ['chrome', 'firefox']) {
  const root = `.output/${browser}-mv3`;
  const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'scripting', 'storage'].sort());
  assert(!manifest.host_permissions?.length, 'No required host access');
  assert(!manifest.content_scripts?.length, 'Floating UI must be registered only after opt-in');
  assert(manifest.optional_host_permissions.every(origin => origin.startsWith('https://') && !origin.includes('<all_urls>')));
  assert(manifest.content_security_policy.extension_pages.includes("connect-src 'none'"));
  if (browser === 'chrome') { assert(manifest.background.service_worker); assert(!manifest.background.scripts); }
  else { assert(manifest.background.scripts?.length); assert(!manifest.background.service_worker); assert.equal(manifest.browser_specific_settings.gecko.data_collection_permissions.required[0], 'none'); }
  for (const name of ['background', 'chatgpt', 'claude', 'deepseek', 'kimi', 'qwen', 'widget']) {
    const size = await initialBytes(root, `${name}.js`);
    assert(size <= 50 * 1024, `${browser}/${name} exceeded 50 KiB gzip`);
    console.log(`${browser}/${name}: ${(size / 1024).toFixed(2)} KiB gzip`);
  }
  for (const page of ['popup', 'workspace']) {
    const html = await readFile(`${root}/${page}.html`, 'utf8');
    const script = /<script[^>]*src="([^"]+)"/.exec(html)?.[1]; assert(script);
    const size = await initialBytes(root, script.replace(/^\//, ''));
    assert(size <= 150 * 1024, `${browser}/${page} exceeded 150 KiB gzip`);
    console.log(`${browser}/${page} initial JS: ${(size / 1024).toFixed(2)} KiB gzip`);
  }
  const assets = await readdir(`${root}/assets`);
  for (const asset of assets.filter(file => /worker.*\.(js|mjs)$/.test(file))) {
    const content = await readFile(`${root}/assets/${asset}`);
    console.log(`${browser}/lazy ${asset}: ${(content.length / 1024).toFixed(1)} KiB raw; ${(gzipSync(content).length / 1024).toFixed(1)} KiB gzip`);
  }
}
