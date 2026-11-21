const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createRelay, parseOsRelease, parseFlatpakList } = require('../desktop/core.cjs');

test('parses Linux identity and Flatpak rows without executing values', () => {
  assert.deepEqual(parseOsRelease('NAME="Linux Mint"\nVERSION_ID="22.3"\nBAD KEY=no\n'), { NAME: 'Linux Mint', VERSION_ID: '22.3' });
  assert.deepEqual(parseFlatpakList('org.example.Editor\tEditor\n../../bad\tBad\n'), [{ id: 'org.example.Editor', name: 'Editor' }]);
});

test('previews, resets and restores only a selected user Flatpak override', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-test-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const overrideDir = path.join(home, '.local', 'share', 'flatpak', 'overrides');
  await fs.mkdir(overrideDir, { recursive: true });
  const target = path.join(overrideDir, 'org.example.Editor');
  const contents = '[Context]\nfilesystems=home:ro;\n';
  await fs.writeFile(target, contents);
  const calls = [];
  const command = async (program, args) => {
    calls.push([program, ...args]);
    if (program === 'flatpak' && args[0] === 'list') return { stdout: 'org.example.Editor\tEditor\n', stderr: '' };
    if (program === 'flatpak' && args[0] === 'override') {
      await fs.unlink(target);
      return { stdout: '', stderr: '' };
    }
    if (program === 'systemctl') return { stdout: 'LoadState=loaded\nActiveState=active\n', stderr: '' };
    throw new Error('Unexpected command');
  };
  const relay = createRelay({ home, dataDir: path.join(home, 'relay-state'), command, platform: 'linux', env: {} });
  const preview = await relay.preview('org.example.Editor');
  assert.equal(preview.hasUserOverrides, true);
  assert.deepEqual(preview.lines, ['[Context]', 'filesystems=home:ro;']);
  await assert.rejects(relay.reset('../../bad'), /Invalid application ID/);
  const result = await relay.reset('org.example.Editor');
  assert.equal((await relay.pendingUndo()).token, result.token);
  assert.deepEqual(calls.find(call => call[1] === 'override'), ['flatpak', 'override', '--user', '--reset', 'org.example.Editor']);
  await assert.rejects(fs.access(target), { code: 'ENOENT' });
  await relay.undo(result.token);
  assert.equal(await fs.readFile(target, 'utf8'), contents);
  assert.equal(await relay.pendingUndo(), null);
  await assert.rejects(relay.undo(result.token), /new permission changes/);
});

test('does not overwrite changes created after a repair', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-test-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const overrideDir = path.join(home, '.local', 'share', 'flatpak', 'overrides');
  await fs.mkdir(overrideDir, { recursive: true });
  const target = path.join(overrideDir, 'org.example.Editor');
  await fs.writeFile(target, '[Context]\nfilesystems=home:ro;\n');
  const command = async (program, args) => {
    if (args[0] === 'list') return { stdout: 'org.example.Editor\tEditor\n' };
    if (args[0] === 'override') { await fs.unlink(target); return { stdout: '' }; }
    return { stdout: 'LoadState=not-found\nActiveState=inactive\n' };
  };
  const relay = createRelay({ home, dataDir: path.join(home, 'relay-state'), command, platform: 'linux', env: {} });
  const result = await relay.reset('org.example.Editor');
  await fs.writeFile(target, '[Context]\nfilesystems=xdg-documents;\n');
  await assert.rejects(relay.undo(result.token), /new permission changes/);
  assert.match(await fs.readFile(target, 'utf8'), /xdg-documents/);
});

test('support report excludes application names, override values and local paths', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-test-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const targetDir = path.join(home, '.local', 'share', 'flatpak', 'overrides');
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(path.join(targetDir, 'org.example.Editor'), '[Context]\nfilesystems=/secret/location;\n');
  const command = async (program) => program === 'flatpak' ? { stdout: 'org.example.Editor\tPersonal Editor\n' } : { stdout: 'LoadState=loaded\nActiveState=active\n' };
  const relay = createRelay({ home, command, platform: 'linux', env: { XDG_CURRENT_DESKTOP: 'GNOME', XDG_SESSION_TYPE: 'wayland' } });
  const report = JSON.stringify(await relay.report());
  assert.doesNotMatch(report, /Personal Editor|org\.example\.Editor|secret\/location|relay-test-/);
  assert.match(report, /"appCount":1/);
  assert.match(report, /"appsWithUserOverrides":1/);
});
