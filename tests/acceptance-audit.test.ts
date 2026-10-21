import { afterEach, describe, expect, it } from 'vitest'
import { cp, mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { start, type RunningServer } from '../server/server'
import { acquireOwner, LOCK_OPTIONS } from '../core/owner'
import { loadConfig } from '../core/config'
import { planInit, scopedRead, initPaths } from '../core/init'
import { ProjectSync } from '../src/data/sync'
import { DraftManager } from '../src/data/drafts'

const roots: string[] = []
const servers: RunningServer[] = []
const T3 = 'docs/tasks/T-003-inspector.md'
async function temp(){ const p=await mkdtemp(path.join(tmpdir(),'nodit-extra-')); roots.push(p); return p }
async function fixture(){ const p=await temp(); await cp(path.resolve('examples/demo'),p,{recursive:true,filter:s=>!s.includes('/.nodit/')||!/(writer\.lock|owner\.json|token)/.test(s)}); return p }
async function serve(root:string){const s=await start({root,port:0});servers.push(s);return s}
function doc(s:RunningServer,p=T3){return s.project.snapshot().docs.find(d=>d.path===p)!}
async function send(s:RunningServer,method:string,p:string,body:unknown){ const base=`http://127.0.0.1:${s.port}`;return fetch(base+p,{method,headers:{Origin:base,'X-Nodit-Token':s.owner.token,'Content-Type':'application/json'},body:JSON.stringify(body)}) }
function defer<T=any>(){let resolve!:(x:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve}}
const sleep=(n:number)=>new Promise(r=>setTimeout(r,n))
afterEach(async()=>{await Promise.all(servers.splice(0).map(s=>s.close()));await Promise.all(roots.splice(0).map(p=>rm(p,{recursive:true,force:true})))})

describe('independent acceptance probes',()=>{
 it('A01 retains last valid card when external YAML becomes invalid',async()=>{
  const root=await fixture(),s=await serve(root);const original=doc(s).card;
  await writeFile(path.join(root,T3),'---\nid: [\n---\n');await s.project.rescan();
  expect(doc(s).card).toEqual(original);expect(doc(s).diagnostics.some(d=>d.code==='yaml-invalid')).toBe(true)
 })
 it('A02 raw rejects invalid priority schema without writing',async()=>{
  const root=await fixture(),s=await serve(root),d=doc(s);const before=await readFile(path.join(root,T3),'utf8');
  const r=await send(s,'PUT',`/api/docs/${d.docKey}/raw`,{baseRevision:d.revision,text:before.replace('priority: medium','priority: urgent')});
  expect(r.status).toBe(422);expect(await readFile(path.join(root,T3),'utf8')).toBe(before)
 })
 it('A03 raw rejects milestone relation pointing to task',async()=>{
  const root=await fixture(),s=await serve(root),d=doc(s);const before=await readFile(path.join(root,T3),'utf8');
  const r=await send(s,'PUT',`/api/docs/${d.docKey}/raw`,{baseRevision:d.revision,text:before.replace('milestone: MS-01','milestone: T-001')});expect(r.status).toBe(422)
 })
 it('A04 link API rejects implements pointing to task',async()=>{
  const root=await fixture(),s=await serve(root),d=doc(s);const r=await send(s,'PATCH',`/api/docs/${d.docKey}/links`,{baseRevision:d.revision,add:[{rel:'implements',to:'T-001'}]});expect(r.status).toBe(422)
 })
 it('A05 scanned docKey never represents outside-scope symlink target',async()=>{
  const root=await fixture(),outside=await temp();
  await writeFile(path.join(outside,'secret.md'),'---\nid: T-090\ntype: task\ntitle: outside secret marker\nstatus: todo\n---\n\n## Description\nprivate outside bytes\n');
  await symlink(path.join(outside,'secret.md'),path.join(root,'docs/tasks/T-090-secret.md'));
  const s=await serve(root);expect(s.project.snapshot().docs.some(d=>d.card?.title==='outside secret marker')).toBe(false)
 })
 it('A06 owner lock refuses .nodit symlink escaping project',async()=>{
  const root=await temp(),outside=await temp();await symlink(outside,path.join(root,'.nodit'));let acquired=false;
  try{const owner=await acquireOwner(root,'cli');acquired=true;await owner.release()}catch{}
  expect(acquired).toBe(false)
 })
 it('A07 transient invalid config retains prior config paths',async()=>{
  const root=await fixture(),s=await serve(root);const first=s.project.snapshot();
  await writeFile(path.join(root,'nodit.config.json'),'{');await s.project.rescan();
  expect(s.project.snapshot().projectId).toBe(first.projectId)
 })
 it('A08 no-ai plan does not inspect unrelated AI symlink',async()=>{
  const root=await temp(),outside=await temp();await writeFile(path.join(outside,'AGENTS.md'),'unrelated');await symlink(path.join(outside,'AGENTS.md'),path.join(root,'AGENTS.md'));
  const {config}=await loadConfig(root);const p=await planInit(scopedRead(root,initPaths(config)),config,false,false);expect(p.items.every(i=>i.group==='core')).toBe(true)
 })
 it('A09 config null surfaces diagnostics rather than crashing',async()=>{
  const root=await temp();await writeFile(path.join(root,'nodit.config.json'),'null');const r=await loadConfig(root);expect(r.diagnostics.some(d=>d.level==='error')).toBe(true)
 })
 it('A10 old connection generation initial response is ignored',async()=>{
  const requests:any[]=[];const applied:any[]=[];let handlers:any;
  const fake:any={connGen:0,getProject:()=>{const d=defer();requests.push(d);return d.promise},subscribe:(h:any)=>{handlers=h;return()=>{}}};
  const sync=new ProjectSync(fake,{apply:e=>applied.push(e),connection:()=>{},compromised:()=>{},error:()=>{}});sync.start();
  fake.connGen++;handlers.hello({projectId:'p',sessionId:'s',rev:2});requests[0].resolve({projectId:'p',sessionId:'s',rev:1});await sleep(0);expect(applied).toHaveLength(0);sync.stop()
 })
 it('A11 SSE hello gap converges and delayed old snapshot cannot regress state',async()=>{
  const requests:any[]=[],applied:any[]=[];let handlers:any;
  const fake:any={connGen:0,getProject:()=>{const d=defer();requests.push(d);return d.promise},subscribe:(h:any)=>{handlers=h;return()=>{}}};
  const sync=new ProjectSync(fake,{apply:e=>applied.push(e),connection:()=>{},compromised:()=>{},error:()=>{}});sync.start();requests[0].resolve({projectId:'p',sessionId:'s1',rev:1});await sleep(0);
  fake.connGen++;handlers.hello({projectId:'p',sessionId:'s1',rev:3});requests[1].resolve({projectId:'p',sessionId:'s1',rev:3});await sleep(0);
  const a=sync.fetch();fake.connGen++;handlers.hello({projectId:'p',sessionId:'s2',rev:1});requests[3].resolve({projectId:'p',sessionId:'s2',rev:1});await sleep(0);requests[2].resolve({projectId:'p',sessionId:'s1',rev:99});await a;
  expect(applied.map(x=>[x.sessionId,x.rev])).toEqual([['s1',1],['s1',3],['s2',1]]);sync.stop()
 })
 it('A12 in-flight only 500 keeps draft and never reports saved',async()=>{
  const d=defer(),saved:any[]=[];const drafts=new DraftManager(()=>d.promise,(_k,r)=>saved.push(r),10000);drafts.edit('d','r0','title','mine');const f=drafts.flush('d');d.resolve({ok:false,reason:'error',message:'500'});await f;
  expect(drafts.view('d')).toMatchObject({status:'error',values:{title:'mine'}});expect(saved).toHaveLength(0);drafts.discard('d')
 })
 it('A13 lock before listen refuses second server and compromised queue rejects writes',async()=>{
  const root=await fixture(),owner=await acquireOwner(root,'cli');await expect(start({root,port:0})).rejects.toThrow();await owner.release();
  const s=await serve(root),d=doc(s);s.owner.markCompromised(new Error('audit simulated'));const r=await send(s,'PATCH',`/api/docs/${d.docKey}`,{baseRevision:d.revision,fields:{title:'blocked'}});expect(r.status).toBe(503)
 })
 it('A14 rename and atomic save retain ID/layout and recover after invalid raw',async()=>{
  const root=await fixture(),s=await serve(root),old=doc(s);const renamed='docs/tasks/T-003-renamed.md';
  await rename(path.join(root,T3),path.join(root,renamed));await s.project.rescan();expect(doc(s,renamed).card?.id).toBe(old.card?.id);expect(doc(s,renamed).docKey).not.toBe(old.docKey);
  const before=await readFile(path.join(root,renamed),'utf8');await writeFile(path.join(root,renamed+'.tmp'),before.replace('側欄編輯器','atomic save'));await rename(path.join(root,renamed+'.tmp'),path.join(root,renamed));await sleep(400);
  expect(doc(s,renamed).card?.title).toBe('atomic save')
 })
 it('A15 no-op metadata leaves revision and mtime unchanged',async()=>{
  const root=await fixture(),s=await serve(root),d=doc(s);const file=path.join(root,T3);const before=await stat(file);const rev=s.project.rev;
  const r=await send(s,'PATCH',`/api/docs/${d.docKey}`,{baseRevision:d.revision,fields:{title:d.card!.title}});expect(r.status).toBe(200);expect((await stat(file)).mtimeMs).toBe(before.mtimeMs);expect(s.project.rev).toBe(rev)
 })
 it('A16 missing managed heading is readonly per revision-4 spec',async()=>{
  const root=await fixture(),s=await serve(root);const file=path.join(root,T3);await writeFile(file,(await readFile(file,'utf8')).replace('## Description','## Custom'));await s.project.rescan();const d=doc(s);
  const r=await send(s,'PATCH',`/api/docs/${d.docKey}`,{baseRevision:d.revision,sections:{Description:'new'}});expect(r.status).toBe(422)
 })
 it('A19 running server survives null config and keeps prior config',async()=>{
  const root=await fixture(),s=await serve(root);const first=s.project.snapshot();
  await writeFile(path.join(root,'nodit.config.json'),'null');await sleep(400);
  const snap=s.project.snapshot();expect(snap.projectId).toBe(first.projectId);expect(snap.diagnostics.some(d=>d.code==='config-invalid')).toBe(true);
  expect((await fetch(`http://127.0.0.1:${s.port}/api/health`)).status).toBe(200)
 })
 it('A20 project payload carries config and per-component status',async()=>{
  const s=await serve(await fixture());const r=await(await fetch(`http://127.0.0.1:${s.port}/api/project`)).json();
  expect(r.config.paths.task).toBe('docs/tasks');expect(r.status.initialized).toBe(true);expect(r.status.components).toMatchObject({config:'ok',task:'ok',architecture:'ok'})
 })
 it('A21 raw rejects malformed date without writing',async()=>{
  const root=await fixture(),s=await serve(root),d=s.project.snapshot().docs.find(d=>d.card?.type==='adr')!;const file=path.join(root,d.path),before=await readFile(file,'utf8');
  const r=await send(s,'PUT',`/api/docs/${d.docKey}/raw`,{baseRevision:d.revision,text:before.replace(/^date: .*$/m,'date: 2026/1/1')});expect(r.status).toBe(422);expect(await readFile(file,'utf8')).toBe(before)
 })
 it('A17 watcher follows config path changes',async()=>{
  const root=await fixture(),s=await serve(root),file=path.join(root,'nodit.config.json'),config=JSON.parse(await readFile(file,'utf8'));
  await mkdir(path.join(root,'moved-tasks'));config.paths.task='moved-tasks';await writeFile(file,JSON.stringify(config));await sleep(400);
  await writeFile(path.join(root,'moved-tasks/T-091-moved.md'),'---\nid: T-091\ntype: task\ntitle: new watched dir\nstatus: todo\n---\n');await sleep(600);
  expect(s.project.snapshot().docs.some(d=>d.card?.id==='T-091')).toBe(true)
 })
 it('A18 queued operations stop and error propagates after compromised',async()=>{
  const root=await fixture(),s=await serve(root);const d=doc(s);s.owner.markCompromised(new Error('simulated'));const rs=await Promise.all([1,2,3].map(()=>send(s,'PATCH',`/api/docs/${d.docKey}`,{baseRevision:d.revision,fields:{title:'blocked'}})));expect(rs.map(r=>r.status)).toEqual([503,503,503]);expect(LOCK_OPTIONS).toMatchObject({stale:10000,update:2000})
 })
})
