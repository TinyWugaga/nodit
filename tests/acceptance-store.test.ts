// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {appendFile,cp,mkdtemp,readFile,rm,stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {start,type RunningServer} from '../server/server'
let root:string,s:RunningServer
const nativeFetch=globalThis.fetch
let injectPath=''
let staleLayout=false
beforeEach(async()=>{
 vi.resetModules();root=await mkdtemp(path.join(tmpdir(),'nodit-store-'));await cp(path.resolve('examples/demo'),root,{recursive:true,filter:p=>!p.includes('/.nodit/')||!/(writer\.lock|owner\.json|token)/.test(p)});s=await start({root,port:0});
 document.head.innerHTML=`<meta name="nodit-token" content="${s.owner.token}">`;
 vi.stubGlobal('EventSource',class{static CLOSED=2;readyState=1;onopen:any;onerror:any;addEventListener(){}close(){}});
 vi.stubGlobal('fetch',(url:string,init:RequestInit={})=>{if(staleLayout&&url==='/api/layout'&&init.method==='PUT')return Promise.resolve(new Response(JSON.stringify({projectId:s.project.projectId,sessionId:s.project.sessionId,rev:0,revision:'stale-revision'}),{status:200}));if(injectPath&&url===injectPath&&init.method==='PATCH')return Promise.resolve(new Response(JSON.stringify({error:'injected one-file failure'}),{status:500}));const base=`http://127.0.0.1:${s.port}`;return nativeFetch(new URL(url,base),{...init,headers:{...init.headers,Origin:base}})});localStorage.clear();injectPath='';staleLayout=false
})
afterEach(async()=>{vi.unstubAllGlobals();await s.close();await rm(root,{recursive:true,force:true})})
async function store(){const {useProject}=await import('../src/store');await vi.waitFor(()=>expect(useProject.getState().docs).toHaveLength(14));return useProject}
it('C01 UI delete action clears all incoming references when selected',async()=>{
 const storeApi=await store(),state=storeApi.getState(),d=state.docs.find(d=>d.card?.id==='MS-01')!;const refs=state.referencesTo(d.docKey);expect(refs).toHaveLength(3);
 expect(await state.deleteCard(d.docKey,true)).toBe(true);await expect(stat(path.join(root,d.path))).rejects.toThrow();
 for(const r of refs){expect(await readFile(path.join(root,state.docs.find(d=>d.docKey===r.docKey)!.path),'utf8')).not.toContain('milestone: MS-01')}
 expect(s.project.snapshot().docs.some(d=>d.card?.links.milestone==='MS-01')).toBe(false)
})
it('C02 UI delete without cleanup retains dangling references and diagnostics',async()=>{
 const storeApi=await store(),state=storeApi.getState(),d=state.docs.find(d=>d.card?.id==='MS-01')!;expect(await state.deleteCard(d.docKey,false)).toBe(true);
 expect(s.project.snapshot().docs.filter(d=>d.card?.links.milestone==='MS-01')).toHaveLength(3);expect(s.project.snapshot().diagnostics.some(d=>d.code==='link-dangling')).toBe(true)
})
it('C03 partial cleanup failure keeps failed file intact and reports failure',async()=>{
 const storeApi=await store(),state=storeApi.getState(),target=state.docs.find(d=>d.card?.id==='MS-01')!,failed=state.docs.find(d=>d.card?.id==='T-002')!;const before=await readFile(path.join(root,failed.path),'utf8');injectPath=`/api/docs/${failed.docKey}/links`;
 expect(await state.deleteCard(target.docKey,true)).toBe(true);expect(await readFile(path.join(root,failed.path),'utf8')).toBe(before);expect(storeApi.getState().toast?.message).toContain('1 份文件的引用沒有清除');expect(s.project.snapshot().docs.filter(d=>d.card?.links.milestone==='MS-01')).toHaveLength(1)
})
it('C04 edge removal writes against the revision stored with the edge',async()=>{
 const storeApi=await store(),state=storeApi.getState(),edge=state.edges.find(e=>e.data?.kind==='implements')!,at=edge.data!.storedAt[0],doc=state.docs.find(d=>d.docKey===at.docKey)!;
 expect(at.revision).toBe(doc.revision);await appendFile(path.join(root,doc.path),'\nexternal edit\n');const before=await readFile(path.join(root,doc.path),'utf8');
 await state.removeEdge(edge.id);expect(await readFile(path.join(root,doc.path),'utf8')).toBe(before)
})
it('C05 a layout response older than the loaded snapshot does not roll the layout back',async()=>{
 const storeApi=await store(),state=storeApi.getState(),node=state.nodes.find(n=>n.data.code==='T-003')!,before={layout:state.layout,revision:state.layoutRevision};staleLayout=true;
 state.onNodesChange([{type:'position',id:node.id,position:{x:100,y:0}}]);state.onNodeDragStop();await new Promise(r=>setTimeout(r,600));
 expect(storeApi.getState().layoutRevision).toBe(before.revision);expect(storeApi.getState().layout['T-003']).toEqual(before.layout['T-003'])
})
