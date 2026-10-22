import type { HeadphoneCalibration } from './audioEffectState';

export type HeadphoneScheme =
  | 'professional'
  | 'original'
  | 'soft'
  | 'bass'
  | 'custom';

/** The selected preview and the applied configuration share one scheme builder. */
export function headphoneSchemeProfile(
  calibration: HeadphoneCalibration | undefined,
  scheme: HeadphoneScheme,
): HeadphoneCalibration | null {
  if (scheme === 'original' || !calibration) return null;
  if (scheme !== 'soft' && scheme !== 'bass') return calibration;
  return {
    ...calibration,
    profileId: calibration.profileId + ':' + scheme,
    name: scheme === 'soft' ? '柔和聆听 · 用户偏好' : '低音增强 · 用户偏好',
    filters: [
      ...calibration.filters,
      {
        type: scheme === 'soft' ? 'HS' : 'LS',
        frequency: scheme === 'soft' ? 4500 : 100,
        gain: scheme === 'soft' ? -2 : 3,
        q: 0.707,
      },
    ],
  };
}
