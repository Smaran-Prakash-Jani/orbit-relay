const $ = id => document.getElementById(id);
const iconPaths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  sparkles: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4m-2-2h4"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6M8 13h8m-8 4h8"/>',
  refresh: '<path d="M20 7a9 9 0 1 0 1 8M20 3v5h-5"/>',
  sliders: '<path d="M4 6h8m4 0h4M4 12h3m4 0h9M4 18h10m4 0h2"/><circle cx="14" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
  'arrow-right': '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  app: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 9v12"/>',
  check: '<path d="m5 12 4 4L19 6"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.grid}</svg>`;
document.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
let scanResult = null;
let selectedId = null;
let changedOnly = false;
let lastUndo = null;
let toastTimer;
let transparency = 48;
try { const saved = Number(localStorage.getItem('relay:transparency')); if (Number.isFinite(saved) && localStorage.getItem('relay:transparency') !== null) transparency = Math.max(0, Math.min(80, Math.round(saved))); } catch { /* Keep the default when storage is unavailable. */ }

function applyTransparency() {
  const alpha = (100 - transparency) / 100;
  document.documentElement.style.setProperty('--window-alpha', alpha);
  document.documentElement.style.setProperty('--header-alpha', Math.max(.78, Math.min(1, alpha + .12)));
  document.documentElement.style.setProperty('--panel-alpha', Number(Math.min(.74, Math.max(.42, 1.02 - alpha * .85)).toFixed(3)));
  document.querySelectorAll('[data-transparency-slider]').forEach(slider => { slider.value = transparency; });
  document.querySelectorAll('[data-transparency-value]').forEach(label => { label.textContent = `${transparency}%`; });
}

function closeTransparencyPopover() {
  $('transparency-popover').hidden = true;
  $('transparency-toggle').setAttribute('aria-expanded', 'false');
}

function toast(message) {
  const element = $('toast');
  element.textContent = message;
  element.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('visible'), 4500);
}

function setBadge(element, state) {
  element.textContent = state === 'ok' ? 'Ready' : state === 'warning' ? 'Attention' : 'Unknown';
  element.className = `badge ${state}`;
}

function page(name) {
  document.querySelectorAll('.page').forEach(el => el.classList.toggle('active', el.id === name));
  document.querySelectorAll('.header-nav .nav').forEach(el => {
    const active = el.dataset.page === name;
    el.classList.toggle('active', active);
    if (active) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  document.querySelector('main').scrollTop = 0;
  if (name === 'report') refreshReport();
}

function renderApps() {
  const list = $('app-list');
  list.replaceChildren();
  const query = $('app-search').value.trim().toLowerCase();
  const apps = (scanResult?.flatpak.apps || []).filter(app => (!changedOnly || app.hasUserOverrides) && `${app.name} ${app.id}`.toLowerCase().includes(query));
  if (!apps.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = scanResult?.flatpak.status === 'unknown' ? scanResult.flatpak.summary : changedOnly && !query ? 'No apps have user permission changes.' : 'No apps match this search.';
    list.append(empty);
    return;
  }
  for (const app of apps) {
    const row = document.createElement('button');
    row.className = `app-row${app.id === selectedId ? ' selected' : ''}`;
    row.setAttribute('aria-pressed', String(app.id === selectedId));
    const symbol = document.createElement('span');
    symbol.className = 'app-icon';
    symbol.innerHTML = icon('app');
    const copy = document.createElement('span');
    copy.className = 'app-copy';
    const title = document.createElement('strong');
    title.textContent = app.name;
    const subtitle = document.createElement('small');
    subtitle.textContent = app.hasUserOverrides ? 'Permission changes found' : app.id;
    if (app.hasUserOverrides) subtitle.className = 'changed';
    copy.append(title, subtitle);
    row.append(symbol, copy);
    row.addEventListener('click', () => selectApp(app));
    list.append(row);
  }
}

async function selectApp(app) {
  selectedId = app.id;
  renderApps();
  const detail = $('repair-detail');
  detail.textContent = 'Inspecting permissions…';
  try {
    const result = await window.relay.preview(app.id);
    if (selectedId !== app.id) return;
    detail.replaceChildren();
    const title = document.createElement('h2');
    title.textContent = app.name;
    const id = document.createElement('p');
    id.className = 'app-id';
    id.textContent = result.id;
    const explanation = document.createElement('p');
    explanation.textContent = result.explanation;
    detail.append(title, id);
    if (result.hasUserOverrides) {
      detail.append(explanation);
      const heading = document.createElement('h3');
      heading.textContent = 'Current user overrides';
      const content = document.createElement('div');
      content.className = 'override-lines';
      content.textContent = result.lines.join('\n') || '(empty override file)';
      const button = document.createElement('button');
      button.className = 'button primary';
      button.textContent = 'Reset user changes';
      button.addEventListener('click', () => resetApp(result.id, button));
      detail.append(heading, content, button);
    } else {
      const status = document.createElement('div');
      status.className = 'detail-status';
      status.innerHTML = icon('check');
      const message = document.createElement('span');
      message.textContent = result.explanation;
      status.append(message);
      detail.append(status);
    }
  } catch (error) { detail.textContent = `Could not inspect app: ${error.message}`; }
}

async function resetApp(id, button) {
  if (!window.confirm(`Reset user permission changes for ${id}? Relay will save an undo copy. Application data will stay in place.`)) return;
  button.disabled = true;
  try {
    lastUndo = await window.relay.reset(id);
    $('undo-text').textContent = lastUndo.summary;
    $('undo-banner').hidden = false;
    toast('Permissions reset. You can undo this change.');
    await refresh();
  } catch (error) { toast(`Reset failed: ${error.message}`); button.disabled = false; }
}

async function refresh() {
  $('scan-button').disabled = true;
  try {
    scanResult = await window.relay.scan();
    const s = scanResult.system;
    $('system-line').textContent = `${s.distro}${s.version ? ` ${s.version}` : ''} · ${s.desktop} · ${s.session}`;
    $('profile-os').textContent = `${s.distro}${s.version ? ` ${s.version}` : ''}`;
    $('profile-desktop').textContent = s.desktop;
    $('profile-session').textContent = s.session;
    const apps = scanResult.flatpak.apps || [];
    const changed = apps.filter(app => app.hasUserOverrides).length;
    const flatpakAvailable = scanResult.flatpak.status !== 'unknown';
    $('changes-count').textContent = flatpakAvailable ? String(changed) : '—';
    $('changes-detail').textContent = flatpakAvailable ? `${apps.length} installed app${apps.length === 1 ? '' : 's'} inspected` : 'Flatpak app scan unavailable';
    $('changes-state').textContent = flatpakAvailable ? changed ? 'Review' : 'No changes' : 'Unknown';
    $('changes-state').className = `badge ${flatpakAvailable ? changed ? 'warning' : 'ok' : 'unknown'}`;
    $('profile-apps').textContent = scanResult.flatpak.status === 'unknown' ? 'Unavailable' : String(apps.length);
    $('profile-changes').textContent = scanResult.flatpak.status === 'unknown' ? 'Flatpak scan unavailable' : `${changed} app${changed === 1 ? '' : 's'} with user changes`;
    $('next-summary').textContent = changed ? `Review the ${changed} app${changed === 1 ? '' : 's'} with user permission changes. Relay shows the exact changes before any reset.` : scanResult.audio.status === 'warning' ? scanResult.audio.advice || 'Review the audio service status before changing anything.' : 'Your scanned services are ready. Open Fix center to inspect app permissions, or prepare a support report.';
    $('audio-summary').textContent = scanResult.audio.summary;
    $('audio-advice').textContent = scanResult.audio.advice || '';
    $('flatpak-summary').textContent = scanResult.flatpak.summary;
    setBadge($('audio-state'), scanResult.audio.status);
    setBadge($('flatpak-state'), scanResult.flatpak.status);
    $('scan-time').textContent = `Updated ${new Date().toLocaleTimeString()}`;
    renderApps();
    if (selectedId) {
      const app = scanResult.flatpak.apps.find(item => item.id === selectedId);
      if (app) await selectApp(app);
    }
  } catch (error) { toast(`Scan failed: ${error.message}`); }
  finally { $('scan-button').disabled = false; }
}

async function refreshReport() {
  $('report-preview').textContent = 'Preparing report…';
  try { $('report-preview').textContent = JSON.stringify(await window.relay.report(), null, 2); }
  catch (error) { $('report-preview').textContent = `Report unavailable: ${error.message}`; }
}

document.querySelectorAll('.header-nav .nav').forEach(button => button.addEventListener('click', () => page(button.dataset.page)));
document.querySelectorAll('[data-window]').forEach(button => button.addEventListener('click', () => window.relay.windowControl(button.dataset.window).catch(error => toast(error.message))));
document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.filter === 'changed') {
    changedOnly = true;
    $('app-search').value = '';
    $('changed-only').setAttribute('aria-pressed', 'true');
    renderApps();
  }
  page(button.dataset.go);
}));
document.querySelectorAll('[data-transparency-slider]').forEach(slider => slider.addEventListener('input', event => {
  transparency = Number(event.target.value);
  applyTransparency();
  try { localStorage.setItem('relay:transparency', String(transparency)); } catch { /* The choice remains active for this session. */ }
}));
$('transparency-toggle').addEventListener('click', () => {
  const popover = $('transparency-popover');
  popover.hidden = !popover.hidden;
  $('transparency-toggle').setAttribute('aria-expanded', String(!popover.hidden));
  if (!popover.hidden) popover.querySelector('[data-transparency-slider]').focus();
});
document.addEventListener('click', event => {
  if (!$('transparency-popover').hidden && !$('transparency-popover').contains(event.target) && !$('transparency-toggle').contains(event.target)) closeTransparencyPopover();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('transparency-popover').hidden) { closeTransparencyPopover(); $('transparency-toggle').focus(); }
});
const scrollPane = document.querySelector('main');
scrollPane.addEventListener('scroll', () => document.querySelector('.topbar').classList.toggle('is-scrolled', scrollPane.scrollTop > 4), { passive: true });
$('scan-button').addEventListener('click', refresh);
$('app-search').addEventListener('input', renderApps);
$('changed-only').addEventListener('click', () => {
  changedOnly = !changedOnly;
  $('changed-only').setAttribute('aria-pressed', String(changedOnly));
  renderApps();
});
$('refresh-report').addEventListener('click', refreshReport);
$('export-report').addEventListener('click', async () => {
  try { const result = await window.relay.exportReport(); if (result.saved) toast('Support report saved.'); }
  catch (error) { toast(`Save failed: ${error.message}`); }
});
$('undo-button').addEventListener('click', async () => {
  if (!lastUndo) return;
  try {
    const result = await window.relay.undo(lastUndo.token);
    lastUndo = null;
    $('undo-banner').hidden = true;
    toast(result.summary);
    await refresh();
  } catch (error) { toast(`Undo failed: ${error.message}`); }
});
applyTransparency();
Promise.all([refresh(), window.relay.pendingUndo()]).then(([, pending]) => {
  if (pending) {
    lastUndo = pending;
    $('undo-text').textContent = pending.summary;
    $('undo-banner').hidden = false;
  }
}).catch(error => toast(`Startup check failed: ${error.message}`));
