import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { zipSync } from 'fflate';
import path from 'node:path';
import { createHash } from 'node:crypto';

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
await mkdir('artifacts', { recursive: true });
for (const browser of ['chrome', 'firefox']) {
  const root = `.output/${browser}-mv3`; const entries = {};
  const files = (await readdir(root, { recursive: true, withFileTypes: true })).filter(file => file.isFile());
  const sorted = files.map(file => path.join(file.parentPath, file.name)).sort();
  for (const absolute of sorted) {
    const name = path.relative(root, absolute).replaceAll('\\', '/');
    entries[name] = [new Uint8Array(await readFile(absolute)), { mtime: new Date(2000, 0, 1, 0, 0, 0), level: 0 }];
  }
  const bytes = zipSync(entries); const name = `synapse-${version}-${browser}-mv3.zip`;
  await writeFile(`artifacts/${name}`, bytes);
  await writeFile(`artifacts/${name}.sha256`, `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`);
  console.log(`Packaged artifacts/${name}`);
}
