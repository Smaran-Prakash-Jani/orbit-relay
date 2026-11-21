const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createRelay } = require('./core.cjs');

const index = path.join(__dirname, '..', 'ui', 'index.html');
let window;
let relay;
let reportSnapshot;

function handle(name, callback) {
  ipcMain.handle(`relay:${name}`, async (event, ...args) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== pathToFileURL(index).href) throw new Error('Untrusted request.');
    return callback(...args);
  });
}

function createWindow() {
  window = new BrowserWindow({
    width: 1240, height: 820, minWidth: 800, minHeight: 600,
    frame: false, transparent: true, backgroundColor: '#00000000', title: 'Orbit Relay', icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  window.on('closed', () => { window = null; });
  window.loadFile(index);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  relay = createRelay({ dataDir: app.getPath('userData') });
  handle('scan', () => relay.scan());
  handle('preview', id => relay.preview(id));
  handle('reset', id => relay.reset(id));
  handle('undo', token => relay.undo(token));
  handle('pending-undo', () => relay.pendingUndo());
  handle('report', async () => { reportSnapshot = await relay.report(); return reportSnapshot; });
  handle('export', async () => {
    const report = reportSnapshot || await relay.report();
    const choice = await dialog.showSaveDialog(window, {
      title: 'Save support report',
      defaultPath: `Orbit-Relay-report-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON report', extensions: ['json'] }]
    });
    if (choice.canceled || !choice.filePath) return { saved: false };
    await fs.writeFile(choice.filePath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    return { saved: true };
  });
  handle('window', action => {
    if (action === 'minimize') window.minimize();
    else if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    else if (action === 'close') window.close();
    else throw new Error('Unknown window action.');
  });
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
