import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useApp } from '../state/AppContext';
import { useTheme } from '../theme';
import { useLayout } from '../state/LayoutContext';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';
import {
  equalizerBandLabels,
  equalizerPresetCategories,
  equalizerCategoryLabels,
  flatEqualizerGains,
  validEqualizerGains,
} from '../services/equalizer';
import type {
  EqualizerPresetCategory,
  SavedEqualizerPreset,
} from '../domain/types';
import { readEffects } from '../services/effectIsolation';
import type { EffectScope } from '../services/effectIsolation';
import type { HeadphoneCalibration } from '../services/audioEffectState';
import { flatAdvancedEffects } from '../services/audioEffectState';
import { activeEffectName, effectTargetMatches } from '../services/effectEditing';
import type { EffectEditTarget } from '../services/effectEditing';
import { useEffectEditSession } from './EffectEditSession';
import { EffectConfirmationDialog } from './EffectConfirmationDialog';

const railHeight = 180;
const accent = '#F4C75E';
export const equalizerGainAtPosition = (y: number) =>
  Math.max(-12, Math.min(12, Math.round((12 - (y / railHeight) * 24) * 2) / 2));
const equalizerGainAtDrag = (
  startGain: number,
  startPageY: number,
  pageY: number,
  scale: number,
) =>
  Math.max(
    -12,
    Math.min(
      12,
      Math.round(
        (startGain - ((pageY - startPageY) / scale / railHeight) * 24) * 2,
      ) / 2,
    ),
  );

type Foreground = { primary: string; secondary: string };

function SavedEqualizerList({
  foreground,
  presets,
  category,
  onSelect,
  cards = false,
  scope,
}: {
  foreground: Foreground;
  presets: SavedEqualizerPreset[];
  category: EqualizerPresetCategory;
  onSelect?: (preset: SavedEqualizerPreset) => Promise<unknown>;
  cards?: boolean;
  scope?: EffectScope;
}) {
  const app = useApp();
  const theme = useTheme();
  const settings = app.state.settings;
  const [busy, setBusy] = useState(false);
  const [gridWidth, setGridWidth] = useState(0);
  const columns = gridWidth >= 384 ? 6 : 5;
  const operation = useRef(false);
  const run = async (action: () => Promise<unknown>) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    try {
      await action();
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };
  const visible = presets.filter(preset => preset.category === category);
  if (!visible.length) return null;
  return (
    <View testID={`saved-equalizers-${category}`}>
      <Text style={[styles.savedTitle, { color: foreground.primary }]}>
        已保存音效 · {visible.length}
      </Text>
      <View
        testID={cards ? 'saved-equalizer-grid' : undefined}
        onLayout={
          cards
            ? event => setGridWidth(event.nativeEvent.layout.width)
            : undefined
        }
        style={cards ? styles.savedGrid : undefined}
      >
        {visible.map(preset => {
          const active =
            settings.equalizer === 'Custom' &&
            settings.customEqualizerPresetId === preset.id &&
            preset.gains.every(
              (gain, index) => gain === settings.customEqualizerGains?.[index],
            );
          return (
            <View
              key={preset.id}
              testID={`saved-equalizer-card-${preset.id}`}
              style={
                cards
                  ? [
                      styles.savedCard,
                      {
                        width: gridWidth
                          ? (gridWidth - (columns - 1) * 6) / columns
                          : '18%',
                        backgroundColor: active
                          ? theme.selectedSurface
                          : theme.panel,
                        borderColor: active ? theme.gold : theme.line,
                      },
                    ]
                  : [styles.saved, active && styles.savedActive]
              }
            >
              {cards && (
                <Svg
                  pointerEvents="none"
                  width="100%"
                  height="100%"
                  viewBox="0 0 100 90"
                  preserveAspectRatio="none"
                  style={StyleSheet.absoluteFill}
                >
                  <Defs>
                    <LinearGradient
                      id={`saved-material-${preset.id}`}
                      x1="0"
                      y1="0"
                      x2="0.8"
                      y2="1"
                    >
                      <Stop
                        offset="0"
                        stopColor={theme.text}
                        stopOpacity={0.1}
                      />
                      <Stop
                        offset="0.42"
                        stopColor={theme.panel}
                        stopOpacity={0.08}
                      />
                      <Stop
                        offset="1"
                        stopColor={theme.text}
                        stopOpacity={0.04}
                      />
                    </LinearGradient>
                  </Defs>
                  <Rect
                    width={100}
                    height={90}
                    fill={`url(#saved-material-${preset.id})`}
                  />
                  <Path
                    d="M 12 1 H 88"
                    stroke={theme.text}
                    strokeOpacity={0.2}
                  />
                  <Path
                    d="M 7 58 H 93"
                    stroke={theme.muted}
                    strokeOpacity={0.15}
                  />
                  <Path
                    testID={`saved-equalizer-curve-${preset.id}`}
                    d={preset.gains
                      .map(
                        (gain, i) =>
                          `${i ? 'L' : 'M'}${7 + (i * 86) / 9},${
                            58 - gain * 0.7
                          }`,
                      )
                      .join(' ')}
                    fill="none"
                    stroke={active ? theme.gold : theme.accent}
                    strokeWidth={1.6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              )}
              <Pressable
                testID={`saved-equalizer-${preset.id}`}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`应用${preset.name}`}
                accessibilityState={{ selected: active }}
                onPress={() =>
                  run(() =>
                    onSelect
                      ? onSelect(preset)
                        : app.applyCustomEqualizer(preset.gains, preset.id, {
                          advanced: preset.advanced,
                          headphone: category === '调音台' ? preset.headphone ?? null : null,
                          ...(category === '调音台' ? { scope: preset.effectScope ?? scope } : {}),
                        }),
                  )
                }
                style={cards ? styles.savedCardApply : styles.savedApply}
              >
                <Text
                  numberOfLines={cards ? 2 : undefined}
                  style={[
                    cards && styles.savedCardName,
                    { color: foreground.primary },
                  ]}
                >
                  {preset.name}
                </Text>
                <Text
                  style={[
                    cards && styles.savedCardStatus,
                    { color: foreground.secondary },
                  ]}
                >
                  {active ? '当前使用' : '点击应用'}
                </Text>
              </Pressable>
              <Pressable
                testID={`delete-equalizer-${preset.id}`}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`删除${preset.name}`}
                onPress={() => run(() => app.deleteCustomEqualizer(preset.id))}
                style={
                  cards
                    ? [styles.savedCardDelete, { borderTopColor: theme.line }]
                    : styles.deleteButton
                }
              >
                <Text
                  style={[
                    cards && styles.savedCardStatus,
                    { color: foreground.secondary },
                  ]}
                >
                  删除
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function EqualizerEditor({
  foreground,
  onScrollLockChange,
  scope = 'general',
  calibration,
}: {
  foreground: Foreground;
  onScrollLockChange?: (locked: boolean) => void;
  scope?: EffectScope;
  calibration?: HeadphoneCalibration | null;
}) {
  const app = useApp();
  const theme = useTheme();
  const session = useEffectEditSession();
  const { scale } = useLayout();
  const stored = app.state.settings;
  const selected = readEffects(stored, scope);
  const settings = { ...stored, equalizer: selected.equalizer, customEqualizerGains: selected.gains,
    customEqualizerPresetId: selected.savedId, customEqualizerAdvanced: selected.advanced };
  const scopeOptions = scope === 'general' ? {} : { scope, headphone: calibration ?? selected.headphone ?? null };
  const presets = (settings.customEqualizerPresets ?? []).filter(preset => scope === 'general' ||
    ((preset.effectScope?.modelId ?? preset.headphone?.modelId) === scope.modelId &&
     (preset.effectScope?.profileId ?? preset.headphone?.profileId ?? 'original') === scope.profileId));
  const [draft, setDraft] = useState(() =>
    session ? [...session.gains] : validEqualizerGains(settings.customEqualizerGains)
      ? [...settings.customEqualizerGains]
      : flatEqualizerGains(),
  );
  const sessionKey = useRef(session?.target.key);
  const draftRef = useRef(draft);
  const lastSuccessfulDraft = useRef(draft);
  const revision = useRef(0);
  const mounted = useRef(true);
  const controller = useRef(app);
  controller.current = app;
  const [localName, setLocalName] = useState('');
  const name = session?.name ?? localName;
  const setName = (value: string) => { setLocalName(value); session?.patch({ name: value }); };
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [localCategory, setLocalCategory] = useState<EqualizerPresetCategory>(scope === 'general' ? '自定义' : '调音台');
  const category = session?.category ?? localCategory;
  const setCategory = (value: EqualizerPresetCategory) => { setLocalCategory(value); session?.patch({ category: value }); };
  const [choosingCategory, setChoosingCategory] = useState(false);
  const [savePrompt, setSavePrompt] = useState<EffectEditTarget | null>(null);
  const [applyConfirmation, setApplyConfirmation] = useState<{ target: EffectEditTarget; gains: number[] } | null>(null);
  const operation = useRef(false);
  const saveTarget = useRef<EffectEditTarget | null>(null);
  const drag = useRef<{ pageY: number; gain: number } | null>(null);
  const publishDraft = useCallback((gains: number[]) => {
    draftRef.current = [...gains];
    setDraft(draftRef.current);
    session?.patch({ gains: [...gains] });
  }, [session]);
  const updateLive = (gains: number[]) => {
    publishDraft(gains);
    const version = ++revision.current;
    app.applyCustomEqualizer(gains, undefined, { live: true, ...scopeOptions,
      ...(session ? { preserveIdentity: true, expectedTargetKey: session.target.key } : {}) }).then(success => {
      if (success) lastSuccessfulDraft.current = [...gains];
      else if (mounted.current && revision.current === version)
        publishDraft(lastSuccessfulDraft.current);
    });
  };
  const change = (index: number, gain: number) => {
    if (draftRef.current[index] === gain) return;
    updateLive(
      draftRef.current.map((old, band) => (band === index ? gain : old)),
    );
  };
  const endDrag = useCallback(() => {
    drag.current = null;
    onScrollLockChange?.(false);
    controller.current.flushEqualizerUpdates();
  }, [onScrollLockChange]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      endDrag();
    };
  }, [endDrag]);
  useEffect(() => {
    if (session) {
      if (sessionKey.current !== session.target.key) {
        sessionKey.current = session.target.key;
        draftRef.current = [...session.gains];
        setDraft(draftRef.current);
        lastSuccessfulDraft.current = [...session.gains];
      }
      return;
    }
    if (!drag.current && validEqualizerGains(settings.customEqualizerGains)) {
      publishDraft(settings.customEqualizerGains);
      lastSuccessfulDraft.current = [...settings.customEqualizerGains];
    }
  }, [settings.customEqualizerGains, session, publishDraft]);
  const apply = async (gains = draft, id?: string) => {
    if (applying) return;
    setApplying(true);
    const version = ++revision.current;
    try {
      if (await (scope === 'general' ? app.applyCustomEqualizer(gains, id) : app.applyCustomEqualizer(gains, id, scopeOptions)))
        lastSuccessfulDraft.current = [...gains];
      else if (mounted.current && revision.current === version)
        publishDraft(lastSuccessfulDraft.current);
    } finally {
      setApplying(false);
    }
  };
  const save = () => {
    if (saving || operation.current) return;
    if (session && !session.readyToSave) setSavePrompt(session.target);
    else {
      saveTarget.current = session?.target ?? null;
      setChoosingCategory(true);
    }
  };
  const continueSave = (configureAdvanced: boolean) => {
    if (!session || !savePrompt) return;
    if (!effectTargetMatches(stored, savePrompt) || savePrompt.key !== session.target.key) {
      setSavePrompt(null);
      app.notify('当前音效已变化，请重新确认保存');
      return;
    }
    saveTarget.current = savePrompt;
    setSavePrompt(null);
    session.beginSave(configureAdvanced);
    if (!configureAdvanced) setChoosingCategory(true);
  };
  const confirmApply = async () => {
    if (!applyConfirmation || operation.current) return;
    operation.current = true;
    ++revision.current; // An urgent confirmation may supersede a queued live audition.
    setApplying(true);
    try {
      if (await app.commitEqualizerEdit(applyConfirmation.target, applyConfirmation.gains)) {
        lastSuccessfulDraft.current = [...applyConfirmation.gains];
        setApplyConfirmation(null);
      }
    } finally {
      operation.current = false;
      setApplying(false);
    }
  };
  const confirmSave = async () => {
    if (saving || operation.current) return;
    if (session && (!saveTarget.current || !effectTargetMatches(stored, saveTarget.current) ||
      saveTarget.current.key !== session.target.key)) {
      app.notify('当前音效已变化，请重新确认保存');
      setChoosingCategory(false);
      return;
    }
    operation.current = true;
    if (session) ++revision.current;
    setSaving(true);
    try {
      if (
        await (session ? app.saveEqualizerDraft(
          name || `我的音效 ${presets.length + 1}`, draftRef.current, category,
          session.target.scope, session.includeAdvanced ? session.advanced : undefined,
        ) : app.saveCustomEqualizer(
          name || `我的音效 ${presets.length + 1}`,
          draft,
          category,
          ...(scope === 'general' ? [] : [scope]),
        ))
      ) {
        setName('');
        setChoosingCategory(false);
        session?.saved();
      }
    } finally {
      operation.current = false;
      setSaving(false);
    }
  };
  return (
    <View testID="custom-equalizer-editor">
      {session && (
        <Text testID="equalizer-current-effect" style={{ color: theme.muted, fontSize: 13, marginBottom: 12 }}>
          当前使用：{activeEffectName(stored)}
          {session.pendingSave ? `\n待保存：${name || '新音效'}` : `\n正在编辑：${session.target.name}`}
        </Text>
      )}
      <View style={styles.bands}>
        {equalizerBandLabels.map((label, index) => (
          <View key={label} style={styles.column}>
            <View
              testID={`equalizer-band-${index}`}
              accessibilityRole="adjustable"
              accessibilityLabel={`${label} Hz 均衡器`}
              accessibilityValue={{ min: -12, max: 12, now: draft[index] }}
              accessibilityActions={[
                { name: 'increment' },
                { name: 'decrement' },
              ]}
              onAccessibilityAction={event =>
                change(
                  index,
                  Math.max(
                    -12,
                    Math.min(
                      12,
                      draftRef.current[index]! +
                        (event.nativeEvent.actionName === 'increment'
                          ? 0.5
                          : -0.5),
                    ),
                  ),
                )
              }
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderTerminationRequest={() => false}
              onResponderGrant={event => {
                const nativeEvent = event.nativeEvent;
                const initialGain = equalizerGainAtPosition(
                  nativeEvent.locationY,
                );
                drag.current = {
                  pageY: nativeEvent.pageY ?? nativeEvent.locationY,
                  gain: initialGain,
                };
                onScrollLockChange?.(true);
                change(index, initialGain);
                return true;
              }}
              onResponderMove={event => {
                const current = drag.current;
                if (!current) return;
                const pageY =
                  event.nativeEvent.pageY ?? event.nativeEvent.locationY;
                change(
                  index,
                  equalizerGainAtDrag(
                    current.gain,
                    current.pageY,
                    pageY,
                    scale,
                  ),
                );
              }}
              onResponderRelease={endDrag}
              onResponderTerminate={endDrag}
              style={styles.rail}
            >
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <View
                  style={[styles.railLine, { backgroundColor: theme.line }]}
                />
                <View
                  style={[
                    styles.fill,
                    {
                      top: ((12 - draft[index]!) / 24) * railHeight,
                      backgroundColor: theme.gold,
                    },
                  ]}
                />
                <View
                  style={[
                    styles.knob,
                    { top: ((12 - draft[index]!) / 24) * railHeight - 10 },
                  ]}
                >
                  <Svg width={22} height={22} viewBox="0 0 22 22">
                    <Defs>
                      <LinearGradient
                        id={`slider-${index}`}
                        x1="0"
                        y1="0"
                        x2="1"
                        y2="1"
                      >
                        <Stop offset="0" stopColor={theme.panel} />
                        <Stop offset="0.6" stopColor={theme.panelSoft} />
                        <Stop offset="1" stopColor={theme.line} />
                      </LinearGradient>
                    </Defs>
                    <Circle
                      cx={11}
                      cy={12}
                      r={9}
                      fill={theme.text}
                      opacity={0.12}
                    />
                    <Circle
                      cx={11}
                      cy={10}
                      r={8.5}
                      fill={`url(#slider-${index})`}
                      stroke={theme.gold}
                      strokeWidth={1.5}
                    />
                    <Circle cx={11} cy={10} r={3} fill={theme.gold} />
                  </Svg>
                </View>
              </View>
            </View>
            <Text style={[styles.frequency, { color: foreground.secondary }]}>
              {label}
            </Text>
            <Text
              testID={`equalizer-gain-${index}`}
              style={[styles.gain, { color: foreground.primary }]}
            >
              {draft[index]! > 0 ? '+' : ''}
              {draft[index]} dB
            </Text>
          </View>
        ))}
      </View>
      <View testID="equalizer-actions" style={styles.actions}>
        <TextInput
          testID="equalizer-preset-name"
          accessibilityLabel="自定义音效名称"
          value={name}
          onChangeText={setName}
          maxLength={32}
          placeholder="给音效起个名字"
          placeholderTextColor={foreground.secondary}
          style={[
            styles.input,
            {
              color: foreground.primary,
              backgroundColor: theme.panel,
              borderColor: theme.line,
            },
          ]}
        />
        <Pressable
          testID="equalizer-save"
          disabled={saving}
          onPress={save}
          style={[styles.button, { backgroundColor: theme.panel }]}
        >
          <Text style={{ color: foreground.primary }}>{session?.readyToSave ? '保存并使用' : '保存'}</Text>
        </Pressable>
        <Pressable
          testID="equalizer-reset"
          onPress={() => {
            updateLive(flatEqualizerGains());
            app.flushEqualizerUpdates();
          }}
          style={[styles.button, { backgroundColor: theme.panelSoft }]}
        >
          <Text style={{ color: foreground.primary }}>归零</Text>
        </Pressable>
        <Pressable
          testID="equalizer-apply"
          disabled={applying}
          onPress={() => session
            ? setApplyConfirmation({ target: session.target, gains: [...draftRef.current] })
            : apply()}
          style={[
            styles.button,
            {
              backgroundColor: theme.selectedSurface,
              borderColor: theme.gold,
              borderWidth: 1,
            },
          ]}
        >
          <Text style={[styles.primaryText, { color: theme.text }]}>应用</Text>
        </Pressable>
      </View>
      <SavedEqualizerList
        foreground={foreground}
        presets={presets}
        category={scope === 'general' ? '自定义' : '调音台'}
        scope={scope}
        cards
        onSelect={preset => {
          publishDraft(preset.gains);
          setName(preset.name);
          setCategory(preset.category);
          session?.patch({ advanced: preset.advanced ?? flatAdvancedEffects() });
          return app.applyCustomEqualizer(preset.gains, preset.id, {
            advanced: preset.advanced,
            headphone: scope === 'general' ? null : preset.headphone ?? calibration ?? null,
            ...(scope === 'general' ? {} : { scope: preset.effectScope ?? scope }),
          });
        }}
      />
      {applyConfirmation && (
        <EffectConfirmationDialog id="equalizer-apply-dialog" title="确认修改音效"
          message={`当前使用：${activeEffectName(stored)}\n修改音效：${applyConfirmation.target.name}\n应用会覆盖正在使用的音效，是否确认修改？如果需要新增音效，请点击“保存”。`}
          busy={applying} onCancel={() => setApplyConfirmation(null)} buttons={[
            { id: 'equalizer-apply-cancel', label: '取消', onPress: () => setApplyConfirmation(null) },
            { id: 'equalizer-apply-save', label: '保存', onPress: () => {
              if (!effectTargetMatches(stored, applyConfirmation.target) || applyConfirmation.target.key !== session?.target.key) {
                setApplyConfirmation(null); app.notify('当前音效已变化，请重新确认保存'); return;
              }
              setApplyConfirmation(null); save();
            } },
            { id: 'equalizer-apply-confirm', label: '确认修改', onPress: () => { void confirmApply(); }, primary: true },
          ]} />
      )}
      {savePrompt && session && (
        <EffectConfirmationDialog id="equalizer-advanced-prompt" title="保存新音效"
          message="是否需要调教高级设置参数？选择否，只保存均衡器参数；选择是，完成高级设置后返回这里保存并使用。"
          onCancel={() => setSavePrompt(null)} buttons={[
            { id: 'equalizer-advanced-cancel', label: '取消', onPress: () => setSavePrompt(null) },
            { id: 'equalizer-advanced-no', label: '否，只保存均衡器', onPress: () => continueSave(false) },
            { id: 'equalizer-advanced-yes', label: '是，前往高级设置', onPress: () => continueSave(true), primary: true },
          ]} />
      )}
      {choosingCategory && (
        <Modal
          transparent
          animationType="fade"
          onRequestClose={() => {
            if (!saving) setChoosingCategory(false);
          }}
        >
          <View style={styles.pickerOverlay}>
            <Pressable
              accessibilityLabel="取消保存分类选择"
              style={StyleSheet.absoluteFill}
              disabled={saving}
              onPress={() => setChoosingCategory(false)}
            />
            <View
              testID="equalizer-category-picker"
              style={[styles.categoryPicker, { backgroundColor: theme.panel }]}
            >
              <Text
                style={[styles.categoryTitle, { color: foreground.primary }]}
              >
                选择保存分类
              </Text>
              {(scope === 'general' ? equalizerPresetCategories : ['调音台'] as const).map((option, index) => (
                <Pressable
                  key={option}
                  testID={`equalizer-save-category-${index}`}
                  disabled={saving}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: option === category }}
                  onPress={() => setCategory(option)}
                  style={[
                    styles.categoryOption,
                    option === category && {
                      backgroundColor: theme.selectedSurface,
                    },
                  ]}
                >
                  <Text style={{ color: foreground.primary }}>
                    {equalizerCategoryLabels[option]}
                  </Text>
                  {option === category && (
                    <Text style={{ color: theme.text }}>✓</Text>
                  )}
                </Pressable>
              ))}
              <View style={styles.categoryActions}>
                <Pressable
                  testID="equalizer-save-cancel"
                  disabled={saving}
                  onPress={() => setChoosingCategory(false)}
                  style={[styles.button, { backgroundColor: theme.panelSoft }]}
                >
                  <Text style={{ color: foreground.primary }}>取消</Text>
                </Pressable>
                <Pressable
                  testID="equalizer-save-confirm"
                  disabled={saving}
                  onPress={confirmSave}
                  style={[
                    styles.button,
                    {
                      backgroundColor: theme.selectedSurface,
                      borderColor: theme.gold,
                      borderWidth: 1,
                    },
                  ]}
                >
                  <Text style={[styles.primaryText, { color: theme.text }]}>
                    {session ? '保存并使用' : '确认保存'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

export { SavedEqualizerList };

const styles = StyleSheet.create({
  bands: { flexDirection: 'row', justifyContent: 'space-between' },
  column: { flex: 1, alignItems: 'center' },
  rail: { height: railHeight, width: '100%' },
  railLine: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    width: 4,
    marginLeft: -1,
    borderRadius: 2,
  },
  fill: {
    position: 'absolute',
    left: '50%',
    bottom: 0,
    width: 2,
    backgroundColor: accent,
  },
  knob: {
    position: 'absolute',
    left: '50%',
    marginLeft: -10,
    width: 22,
    height: 22,
  },
  frequency: { fontSize: 11, marginTop: 12 },
  gain: { fontSize: 10, marginTop: 6, fontVariant: ['tabular-nums'] },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 18,
  },
  button: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  primaryText: { fontWeight: '600' },
  input: {
    flex: 1,
    minWidth: 0,
    height: 44,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  savedTitle: { fontSize: 16, marginTop: 16, marginBottom: 10 },
  savedGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  savedCard: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
    height: 90,
  },
  savedCardApply: {
    height: 44,
    paddingHorizontal: 3,
    paddingVertical: 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  savedCardName: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  savedCardStatus: { fontSize: 9, lineHeight: 12, textAlign: 'center' },
  savedCardDelete: {
    height: 44,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 4,
  },
  saved: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    borderRadius: 12,
    marginBottom: 10,
    backgroundColor: 'rgba(155,160,170,0.16)',
  },
  savedActive: { borderWidth: 1, borderColor: accent },
  savedApply: {
    flex: 1,
    paddingVertical: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  deleteButton: { paddingHorizontal: 16, paddingVertical: 16 },
  pickerOverlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0,0,0,0.52)',
  },
  categoryPicker: {
    padding: 20,
    borderRadius: 16,
    backgroundColor: 'rgba(24,29,36,0.98)',
  },
  categoryTitle: { fontSize: 16, marginBottom: 8 },
  categoryOption: {
    minHeight: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  categoryActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 12,
  },
});
