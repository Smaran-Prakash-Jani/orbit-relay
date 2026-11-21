const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

(async () => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-smoke-'));
  const executablePath = process.env.RELAY_EXECUTABLE;
  const launch = executablePath ? { executablePath, args: [] } : { args: [path.resolve(__dirname, '..')] };
  const app = await electron.launch({ ...launch, env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }, timeout: 30000 });
  try {
    const window = await app.firstWindow();
    const errors = [];
    window.on('pageerror', error => errors.push(error.message));
    await window.waitForFunction(() => document.getElementById('system-line').textContent !== 'Checking this computer…');
    await fs.mkdir('test-results', { recursive: true });
    await window.screenshot({ path: 'test-results/overview-glass.png', animations: 'disabled' });
    assert.equal(await window.evaluate(() => typeof window.require), 'undefined');
    const preferences = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.sandbox, true);
    assert.equal(preferences.nodeIntegration, false);
    assert.equal(await window.locator('.header-nav .nav:visible').count(), 3, 'all three views are in the top navigation');
    assert.equal(await window.locator('body').evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
    assert.equal(await window.locator('#profile-os').innerText(), await window.locator('#system-line').innerText().then(value => value.split(' · ')[0]));
    const scan = await window.evaluate(() => window.relay.scan());
    if (scan.flatpak.status !== 'unknown') {
      const changed = scan.flatpak.apps.filter(item => item.hasUserOverrides).length;
      assert.equal(await window.locator('#changes-count').innerText(), String(changed));
      await window.getByRole('button', { name: 'Inspect changes' }).click();
      assert.equal(await window.locator('#changed-only').getAttribute('aria-pressed'), 'true');
      assert.equal(await window.locator('#app-list .app-row').count(), changed);
      await window.getByRole('button', { name: 'Changed only' }).click();
      assert.equal(await window.locator('#app-list .app-row').count(), scan.flatpak.apps.length);
      await window.getByRole('button', { name: 'Overview', exact: true }).click();
    }
    assert.ok((await window.getByRole('button', { name: 'Close window' }).boundingBox()).width >= 24);
    await window.getByRole('button', { name: 'Adjust transparency' }).click();
    const slider = window.locator('#transparency-popover [data-transparency-slider]');
    assert.equal(await slider.isVisible(), true);
    await window.screenshot({ path: 'test-results/transparency-popover.png', animations: 'disabled' });
    if (!executablePath) {
      const initial = await slider.inputValue();
      await slider.focus(); await slider.press('End');
      assert.equal(await window.locator('html').evaluate(element => element.style.getPropertyValue('--window-alpha')), '0.2');
      await window.reload();
      await window.waitForFunction(() => document.getElementById('system-line').textContent !== 'Checking this computer…');
      assert.equal(await slider.inputValue(), '80');
      await slider.evaluate((element, value) => { element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); }, initial);
    }
    await window.keyboard.press('Escape');
    assert.equal(await window.locator('#transparency-popover').isVisible(), false);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 600));
    await window.waitForFunction(() => innerWidth <= 820 && innerHeight <= 620);
    const layout = await window.evaluate(() => {
      const main = document.querySelector('main');
      const topbar = document.querySelector('.topbar');
      const before = topbar.getBoundingClientRect().top;
      main.scrollTop = 300;
      const result = { scroll: main.scrollTop, pageScroll: document.scrollingElement.scrollTop, viewport: [innerWidth, innerHeight], scrollHeight: main.scrollHeight, clientHeight: main.clientHeight, before,
        after: topbar.getBoundingClientRect().top };
      return result;
    });
    assert.ok(layout.scroll >= 100, `Relay scrolls inside the content pane at its minimum window size: ${JSON.stringify(layout)}`);
    assert.equal(layout.pageScroll, 0, 'Relay frame stays fixed');
    assert.equal(layout.after, layout.before, 'Relay topbar stays in place');
    await window.waitForFunction(() => document.querySelector('.topbar').classList.contains('is-scrolled'));
    assert.equal(await window.locator('.topbar').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(76, 57, 61)');
    await fs.mkdir('test-results', { recursive: true });
    await window.screenshot({ path: 'test-results/desktop-scrolled.png', animations: 'disabled' });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1240, 820));

    await window.getByRole('button', { name: 'Fix center', exact: true }).click();
    assert.equal(await window.locator('main').evaluate(element => element.scrollTop), 0, 'navigation resets the content scroll position');
    await window.locator('#app-list .app-row').first().waitFor();
    await window.locator('#app-list .app-row').first().click();
    await window.locator('#repair-detail h2').waitFor();
    await window.screenshot({ path: 'test-results/repairs.png', animations: 'disabled' });
    await window.getByRole('button', { name: 'Support report' }).click();
    await window.waitForFunction(() => document.getElementById('report-preview').textContent.includes('"appCount"'));
    assert.equal(await window.locator('.report-toolbar').isVisible(), true, 'report actions stay above the long preview');
    await window.screenshot({ path: 'test-results/report.png', animations: 'disabled' });
    const preview = JSON.parse(await window.locator('#report-preview').textContent());
    const reportPath = path.join(fixture, 'report.json');
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, reportPath);
    await window.getByRole('button', { name: 'Save JSON report' }).click();
    await window.getByText('Support report saved.').waitFor();
    const saved = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    assert.deepEqual(saved, preview);
    await window.getByRole('button', { name: 'Overview' }).click();
    await fs.mkdir('test-results', { recursive: true });
    await window.screenshot({ path: 'test-results/desktop.png', animations: 'disabled' });
    assert.deepEqual(errors, []);
    console.log('Desktop smoke passed: transparency control, scan, app preview, report export, renderer isolation.');
  } finally {
    await app.close();
    await fs.rm(fixture, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
