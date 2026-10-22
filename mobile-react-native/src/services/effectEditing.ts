import { equalizerPresetLabels, equalizerPresets } from '../domain/types';
import type { AppSettings, SavedEqualizerPreset } from '../domain/types';
import { AudioEffectStateManager, validAdvancedEffects } from './audioEffectState';
import type { AdvancedEffects } from './audioEffectState';
import { headphoneEffectKey, readEffects } from './effectIsolation';
import type { EffectScope } from './effectIsolation';
import { zeusScenes, gtoScenes } from './effectScenes';
import { validEqualizerGains } from './equalizer';

export interface EffectEditTarget {
  key: string;
  kind: 'saved' | 'scene' | 'preset' | 'custom';
  id?: string;
  name: string;
  scope: EffectScope;
}

const scenes = [...zeusScenes, ...gtoScenes];
const presetKeys = new Set(equalizerPresets.filter(preset => preset !== 'Custom').map(preset => `preset:${preset}`));

export function savedEffectHasScope(preset: SavedEqualizerPreset, scope: EffectScope): boolean {
  const storedScope = preset.effectScope ?? (preset.headphone
    ? { modelId: preset.headphone.modelId, profileId: preset.headphone.profileId } : undefined);
  return scope === 'general' ? !storedScope : !!storedScope && headphoneEffectKey(storedScope) === headphoneEffectKey(scope);
}

/** Identity belongs to the selected effect and scope, never to the changing slider values. */
export function effectEditingTarget(settings: AppSettings, scope: EffectScope = 'general'): EffectEditTarget {
  const selected = readEffects(settings, scope);
  const saved = settings.customEqualizerPresets?.find(preset => preset.id === selected.savedId && savedEffectHasScope(preset, scope));
  const scene = scenes.find(item => item.id === selected.sceneId);
  const presetId = selected.sceneId && presetKeys.has(selected.sceneId) ? selected.sceneId
    : selected.equalizer !== 'Custom' && presetKeys.has(`preset:${selected.equalizer}`) ? `preset:${selected.equalizer}` : undefined;
  const kind = saved ? 'saved' : scene ? 'scene' : presetId ? 'preset' : 'custom';
  const id = saved?.id ?? scene?.id ?? presetId;
  const name = saved?.name ?? scene?.name ?? (presetId
    ? equalizerPresetLabels[presetId.slice(7) as keyof typeof equalizerPresetLabels] : selected.headphone?.name ?? '自定义');
  const targetScope = scope === 'general' ? scope : { ...scope };
  return { key: JSON.stringify([scope === 'general' ? scope : headphoneEffectKey(scope), kind, id ?? 'custom']),
    kind, id, name, scope: targetScope };
}

export function effectTargetMatches(settings: AppSettings, target: EffectEditTarget): boolean {
  const current = effectEditingTarget(settings, target.scope);
  return current.key === target.key && current.kind === target.kind && current.id === target.id;
}

export function activeEffectName(settings: AppSettings): string {
  const calibration = settings.headphoneCalibration;
  return effectEditingTarget(settings, calibration
    ? { modelId: calibration.modelId, profileId: calibration.profileId } : 'general').name;
}

export function normalizeEffectUserOverrides(value: unknown): Record<string, { gains: number[]; advanced: AdvancedEffects }> {
  const result: Record<string, { gains: number[]; advanced: AdvancedEffects }> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [key, entry] of Object.entries(value)) {
    if (!presetKeys.has(key) && !scenes.some(scene => scene.id === key)) continue;
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as { gains?: unknown; advanced?: unknown };
    if (!validEqualizerGains(item.gains) || !validAdvancedEffects(item.advanced)) continue;
    result[key] = { gains: [...item.gains], advanced: AudioEffectStateManager.configuration(item.advanced).advanced };
  }
  return result;
}
