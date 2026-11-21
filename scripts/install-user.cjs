const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { version } = require('../package.json');

async function main() {
  if (process.platform !== 'linux') throw new Error('User installation is Linux only.');
  const home = os.homedir();
  const root = path.resolve(__dirname, '..');
  const source = path.join(root, 'release', 'linux-unpacked');
  const binary = path.join(source, 'orbit-relay');
  await fs.access(binary);

  const installRoot = path.join(home, '.local', 'opt', 'orbit-relay');
  const versionDir = path.join(installRoot, version);
  const stage = path.join(installRoot, `.install-${process.pid}`);
  const backup = path.join(installRoot, `.previous-${version}-${process.pid}`);
  const replace = process.argv.includes('--replace');
  const iconDir = path.join(home, '.local', 'share', 'icons', 'hicolor', '256x256', 'apps');
  const appDir = path.join(home, '.local', 'share', 'applications');
  const desktopFile = path.join(appDir, 'io.github.orbitdesktop.Relay.desktop');
  let alreadyInstalled = false;
  try { await fs.access(versionDir); alreadyInstalled = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (alreadyInstalled && !replace) throw new Error(`Version ${version} is already installed at ${versionDir}. Pass --replace to update this version.`);

  await fs.mkdir(installRoot, { recursive: true });
  let movedCurrent = false;
  let promoted = false;
  try {
    await fs.cp(source, stage, { recursive: true, errorOnExist: true, force: false });
    if (alreadyInstalled) { await fs.rename(versionDir, backup); movedCurrent = true; }
    await fs.rename(stage, versionDir);
    promoted = true;
    await fs.mkdir(iconDir, { recursive: true });
    await fs.copyFile(path.join(root, 'assets', 'icon.png'), path.join(iconDir, 'orbit-relay.png'));
    await fs.mkdir(appDir, { recursive: true });
    const executable = path.join(versionDir, 'orbit-relay').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const desktop = `[Desktop Entry]\nType=Application\nName=Orbit Relay\nComment=Understand and repair Linux desktop issues\nExec="${executable}"\nIcon=orbit-relay\nTerminal=false\nCategories=System;\nStartupWMClass=orbit-relay\n`;
    await fs.writeFile(desktopFile, desktop, { mode: 0o644 });
  } catch (error) {
    if (promoted) await fs.rm(versionDir, { recursive: true, force: true });
    if (movedCurrent) await fs.rename(backup, versionDir);
    await fs.rm(stage, { recursive: true, force: true });
    throw error;
  }
  if (movedCurrent) await fs.rm(backup, { recursive: true });
  console.log(`Installed Orbit Relay ${version}. Open "Orbit Relay" from the application menu.`);
  console.log(`Launcher: ${desktopFile}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
