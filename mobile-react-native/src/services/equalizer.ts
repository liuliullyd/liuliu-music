import type { EqualizerPresetCategory, SavedEqualizerPreset } from '../domain/types';
import { validAdvancedEffects, validCalibration } from './audioEffectState';
import type { AudioEffectConfiguration } from './audioEffectState';
import type { EffectScope } from './effectIsolation';
import { canonicalHeadphoneCalibration, canonicalHeadphoneModelId, canonicalHeadphoneProfileId } from './headphones';
export const equalizerCategoryLabels: Record<EqualizerPresetCategory,string> = { '银河音效':'宙斯音效','DTS 音效':'GTO 音效','调音台':'耳机音效','自定义':'均衡器' };

export const equalizerPresetCategories: EqualizerPresetCategory[] = ['银河音效', 'DTS 音效', '调音台', '自定义'];

export const equalizerBandLabels = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
export const flatEqualizerGains = () => Array<number>(10).fill(0);

export function validEqualizerGains(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === 10 && value.every(
    gain => typeof gain === 'number' && Number.isFinite(gain) && gain >= -12 && gain <= 12,
  );
}

export function normalizeSavedEqualizers(value: unknown): SavedEqualizerPreset[] {
  if (!Array.isArray(value)) return [];
  const result = new Map<string, SavedEqualizerPreset>();
  for (const entry of value) {
    if (!entry || typeof entry.id !== 'string' || !entry.id.trim()
        || typeof entry.name !== 'string' || !entry.name.trim() || !validEqualizerGains(entry.gains)) continue;
    const category = equalizerPresetCategories.includes(entry.category) ? entry.category : '自定义';
    result.set(entry.id, { id: entry.id, name: entry.name.trim().slice(0, 32), gains: [...entry.gains], category,
      ...(validAdvancedEffects(entry.advanced)?{advanced:entry.advanced}:{}), ...(validCalibration(entry.headphone)?{headphone:canonicalHeadphoneCalibration(entry.headphone)}:{}),
      ...(entry.effectScope && typeof entry.effectScope.modelId === 'string' && typeof entry.effectScope.profileId === 'string' ? { effectScope: {
        modelId: canonicalHeadphoneModelId(entry.effectScope.modelId), profileId: canonicalHeadphoneProfileId(entry.effectScope.profileId) } } : {}) });
  }
  return [...result.values()];
}

export function storeEqualizerPreset(presets: SavedEqualizerPreset[], name: string, gains: number[], category: EqualizerPresetCategory = '自定义', configuration?: AudioEffectConfiguration, scope: EffectScope = 'general'): {
  presets: SavedEqualizerPreset[]; saved: SavedEqualizerPreset;
} {
  const title = name.trim().slice(0, 32);
  if (!title) throw new Error('请给音效起一个名字');
  if (!validEqualizerGains(gains)) throw new Error('需要十段 -12 至 +12 dB 的有效参数');
  if (!equalizerPresetCategories.includes(category)) throw new Error('无效的音效分类');
  const existing = presets.find(preset => preset.name === title &&
    (scope === 'general' ? !preset.headphone && !preset.effectScope :
      JSON.stringify(preset.effectScope ?? (preset.headphone ? { modelId: preset.headphone.modelId, profileId: preset.headphone.profileId } : null)) === JSON.stringify(scope)));
  const saved = { id: existing?.id ?? `eq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: title, gains: [...gains], category,
    ...(configuration?{advanced:configuration.advanced,headphone:configuration.headphone}:{}), ...(scope === 'general' ? {} : { effectScope: scope }) };
  return { saved, presets: existing ? presets.map(preset => preset.id === existing.id ? saved : preset) : [...presets, saved] };
}

export function deleteEqualizerPreset(presets: SavedEqualizerPreset[], id: string): SavedEqualizerPreset[] {
  return presets.filter(preset => preset.id !== id);
}
