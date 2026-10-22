import {afterEach,expect,it} from 'vitest'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {chmod,cp,mkdtemp,readFile,rename,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {start,type RunningServer} from '../server/server'
const roots:string[]=[],ss:RunningServer[]=[]
async function root(){const r=await mkdtemp(path.join(tmpdir(),'nodit-fe-review-'));roots.push(r);await cp(path.resolve('examples/demo'),r,{recursive:true,filter:p=>!p.includes('/.nodit/')||!/(writer\.lock|owner\.json|token)/.test(p)});return r}
async function server(r:string){const s=await start({root:r,port:0});ss.push(s);return s}
async function send(s:RunningServer,method:string,p:string,body?:unknown){const base=`http://127.0.0.1:${s.port}`;return fetch(base+p,{method,headers:{Origin:base,'X-Nodit-Token':s.owner.token,'X-Nodit-Session':s.project.sessionId,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})}
afterEach(async()=>{await Promise.all(ss.splice(0).map(s=>s.close()));await Promise.all(roots.splice(0).map(r=>rm(r,{recursive:true,force:true})))})
it('V01 unreadable config keeps the previously accepted custom task directory',async()=>{
 const r=await root(),file=path.join(r,'nodit.config.json'),cfg=JSON.parse(await readFile(file,'utf8'));await rename(path.join(r,'docs/tasks'),path.join(r,'work'));cfg.paths.task='work';await writeFile(file,JSON.stringify(cfg));const s=await server(r);await chmod(file,0o000);
 try{await s.project.rescan();const snap=s.project.snapshot();const result=await send(s,'POST','/api/cards',{type:'task',title:'after config EACCES'});const body=await result.json();expect(snap.config.paths.task).toBe('work');expect(snap.status.components.config).toBe('invalid');expect(result.status).toBe(201);expect(body.doc.path.startsWith('work/')).toBe(true)}
 finally{await chmod(file,0o600)}
})
it('V02 offline CLI rejects an invalid first config without creating a card',async()=>{
 const r=await root();await rename(path.join(r,'docs/tasks'),path.join(r,'work'));await writeFile(path.join(r,'nodit.config.json'),JSON.stringify({paths:{task:'../outside'}}));const run=promisify(execFile);let result;try{const x=await run(process.execPath,[path.resolve('node_modules/tsx/dist/cli.mjs'),path.resolve('server/cli.ts'),'new','task','offline invalid config','--dir',r,'--json']);result={code:0,out:x.stdout,err:x.stderr}}catch(e:any){result={code:e.code,out:e.stdout,err:e.stderr}}
 expect(result.code).not.toBe(0)
})
it('V03 malformed shared AI marker block is not reported as installed ok',async()=>{
 const r=await root(),s=await server(r),p=await(await send(s,'GET','/api/init/plan?ai=true')).json();expect((await send(s,'POST','/api/init/apply',{planId:p.planId,itemIds:p.items.filter((x:any)=>!['skip','conflict'].includes(x.action)).map((x:any)=>x.itemId)})).status).toBe(200);await s.project.rescan();expect(s.project.snapshot().status.components['AGENTS.md#nodit']).toBe('ok');await writeFile(path.join(r,'AGENTS.md'),'<!-- nodit:start v1 -->\ntruncated content\n');await s.project.rescan();const status=s.project.snapshot().status.components['AGENTS.md#nodit'];const plan=await(await send(s,'GET','/api/init/plan?ai=true')).json();expect(status).not.toBe('ok');expect(plan.items.find((x:any)=>x.itemId==='AGENTS.md#nodit')?.action).toBe('conflict')
})
