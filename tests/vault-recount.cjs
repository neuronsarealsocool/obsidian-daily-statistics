const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function setup() {
  let date = '2026-11-23';
  class TestDate extends Date {constructor(...args){super(...(args.length?args:[date+'T12:00:00+11:00']));}static now(){return new Date(date+'T12:00:00+11:00').getTime();}}
  const compiled = ts.transpileModule(fs.readFileSync('src/data/StatisticsDataManager.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, console, setTimeout, Date: TestDate,
    require: (name) => {
      if (name === 'dayjs') return { default: () => ({ format: () => date }) };
      if (name === './Settting') return { DailyStatisticsSettings: class {} };
      if (name === './mobile-journal' || name === './statistics-ledger') {
        const dependency = {}; const source = ts.transpileModule(fs.readFileSync('src/data/'+name.slice(2)+'.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
        vm.runInNewContext(source,{exports:dependency,console,Date:TestDate,Map,Set,require:()=>({})}); return dependency;
      }
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
    adapter: {exists: async()=>false},
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

test('the first mobile sync after midnight counts toward today only', async () => {
  const { manager, notes, setDate } = setup();
  await manager.recountVault();
  notes.set('existing.md', 'one two three');
  await manager.recountVault();
  setDate('2026-11-24');
  notes.set('existing.md', 'one two three four five');
  notes.set('mobile.md', 'new mobile note');
  await manager.recountVault();
  assert.equal(manager.data.dayCounts['2026-11-23'], 1);
  assert.equal(manager.data.dayCounts['2026-11-24'], 5);
  await manager.recountVault();
  assert.equal(manager.currentWordCount, 5);
});

test('saving after midnight rolls the baseline before the next recount', async () => {
  const { manager, notes, setDate } = setup();
  await manager.recountVault();
  notes.set('existing.md', 'one two three');
  await manager.recountVault();
  manager.data.currentManuallyModifyWordCount = 7;
  manager.updateCounts(false);
  manager.plugin.loadData = async () => ({});
  manager.plugin.saveData = async () => {};
  setDate('2026-11-24');
  await Object.getPrototypeOf(manager).saveStatisticsData.call(manager);
  assert.equal(manager.data.dayCounts['2026-11-23'], 8);
  assert.equal(manager.data.dayCounts['2026-11-24'], 0);
  notes.set('existing.md', 'one two three four');
  await manager.recountVault();
  assert.equal(manager.data.dayCounts['2026-11-24'], 1);
});

test('an editor note read crossing midnight is attributed to the new day', async () => {
  const { manager, setDate } = setup();
  await manager.recountVault();
  manager.app.vault.getFileByPath = (path) => ({ path });
  manager.app.vault.read = async () => {
    setDate('2026-11-24');
    return 'one two three';
  };
  await manager.updateWordCount(null, 'existing.md');
  assert.equal(manager.data.dayCounts['2026-11-23'], 0);
  assert.equal(manager.data.dayCounts['2026-11-24'], 1);
});

test('reloading yesterday\'s persisted baselines assigns synced growth to today', async () => {
  const { manager, notes, setDate } = setup();
  await manager.recountVault();
  notes.set('existing.md', 'one two three');
  await manager.recountVault();
  const persisted = JSON.parse(JSON.stringify(manager.data));
  setDate('2026-11-24');
  manager.plugin.loadData = async () => persisted;
  await manager.loadStatisticsData();
  notes.set('existing.md', 'one two three four');
  await manager.recountVault();
  assert.equal(manager.data.dayCounts['2026-11-23'], 1);
  assert.equal(manager.data.dayCounts['2026-11-24'], 1);
});
