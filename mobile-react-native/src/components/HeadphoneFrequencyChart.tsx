import React, { useEffect, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import Svg, {
  Defs,
  Line,
  LinearGradient,
  Path,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { useApp } from '../state/AppContext';
import { useTheme } from '../theme';
import {
  effectsSpectrum,
  type EffectSpectrumFrame,
  type HeadphoneEqResponse,
} from '../services/effectsSpectrum';
import type { HeadphoneCalibration } from '../services/audioEffectState';
import type { HeadphoneEqProfileEntity } from '../services/headphones';

const x = (f: number) =>
  34 + (Math.log10(Math.max(20, Math.min(20000, f)) / 20) / 3) * 290;
const path = (
  frequencies: number[],
  values: number[],
  y: (db: number) => number,
) =>
  frequencies
    .map(
      (f, i) =>
        `${i ? 'L' : 'M'}${x(f).toFixed(1)},${y(values[i] ?? -96).toFixed(1)}`,
    )
    .join(' ');
const frequencies = [20, 100, 1000, 10000, 20000];

function usePlayingSpectrum() {
  const app = useApp();
  const [foreground, setForeground] = useState(
    AppState.currentState !== 'background' &&
      AppState.currentState !== 'inactive',
  );
  const [frame, setFrame] = useState<EffectSpectrumFrame | null>(null);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state =>
      setForeground(state === 'active'),
    );
    return () => listener.remove();
  }, []);
  const identity = app.current
    ? `${app.current.provider}:${app.current.providerId ?? app.current.id}`
    : '';
  const configuration = JSON.stringify([
    app.state.settings.customEqualizerGains,
    app.state.settings.customEqualizerAdvanced,
    app.state.settings.headphoneCalibration,
  ]);
  const playing = Boolean(app.player?.playing);
  useEffect(() => {
    setFrame(null);
    if (
      !effectsSpectrum.available ||
      !foreground ||
      !playing ||
      app.page !== 'effects'
    )
      return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await effectsSpectrum.frame();
        if (!cancelled) setFrame(next.active ? next : null);
      } catch {
        if (!cancelled) setFrame(null);
      }
      if (!cancelled) timer = setTimeout(poll, 100);
    };
    effectsSpectrum
      .observe(true)
      .then(() => {
        if (!cancelled) void poll();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      void effectsSpectrum.observe(false).catch(() => undefined);
    };
  }, [playing, foreground, identity, configuration, app.page]);
  return { frame, playing, foreground };
}

export function HeadphoneFrequencyChart({
  profile,
  calibration,
}: {
  profile: HeadphoneEqProfileEntity;
  calibration: HeadphoneCalibration | null;
}) {
  const theme = useTheme(),
    app = useApp();
  const { frame, playing, foreground } = usePlayingSpectrum();
  const [response, setResponse] = useState<HeadphoneEqResponse | null>(null);
  const [responseError, setResponseError] = useState(false);
  const signature = JSON.stringify(calibration);
  const liveRate = frame?.sampleRate;
  useEffect(() => {
    let cancelled = false;
    setResponse(null);
    setResponseError(false);
    effectsSpectrum
      .response(calibration)
      .then(value => {
        if (!cancelled) setResponse(value);
      })
      .catch(() => {
        if (!cancelled) setResponseError(true);
      });
    return () => {
      cancelled = true;
    };
    // The signature tracks the full immutable selected profile, not its display name.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, liveRate]);
  const curves = profile.curves?.filter(
    p => p.frequency >= 20 && p.frequency <= 20000,
  );
  const responseY = (db: number) => 78 - Math.max(-24, Math.min(24, db)) * 2.4;
  const spectrumY = (db: number) =>
    16 + (Math.max(0, Math.min(96, -db)) / 96) * 112;
  const input =
    frame?.frequencies && frame.inputDb
      ? path(frame.frequencies, frame.inputDb, spectrumY)
      : '';
  const output =
    frame?.frequencies && frame.outputDb
      ? path(frame.frequencies, frame.outputDb, spectrumY)
      : '';
  return (
    <View testID="headphone-frequency-chart">
      <Text style={{ color: theme.text, fontWeight: '600', marginBottom: 8 }}>
        频响与 EQ 修正 · dB
      </Text>
      <Text
        testID="headphone-response-scheme"
        style={{ color: theme.muted, fontSize: 11, marginBottom: 6 }}
      >
        所选方案预览：{calibration?.name ?? '原声模式'}
      </Text>
      <Svg width="100%" height={158} viewBox="0 0 340 158">
        {frequencies.map(f => (
          <Line
            key={f}
            x1={x(f)}
            x2={x(f)}
            y1={12}
            y2={140}
            stroke={theme.line}
          />
        ))}
        {[-24, -12, 0, 12, 24].map(db => (
          <React.Fragment key={db}>
            <Line
              x1={34}
              x2={324}
              y1={responseY(db)}
              y2={responseY(db)}
              stroke={theme.line}
            />
            <SvgText
              x={27}
              y={responseY(db) + 3}
              textAnchor="end"
              fill={theme.muted}
              fontSize={8}
            >
              {db}
            </SvgText>
          </React.Fragment>
        ))}
        {!!curves?.length && (
          <>
            <Path
              d={path(
                curves.map(p => p.frequency),
                curves.map(p => p.raw),
                responseY,
              )}
              stroke={theme.muted}
              strokeWidth={1.2}
              strokeDasharray="4 4"
              fill="none"
            />
            <Path
              d={path(
                curves.map(p => p.frequency),
                curves.map(p => p.target),
                responseY,
              )}
              stroke={theme.red}
              strokeWidth={1.2}
              strokeDasharray="3 3"
              fill="none"
            />
          </>
        )}
        {response && (
          <Path
            testID="headphone-correction-path"
            d={path(response.frequencies, response.correctionDb, responseY)}
            stroke={theme.gold}
            strokeWidth={2}
            fill="none"
          />
        )}
        {frequencies.map((f, i) => (
          <SvgText
            key={`hz-${f}`}
            x={x(f)}
            y={153}
            textAnchor={
              i === 0
                ? 'start'
                : i === frequencies.length - 1
                ? 'end'
                : 'middle'
            }
            fill={theme.muted}
            fontSize={8}
          >
            {f === 20 ? '20 Hz' : f >= 1000 ? `${f / 1000}k` : f}
          </SvgText>
        ))}
      </Svg>
      <Text
        style={{
          color: theme.muted,
          fontSize: 10,
          lineHeight: 15,
          marginTop: 6,
        }}
      >
        灰：测量频响　红：目标　金：所选方案 PEQ 修正（不含前级）
      </Text>
      {!curves?.length && (
        <Text style={{ color: theme.muted, fontSize: 10, marginTop: 4 }}>
          该文件未提供测量频响和目标曲线。
        </Text>
      )}
      {responseError && (
        <Text style={{ color: theme.red, fontSize: 10, marginTop: 4 }}>
          当前采样率无法准确展示该 PEQ 修正。
        </Text>
      )}
      <Text
        style={{
          color: theme.text,
          fontWeight: '600',
          marginTop: 16,
          marginBottom: 6,
        }}
      >
        实时播放频谱 · dBFS
      </Text>
      <Text
        testID="headphone-output-calibration"
        style={{
          color: theme.muted,
          fontSize: 10,
          lineHeight: 15,
          marginBottom: 4,
        }}
      >
        {app.player?.audioEffectWarning
          ? app.player.audioEffectWarning
          : app.state.settings.headphoneCalibration
          ? `已应用：${app.state.settings.headphoneCalibration.name} · 包含均衡器与高级设置`
          : '尚未应用耳机校准 · 当前包含均衡器与高级设置'}
      </Text>
      <Svg
        testID="headphone-live-spectrum"
        accessibilityLabel="当前音频输入与输出的实时频谱"
        width="100%"
        height={148}
        viewBox="0 0 340 148"
      >
        <Defs>
          <LinearGradient id="spectrum-fill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={theme.gold} stopOpacity={0.25} />
            <Stop offset="1" stopColor={theme.gold} stopOpacity={0.02} />
          </LinearGradient>
        </Defs>
        {frequencies.map(f => (
          <Line
            key={f}
            x1={x(f)}
            x2={x(f)}
            y1={16}
            y2={128}
            stroke={theme.line}
          />
        ))}
        {[0, -24, -48, -72, -96].map(db => (
          <React.Fragment key={db}>
            <Line
              x1={34}
              x2={324}
              y1={spectrumY(db)}
              y2={spectrumY(db)}
              stroke={theme.line}
            />
            <SvgText
              x={27}
              y={spectrumY(db) + 3}
              textAnchor="end"
              fill={theme.muted}
              fontSize={8}
            >
              {db}
            </SvgText>
          </React.Fragment>
        ))}
        {!!output && (
          <Path
            d={`${output} L${x(frame!.frequencies!.at(-1)!)},128 L34,128 Z`}
            fill="url(#spectrum-fill)"
          />
        )}
        <Path
          testID="headphone-spectrum-input"
          d={input}
          stroke={theme.muted}
          strokeWidth={1.2}
          fill="none"
        />
        <Path
          testID="headphone-spectrum-output"
          d={output}
          stroke={theme.gold}
          strokeWidth={2}
          fill="none"
        />
      </Svg>
      <Text
        testID="headphone-spectrum-status"
        style={{ color: theme.muted, fontSize: 10, lineHeight: 15 }}
      >
        {frame
          ? '灰：处理前　金：处理后'
          : !foreground
          ? '返回后显示实时频谱'
          : !playing
          ? '播放时显示真实音频频谱'
          : '等待音频频谱'}
      </Text>
    </View>
  );
}
