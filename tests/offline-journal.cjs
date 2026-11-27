const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');
const modules={};function load(name){if(modules[name])return modules[name];const exports={};const code=ts.transpileModule(fs.readFileSync('src/data/'+name+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(code,{exports,console,Date,Map,Set,require:n=>load(n.replace('./',''))});return modules[name]=exports;}
const {MobileJournalReader,parseMobileRecord}=load('mobile-journal');const {StatisticsLedger,fingerprint}=load('statistics-ledger');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');const device=uuid(999);
function record(n,before,after,iso){const time=Date.parse(iso);return {schema:1,id:uuid(n),deviceId:device,path:'note.md',kind:'edit',previousContent:before,content:after,capturedAt:new Date(time+1000).toISOString(),modifiedAt:time,day:new Date(time+660*60000).toISOString().slice(0,10),offsetMinutes:660,basis:'file-mtime'};}
const measure=text=>({hash:fingerprint(text),count:text.trim()?text.trim().split(/\s+/).length:0});
test('recovering missing history preserves explicit zeroes and does not double ledger contributions',()=>{
 const ledger=new StatisticsLedger(StatisticsLedger.create({'2026-11-24':0}),measure);
 ledger.import([record(90,'one','one two','2026-11-25T00:00Z')],()=>true);
 ledger.restoreMissingDays({'2026-05-01':78,'2026-11-24':10,'2026-11-25':1});
 assert.equal(ledger.totals()['2026-05-01'],78);
 assert.equal(ledger.totals()['2026-11-24'],0);
 assert.equal(ledger.totals()['2026-11-25'],1);
 ledger.restoreMissingDays(ledger.totals());
 assert.equal(ledger.totals()['2026-11-25'],1);
});
test('late and out-of-order journal corrects desktop estimate without double counting, even with partial chains',()=>{
 const state=StatisticsLedger.create({'2026-11-20':42});const ledger=new StatisticsLedger(state,measure);
 ledger.observe('note.md','one',Date.parse('2026-11-23T00:00Z'),'baseline');
 ledger.observe('note.md','one two three',Date.parse('2026-11-26T00:00Z'),'file-mtime-estimate');
 const currentDay=new Date(Date.parse('2026-11-26T00:00Z'));const today=currentDay.getFullYear()+'-'+String(currentDay.getMonth()+1).padStart(2,'0')+'-'+String(currentDay.getDate()).padStart(2,'0');
 assert.equal(ledger.totals()[today],2);
 const a=record(1,'one','one two','2026-11-24T00:00Z'),b=record(2,'one two','one two three','2026-11-25T00:00Z');
 ledger.import([b],()=>true);assert.equal(ledger.totals()[today],1);assert.equal(ledger.totals()['2026-11-25'],1);
 ledger.import([a,b,b],()=>true);assert.equal(ledger.totals()[today],0);assert.equal(ledger.totals()['2026-11-24'],1);assert.equal(ledger.totals()['2026-11-25'],1);assert.equal(ledger.totals()['2026-11-20'],42);
 const reopened=new StatisticsLedger(JSON.parse(JSON.stringify(state)),measure);reopened.import([b,a],()=>true);assert.deepEqual(reopened.totals(),ledger.totals());
});
test('deletions, rewrites, baseline snapshots and excluded files do not inflate writing',()=>{
 const ledger=new StatisticsLedger(StatisticsLedger.create({}),measure);
 const a=record(3,'one','one two three','2026-11-24T00:00Z'),b=record(4,'one two three','one two','2026-11-24T00:01Z');
 ledger.import([a,b,{...a,id:uuid(5),kind:'baseline'}],()=>true);assert.equal(ledger.totals()['2026-11-24'],1);
 const excluded=record(6,'','many words here','2026-11-25T00:00Z');excluded.path='Templates/x.md';ledger.import([excluded],p=>!p.startsWith('Templates/'));assert.equal(ledger.totals()['2026-11-25'],undefined);
});
test('reader retries partial Resilio writes, ignores staging files, validates identity, timezone and safe paths',async()=>{
 const r=record(7,'one','two words','2026-11-25T14:00Z');const folder='_mobile-edit-history/v1/'+device,file=folder+'/'+r.id+'.json';let content='{',mtime=1;const errors=[];
 const adapter={exists:async()=>true,list:async p=>p.endsWith('/v1')?{files:[],folders:[folder]}:{files:[file,file+'.part'],folders:[]},stat:async()=>({mtime,size:content.length}),read:async()=>content};
 const reader=new MobileJournalReader(adapter,(p,e)=>errors.push(p));assert.equal((await reader.readAll()).length,0);assert.equal(errors.length,1);
 content=JSON.stringify(r);mtime++;assert.equal((await reader.readAll())[0].day,'2026-11-26');assert.equal((await reader.readAll()).length,1);
 assert.throws(()=>parseMobileRecord(JSON.stringify({...r,path:'../escape.md'})));
 assert.throws(()=>parseMobileRecord(JSON.stringify({...r,day:'2026-11-25'})));
 assert.throws(()=>parseMobileRecord(JSON.stringify({...r,path:'.obsidian/config.md'})));
});
