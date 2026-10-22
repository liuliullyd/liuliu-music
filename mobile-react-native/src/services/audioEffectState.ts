export type OutputMode = 'headphones' | 'speakers' | 'car';
export interface CompressorSettings {
  ratio: number;
  thresholdDb: number;
  attackMs: number;
  releaseMs: number;
  kneeDb: number;
}
export interface AdvancedEffects {
  clarity: number;
  reverb: number;
  surround: number;
  bass: number;
  dynamics: number;
  mode: OutputMode;
  /** Optional fields preserve the response of older saved five-control configurations. */
  width?: number;
  preampDb?: number;
  compressor?: CompressorSettings;
  loudness?: boolean;
}
export interface PeqFilter {
  type: 'PK' | 'LS' | 'HS';
  frequency: number;
  gain: number;
  q: number;
}
export interface HeadphoneCalibration {
  modelId: string;
  profileId: string;
  name: string;
  preampDb: number;
  filters: PeqFilter[];
}
export interface AudioEffectConfiguration {
  advanced: AdvancedEffects;
  headphone?: HeadphoneCalibration;
}
export const flatAdvancedEffects = (): AdvancedEffects => ({
  clarity: 0,
  reverb: 0,
  surround: 0,
  bass: 0,
  dynamics: 0,
  mode: 'headphones',
});
export function validAdvancedEffects(value: unknown): value is AdvancedEffects {
  if (!value || typeof value !== 'object') return false;
  const v = value as AdvancedEffects;
  return (
    ['headphones', 'speakers', 'car'].includes(v.mode) &&
    ['clarity', 'reverb', 'surround', 'bass', 'dynamics'].every(key => {
      const n = v[key as keyof AdvancedEffects];
      return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;
    }) &&
    (v.width === undefined || finiteRange(v.width, 0, 100)) &&
    (v.preampDb === undefined || finiteRange(v.preampDb, -30, 12)) &&
    (v.loudness === undefined || typeof v.loudness === 'boolean') &&
    (v.compressor === undefined || validCompressor(v.compressor))
  );
}
const finiteRange = (
  value: unknown,
  min: number,
  max: number,
): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;
export function validCompressor(value: unknown): value is CompressorSettings {
  if (!value || typeof value !== 'object') return false;
  const v = value as CompressorSettings;
  return (
    finiteRange(v.ratio, 1, 12) &&
    finiteRange(v.thresholdDb, -60, 0) &&
    finiteRange(v.attackMs, 0.1, 200) &&
    finiteRange(v.releaseMs, 5, 3000) &&
    finiteRange(v.kneeDb, 0, 24)
  );
}
export const defaultCompressor = (ratio = 1): CompressorSettings => ({
  ratio,
  thresholdDb: -18,
  attackMs: 12,
  releaseMs: 120,
  kneeDb: 6,
});
export function validCalibration(
  value: unknown,
): value is HeadphoneCalibration {
  if (!value || typeof value !== 'object') return false;
  const v = value as HeadphoneCalibration;
  return (
    typeof v.modelId === 'string' &&
    !!v.modelId &&
    typeof v.profileId === 'string' &&
    !!v.profileId &&
    typeof v.name === 'string' &&
    Number.isFinite(v.preampDb) &&
    v.preampDb >= -30 &&
    v.preampDb <= 12 &&
    Array.isArray(v.filters) &&
    v.filters.length <= 128 &&
    v.filters.every(
      f =>
        f &&
        ['PK', 'LS', 'HS'].includes(f.type) &&
        Number.isFinite(f.frequency) &&
        f.frequency >= 20 &&
        f.frequency <= 20000 &&
        Number.isFinite(f.gain) &&
        f.gain >= -24 &&
        f.gain <= 24 &&
        Number.isFinite(f.q) &&
        f.q >= 0.1 &&
        f.q <= 20,
    )
  );
}
/** Builds the single native configuration. Headphone correction never gets added twice. */
export class AudioEffectStateManager {
  static configuration(
    advanced?: AdvancedEffects,
    headphone?: HeadphoneCalibration,
  ): AudioEffectConfiguration {
    if (advanced && !validAdvancedEffects(advanced))
      throw new Error('高级音效参数无效');
    if (headphone && !validCalibration(headphone))
      throw new Error('耳机校准参数无效');
    return {
      advanced: advanced
        ? {
            ...advanced,
            ...(advanced.compressor
              ? { compressor: { ...advanced.compressor } }
              : {}),
          }
        : flatAdvancedEffects(),
      headphone,
    };
  }
}
