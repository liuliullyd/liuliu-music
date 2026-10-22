import { NativeModules } from 'react-native';
import baseCatalog from '../assets/headphones/catalog.json';
import baseManifest from '../assets/headphones/sync-manifest.json';
import manufacturers from '../assets/headphones/manufacturers.json';
import {
  headphoneModels, installHeadphoneCatalog,
  HeadphoneProfileImporter, HeadphoneProfileValidator, loadBundledHeadphoneProfiles,
} from './headphones';
import type { HeadphoneBrandEntity, HeadphoneModelEntity, HeadphoneEqProfileEntity, HeadphoneType } from './headphones';
import { headphoneRequest, latestAutoEqVersion } from './headphoneRequests';

interface Measurement { source: string; rig: string | null; form: Exclude<HeadphoneType,'open'> }
interface Descriptor extends Measurement { profileId: string; modelId: string; name: string; path?: string; blobSha?: string; generated?: boolean; recommended?: boolean; archived?: boolean }
export interface HeadphoneDatabaseSnapshot {
  version: 1; sourceVersion: string; entriesSha256: string; checkedAt?: number;
  brands: HeadphoneBrandEntity[]; models: HeadphoneModelEntity[]; profiles: Descriptor[];
}
interface Storage {
  loadHeadphoneCatalog?: () => Promise<string | null>;
  beginHeadphoneUpdate: () => Promise<string>;
  stageHeadphoneModel: (token: string,id: string,value: string) => Promise<void>;
  commitHeadphoneUpdate: (token: string,value: string) => Promise<string>;
  cancelHeadphoneUpdate: (token: string) => Promise<void>;
  headphoneHash: (value: string,gitBlob: boolean) => Promise<string>;
}
export interface DatabaseProgress { phase: 'checking'|'downloading'|'saving'; completed: number; total: number }
export interface DatabaseUpdateResult { brands: number; models: number; profiles: number; downloaded: number; addedModels: number; checkedAt: number }
let snapshot: HeadphoneDatabaseSnapshot = { ...baseManifest,version:1,brands:baseCatalog.brands,models:baseCatalog.models as HeadphoneModelEntity[],profiles:baseManifest.profiles as Descriptor[] };
let initialized: Promise<void> | undefined;
let operation: Promise<DatabaseUpdateResult> | undefined;
const bridge = () => NativeModules.LiuliuStorage as Storage;
const compare = (a: string,b: string) => a<b?-1:a>b?1:0;
const identity = (name: string,source: string,rig: string|null) => JSON.stringify([name,source,rig]);
const hash = (text: string,gitBlob=false) => {
  if (!bridge()?.headphoneHash) throw new Error('当前版本缺少本地耳机更新组件，请安装最新版本');
  return bridge().headphoneHash(text,gitBlob);
};
const checkCancelled = (signal?: AbortSignal) => { if (signal?.aborted) throw new Error('已取消更新，原耳机数据库保留'); };
const text = async (url: string,signal?: AbortSignal) => {
  const value = await headphoneRequest(url,response=>response.text(),signal);
  if (value.length>16_000_000) throw new Error('官网数据过大，原数据库保留');
  return value;
};
const json = async <T,>(url: string,signal?: AbortSignal): Promise<T> => JSON.parse(await text(url,signal));
const id = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const translate = (name: string) => name.replace(/ANC Off/gi,'降噪关闭').replace(/ANC On/gi,'降噪开启').replace(/transparency mode/gi,'通透模式').replace(/passive/gi,'被动模式').replace(/active/gi,'主动模式').replace(/stock pads/gi,'原装耳垫').replace(/new pads/gi,'新耳垫').replace(/worn pads/gi,'磨损耳垫').replace(/velour pads/gi,'绒面耳垫').replace(/leather pads/gi,'皮质耳垫').replace(/ohm/gi,'欧姆').replace(/EQ off/gi,'均衡关闭').replace(/EQ on/gi,'均衡开启');
export const headphoneDatabaseInfo = () => ({sourceVersion:snapshot.sourceVersion,checkedAt:snapshot.checkedAt,profiles:snapshot.profiles.length});

export function validateHeadphoneDatabase(value: unknown): HeadphoneDatabaseSnapshot {
  const data=value as HeadphoneDatabaseSnapshot;
  if (!data || data.version!==1 || !/^[a-f0-9]{40}$/.test(data.sourceVersion) || !/^[a-f0-9]{64}$/.test(data.entriesSha256) ||
    !Array.isArray(data.brands)||!data.brands.length||data.brands.length>10000||!Array.isArray(data.models)||!data.models.length||data.models.length>30000||
    !Array.isArray(data.profiles)||!data.profiles.length||data.profiles.length>60000) throw new Error('耳机数据库格式无效，原数据库保留');
  const validId=(s: unknown)=>typeof s==='string'&&/^[a-z0-9-]{1,221}$/.test(s)&&/[a-z0-9]/.test(s);
  const brandIds=new Set<string>(),modelIds=new Set<string>(),profileIds=new Set<string>();
  for(const brand of data.brands){if(!validId(brand.id)||brandIds.has(brand.id)||!brand.name?.trim()||!brand.displayName?.trim())throw new Error('品牌数据无效');brandIds.add(brand.id);}
  for(const model of data.models){if(!validId(model.id)||modelIds.has(model.id)||!brandIds.has(model.brandId)||!model.modelName?.trim()||!['over-ear','in-ear','earbud','open'].includes(model.headphoneType)||!Array.isArray(model.aliases)||!model.aliases.length||!model.aliases.every(a=>typeof a==='string'))throw new Error('型号数据无效');modelIds.add(model.id);}
  const covered=new Set<string>();
  for(const profile of data.profiles){if(!modelIds.has(profile.modelId)||profileIds.has(profile.profileId)||!/^autoeq-[a-f0-9]{24}$/.test(profile.profileId)||!profile.source?.trim()||(profile.rig!==null&&!profile.rig?.trim())||!profile.name?.trim()||!['over-ear','in-ear','earbud'].includes(profile.form)||(profile.blobSha!==undefined&&!/^[a-f0-9]{40}$/.test(profile.blobSha)))throw new Error('校准目录数据无效');profileIds.add(profile.profileId);covered.add(profile.modelId);}
  if(covered.size!==modelIds.size)throw new Error('型号缺少完整校准方案');
  return data;
}

export async function initializeHeadphoneDatabase(): Promise<void> {
  if(!bridge()?.loadHeadphoneCatalog)return;
  if(!initialized)initialized=(async()=>{const raw=await bridge().loadHeadphoneCatalog!();if(raw){const next=validateHeadphoneDatabase(JSON.parse(raw));snapshot=next;installHeadphoneCatalog(next.brands,next.models);}})().catch(error=>{initialized=undefined;throw error;});
  return initialized;
}

function parseEntries(value: unknown): Record<string,Measurement[]> {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('官网耳机目录格式无效');
  const entries=value as Record<string,Measurement[]>;
  const names=Object.keys(entries);
  if(!names.length||names.length>30000)throw new Error('官网耳机目录数量无效');
  for(const name of names)if(!name.trim()||name.length>500||!Array.isArray(entries[name])||!entries[name]!.length||entries[name]!.length>100||entries[name]!.some(e=>!e.source?.trim()||(e.rig!==null&&!e.rig?.trim())||!['over-ear','in-ear','earbud'].includes(e.form)))throw new Error('官网测量信息无效');
  return entries;
}
export const canonicalHeadphoneEntries = (entries: Record<string,Measurement[]>) => JSON.stringify(Object.entries(entries).sort(([a],[b])=>compare(a,b)).map(([name,measurements])=>[name,measurements.map(e=>[e.source,e.rig,e.form]).sort((a,b)=>compare(JSON.stringify(a),JSON.stringify(b)))]));
interface Target { label: string; compatible: Array<Partial<Measurement>>; recommended: Array<Partial<Measurement>>; bassBoost: {fc:number;q:number;gain:number} }
async function generateProfile(descriptor: Descriptor,targets: Target[],version: string,allowed: Set<string>,signal?: AbortSignal): Promise<HeadphoneEqProfileEntity> {
  const matches=(condition: Partial<Measurement>)=>Object.entries(condition).every(([key,value])=>descriptor[key as keyof Measurement]===value);
  const target=targets.find(t=>t.recommended.some(matches))??targets.find(t=>t.compatible.some(matches));
  if(!target)throw new Error(`官网没有 ${descriptor.name} 的兼容校准目标，原数据库保留`);
  const request={name:descriptor.name,source:descriptor.source,rig:descriptor.rig,target:target.label,bass_boost_gain:target.bassBoost.gain,bass_boost_fc:target.bassBoost.fc,bass_boost_q:target.bassBoost.q,
    parametric_eq:true,parametric_eq_config:'8_PEAKING_WITH_SHELVES',response:{fr_fields:['frequency','raw','target','equalization'],base64fp16:false}};
  const response=await headphoneRequest('https://autoeq.app/equalize',r=>r.text(),signal,request);
  const result=JSON.parse(response).parametric_eq as {preamp:number;filters:Array<{type:string;fc:number;gain:number;q:number}>};
  if(!result||!Array.isArray(result.filters)||!result.filters.length||result.filters.some(f=>!['LOW_SHELF','HIGH_SHELF','PEAKING'].includes(f.type)))throw new Error('官网计算结果无效');
  const filters=result.filters.map(f=>({type:(f.type==='LOW_SHELF'?'LS':f.type==='HIGH_SHELF'?'HS':'PK') as 'LS'|'HS'|'PK',frequency:f.fc,gain:f.gain,q:f.q}));
  const content=`Preamp: ${result.preamp} dB\n`+filters.map((f,i)=>`Filter ${i+1}: ON ${f.type} Fc ${f.frequency} Hz Gain ${f.gain} dB Q ${f.q}`).join('\n');
  return HeadphoneProfileValidator.validate({...profileMetadata(descriptor,version),sourceUrl:'https://autoeq.app/',name:`专业校准（官网计算 · ${descriptor.source} 测量${descriptor.rig?' · '+descriptor.rig:''}）`,preampDb:result.preamp,filters,originalContent:content,
    generation:{endpoint:'https://autoeq.app/equalize',request,generatedAt:new Date().toISOString(),responseSha256:await hash(response),staticFileMissing:true}},allowed);
}
function profileMetadata(d: Descriptor,version: string): Omit<HeadphoneEqProfileEntity,'filters'|'preampDb'> {
  const now=Date.now();return {modelId:d.modelId,profileId:d.profileId,name:`专业校准（${d.source} 测量${d.rig?' · '+d.rig:''}）`,sourceName:`AutoEq · ${d.source}`,sourceUrl:d.path?`https://github.com/jaakkopasanen/AutoEq/tree/${version}/results/${d.path}`:'https://autoeq.app/',sourceVersion:version,license:'MIT',measurementMode:d.rig??d.form,verified:true,format:'peq',createdAt:now,updatedAt:now,originalName:d.name,recommended:d.recommended};
}

async function buildCatalog(entries: Record<string,Measurement[]>,aliases: Record<string,string>,index: string,recommended: string,signal?: AbortSignal) {
  const brands=new Map(snapshot.brands.map(b=>[b.id,b])),models=new Map(snapshot.models.map(m=>[m.id,m]));
  const nameModels=new Map(snapshot.models.map(m=>[m.aliases[2]!,m]));
  const names=new Map<string,string>();
  for(const [name,measurements] of Object.entries(entries)){
    checkCancelled(signal);const prior=nameModels.get(name);if(prior){names.set(name,prior.id);continue;}
    const words=name.split(' ');let brandName='',prefix='';
    for(let length=words.length;length>0;length--){const part=words.slice(0,length).join(' '),brand=aliases[part.toLowerCase()];if(brand){brandName=brand;prefix=part;break;}}
    if(!brandName)throw new Error(`无法核实新增型号 ${name} 的品牌，原数据库保留`);
    const brandId=[...brands.values()].find(b=>b.name.toLowerCase()===brandName.toLowerCase())?.id??(id(brandName)||'brand-'+(await hash(brandName)).slice(0,16));
    const displayName=brands.get(brandId)?.displayName??brandName;
    if(!brands.has(brandId))brands.set(brandId,{id:brandId,name:brandName,displayName});
    let modelId=id(name).slice(0,200)||'model-'+(await hash(name)).slice(0,16);if(models.has(modelId))modelId+='-'+(await hash(name)).slice(0,8);
    const type=measurements.some(m=>m.form==='over-ear')?'over-ear':measurements.some(m=>m.form==='earbud')?'earbud':'in-ear';
    models.set(modelId,{id:modelId,brandId,modelName:translate(name.slice(prefix.length).trim())||name,headphoneType:type,aliases:[brandName,displayName,name,translate(name)]});names.set(name,modelId);
  }
  const paths=new Map<string,string>(),recommendedPaths=new Set([...recommended.matchAll(/^- \[[^\n]+?\]\(\.\/(.+?)\)/gm)].map(m=>m[1]!));
  for(const match of index.matchAll(/^- \[([^\n]+?)\]\(\.\/(.+?)\) by ([^\n]+)/gm)){
    const name=decodeURIComponent(match[2]!.split('/').pop()!),source=match[3]!.split(' on ')[0]!,rig=match[3]!.includes(' on ')?match[3]!.split(' on ').slice(1).join(' on '):entries[name]?.find(e=>e.source===source)?.rig;
    if(rig!==undefined)paths.set(identity(name,source,rig),match[2]!);
  }
  const prior=new Map(snapshot.profiles.map(p=>[identity(p.name,p.source,p.rig),p]));
  const profiles=new Map(snapshot.profiles.map(p=>[p.profileId,{...p,archived:true}]));
  for(const [name,measurements] of Object.entries(entries))for(const measurement of measurements){
    checkCancelled(signal);const key=identity(name,measurement.source,measurement.rig),old=prior.get(key),relative=paths.get(key);
    const profileId=old?.profileId??'autoeq-'+(await hash(relative??key)).slice(0,24);
    profiles.set(profileId,{...measurement,profileId,modelId:names.get(name)!,name,path:relative,blobSha:old?.blobSha,generated:!relative||old?.generated,recommended:relative?recommendedPaths.has(relative):true,archived:false});
  }
  return {brands:[...brands.values()],models:[...models.values()],profiles:[...profiles.values()]};
}

export function updateHeadphoneDatabase(signal?: AbortSignal,onProgress?: (progress: DatabaseProgress)=>void): Promise<DatabaseUpdateResult> {
  if(operation)return operation;
  operation=performUpdate(signal,onProgress).finally(()=>{operation=undefined;});return operation;
}
async function performUpdate(signal?: AbortSignal,onProgress?: (progress: DatabaseProgress)=>void): Promise<DatabaseUpdateResult> {
  await initializeHeadphoneDatabase();checkCancelled(signal);onProgress?.({phase:'checking',completed:0,total:0});
  const priorModelCount=snapshot.models.length;
  const values=await Promise.allSettled([latestAutoEqVersion(signal),json<unknown>('https://autoeq.app/entries',signal),json<Target[]>('https://autoeq.app/targets',signal)]);
  for(const value of values)if(value.status==='rejected')throw value.reason;
  const [version,rawEntries,targets]=values.map(v=>(v as PromiseFulfilledResult<any>).value) as [string,unknown,Target[]];
  const entries=parseEntries(rawEntries);if(!Array.isArray(targets)||!targets.length||targets.some(t=>!t.label||!Array.isArray(t.compatible)||!Array.isArray(t.recommended)||!t.bassBoost||![t.bassBoost.fc,t.bassBoost.q,t.bassBoost.gain].every(Number.isFinite)))throw new Error('官网目标数据无效');
  const entriesSha256=await hash(canonicalHeadphoneEntries(entries));
  let next: HeadphoneDatabaseSnapshot={...snapshot,checkedAt:Date.now()};
  const jobs: Descriptor[]=[];
  if(version!==snapshot.sourceVersion||entriesSha256!==snapshot.entriesSha256){
    const base=`https://raw.githubusercontent.com/jaakkopasanen/AutoEq/${version}/`;
    const results=await Promise.allSettled([text(base+'results/INDEX.md',signal),text(base+'dbtools/manufacturers.tsv',signal),text(base+'results/README.md',signal),json<{tree:Array<{path:string;sha:string}>}>(`https://api.github.com/repos/jaakkopasanen/AutoEq/git/trees/${version}`,signal)]);
    for(const value of results)if(value.status==='rejected')throw value.reason;
    const [index,brandText,recommended,root]=results.map(v=>(v as PromiseFulfilledResult<any>).value) as [string,string,string,{tree:Array<{path:string;sha:string}>}];
    const resultsSha=root.tree?.find(t=>t.path==='results')?.sha;if(!resultsSha||!/^[a-f0-9]{40}$/.test(resultsSha))throw new Error('官网校准目录版本无效');
    const tree=await json<{truncated:boolean;tree:Array<{path:string;sha:string;type:string}>}>(`https://api.github.com/repos/jaakkopasanen/AutoEq/git/trees/${resultsSha}?recursive=1`,signal);
    if(tree.truncated||!Array.isArray(tree.tree))throw new Error('官网校准目录不完整，原数据库保留');
    const blobs=new Map(tree.tree.filter(t=>t.type==='blob').map(t=>[t.path,t.sha]));
    const aliases: Record<string,string>={...manufacturers};for(const line of brandText.trim().split(/\r?\n/)){const parts=line.split('\t');for(const alias of parts)aliases[alias.toLowerCase()]=parts[0]!;}
    const catalog=await buildCatalog(entries,aliases,index,recommended,signal);
    const old=new Map(snapshot.profiles.map(p=>[p.profileId,p]));
    for(const d of catalog.profiles){
      if(d.archived)continue;
      const prior=old.get(d.profileId),folder=d.path?decodeURIComponent(d.path.split('/').pop()!):undefined;
      const file=d.path&&folder?d.path.split('/').map(decodeURIComponent).join('/')+'/'+folder+' ParametricEQ.txt':undefined;
      const blob=file?blobs.get(file):undefined;
      if(blob&&!/^[a-f0-9]{40}$/.test(blob))throw new Error('官网参数指纹无效');
      const changed=blob?prior?.blobSha!==blob:!prior||version!==snapshot.sourceVersion;
      if(changed)jobs.push(d);
      d.blobSha=blob;d.generated=!blob;
    }
    next={version:1,sourceVersion:version,entriesSha256,checkedAt:Date.now(),...catalog};
  }
  validateHeadphoneDatabase(next);checkCancelled(signal);
  const token=await bridge().beginHeadphoneUpdate();let committed=false;
  try {
    const allowed=new Set(next.models.map(m=>m.id)),models=new Map<string,HeadphoneEqProfileEntity[]>(),groups=new Map<string,Descriptor[]>();
    for(const job of jobs){const group=groups.get(job.modelId)??[];group.push(job);groups.set(job.modelId,group);}
    const queue=[...groups],updatedAt=Date.now();let completed=0;
    onProgress?.({phase:'downloading',completed:0,total:jobs.length});
    await Promise.allSettled(Array.from({length:Math.min(3,queue.length)},async()=>{try { while(queue.length){checkCancelled(signal);const [modelId,descriptors]=queue.shift()!;
      const profiles=headphoneModels.some(m=>m.id===modelId)?[...await loadBundledHeadphoneProfiles(modelId)]:[];
      for(const d of descriptors){checkCancelled(signal);let profile: HeadphoneEqProfileEntity;
        if(d.blobSha&&d.path){const folder=decodeURIComponent(d.path.split('/').pop()!),url=`https://raw.githubusercontent.com/jaakkopasanen/AutoEq/${version}/results/${d.path}/${encodeURIComponent(folder+' ParametricEQ.txt')}`;
          const content=await text(url,signal);if(await hash(content,true)!==d.blobSha)throw new Error('官网参数内容校验失败，原数据库保留');
          profile=HeadphoneProfileImporter.parse(content,{...profileMetadata(d,version),originalContent:content},allowed);
        }else profile=await generateProfile(d,targets,version,allowed,signal);
        const position=profiles.findIndex(p=>p.profileId===profile.profileId);if(position>=0)profiles[position]=profile;else profiles.push(profile);
        completed++;onProgress?.({phase:'downloading',completed,total:jobs.length});
      }
      profiles.sort((a,b)=>Number(b.recommended)-Number(a.recommended)||compare(a.sourceName,b.sourceName));
      models.set(modelId,profiles);await bridge().stageHeadphoneModel(token,modelId,JSON.stringify(profiles));
    }} catch(error) { queue.length=0; throw error; } })).then(results=>{const failure=results.find(r=>r.status==='rejected') as PromiseRejectedResult|undefined;if(failure)throw failure.reason;});
    // Recheck both mutable endpoints before publishing the fixed snapshot.
    if(jobs.length){const [finalVersion,finalEntries]=await Promise.all([latestAutoEqVersion(signal),json<unknown>('https://autoeq.app/entries',signal)]);
      if(finalVersion!==version||await hash(canonicalHeadphoneEntries(parseEntries(finalEntries)))!==entriesSha256)throw new Error('官网数据在下载期间更新，请重试；原数据库保留');}
    checkCancelled(signal);onProgress?.({phase:'saving',completed:jobs.length,total:jobs.length});
    // Saving is the short atomic commit boundary; the cancel button is disabled.
    const raw=await bridge().commitHeadphoneUpdate(token,JSON.stringify(next));committed=true;
    snapshot=validateHeadphoneDatabase(JSON.parse(raw));installHeadphoneCatalog(snapshot.brands,snapshot.models);
    return {brands:next.brands.length,models:next.models.length,profiles:next.profiles.length,downloaded:jobs.length,addedModels:next.models.length-priorModelCount,checkedAt:next.checkedAt??updatedAt};
  } finally { if(!committed)await bridge().cancelHeadphoneUpdate(token).catch(()=>undefined); }
}

export async function refreshGeneratedHeadphoneProfile(profile: HeadphoneEqProfileEntity,signal?: AbortSignal): Promise<HeadphoneEqProfileEntity> {
  if(!profile.verified||profile.license!=='MIT'||profile.generation?.endpoint!=='https://autoeq.app/equalize'||profile.sourceUrl!=='https://autoeq.app/')throw new Error('该方案不属于官网计算结果');
  const descriptor=snapshot.profiles.find(p=>p.profileId===profile.profileId&&p.modelId===profile.modelId);
  if(!descriptor)throw new Error('官网计算方案归属不明，当前音效保持不变');
  const [version,targets,rawEntries]=await Promise.all([latestAutoEqVersion(signal),json<Target[]>('https://autoeq.app/targets',signal),json<unknown>('https://autoeq.app/entries',signal)]);
  const entries=parseEntries(rawEntries);
  if(!entries[descriptor.name]?.some(m=>m.source===descriptor.source&&m.rig===descriptor.rig))throw new Error('官网已无该测量，当前音效保持不变');
  const updated=await generateProfile(descriptor,targets,version,new Set(headphoneModels.map(m=>m.id)),signal);
  return {...updated,createdAt:profile.createdAt};
}
