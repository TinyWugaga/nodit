// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {cp,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {start,type RunningServer} from '../server/server'
let root:string,s:RunningServer,hold=false,release!:()=>void,ready!:()=>void,ackReady:Promise<void>,gate:Promise<void>
let events:Record<string,(e:any)=>void>
const nativeFetch=globalThis.fetch
beforeEach(async()=>{
 vi.resetModules();root=await mkdtemp(path.join(tmpdir(),'nodit-fe-layout-'));await cp(path.resolve('examples/demo'),root,{recursive:true,filter:p=>!p.includes('/.nodit/')||!/(writer\.lock|owner\.json|token)/.test(p)});s=await start({root,port:0});events={};hold=false;gate=new Promise(r=>release=r);ackReady=new Promise(r=>ready=r);
 document.head.innerHTML=`<meta name="nodit-token" content="${s.owner.token}">`;
 vi.stubGlobal('EventSource',class{static CLOSED=2;readyState=1;onopen:any;onerror:any;addEventListener(name:string,fn:(e:any)=>void){events[name]=fn}close(){}});s.project.on('change',e=>events['snapshot-changed']?.({data:JSON.stringify(e)}));
 vi.stubGlobal('fetch',async(url:string,init:RequestInit={})=>{const base=`http://127.0.0.1:${s.port}`;const res=await nativeFetch(new URL(url,base),{...init,headers:{...init.headers,Origin:base}});if(hold&&url==='/api/layout'&&init.method==='PUT'){hold=false;ready();await gate}return res});localStorage.clear()
})
afterEach(async()=>{release();vi.unstubAllGlobals();await s.close();await rm(root,{recursive:true,force:true})})
it('V04 graph node follows the newest layout after an old own ACK settles',async()=>{
 const {useProject:st}=await import('../src/store');await vi.waitFor(()=>expect(st.getState().docs).toHaveLength(11));const n=st.getState().nodes.find(n=>n.data.code==='T-003')!;hold=true;st.getState().onNodesChange([{type:'position',id:n.id,position:{x:100,y:120}}]);st.getState().onNodeDragStop();await ackReady;
 const file=path.join(root,'.nodit/layout.json'),data=JSON.parse(await readFile(file,'utf8'));data['T-003']={x:500,y:120};await writeFile(file,JSON.stringify(data));await s.project.rescan();await vi.waitFor(()=>expect(st.getState().layout['T-003'].x).toBe(500));release();await new Promise(r=>setTimeout(r,150));
 expect(st.getState().layout['T-003'].x).toBe(500);await vi.waitFor(()=>expect(st.getState().nodes.find(n=>n.data.code==='T-003')?.position.x).toBe(500),{timeout:1200})
})
