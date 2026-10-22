import type { AppSettings, EqualizerPreset } from '../domain/types';
import { flatAdvancedEffects, validAdvancedEffects, validCalibration } from './audioEffectState';
import type { AdvancedEffects, HeadphoneCalibration } from './audioEffectState';
import { flatEqualizerGains, validEqualizerGains } from './equalizer';
import { canonicalHeadphoneCalibration } from './headphones';

export type EffectScope = 'general' | { modelId: string; profileId: string };
export interface EffectSnapshot {
  equalizer: EqualizerPreset;
  gains: number[];
  advanced: AdvancedEffects;
  headphone?: HeadphoneCalibration;
  savedId?: string;
  sceneId?: string;
}
export interface EffectIsolation {
  version: 1;
  active: 'general' | 'headphone';
  general: EffectSnapshot;
  headphones: Record<string, EffectSnapshot>;
  lastHeadphoneKey?: string;
  legacyBackup?: EffectSnapshot;
}
export interface EffectApplyOptions {
  live?: boolean;
  preserveIdentity?: boolean;
  expectedTargetKey?: string;
  advanced?: AdvancedEffects;
  headphone?: HeadphoneCalibration | null;
  scope?: EffectScope;
  sceneId?: string;
}
type EffectSettings = Pick<AppSettings, 'equalizer' | 'customEqualizerGains' | 'customEqualizerAdvanced' |
  'customEqualizerPresetId' | 'effectSceneId' | 'headphoneCalibration' | 'effectIsolation'>;
export const headphoneEffectKey = (scope: Exclude<EffectScope, string>) =>
  JSON.stringify([scope.modelId, scope.profileId]);
const neutral = (): EffectSnapshot => ({ equalizer: 'Custom', gains: flatEqualizerGains(), advanced: flatAdvancedEffects() });
const emptyEffects = neutral();
const clone = (value: EffectSnapshot): EffectSnapshot => ({ ...value, gains: [...value.gains],
  advanced: { ...value.advanced, ...(value.advanced.compressor ? { compressor: { ...value.advanced.compressor } } : {}) } });
function snapshot(value: unknown): EffectSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as EffectSnapshot;
  if (!validEqualizerGains(item.gains) || !validAdvancedEffects(item.advanced)) return undefined;
  if (item.headphone !== undefined && !validCalibration(item.headphone)) return undefined;
  return clone({ ...item, equalizer: item.equalizer,
    headphone: item.headphone ? canonicalHeadphoneCalibration(item.headphone) : undefined,
    savedId: typeof item.savedId === 'string' ? item.savedId : undefined,
    sceneId: typeof item.sceneId === 'string' ? item.sceneId : undefined });
}
/** One-time migration never guesses whether old shared adjustments belong to an earphone. */
export function normalizeEffectIsolation(settings: EffectSettings): EffectIsolation {
  const stored = settings.effectIsolation;
  if (stored?.version === 1 && snapshot(stored.general)) {
    const headphones: Record<string, EffectSnapshot> = {};
    for (const [key, value] of Object.entries(stored.headphones ?? {})) {
      try {
        const identity = JSON.parse(key);
        const valid = snapshot(value);
        if (Array.isArray(identity) && identity.length === 2 && identity.every(s => typeof s === 'string' && s.length > 0) && valid)
          headphones[key] = valid;
      } catch {}
    }
    const last = stored.lastHeadphoneKey && headphones[stored.lastHeadphoneKey] ? stored.lastHeadphoneKey : undefined;
    return { version: 1, active: stored.active === 'headphone' && last ? 'headphone' : 'general',
      general: { ...snapshot(stored.general)!, headphone: undefined }, headphones, lastHeadphoneKey: last,
      legacyBackup: snapshot(stored.legacyBackup) };
  }
  const legacy: EffectSnapshot = { equalizer: settings.equalizer, gains: [...(settings.customEqualizerGains ?? flatEqualizerGains())],
    advanced: settings.customEqualizerAdvanced ?? flatAdvancedEffects(), headphone: settings.headphoneCalibration,
    savedId: settings.customEqualizerPresetId, sceneId: settings.effectSceneId };
  const result: EffectIsolation = { version: 1, active: 'general', general: { ...clone(legacy), headphone: undefined },
    headphones: {}, legacyBackup: clone(legacy) };
  if (legacy.headphone) {
    const key = headphoneEffectKey(legacy.headphone);
    result.headphones[key] = { ...neutral(), headphone: legacy.headphone };
    result.lastHeadphoneKey = key; result.active = 'headphone';
  }
  return result;
}
export function readEffects(settings: EffectSettings, scope: EffectScope = 'general'): EffectSnapshot {
  if (scope === 'general') return settings.effectIsolation?.general ?? {
    equalizer: settings.equalizer, gains: settings.customEqualizerGains ?? flatEqualizerGains(),
    advanced: settings.customEqualizerAdvanced ?? flatAdvancedEffects(), savedId: settings.customEqualizerPresetId,
    sceneId: settings.effectSceneId,
  };
  return settings.effectIsolation?.headphones[headphoneEffectKey(scope)] ?? emptyEffects;
}
export function effectScope(options?: EffectApplyOptions): EffectScope {
  return options?.scope ?? (options?.headphone ? { modelId: options.headphone.modelId, profileId: options.headphone.profileId } : 'general');
}
/** Flat fields are the single effective native configuration, not an editor's storage. */
export function commitEffects<T extends EffectSettings>(settings: T, value: EffectSnapshot, scope: EffectScope): T {
  const isolation = normalizeEffectIsolation(settings);
  const next = clone({ ...value, headphone: scope === 'general' ? undefined : value.headphone });
  if (scope === 'general') { isolation.general = next; isolation.active = 'general'; }
  else {
    const key = headphoneEffectKey(scope);
    isolation.headphones = { ...isolation.headphones, [key]: next };
    isolation.lastHeadphoneKey = key; isolation.active = 'headphone';
  }
  return { ...settings, effectIsolation: isolation, equalizer: next.equalizer,
    customEqualizerGains: next.gains, customEqualizerAdvanced: next.advanced,
    headphoneCalibration: next.headphone, customEqualizerPresetId: next.savedId, effectSceneId: next.sceneId };
}
export function restoreEffectiveEffects<T extends EffectSettings>(settings: T): T {
  const isolation = normalizeEffectIsolation(settings);
  const active = isolation.active === 'headphone' ? isolation.headphones[isolation.lastHeadphoneKey!] : isolation.general;
  return { ...settings, effectIsolation: isolation, equalizer: active.equalizer,
    customEqualizerGains: active.gains, customEqualizerAdvanced: active.advanced,
    headphoneCalibration: active.headphone, customEqualizerPresetId: active.savedId, effectSceneId: active.sceneId };
}
/** Only a new app launch selects general sound; headphone banks remain available for manual application. */
export function restoreLaunchEffects<T extends EffectSettings>(settings: T): T {
  const isolation = normalizeEffectIsolation(settings);
  return commitEffects({ ...settings, effectIsolation: isolation }, isolation.general, 'general');
}
export function forgetSavedEffect<T extends EffectSettings>(settings: T, id: string): T {
  const isolation = normalizeEffectIsolation(settings);
  if (isolation.general.savedId === id) isolation.general.savedId = undefined;
  for (const value of Object.values(isolation.headphones)) if (value.savedId === id) value.savedId = undefined;
  return { ...settings, effectIsolation: isolation,
    customEqualizerPresetId: settings.customEqualizerPresetId === id ? undefined : settings.customEqualizerPresetId };
}
