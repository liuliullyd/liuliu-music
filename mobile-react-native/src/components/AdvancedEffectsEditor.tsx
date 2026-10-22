import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient,
  Path,
  RadialGradient,
  Stop,
} from 'react-native-svg';
import { useApp } from '../state/AppContext';
import { useTheme } from '../theme';
import { useLayout } from '../state/LayoutContext';
import {
  defaultCompressor,
  flatAdvancedEffects,
} from '../services/audioEffectState';
import type { CompressorSettings } from '../services/audioEffectState';
import {
  beginRotaryGesture,
  moveRotaryGesture,
} from '../services/rotaryGesture';
import type { RotaryGesture } from '../services/rotaryGesture';
import type { AdvancedEffects } from '../services/audioEffectState';
import type { HeadphoneCalibration } from '../services/audioEffectState';
import { readEffects } from '../services/effectIsolation';
import type { EffectScope } from '../services/effectIsolation';
import { activeEffectName, effectTargetMatches } from '../services/effectEditing';
import type { EffectEditTarget } from '../services/effectEditing';
import { useEffectEditSession } from './EffectEditSession';
import { EffectConfirmationDialog } from './EffectConfirmationDialog';
const controls = [
  ['clarity', '高保真度', '提升明亮度与高频细节'],
  ['reverb', '混响强度', '增加声音的空间余韵'],
  ['surround', '环绕强度', '拓展空间感与立体声宽度'],
  ['bass', '超重低音', '增强低频厚度与下潜'],
  ['dynamics', '动态推进', '平衡响度，突出节奏'],
] as const;
const point = (value: number) => {
  const angle = ((135 + value * 2.7) * Math.PI) / 180;
  return { x: 70 + 54 * Math.cos(angle), y: 70 + 54 * Math.sin(angle) };
};
export function AdvancedEffectsEditor({
  onScrollLockChange,
  scope = 'general',
  calibration,
}: {
  onScrollLockChange: (value: boolean) => void;
  scope?: EffectScope;
  calibration?: HeadphoneCalibration | null;
}) {
  const app = useApp(),
    theme = useTheme();
  const session = useEffectEditSession();
  const { scale } = useLayout();
  const selected = readEffects(app.state.settings, scope);
  const scopeOptions = scope === 'general' ? {} : { scope, headphone: calibration ?? selected.headphone ?? null };
  const [draft, setDraft] = useState<AdvancedEffects>(
    () => session?.advanced ?? selected.advanced,
  );
  const sessionKey = useRef(session?.target.key);
  const [confirmation, setConfirmation] = useState<{ target: EffectEditTarget; gains: number[];
    advanced: AdvancedEffects; pendingSave: boolean; name: string } | null>(null);
  const [applying, setApplying] = useState(false);
  const operation = useRef(false);
  const ref = useRef(draft),
    drag = useRef<{
      key: (typeof controls)[number][0];
      gesture: RotaryGesture;
      pageX: number;
      pageY: number;
      offsetX: number;
      offsetY: number;
      radius: number;
    } | null>(null),
    revision = useRef(0);
  const success = useRef(draft);
  const [details, setDetails] = useState(false);
  const knobSize = useRef({ width: 88, height: 88 });
  const mounted = useRef(true);
  const flush = app.flushEqualizerUpdates;
  useEffect(() => {
    if (session) {
      if (sessionKey.current !== session.target.key) {
        sessionKey.current = session.target.key;
        ref.current = session.advanced;
        setDraft(ref.current);
        success.current = ref.current;
      }
      return;
    }
    if (!drag.current) {
      ref.current =
        selected.advanced;
      setDraft(ref.current);
      success.current = ref.current;
    }
  }, [selected.advanced, session]);
  useEffect(
    () => () => {
      mounted.current = false;
      onScrollLockChange(false);
      flush();
    },
    [onScrollLockChange, flush],
  );
  const update = (next: AdvancedEffects) => {
    ref.current = next;
    setDraft(next);
    session?.patch({ advanced: next });
    const version = ++revision.current;
    app
      .applyCustomEqualizer(
        session?.gains ?? selected.gains,
        undefined,
        { live: true, advanced: next, ...scopeOptions, ...(session ? { preserveIdentity: true, expectedTargetKey: session.target.key } : {}) },
      )
      .then(ok => {
        if (ok) success.current = next;
        else if (mounted.current && revision.current === version) {
          ref.current = success.current;
          setDraft(success.current);
          session?.patch({ advanced: success.current });
        }
      });
  };
  const amount = (key: (typeof controls)[number][0], value: number) => {
    const next = { ...ref.current, [key]: value };
    if (key === 'dynamics' && next.compressor)
      next.compressor = { ...next.compressor, ratio: 1 + (2 * value) / 100 };
    update(next);
  };
  const compressor = draft.compressor ?? {
    ...defaultCompressor(1 + (2 * draft.dynamics) / 100),
    kneeDb: 0,
  };
  const changeCompressor = (key: keyof CompressorSettings, value: number) => {
    const next = { ...compressor, [key]: value };
    update({
      ...ref.current,
      compressor: next,
      ...(key === 'ratio' ? { dynamics: Math.min(100, (value - 1) * 50) } : {}),
    });
    app.flushEqualizerUpdates();
  };
  const end = () => {
    drag.current = null;
    onScrollLockChange(false);
    app.flushEqualizerUpdates();
  };
  const confirmApplication = async (bind: boolean) => {
    if (!confirmation || !session || operation.current) return;
    if (!effectTargetMatches(app.state.settings, confirmation.target) ||
      confirmation.pendingSave !== session.pendingSave || confirmation.target.key !== session.target.key) {
      app.notify('当前音效已变化，请重新确认');
      setConfirmation(null);
      return;
    }
    operation.current = true;
    ++revision.current; // Superseded live work cannot roll back the captured confirmed draft.
    setApplying(true);
    try {
      if (confirmation.pendingSave) {
        // The new preset does not exist yet; never bind these parameters to the old effect.
        session.patch({ advanced: confirmation.advanced });
        session.finishAdvanced(bind);
        setConfirmation(null);
      } else {
        const ok = bind
          ? await app.commitEqualizerEdit(confirmation.target, confirmation.gains, confirmation.advanced, 'advanced')
          : await app.applyCustomEqualizer(confirmation.gains, undefined,
            { advanced: confirmation.advanced, preserveIdentity: true, expectedTargetKey: confirmation.target.key, ...scopeOptions });
        if (ok) {
          success.current = confirmation.advanced;
          setConfirmation(null);
        }
      }
    } finally {
      operation.current = false;
      setApplying(false);
    }
  };
  return (
    <View testID="advanced-effects-editor" style={styles.root}>
      {session && (
        <Text testID="advanced-current-effect" style={{ color: theme.muted, fontSize: 13, marginBottom: 10 }}>
          {session.pendingSave ? `待保存音效：${session.name || '新音效'}\n完成后返回均衡器保存并使用`
            : `当前使用：${activeEffectName(app.state.settings)}\n正在编辑：${session.target.name}`}
        </Text>
      )}
      <View
        testID="advanced-control-grid"
        style={[
          styles.panel,
          !details && styles.filledPanel,
          { backgroundColor: theme.panelSoft, borderColor: theme.line },
        ]}
      >
        {controls.map(([key, label, description]) => {
          const value = draft[key];
          const start = point(0),
            finish = point(value);
          const arc = `M ${start.x} ${start.y} A 54 54 0 ${
            value > 66.66 ? 1 : 0
          } 1 ${finish.x} ${finish.y}`;
          return (
            <View
              testID={`advanced-control-${key}`}
              key={key}
              style={styles.control}
            >
              <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
              <View
                testID={`advanced-${key}`}
                accessibilityRole="adjustable"
                accessibilityLabel={`${label}，${description}`}
                accessibilityValue={{ min: 0, max: 100, now: value }}
                accessibilityActions={[
                  { name: 'increment' },
                  { name: 'decrement' },
                ]}
                onAccessibilityAction={e =>
                  amount(
                    key,
                    Math.max(
                      0,
                      Math.min(
                        100,
                        ref.current[key] +
                          (e.nativeEvent.actionName === 'increment' ? 5 : -5),
                      ),
                    ),
                  )
                }
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderTerminationRequest={() => false}
                onResponderGrant={e => {
                  const { width, height } = knobSize.current;
                  const { pageX, pageY, locationX, locationY } = e.nativeEvent;
                  drag.current = {
                    key,
                    gesture: beginRotaryGesture(
                      ref.current[key],
                      locationX - width / 2,
                      locationY - height / 2,
                      width / 2,
                    ),
                    pageX,
                    pageY,
                    offsetX: locationX - width / 2,
                    offsetY: locationY - height / 2,
                    radius: width / 2,
                  };
                  onScrollLockChange(true);
                }}
                onResponderMove={e => {
                  const current = drag.current;
                  if (current && current.key === key) {
                    current.gesture = moveRotaryGesture(
                      current.gesture,
                      current.offsetX +
                        (e.nativeEvent.pageX - current.pageX) / scale,
                      current.offsetY +
                        (e.nativeEvent.pageY - current.pageY) / scale,
                      current.radius,
                    );
                    const next = Math.round(current.gesture.value);
                    if (next !== ref.current[key]) amount(key, next);
                  }
                }}
                onLayout={e => {
                  knobSize.current = e.nativeEvent.layout;
                }}
                onResponderRelease={end}
                onResponderTerminate={end}
                style={styles.knob}
              >
                <Svg
                  width="100%"
                  height="100%"
                  viewBox="0 0 140 140"
                  pointerEvents="none"
                >
                  <Defs>
                    <LinearGradient
                      id={`rim-${key}`}
                      x1="0"
                      y1="0"
                      x2="1"
                      y2="1"
                    >
                      <Stop
                        offset="0"
                        stopColor={theme.text}
                        stopOpacity={0.22}
                      />
                      <Stop offset="0.48" stopColor={theme.panel} />
                      <Stop
                        offset="1"
                        stopColor={theme.text}
                        stopOpacity={0.12}
                      />
                    </LinearGradient>
                    <RadialGradient
                      id={`face-${key}`}
                      cx="38%"
                      cy="28%"
                      r="78%"
                    >
                      <Stop offset="0" stopColor={theme.panel} />
                      <Stop offset="0.76" stopColor={theme.panelSoft} />
                      <Stop offset="1" stopColor={theme.line} />
                    </RadialGradient>
                  </Defs>
                  <Circle
                    cx={70}
                    cy={72}
                    r={48}
                    fill={theme.text}
                    opacity={0.09}
                  />
                  {Array.from({ length: 21 }, (_, i) => {
                    const a = ((135 + i * 13.5) * Math.PI) / 180;
                    return (
                      <Line
                        key={i}
                        x1={70 + 61 * Math.cos(a)}
                        y1={70 + 61 * Math.sin(a)}
                        x2={70 + (i % 5 === 0 ? 66 : 64) * Math.cos(a)}
                        y2={70 + (i % 5 === 0 ? 66 : 64) * Math.sin(a)}
                        stroke={i * 5 <= value ? theme.gold : theme.muted}
                        strokeOpacity={0.65}
                        strokeWidth={1.2}
                      />
                    );
                  })}
                  <Circle
                    cx={70}
                    cy={70}
                    r={54}
                    stroke={theme.line}
                    strokeWidth={9}
                    fill="none"
                  />
                  {value > 0 && (
                    <Path
                      d={arc}
                      stroke={theme.gold}
                      strokeWidth={7}
                      strokeLinecap="round"
                      fill="none"
                    />
                  )}
                  <Circle
                    cx={70}
                    cy={70}
                    r={44}
                    fill={`url(#rim-${key})`}
                    stroke={theme.line}
                  />
                  <Circle
                    cx={70}
                    cy={70}
                    r={39}
                    fill={`url(#face-${key})`}
                    stroke={theme.panel}
                    strokeWidth={1.5}
                  />
                  <Line
                    x1={70 + (finish.x - 70) * 0.48}
                    y1={70 + (finish.y - 70) * 0.48}
                    x2={70 + (finish.x - 70) * 0.65}
                    y2={70 + (finish.y - 70) * 0.65}
                    stroke={theme.gold}
                    strokeWidth={3}
                    strokeLinecap="round"
                  />
                  <Circle
                    cx={60}
                    cy={55}
                    r={24}
                    fill={theme.panel}
                    opacity={0.16}
                  />
                  <Circle cx={finish.x} cy={finish.y} r={6} fill={theme.gold} />
                </Svg>
              </View>
              <Text
                testID={`advanced-value-${key}`}
                style={{ color: theme.text, fontSize: 16 }}
              >
                {value}%
              </Text>
              <Text
                style={{
                  color: theme.muted,
                  fontSize: 10,
                  textAlign: 'center',
                  marginTop: 3,
                  lineHeight: 13,
                }}
              >
                {description}
              </Text>
            </View>
          );
        })}
        <View style={[styles.control, styles.modes]}>
          {(
            [
              ['headphones', '耳机'],
              ['speakers', '音响'],
              ['car', '车载'],
            ] as const
          ).map(([mode, title]) => (
            <Pressable
              key={mode}
              testID={`advanced-mode-${mode}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: mode === draft.mode }}
              onPress={() => {
                update({ ...ref.current, mode });
                app.flushEqualizerUpdates();
              }}
              style={[
                styles.mode,
                {
                  backgroundColor:
                    mode === draft.mode ? theme.selectedSurface : theme.panel,
                },
              ]}
            >
              <Text
                style={{
                  color: theme.text,
                  fontSize: 14,
                }}
              >
                {title}
              </Text>
            </Pressable>
          ))}
          <Text
            style={{ color: theme.muted, fontSize: 10, textAlign: 'center' }}
          >
            调整空间与动态参数
          </Text>
        </View>
      </View>
      <Pressable
        testID="advanced-details-toggle"
        accessibilityRole="button"
        accessibilityState={{ expanded: details }}
        onPress={() => setDetails(value => !value)}
        style={[styles.detailsToggle, { backgroundColor: theme.panelSoft }]}
      >
        <Text style={{ color: theme.text }}>
          DSP 参数　{details ? '⌃' : '⌄'}
        </Text>
      </Pressable>
      {details && (
        <View
          testID="advanced-dsp-details"
          style={[styles.details, { borderColor: theme.line }]}
        >
          {(
            [
              ['width', '空间宽度', draft.width ?? 0, 0, 100, 5, '%'],
              [
                'preampDb',
                '场景前级',
                draft.preampDb ?? 0,
                -30,
                12,
                0.5,
                ' dB',
              ],
              ['ratio', '压缩比', compressor.ratio, 1, 12, 0.1, ':1'],
              [
                'thresholdDb',
                '阈值',
                compressor.thresholdDb,
                -60,
                0,
                1,
                ' dBFS',
              ],
              ['attackMs', 'Attack', compressor.attackMs, 0.1, 200, 1, ' ms'],
              [
                'releaseMs',
                'Release',
                compressor.releaseMs,
                5,
                3000,
                10,
                ' ms',
              ],
              ['kneeDb', 'Knee', compressor.kneeDb, 0, 24, 0.5, ' dB'],
            ] as const
          ).map(([key, label, value, min, max, step, unit]) => {
            const change = (direction: number) => {
              const next = Number(
                Math.max(min, Math.min(max, value + direction * step)).toFixed(
                  2,
                ),
              );
              if (key === 'width' || key === 'preampDb') {
                update({ ...ref.current, [key]: next });
                app.flushEqualizerUpdates();
              } else changeCompressor(key, next);
            };
            return (
              <View key={key} style={styles.detailRow}>
                <Text style={{ color: theme.text, flex: 1 }}>{label}</Text>
                <Pressable
                  testID={'advanced-dsp-' + key + '-decrease'}
                  accessibilityLabel={'减小' + label}
                  onPress={() => change(-1)}
                  style={styles.stepButton}
                >
                  <Text style={{ color: theme.text }}>−</Text>
                </Pressable>
                <Text
                  testID={'advanced-dsp-' + key}
                  style={{
                    color: theme.text,
                    minWidth: 80,
                    textAlign: 'center',
                  }}
                >
                  {value}
                  {unit}
                </Text>
                <Pressable
                  testID={'advanced-dsp-' + key + '-increase'}
                  accessibilityLabel={'增大' + label}
                  onPress={() => change(1)}
                  style={styles.stepButton}
                >
                  <Text style={{ color: theme.text }}>＋</Text>
                </Pressable>
              </View>
            );
          })}
          {draft.loudness && (
            <Text style={{ color: theme.muted, fontSize: 11, lineHeight: 17 }}>
              低音量补偿随播放器与系统音量渐变；显示为最大补偿参数，实际输出按音量估算，不代表耳边声压校准。
            </Text>
          )}
        </View>
      )}
      <View
        testID="advanced-actions"
        style={[styles.actions, !details && styles.dockedActions]}
      >
        <Pressable
          testID="advanced-reset"
          onPress={() => {
            update(flatAdvancedEffects());
            app.flushEqualizerUpdates();
          }}
          style={[styles.action, { backgroundColor: theme.panelSoft }]}
        >
          <Text style={{ color: theme.text }}>↻　重置</Text>
        </Pressable>
        <Pressable
          testID="advanced-apply"
          disabled={applying}
          onPress={() =>
            session ? setConfirmation({ target: session.target, gains: [...session.gains],
              advanced: { ...ref.current, ...(ref.current.compressor ? { compressor: { ...ref.current.compressor } } : {}) },
              pendingSave: session.pendingSave, name: session.name }) : app.applyCustomEqualizer(
              selected.gains,
              undefined,
              { advanced: ref.current, ...scopeOptions },
            )
          }
          style={[styles.action, { backgroundColor: theme.selectedSurface }]}
        >
          <Text style={{ color: theme.text }}>✓　应用</Text>
        </Pressable>
      </View>
      {confirmation && (
        <EffectConfirmationDialog id="advanced-apply-dialog" title="应用高级参数" busy={applying}
          message={confirmation.pendingSave
            ? `待保存音效：${confirmation.name || '新音效'}\n是否将这些高级参数加入新音效？确认后返回均衡器，最后保存并使用。`
            : `当前使用：${activeEffectName(app.state.settings)}\n修改音效：${confirmation.target.name}\n是否将这些高级参数绑定到当前音效？`}
          onCancel={() => setConfirmation(null)} buttons={[
            { id: 'advanced-apply-cancel', label: '取消', onPress: () => setConfirmation(null) },
            { id: 'advanced-apply-only', label: confirmation.pendingSave ? '不绑定，返回均衡器' : '仅应用', onPress: () => { void confirmApplication(false); } },
            { id: 'advanced-apply-bind', label: confirmation.pendingSave ? '加入新音效并返回' : '绑定并应用', onPress: () => { void confirmApplication(true); }, primary: true },
          ]} />
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flexGrow: 1 },
  panel: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  filledPanel: {
    flexGrow: 1,
    minHeight: 342,
    alignContent: 'space-around',
  },
  control: {
    width: '33.333333%',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 4 },
  knob: { width: 88, height: 88 },
  modes: { justifyContent: 'center', gap: 4, paddingHorizontal: 4 },
  mode: {
    width: '100%',
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
    borderRadius: 12,
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  dockedActions: { marginTop: 'auto', paddingTop: 12 },
  action: {
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  detailsToggle: {
    minHeight: 44,
    marginTop: 10,
    borderRadius: 14,
    padding: 12,
  },
  details: { borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 8 },
  detailRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  stepButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
