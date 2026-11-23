const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function setup() {
  let date = '2026-11-23';
  const compiled = ts.transpileModule(fs.readFileSync('src/data/StatisticsDataManager.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, console, setTimeout,
    require: (name) => {
      if (name === 'dayjs') return { default: () => ({ format: () => date }) };
      if (name === './Settting') return { DailyStatisticsSettings: class {} };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  const manager = new exports.DailyStatisticsDataManager();
  const notes = new Map([['existing.md', 'one two'], ['Templates/base.md', 'ignored words']]);
  manager.today = date;
  manager.loadingData = true;
  manager.plugin = {
    settings: { statisticsWord: true },
    shouldCountFile: (path) => !path.startsWith('Templates/'),
    isTemplateFile: (path) => path.startsWith('Templates/'),
    stripDailyTotalWordCountText: (text) => text.replace(/<todaystotalwordcount>/g, ''),
  };
  manager.app = { vault: {
    getMarkdownFiles: () => [...notes.keys()].map((path) => ({ path })),
    read: async (file) => notes.get(file.path),
  } };
  let saves = 0;
  manager.saveStatisticsData = async () => { saves++; };
  return { manager, notes, setDate: (value) => { date = value; }, saves: () => saves };
}

test('baseline, external edits and imports, exclusions, and repeated scans', async () => {
  const { manager, notes, saves } = setup();
  manager.data.dayCounts['2026-11-22'] = 120;
  await manager.recountVault();
  assert.equal(manager.currentWordCount, 0);
  assert.equal(manager.data.todayWordCount['Templates/base.md'], undefined);
  notes.set('existing.md', 'one two three');
  notes.set('mobile.md', '---\ntitle: ignored metadata\n---\nfour five <todaystotalwordcount>');
  await manager.recountVault();
  assert.equal(manager.currentWordCount, 3);
  await manager.recountVault();
  assert.equal(manager.currentWordCount, 3);
  assert.equal(manager.data.dayCounts['2026-11-22'], 120);
  assert.equal(saves(), 3);
});

test('preserves tracked progress and manual adjustment on initial baseline', async () => {
  const { manager, notes } = setup();
  manager.data.todayWordCount['existing.md'] = { initial: 1, current: 2 };
  manager.data.currentManuallyModifyWordCount = 9;
  notes.set('existing.md', 'one two three');
  await manager.recountVault();
  assert.equal(manager.currentWordCount, 11);
});

test('midnight establishes a fresh baseline and preserves the previous day', async () => {
  const { manager, notes, setDate } = setup();
  await manager.recountVault();
  notes.set('existing.md', 'one two three');
  await manager.recountVault();
  setDate('2026-11-24');
  await manager.recountVault();
  assert.equal(manager.currentWordCount, 0);
  assert.equal(manager.data.dayCounts['2026-11-23'], 1);
  notes.set('existing.md', 'one two three four');
  await manager.recountVault();
  assert.equal(manager.currentWordCount, 1);
});

test('a concurrent editor update is not overwritten by the scan', async () => {
  const { manager } = setup();
  await manager.recountVault();
  manager.app.vault.read = async () => {
    manager.data.todayWordCount['existing.md'].current = 4;
    return 'one two three';
  };
  await manager.recountVault();
  assert.equal(manager.currentWordCount, 2);
});

test('cancelled scans do not save or replace the baseline', async () => {
  const { manager, saves } = setup();
  await manager.recountVault(() => true);
  assert.equal(saves(), 0);
  assert.equal(manager.data.vaultRecountDate, '');
});
