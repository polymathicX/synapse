import webExt from 'web-ext';
import { firefox } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// Fresh temporary profile only. This verifies temporary installation/startup,
// not authenticated services, native drop UX, or persistence after restart.
const runner = await webExt.cmd.run({ sourceDir: '.output/firefox-mv3', firefox: firefox.executablePath(), args: ['-headless'], noReload: true, noInput: true }, { shouldExitProgram: false });
try {
  const reload = await runner.reloadAllExtensions();
  if (reload.some(result => result.reloadError)) throw new Error('Firefox could not reload the add-on.');
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/firefox-startup.json', JSON.stringify({ temporaryInstallation: true, reloadSucceeded: true, binary: 'Playwright-distributed Firefox', functionalExtensionFlowsVerified: false }, null, 2));
  console.log('Firefox temporary installation and reload succeeded. Full Firefox extension flows remain unverified.');
} finally { await runner.exit(); }
