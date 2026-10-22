import catalog from '../assets/headphones/catalog.json';
import { NativeModules } from 'react-native';
import { validCalibration } from './audioEffectState';
import { latestAutoEqVersion } from './headphoneRequests';
import type { HeadphoneCalibration, PeqFilter } from './audioEffectState';
export type HeadphoneType = 'over-ear' | 'in-ear' | 'earbud' | 'open';
export interface HeadphoneBrandEntity {
  id: string;
  name: string;
  displayName: string;
  logoUri?: string;
}
export interface HeadphoneModelEntity {
  id: string;
  brandId: string;
  modelName: string;
  headphoneType: HeadphoneType;
  aliases: string[];
  imageUri?: string;
}
export interface HeadphoneEqProfileEntity extends HeadphoneCalibration {
  sourceName: string;
  sourceUrl: string;
  sourceVersion: string;
  license: string;
  measurementMode: string;
  verified: boolean;
  format: 'peq' | 'graphic';
  createdAt: number;
  updatedAt: number;
  recommended?: boolean;
  originalName?: string;
  originalContent?: string;
  generation?: { endpoint: string; request: Record<string, unknown>; generatedAt: string; responseSha256: string; staticFileMissing: boolean };
  curves?: Array<{
    frequency: number;
    raw: number;
    target: number;
    correction: number;
  }>;
}
export interface HeadphoneUserData {
  favorites: string[];
  recent: string[];
  imported: HeadphoneEqProfileEntity[];
  brands?: HeadphoneBrandEntity[];
  models?: HeadphoneModelEntity[];
}
export const emptyHeadphoneData = (): HeadphoneUserData => ({
  favorites: [],
  recent: [],
  imported: [],
});
export let headphoneBrands = catalog.brands as HeadphoneBrandEntity[];
export let headphoneModels = catalog.models as HeadphoneModelEntity[];
const modelIds = new Set(headphoneModels.map(model => model.id));
let catalogRevision = 0;
const catalogListeners = new Set<() => void>();
export const headphoneCatalogRevision = () => catalogRevision;
export const observeHeadphoneCatalog = (listener: () => void) => { catalogListeners.add(listener); return () => { catalogListeners.delete(listener); }; };
export function installHeadphoneCatalog(brands: HeadphoneBrandEntity[], models: HeadphoneModelEntity[]) {
  headphoneBrands = brands; headphoneModels = models;
  modelIds.clear(); models.forEach(model => modelIds.add(model.id));
  bundledModels.clear(); pendingModels.clear(); catalogRevision++;
  catalogListeners.forEach(listener => listener());
}
export const hasBundledHeadphoneProfiles = (id: string) => modelIds.has(canonicalHeadphoneModelId(id));
export const canonicalHeadphoneModelId = (id: string) => (catalog.legacyModels as Record<string, string>)[id] ?? id;
export const canonicalHeadphoneProfileId = (id: string) => (catalog.legacyProfiles as Record<string, string>)[id] ?? id;
export const canonicalHeadphoneCalibration = (profile: HeadphoneCalibration): HeadphoneCalibration => {
  const [base, ...variant] = profile.profileId.split(':');
  return { ...profile, modelId: canonicalHeadphoneModelId(profile.modelId),
    profileId: [canonicalHeadphoneProfileId(base!), ...variant].join(':') };
};
const token = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');
export class HeadphoneCatalogRepository {
  constructor(readonly records?: HeadphoneUserData) {}
  brands(query = '') {
    const q = token(query);
    return (this.records?.brands ?? headphoneBrands).filter(b =>
      token(b.name + b.displayName).includes(q),
    );
  }
  models(query = '', brandId?: string, type?: HeadphoneType) {
    const q = token(query);
    return (this.records?.models ?? headphoneModels).filter(
      m =>
        (!brandId || m.brandId === brandId) &&
        (!type || m.headphoneType === type) &&
        token(m.aliases.join(' ')).includes(q),
    );
  }
}
export class HeadphoneProfileValidator {
  static validate(profile: HeadphoneEqProfileEntity, allowedModels: ReadonlySet<string> = modelIds) {
    if (!validCalibration(profile) || !profile.filters.length)
      throw new Error('频率、增益、Q 值或前级增益越界');
    if (!allowedModels.has(canonicalHeadphoneModelId(profile.modelId)))
      throw new Error('未知耳机型号');
    if (
      !profile.sourceName?.trim() ||
      !profile.sourceVersion?.trim() ||
      !profile.license?.trim()
    )
      throw new Error('缺少数据来源、版本或许可信息');
    if (
      profile.curves &&
      !profile.curves.every(
        p =>
          [p.frequency, p.raw, p.target, p.correction].every(Number.isFinite) &&
          p.frequency > 0,
      )
    )
      throw new Error('无效的频响曲线');
    return profile;
  }
}
function fingerprint(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}
export class HeadphoneProfileImporter {
  static parse(
    content: string,
    meta: Omit<
      HeadphoneEqProfileEntity,
      | 'filters'
      | 'preampDb'
      | 'format'
      | 'createdAt'
      | 'updatedAt'
      | 'profileId'
    > & { profileId?: string },
    allowedModels?: ReadonlySet<string>,
  ): HeadphoneEqProfileEntity {
    if (content.length > 1000000) throw new Error('配置文件过大');
    const filters: PeqFilter[] = [];
    let preampDb = 0;
    let format: 'peq' | 'graphic' = 'peq';
    let hasPreamp = false;
    for (const raw of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const pre = line.match(/^Preamp:\s*([-+\d.e]+)\s*dB$/i);
      if (pre) {
        if (hasPreamp) throw new Error('重复前级增益');
        preampDb = Number(pre[1]);
        hasPreamp = true;
        continue;
      }
      if (/^GraphicEQ:/i.test(line)) {
        if (filters.length) throw new Error('不能混合图形和参数 EQ');
        format = 'graphic';
        let previous = 0;
        for (const pair of line.slice(line.indexOf(':') + 1).split(';')) {
          const parts = pair.trim().split(/\s+/);
          if (parts.length !== 2) throw new Error('图形 EQ 格式错误');
          const frequency = Number(parts[0]),
            gain = Number(parts[1]);
          if (frequency <= previous) throw new Error('图形 EQ 频率必须递增');
          previous = frequency;
          filters.push({ type: 'PK', frequency, gain, q: 4.318 });
        }
        continue;
      }
      const f = line.match(
        /^Filter\s+\d+:\s+(ON|OFF)\s+(PK|PEQ|LS|LSC|HS|HSC)\s+Fc\s+([-+\d.e]+)\s+Hz\s+Gain\s+([-+\d.e]+)\s+dB\s+Q\s+([-+\d.e]+)$/i,
      );
      if (!f) throw new Error(`不支持的配置行：${line.slice(0, 80)}`);
      if (f[1]!.toUpperCase() === 'ON')
        filters.push({
          type: f[2]!.toUpperCase().startsWith('LS')
            ? 'LS'
            : f[2]!.toUpperCase().startsWith('HS')
            ? 'HS'
            : 'PK',
          frequency: Number(f[3]),
          gain: Number(f[4]),
          q: Number(f[5]),
        });
    }
    const now = Date.now();
    const signature = JSON.stringify([meta.modelId, preampDb, filters]);
    return HeadphoneProfileValidator.validate({
      ...meta,
      profileId: meta.profileId ?? `peq-${fingerprint(signature)}`,
      preampDb,
      filters,
      format,
      createdAt: now,
      updatedAt: now,
    }, allowedModels);
  }
}
// Only opened models enter the bounded process cache. No calibration bundle is parsed at launch.
const bundledModels = new Map<string, HeadphoneEqProfileEntity[]>();
const pendingModels = new Map<string, Promise<HeadphoneEqProfileEntity[]>>();
export async function loadBundledHeadphoneProfiles(modelId: string): Promise<HeadphoneEqProfileEntity[]> {
  const id = canonicalHeadphoneModelId(modelId);
  if (!modelIds.has(id)) throw new Error('未知耳机型号');
  const cached = bundledModels.get(id);
  if (cached) return cached;
  const pending = pendingModels.get(id);
  if (pending) return pending;
  const bridge = NativeModules.LiuliuStorage as { readBundledHeadphoneProfiles?: (id: string) => Promise<string> } | undefined;
  const revision = catalogRevision;
  const request = (async () => {
    if (!bridge?.readBundledHeadphoneProfiles) throw new Error('当前版本缺少本地耳机目录，请安装最新正式版本');
    const text = await bridge.readBundledHeadphoneProfiles(id);
    if (text.length > 1000000) throw new Error('本地耳机配置文件过大');
    const data: unknown = JSON.parse(text);
    if (revision !== catalogRevision) throw new Error('耳机数据库已更新，请重试');
    if (!Array.isArray(data) || !data.length) throw new Error('本地耳机校准数据为空');
    const profiles = data.map(p => {
      if (p.modelId !== id) throw new Error('本地耳机方案归属错误');
      return HeadphoneProfileValidator.validate(p);
    });
    bundledModels.set(id, profiles);
    while (bundledModels.size > 12) bundledModels.delete(bundledModels.keys().next().value!);
    return profiles;
  })().finally(() => { if (pendingModels.get(id) === request) pendingModels.delete(id); });
  pendingModels.set(id, request);
  return request;
}
export class HeadphoneProfileRepository {
  constructor(readonly imported: HeadphoneEqProfileEntity[] = []) {}
  forModel(id: string) {
    const merged = new Map((bundledModels.get(canonicalHeadphoneModelId(id)) ?? []).map(p => [p.profileId,p]));
    for (const imported of this.imported) {
      const latest = merged.get(imported.profileId);
      const outdatedOfficial = latest?.verified && imported.verified && imported.license === 'MIT' &&
        (imported.sourceUrl.startsWith('https://github.com/jaakkopasanen/AutoEq/tree/') || imported.generation?.endpoint === 'https://autoeq.app/equalize') &&
        latest.sourceVersion !== imported.sourceVersion && latest.updatedAt > imported.updatedAt;
      if (!outdatedOfficial) merged.set(imported.profileId, imported);
    }
    return [...merged.values()].filter(
      p => canonicalHeadphoneModelId(p.modelId) === canonicalHeadphoneModelId(id),
    );
  }
  async loadModel(id: string) {
    await loadBundledHeadphoneProfiles(id);
    return this.forModel(id);
  }
  upsert(profile: HeadphoneEqProfileEntity) {
    HeadphoneProfileValidator.validate(profile);
    const key = (p: HeadphoneEqProfileEntity) =>
      JSON.stringify([p.modelId, p.preampDb, p.filters]);
    const duplicate = this.imported.find(
      p => p.profileId === profile.profileId || key(p) === key(profile),
    );
    return duplicate
      ? this.imported.map(p =>
          p === duplicate
            ? {
                ...profile,
                profileId: duplicate.profileId,
                createdAt: duplicate.createdAt,
              }
            : p,
        )
      : [...this.imported, profile];
  }
}
export class HeadphoneProfileSyncManager {
  private static async request<T>(
    url: string,
    read: (response: Response) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      cancel = () => {
        reject(new Error('已取消更新检查'));
        controller.abort();
      };
      if (signal?.aborted) cancel();
      else signal?.addEventListener('abort', cancel);
      timer = setTimeout(() => {
        reject(new Error('更新检查超时，请检查网络后重试；当前音效保持不变'));
        controller.abort();
      }, 10000);
    });
    const download = async () => {
      if (signal?.aborted) throw new Error('已取消更新检查');
      let response: Response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: {
            Accept: url.includes('api.github.com')
              ? 'application/vnd.github+json'
              : 'text/plain',
          },
        });
      } catch {
        throw new Error(
          '无法连接公开配置服务，请检查网络后重试；当前音效保持不变',
        );
      }
      if (!response.ok) {
        throw new Error(
          response.status === 403 || response.status === 429
            ? '公开配置服务访问受限，请稍后重试；当前音效保持不变'
            : `公开配置请求失败（HTTP ${response.status}）；当前音效保持不变`,
        );
      }
      return read(response);
    };
    try {
      return await Promise.race([cancelled, download()]);
    } finally {
      clearTimeout(timer);
      if (cancel) signal?.removeEventListener('abort', cancel);
    }
  }
  static async refresh(
    profile: HeadphoneEqProfileEntity,
    signal?: AbortSignal,
  ) {
    if(profile.verified&&profile.license==='MIT'&&profile.generation?.endpoint==='https://autoeq.app/equalize'&&profile.sourceUrl==='https://autoeq.app/') {
      const {refreshGeneratedHeadphoneProfile}=await import('./headphoneDatabase');
      return refreshGeneratedHeadphoneProfile(profile,signal);
    }
    if (
      !profile.verified ||
      profile.license !== 'MIT' ||
      !profile.sourceUrl.startsWith(
        'https://github.com/jaakkopasanen/AutoEq/tree/',
      )
    )
      throw new Error('未确认的来源仅支持本地导入');
    let sha: unknown;
    try {
      ({sha} = await this.request<{sha:unknown}>('https://api.github.com/repos/jaakkopasanen/AutoEq/commits/master',response=>response.json(),signal));
    } catch(error) {
      if(error instanceof Error && error.message.includes('访问受限')) {
        try { sha=await latestAutoEqVersion(signal); } catch { throw error; }
      } else throw error;
    }
    if (typeof sha !== 'string' || !/^[a-f0-9]{40}$/.test(sha))
      throw new Error('无效的数据版本');
    if (sha === profile.sourceVersion) return profile;
    const relative = profile.sourceUrl.split('/results/')[1];
    if (!relative) throw new Error('来源地址不完整');
    const parts = relative.split('/').map(part => decodeURIComponent(part));
    if (
      parts.some(
        part =>
          !part || part === '.' || part === '..' || /[\\/\r\n]/.test(part),
      )
    )
      throw new Error('来源地址不完整');
    const encoded = parts.map(part => encodeURIComponent(part)).join('/');
    const file = encodeURIComponent(
      parts[parts.length - 1] + ' ParametricEQ.txt',
    );
    const updated = await this.update(
      profile,
      `https://raw.githubusercontent.com/jaakkopasanen/AutoEq/${sha}/results/${encoded}/${file}`,
      signal,
    );
    return {
      ...updated,
      sourceVersion: sha,
      sourceUrl: `https://github.com/jaakkopasanen/AutoEq/tree/${sha}/results/${encoded}`,
      createdAt: profile.createdAt,
      curves: undefined,
    };
  }
  /** Only explicitly requested MIT output updates. No background scraping or unknown-license sync. */
  static async update(
    profile: HeadphoneEqProfileEntity,
    contentUrl: string,
    signal?: AbortSignal,
  ) {
    if (
      !profile.verified ||
      profile.license !== 'MIT' ||
      !/^https:\/\/raw\.githubusercontent\.com\/jaakkopasanen\/AutoEq\//.test(
        contentUrl,
      )
    )
      throw new Error('该来源未获准同步，请自行导入本地文件');
    const content = await this.request(
      contentUrl,
      response => response.text(),
      signal,
    );
    return HeadphoneProfileImporter.parse(content, {
      ...profile,
      verified: true,
      sourceVersion: contentUrl,
      originalContent: content,
    });
  }
}
export function normalizeHeadphoneData(value: unknown): HeadphoneUserData {
  const data = (value ?? {}) as Partial<HeadphoneUserData>;
  const validId = (id: string) => modelIds.has(canonicalHeadphoneModelId(id));
  const ids = (v: unknown) =>
    Array.isArray(v)
      ? [
          ...new Set(
            v.filter(
              (id): id is string => typeof id === 'string' && validId(id),
            ).map(canonicalHeadphoneModelId),
          ),
        ]
      : [];
  const imported: HeadphoneEqProfileEntity[] = [];
  if (Array.isArray(data.imported))
    for (const p of data.imported) {
      try {
        imported.push(HeadphoneProfileValidator.validate({ ...p, modelId: canonicalHeadphoneModelId(p.modelId), profileId: canonicalHeadphoneProfileId(p.profileId) }));
      } catch {}
    }
  return {
    favorites: ids(data.favorites),
    recent: ids(data.recent).slice(0, 12),
    imported,

  };
}
