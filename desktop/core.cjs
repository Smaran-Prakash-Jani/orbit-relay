const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const runFile = promisify(execFile);

const APP_ID = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+$/;
const MAX_OVERRIDE = 64 * 1024;

function parseOsRelease(input) {
  const entries = {};
  for (const line of input.split('\n')) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replace(/\\([\\"$`])/g, '$1');
    entries[match[1]] = value.slice(0, 120);
  }
  return entries;
}

function parseFlatpakList(input) {
  return input.split('\n').map(line => {
    const [id, name] = line.trim().split('\t');
    if (!APP_ID.test(id || '')) return null;
    return { id, name: (name || id).slice(0, 100) };
  }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

function parseOverride(input) {
  return input.split('\n').filter(line => line.trim() && !line.trim().startsWith('#')).slice(0, 80);
}

function createRelay({ home = os.homedir(), dataDir = path.join(os.homedir(), '.local', 'share', 'orbit-relay'), command = runFile, platform = process.platform, env = process.env } = {}) {
  const overrideDir = path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'flatpak', 'overrides');
  const backupDir = path.join(dataDir, 'undo');
  let busy = false;

  async function run(program, args) {
    return command(program, args, { timeout: 5000, maxBuffer: 256 * 1024, env: { ...env, LC_ALL: 'C' } });
  }

  async function system() {
    let distro = 'Unknown Linux';
    let version = '';
    if (platform === 'linux') {
      try {
        const info = parseOsRelease(await fs.readFile('/etc/os-release', 'utf8'));
        distro = info.NAME || distro;
        version = info.VERSION_ID || '';
      } catch { /* leave unknown */ }
    }
    return {
      platform,
      distro,
      version,
      kernel: os.release().slice(0, 100),
      arch: os.arch(),
      desktop: (env.XDG_CURRENT_DESKTOP || env.DESKTOP_SESSION || 'Unknown').slice(0, 100),
      session: (env.XDG_SESSION_TYPE || 'Unknown').slice(0, 40),
      sandboxed: Boolean(env.FLATPAK_ID)
    };
  }

  async function installedApps() {
    const { stdout } = await run('flatpak', ['list', '--app', '--columns=application,name']);
    return parseFlatpakList(stdout);
  }

  async function overrideFile(id) {
    if (!APP_ID.test(id)) throw new Error('Invalid application ID.');
    const file = path.join(overrideDir, id);
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.size > MAX_OVERRIDE) throw new Error('Permission override is not a regular, supported file.');
      return await fs.readFile(file);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function scan() {
    if (platform !== 'linux') return { system: await system(), flatpak: { status: 'unknown', summary: 'Linux only', apps: [] }, audio: { status: 'unknown', summary: 'Linux only' } };
    const [context, flatpak, audio] = await Promise.all([
      system(),
      (async () => {
        try {
          const apps = await installedApps();
          const decorated = await Promise.all(apps.map(async app => ({ ...app, hasUserOverrides: Boolean(await overrideFile(app.id)) })));
          const count = decorated.filter(app => app.hasUserOverrides).length;
          return { status: 'ok', summary: `${decorated.length} Flatpak apps · ${count} with user permission changes`, apps: decorated };
        } catch (error) {
          return { status: 'unknown', summary: error.code === 'ENOENT' ? 'Flatpak is not installed' : 'Flatpak apps could not be inspected', apps: [] };
        }
      })(),
      (async () => {
        try {
          const { stdout } = await run('systemctl', ['--user', 'show', 'pipewire.service', '--property=LoadState,ActiveState', '--no-pager']);
          const values = Object.fromEntries(stdout.split('\n').filter(line => line.includes('=')).map(line => line.split('=', 2)));
          if (values.LoadState !== 'loaded') return { status: 'unknown', summary: 'PipeWire service is not installed', advice: 'This system may use another audio service.' };
          const active = values.ActiveState === 'active';
          return { status: active ? 'ok' : 'warning', summary: active ? 'PipeWire is running' : 'PipeWire is not active', advice: active ? 'Audio service is available. Device or profile issues may still exist.' : 'Check your user service status and audio device settings.' };
        } catch {
          return { status: 'unknown', summary: 'Audio service state is unavailable', advice: 'This session may not use systemd or PipeWire.' };
        }
      })()
    ]);
    return { system: context, flatpak, audio };
  }

  async function preview(id) {
    if (!APP_ID.test(id)) throw new Error('Invalid application ID.');
    const apps = await installedApps();
    if (!apps.some(app => app.id === id)) throw new Error('Application is not currently installed.');
    const content = await overrideFile(id);
    return {
      id,
      hasUserOverrides: Boolean(content),
      lines: content ? parseOverride(content.toString('utf8')) : [],
      explanation: content ? 'Resetting removes this app’s user permission changes. The app keeps its files and settings. Relay saves these permissions for undo. Restart the app to test the result.' : 'This app has no user permission changes to reset.'
    };
  }

  async function reset(id) {
    if (busy) throw new Error('Another repair is in progress.');
    busy = true;
    try {
      const info = await preview(id);
      if (!info.hasUserOverrides) throw new Error('This app has no user permission changes.');
      const content = await overrideFile(id);
      const token = `${Date.now()}-${require('node:crypto').randomBytes(8).toString('hex')}`;
      await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
      await fs.writeFile(path.join(backupDir, `${token}.json`), JSON.stringify({ id, contents: content.toString('base64'), createdAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
      await run('flatpak', ['override', '--user', '--reset', id]);
      if (await overrideFile(id)) throw new Error('Flatpak did not remove the user override.');
      return { token, id, summary: `User permission changes reset for ${id}.` };
    } finally { busy = false; }
  }

  async function undo(token) {
    if (!/^\d{13}-[a-f0-9]{16}$/.test(token)) throw new Error('Invalid undo token.');
    if (busy) throw new Error('Another repair is in progress.');
    busy = true;
    try {
      const record = JSON.parse(await fs.readFile(path.join(backupDir, `${token}.json`), 'utf8'));
      if (!APP_ID.test(record.id)) throw new Error('Invalid backup.');
      const contents = Buffer.from(record.contents, 'base64');
      if (!contents.length || contents.length > MAX_OVERRIDE) throw new Error('Invalid backup size.');
      if (await overrideFile(record.id)) throw new Error('This app has new permission changes. Review them before undoing.');
      await fs.mkdir(overrideDir, { recursive: true, mode: 0o700 });
      const target = path.join(overrideDir, record.id);
      const temp = `${target}.${token}.tmp`;
      await fs.writeFile(temp, contents, { flag: 'wx', mode: 0o600 });
      await fs.rename(temp, target);
      return { id: record.id, summary: `Previous user permissions restored for ${record.id}.` };
    } finally { busy = false; }
  }

  async function pendingUndo() {
    let names;
    try { names = await fs.readdir(backupDir); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    for (const name of names.filter(name => /^\d{13}-[a-f0-9]{16}\.json$/.test(name)).sort().reverse().slice(0, 30)) {
      try {
        const record = JSON.parse(await fs.readFile(path.join(backupDir, name), 'utf8'));
        if (APP_ID.test(record.id) && !(await overrideFile(record.id))) {
          return { id: record.id, token: name.slice(0, -5), summary: `User permission changes reset for ${record.id}.` };
        }
      } catch { /* skip an unusable backup */ }
    }
    return null;
  }

  async function report() {
    const result = await scan();
    return {
      app: 'Orbit Relay', version: require('../package.json').version, generatedAt: new Date().toISOString(),
      system: result.system,
      checks: [
        { id: 'flatpak', status: result.flatpak.status, appCount: result.flatpak.apps.length, appsWithUserOverrides: result.flatpak.apps.filter(app => app.hasUserOverrides).length },
        { id: 'audio', status: result.audio.status }
      ],
      privacy: 'No usernames, hostnames, paths, network addresses, app names, logs, or command output.'
    };
  }

  return { system, scan, preview, reset, undo, pendingUndo, report };
}

module.exports = { createRelay, parseOsRelease, parseFlatpakList, parseOverride, APP_ID };
