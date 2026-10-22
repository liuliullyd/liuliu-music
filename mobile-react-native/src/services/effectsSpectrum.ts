import { NativeModules } from 'react-native';
import type { HeadphoneCalibration } from './audioEffectState';

export type EffectSpectrumFrame = {
  active: boolean;
  sampleRate: number;
  sequence?: number;
  frequencies?: number[];
  inputDb?: number[];
  outputDb?: number[];
};
export type HeadphoneEqResponse = {
  sampleRate: number;
  preampDb: number;
  frequencies: number[];
  correctionDb: number[];
};
const bridge = NativeModules.LiuliuPlayer as
  | undefined
  | {
      setEffectSpectrumObserving?: (enabled: boolean) => Promise<void>;
      getEffectSpectrum?: () => Promise<EffectSpectrumFrame>;
      getHeadphoneEqResponse?: (
        calibration: HeadphoneCalibration | null,
      ) => Promise<HeadphoneEqResponse>;
    };
let observationCommands: Promise<unknown> = Promise.resolve();
export const effectsSpectrum = {
  available: Boolean(
    bridge?.getEffectSpectrum && bridge?.setEffectSpectrumObserving,
  ),
  observe(enabled: boolean) {
    // Serialize old cleanup and new entry; a late enable cannot outlive its detail.
    const command = observationCommands
      .catch(() => undefined)
      .then(() => bridge?.setEffectSpectrumObserving?.(enabled));
    observationCommands = command;
    return command;
  },
  async frame(): Promise<EffectSpectrumFrame> {
    return bridge?.getEffectSpectrum
      ? bridge.getEffectSpectrum()
      : { active: false, sampleRate: 48000 };
  },
  async response(calibration: HeadphoneCalibration | null) {
    return bridge?.getHeadphoneEqResponse?.(calibration) ?? null;
  },
};
