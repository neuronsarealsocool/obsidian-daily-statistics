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
  const backupFiles = new Map();
  manager.today = date;
  manager.loadingData = true;
  manager.plugin = {
    settings: { statisticsWord: true },
    shouldCountFile: (path) => !path.startsWith('Templates/'),
    isTemplateFile: (path) => path.startsWith('Templates/'),
    stripDailyTotalWordCountText: (text) => text.replace(/<todaystotalwordcount>/g, ''),
  };
  manager.app = { vault: {
    adapter: {
      exists: async(path)=>backupFiles.has(path),
      read: async(path)=>backupFiles.get(path),
      write: async(path,text)=>{backupFiles.set(path,text);},
      rename: async(from,to)=>{
        if (backupFiles.has(to)) throw new Error('Destination file already exists!');
        backupFiles.set(to,backupFiles.get(from));backupFiles.delete(from);
      },
    },
    getMarkdownFiles: () => [...notes.keys()].map((path) => ({ path })),
    read: async (file) => notes.get(file.path),
  } };
  let saves = 0;
  manager.saveStatisticsData = async () => { saves++; };
  return { manager, notes, backupFiles, setDate: (value) => { date = value; }, saves: () => saves };
}

test('loading an existing empty ledger preserves all legacy calendar history', async () => {
  const {manager} = setup();
  const history = {'2026-05-01': 78, '2026-11-22': 42};
  manager.plugin.loadData = async () => ({dayCounts: history,
    offlineLedger: {schema:1,base:{},manual:{},snapshots:{},observations:[],mobile:{}}});
  await manager.loadStatisticsData();
  assert.equal(manager.data.dayCounts['2026-05-01'], 78);
  assert.equal(manager.data.dayCounts['2026-11-22'], 42);
  manager.updateCounts(false);
  assert.equal(manager.data.offlineLedger.base['2026-05-01'], 78);
});

test('independent backup recovers dates after data.json is reset without doubling current totals', async () => {
  const {manager, backupFiles} = setup();
  manager.data.dayCounts = {'2026-05-01':78,'2026-11-22':42};
  manager.plugin.loadData = async () => ({});
  manager.plugin.saveData = async () => {};
  await Object.getPrototypeOf(manager).saveStatisticsData.call(manager);
  const backup = '.obsidian/plugins/daily-statistics/statistics-history.json';
  assert.equal(JSON.parse(backupFiles.get(backup))['2026-05-01'],78);
  manager.plugin.loadData = async () => ({dayCounts:{'2026-11-23':9},
    offlineLedger:{schema:1,base:{'2026-11-23':9},manual:{},snapshots:{},observations:[],mobile:{}}});
  await manager.loadStatisticsData();
  assert.equal(manager.data.dayCounts['2026-05-01'],78);
  assert.equal(manager.data.dayCounts['2026-11-22'],42);
  assert.equal(manager.data.dayCounts['2026-11-23'],9);
});

test('failed independent backup prevents overwriting the primary statistics file', async () => {
  const {manager} = setup();
  let saved = false;
  manager.data.dayCounts = {'2026-05-01':78};
  manager.plugin.loadData = async () => ({});
  manager.plugin.saveData = async () => {saved = true;};
  manager.app.vault.adapter.write = async () => {throw new Error('disk unavailable');};
  await Object.getPrototypeOf(manager).saveStatisticsData.call(manager);
  assert.equal(saved,false);
});

test('goal backup restores missing targets and preserves intentional zero or changed goals', async () => {
  const {manager, backupFiles} = setup();
  manager.data.weeklyPlan = {'2026_33':350,'2026_40':420,'2026_41':350};
  manager.plugin.loadData = async () => ({});
  manager.plugin.saveData = async () => {};
  await Object.getPrototypeOf(manager).saveStatisticsData.call(manager);
  const backup = '.obsidian/plugins/daily-statistics/statistics-goals.json';
  assert.equal(JSON.parse(backupFiles.get(backup))['2026_33'],350);
  manager.plugin.loadData = async () => ({weeklyPlan:{'2026_40':0,'2026_41':700}});
  await manager.loadStatisticsData();
  assert.equal(manager.data.weeklyPlan['2026_33'],350);
  assert.equal(manager.data.weeklyPlan['2026_40'],0);
  assert.equal(manager.data.weeklyPlan['2026_41'],700);
});

test('repeated saves update existing backups and primary data through the Obsidian adapter', async () => {
  const {manager, backupFiles} = setup();
  const saved = [];
  manager.plugin.loadData = async () => ({});
  manager.plugin.saveData = async data => {saved.push(JSON.parse(JSON.stringify(data)));};
  manager.data.weeklyPlan = {'2026_33':350};
  const save = () => Object.getPrototypeOf(manager).saveStatisticsData.call(manager);
  await save();
  await manager.updateWordCount('one two', 'existing.md');
  await manager.updateWordCount('one two three', 'existing.md');
  await save();
  manager.data.weeklyPlan['2026_33'] = 420;
  await manager.updateWordCount('one two three four', 'existing.md');
  await save();
  assert.equal(saved.at(-1).dayCounts['2026-11-23'],2);
  assert.equal(JSON.parse(backupFiles.get('.obsidian/plugins/daily-statistics/statistics-history.json'))['2026-11-23'],2);
  assert.equal(JSON.parse(backupFiles.get('.obsidian/plugins/daily-statistics/statistics-goals.json'))['2026_33'],420);
});

test('a partially written backup is recovered from its staged complete copy', async () => {
  const {manager, backupFiles} = setup();
  const path = '.obsidian/plugins/daily-statistics/statistics-history.json';
  backupFiles.set(path, '{');
  backupFiles.set(path+'.tmp', JSON.stringify({'2026-05-01':78}));
  manager.plugin.loadData = async () => ({});
  await manager.loadStatisticsData();
  assert.equal(manager.data.dayCounts['2026-05-01'],78);
});

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
