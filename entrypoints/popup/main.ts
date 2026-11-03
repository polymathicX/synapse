import '../../ui/style.css';
import { request } from '../../platform/client';
import { repository } from '../../storage/repository';
import { errorMessage } from '../../core/model';
import { byId, button } from '../../ui/shared';
import { browser } from 'wxt/browser';
import { providerForUrl } from '../../providers/registry';
import { enableFloating, requestFloatingPermission } from '../../platform/floating';

const status = byId('status');
const capture = byId<HTMLButtonElement>('capture');
let activeOrigin: string | undefined;
void browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
  const url = tabs[0]?.url;
  if (url && providerForUrl(url)) { activeOrigin = `${new URL(url).origin}/*`; }
  else byId('floating').classList.add('hidden');
});
byId('floating').addEventListener('click', () => {
  if (!activeOrigin) return;
  const origins = [activeOrigin]; const permission = requestFloatingPermission(origins);
  void permission.then(async granted => {
    if (!granted) throw new Error('Access was not granted. You can still capture with the toolbar.');
    await enableFloating(origins); status.textContent = 'Floating Synapse enabled. Click Save chat on the page, then drag saved entries into another chat.';
  }).catch(error => { status.textContent = errorMessage(error); status.classList.add('error'); });
});
capture.addEventListener('click', async () => {
  capture.disabled = true; status.textContent = 'Capturing loaded messages…'; status.classList.remove('error');
  try { await request({ type: 'capture' }); window.close(); }
  catch (error) { status.textContent = errorMessage(error); status.classList.add('error'); }
  finally { capture.disabled = false; }
});
function openWorkspace(): void { void request({ type: 'open-workspace' }).then(() => window.close()).catch(error => { status.textContent = errorMessage(error); }); }
byId('workspace').addEventListener('click', openWorkspace);
byId('brand').addEventListener('click', event => { event.preventDefault(); openWorkspace(); });
void repository.list(0, 4).then(snapshots => {
  const recent = byId('recent');
  if (!snapshots.length) { recent.textContent = 'Capture a chat or create your first context in the workspace.'; recent.className = 'hint'; }
  for (const snapshot of snapshots) {
    const item = button('', () => { void request({ type: 'open-workspace', snapshotId: snapshot.id }).then(() => window.close()); }, 'snapshot-item');
    const title = document.createElement('strong'); title.textContent = snapshot.title;
    const meta = document.createElement('small'); meta.textContent = `${snapshot.source.provider} · ${snapshot.messageCount} messages`;
    item.append(title, meta); recent.append(item);
  }
}).catch(error => { status.textContent = errorMessage(error); status.classList.add('error'); });
