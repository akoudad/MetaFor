const assert = require('node:assert/strict');
const { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('@playwright/test');
const asar = require('@electron/asar');

(async () => {
  const root = process.cwd();
  const bundle = path.resolve(process.argv[2] || path.join(root, 'artifacts/mac/mac-arm64/Metafor.app/Contents/Resources/app.asar'));
  const executable = process.argv[3] || path.resolve(bundle, '../../MacOS/Metafor');
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'metafor-native-profile-'));
  const wrapper = path.join(scratch, 'hidden.cjs');
  // Real packaged main/preload/renderer and Chromium storage; only native
  // presentation, tray and global shortcuts are suppressed during this check.
  // Keychain uses a synthetic fixture; no real credential or provider is used.
  await writeFile(wrapper, `
const Module = require('node:module');
const electron = require('electron');
const load = Module._load;
global.__profileRequests = 0;
global.__profileMode = 'blocked';
global.fetch = async (url, init) => {
  global.__profileRequests++;
  if (global.__profileMode === 'blocked') throw new Error('Unexpected provider request in profile check.');
  if (global.__profileMode === 'rejected') return new Response('Fixture rejection', { status: 401 });
  if (String(url) === 'https://api.meta.ai/v1/models') return Response.json({ data: [{ id: 'muse-spark-1.3' }] });
  if (String(url) !== 'https://api.meta.ai/v1/chat/completions') throw new Error('Unexpected fixture URL.');
  const schema = JSON.parse(init.body).response_format.json_schema.name;
  const answer = schema === 'metafor_organization'
    ? { reason: 'One answer.', overview: '', primary: { decision: 'continue', title: 'Explanation', summary: 'A short explanation.', sectionIds: ['s0'], sourceIds: [] }, topics: [] }
    : { decision: 'continue', reason: 'One answer.', title: 'Explanation', summary: 'A short explanation.', sections: [{ title: 'Explanation', body: 'A short explanation.' }], related: [] };
  return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer) } }] });
};
class HiddenWindow extends electron.BrowserWindow {
  constructor(options) { super({ ...options, show: false }); }
  show() {} showInactive() {} focus() {}
}
const silent = new Proxy(electron, { get(target, key) {
  if (key === 'safeStorage') return { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async value => Buffer.from(value), decryptStringAsync: async value => ({ result: value.toString(), shouldReEncrypt: false }) };
  if (key === 'BrowserWindow') return HiddenWindow;
  if (key === 'Tray') return class { setToolTip() {} setContextMenu() {} };
  if (key === 'globalShortcut') return { isRegistered: () => false, register: () => true, unregister() {}, unregisterAll() {} };
  if (key === 'Menu') return { buildFromTemplate: () => ({}), setApplicationMenu() {} };
  return target[key];
} });
Module._load = function(id, ...args) { return id === 'electron' ? silent : load.call(this, id, ...args); };
electron.app.whenReady().then(() => electron.app.dock?.hide());
require(${JSON.stringify(path.join(bundle, 'main.cjs'))});
`);
  // Packaged Electron ignores command-line app entrypoints. Use its unchanged
  // executable/frameworks in a temporary app copy with a test-only bootstrap;
  // the bootstrap above loads the original production ASAR without editing it.
  const runtime = path.join(scratch, 'Metafor.app');
  await cp(path.resolve(executable, '../../..'), runtime, { recursive: true, verbatimSymlinks: true, mode: require('node:fs').constants.COPYFILE_FICLONE });
  assert.deepEqual(await readFile(path.join(runtime, 'Contents/MacOS', path.basename(executable))), await readFile(executable));
  const runtimeBundle = path.join(runtime, 'Contents/Resources/app.asar');
  await rename(runtimeBundle, `${runtimeBundle}.original`);
  const bootstrap = path.join(scratch, 'bootstrap');
  await mkdir(bootstrap);
  await writeFile(path.join(bootstrap, 'package.json'), JSON.stringify({ name: 'metafor-profile-check', version: '1.0.0', main: 'main.cjs' }));
  await writeFile(path.join(bootstrap, 'main.cjs'), `require(${JSON.stringify(wrapper)});`);
  await asar.createPackage(bootstrap, runtimeBundle);
  let app;
  const report = { packagedVersion: JSON.parse(asar.extractFile(bundle, 'package.json')).version, bundleEntries: asar.listPackage(bundle), fresh: [], persistence: null };
  const launch = async (name, configured = false) => {
    const env = { ...process.env, METAFOR_USER_DATA: path.join(scratch, name), METAFOR_IMPORT_MODEL: '' };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: path.join(runtime, 'Contents/MacOS', path.basename(executable)), args: [], cwd: root, env });
    const page = await app.firstWindow();
    await page.waitForFunction(() => { const input = document.querySelector('textarea[aria-label="Your question"]'); return input && !input.disabled; });
    await page.waitForFunction(async () => !(await window.metaforDesktop.getSettings()).credentialLoading);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isVisible())), false);
    const settings = await page.evaluate(() => window.metaforDesktop.getSettings());
    assert.equal(settings.storagePath, path.join(scratch, name));
    assert.equal(settings.configured, configured);
    assert.equal(settings.hasSavedKey, configured);
    assert.deepEqual(await page.evaluate(() => window.metaforDesktop.listHelp()), []);
    return page;
  };
  const inspect = (page) => page.evaluate(async () => {
    const snapshots = await new Promise((resolve, reject) => {
      const open = indexedDB.open('metaphore-spaces');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('snapshots')) { db.close(); resolve([]); return; }
        const transaction = db.transaction('snapshots', 'readonly');
        const read = transaction.objectStore('snapshots').getAll();
        read.onsuccess = () => resolve(read.result.map(value => JSON.parse(value))); read.onerror = () => reject(read.error);
        transaction.oncomplete = () => db.close();
      };
    });
    return { welcome: !!document.querySelector('.welcome'), topics: document.querySelectorAll('[data-topic]').length, draft: document.querySelector('textarea[aria-label="Your question"]').value, snapshots };
  });
  try {
    let page = await launch('profile-a');
    const first = await inspect(page);
    assert.equal(first.welcome, true); assert.equal(first.topics, 0); assert.equal(first.draft, ''); assert.deepEqual(first.snapshots, []);
    report.fresh.push({ profile: 'a', ...first });
    await page.getByRole('button', { name: 'Add API key' }).click();
    await page.getByRole('heading', { name: 'Connect Metafor' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Close settings' }).count(), 1);
    assert.equal(await page.getByLabel('API key', { exact: true }).getAttribute('required'), '');
    await page.getByRole('button', { name: 'Save settings' }).click();
    assert.equal(await page.evaluate(() => document.querySelector('input[type=password]').validity.valueMissing), true);
    await assert.rejects(page.evaluate(async () => {
      const value = await window.metaforDesktop.getSettings();
      await window.metaforDesktop.saveSettings({ model: value.model, baseURL: value.baseURL, shortcut: value.shortcut });
    }), /Enter your API key/);
    await mkdir(path.join(root, 'artifacts/qa'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'artifacts/qa/first-run-key-setup.png') });
    assert.equal(await app.evaluate(() => global.__profileRequests), 0);
    await app.close(); app = null;
    page = await launch('profile-a');
    await page.getByRole('heading', { name: 'Connect Metafor' }).waitFor();
    await page.getByLabel('API key', { exact: true }).fill('synthetic-profile-test-key');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await page.getByText('Settings saved on this Mac. Provider access has not been checked.').waitFor();
    await app.evaluate(() => { global.__profileMode = 'rejected'; });
    await page.getByRole('button', { name: 'Check connection', exact: true }).click();
    await page.getByText('The API key could not list models. Check it in Settings.').waitFor();
    await app.evaluate(() => { global.__profileMode = 'accepted'; });
    await page.getByRole('button', { name: 'Check connection', exact: true }).click();
    await page.getByText('Connection verified: API key accepted and selected model available.').waitFor();
    await page.screenshot({ path: path.join(root, 'artifacts/qa/first-run-connection-checked.png') });
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal((await page.evaluate(() => window.metaforDesktop.getSettings())).configured, true);
    report.setup = { requiredForAI: true, blankKeyRejected: true, keylessRelaunchShowsSetup: true, savedKeyReported: true, rejectedKeyReported: true, verifiedFixtureAccessReported: true };
    await page.getByRole('textbox', { name: 'Your question' }).fill('Profile fixture question');
    await page.getByRole('button', { name: 'Send question', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-message-id]') && !document.querySelector('.pending-answer'));
    await page.waitForFunction(() => document.querySelector('.save-status')?.textContent === 'Saved locally');
    const created = await inspect(page);
    assert.equal(created.snapshots.length, 1);
    assert.equal(created.snapshots[0].conversation.explorations.root.messages.length, 2);
    report.stubbedProviderRequests = await app.evaluate(() => global.__profileRequests);
    await page.getByLabel('Import conversation file').setInputFiles(path.join(root, 'examples/browser-cache.ingx'));
    await page.waitForFunction(() => document.querySelectorAll('[data-topic]').length > 0);
    const draft = 'Native profile persistence check — unsent draft';
    await page.getByRole('textbox', { name: 'Your question' }).fill(draft);
    await page.waitForFunction(() => document.querySelector('.save-status')?.textContent === 'Saved locally');
    const before = await inspect(page);
    assert.equal(before.snapshots.length, 2); assert.equal(before.draft, draft);
    assert.ok(before.snapshots.some(value => value.conversation.title === 'HTTP Caching: Freshness and Revalidation'));
    assert.ok(before.snapshots.some(value => Object.keys(value.conversation.explorations).length === 2));
    await app.close(); app = null;
    page = await launch('profile-a', true);
    const after = await inspect(page);
    assert.equal(after.welcome, false); assert.equal(after.draft, draft);
    assert.deepEqual(after.snapshots.map(x => x.conversation), before.snapshots.map(x => x.conversation));
    await page.evaluate(() => window.metaforDesktop.openSettings());
    await page.getByRole('button', { name: 'Remove key', exact: true }).click();
    await page.getByRole('button', { name: 'Browse saved chats', exact: true }).click();
    await page.getByLabel('API key setup').waitFor();
    assert.deepEqual((await inspect(page)).snapshots.map(x => x.conversation), before.snapshots.map(x => x.conversation));
    await page.screenshot({ path: path.join(root, 'artifacts/qa/first-run-browse-without-key.png') });
    report.setup.savedChatsAccessibleWithoutKey = true;
    report.persistence = { savedChats: after.snapshots.length, topics: after.topics, unchangedConversations: true, newlyCreatedChatRestored: true, importedChatRestored: true, draftRestored: true };
    assert.equal(await app.evaluate(() => global.__profileRequests), 0);
    await app.close(); app = null;
    page = await launch('profile-a');
    await page.getByRole('button', { name: 'Browse saved chats', exact: true }).click();
    await page.getByLabel('API key setup').waitFor();
    assert.deepEqual((await inspect(page)).snapshots.map(x => x.conversation), before.snapshots.map(x => x.conversation));
    report.persistence.keylessRelaunchKeptSavedChats = true;
    assert.equal(await app.evaluate(() => global.__profileRequests), 0);
    await app.close(); app = null;
    page = await launch('profile-b');
    const other = await inspect(page);
    assert.equal(other.welcome, true); assert.equal(other.topics, 0); assert.equal(other.draft, ''); assert.deepEqual(other.snapshots, []);
    report.fresh.push({ profile: 'b', ...other });
    assert.equal(await app.evaluate(() => global.__profileRequests), 0);
    await app.close(); app = null;
    assert.deepEqual(report.bundleEntries.filter(name => /indexeddb|local storage|preferences\.json|credential\.enc|\.ingx$/i.test(name)), []);
    report.nativePresentationSuppressed = true;
    report.keychainMocked = true;
    report.externalProviderRequests = 0;
    report.packagedExecutable = true;
    report.testBootstrapInTemporaryAppCopy = true;
    report.productionAsarUnmodified = true;
    report.providerResponsesMocked = true;
    report.completedAt = new Date().toISOString();
    await writeFile(path.join(root, 'artifacts/qa/first-run-profile-result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { if (app) await app.close(); await rm(scratch, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
