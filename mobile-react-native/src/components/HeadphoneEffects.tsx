import autoEqLicense from '../assets/headphones/license.json';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useApp } from '../state/AppContext';
import { useTheme } from '../theme';
import {
  HeadphoneCatalogRepository,
  HeadphoneProfileRepository,
  HeadphoneProfileImporter,
  HeadphoneProfileSyncManager,
  headphoneBrands,
  headphoneModels,
  emptyHeadphoneData,
  hasBundledHeadphoneProfiles,
  headphoneCatalogRevision,
  observeHeadphoneCatalog,
} from '../services/headphones';
import { updateHeadphoneDatabase, headphoneDatabaseInfo } from '../services/headphoneDatabase';
import type { DatabaseProgress } from '../services/headphoneDatabase';
import type {
  HeadphoneEqProfileEntity,
  HeadphoneModelEntity,
  HeadphoneType,
} from '../services/headphones';
import { flatAdvancedEffects } from '../services/audioEffectState';
import { pickHeadphoneProfile } from '../services/storage';
import { EqualizerEditor, SavedEqualizerList } from './EqualizerEditor';
import { AdvancedEffectsEditor } from './AdvancedEffectsEditor';
import { readEffects } from '../services/effectIsolation';
import type { EffectScope } from '../services/effectIsolation';
import type { HeadphoneCalibration } from '../services/audioEffectState';
import { HeadphoneBrandLogo } from './HeadphoneBrandLogo';
import { HeadphoneTypeIcon, headphoneTypeLabel } from './HeadphoneTypeIcon';
import { TrackActionIcon } from './TrackActionIcon';
import { HeadphoneFrequencyChart } from './HeadphoneFrequencyChart';
import {
  headphoneSchemeProfile,
  type HeadphoneScheme,
} from '../services/headphoneScheme';

export function HeadphoneIllustration({ size = 96 }: { size?: number } = {}) {
  const theme = useTheme();
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 140 140"
      accessibilityLabel="耳机插画"
    >
      <Path
        d="M25 85V65a45 45 0 0 1 90 0v20"
        stroke={theme.gold}
        strokeWidth={9}
        fill="none"
      />
      <Path
        d="M20 70h18v49H20c-13 0-13-49 0-49M120 70h-18v49h18c13 0 13-49 0-49"
        fill={theme.panel}
        stroke={theme.gold}
        strokeWidth={3}
      />
    </Svg>
  );
}
export function HeadphoneEffects() {
  const app = useApp(),
    theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [catalogVersion,setCatalogVersion] = useState(headphoneCatalogRevision);
  useEffect(() => observeHeadphoneCatalog(() => setCatalogVersion(headphoneCatalogRevision())),[]);
  const [databaseBusy,setDatabaseBusy] = useState(false);
  const [databaseProgress,setDatabaseProgress] = useState<DatabaseProgress>();
  const [databaseStatus,setDatabaseStatus] = useState('');
  const databaseRequest = useRef<AbortController|null>(null);
  const databaseSaving = useRef(false);
  const updateDatabase = async () => {
    if(databaseRequest.current)return;
    const controller=new AbortController();databaseRequest.current=controller;databaseSaving.current=false;
    setDatabaseBusy(true);setDatabaseStatus('');setDatabaseProgress({phase:'checking',completed:0,total:0});
    try {
      const result=await updateHeadphoneDatabase(controller.signal,progress=>{
        databaseSaving.current=progress.phase==='saving';
        if(mounted.current)setDatabaseProgress(progress);
      });
      if(mounted.current)setDatabaseStatus(result.downloaded?`更新完成：新增 ${result.addedModels} 个型号，更新 ${result.downloaded} 份校准方案；点击应用音效后生效`:`已核实官网最新数据：${result.models} 个型号，${result.profiles} 份校准方案`);
    } catch(error) {
      if(mounted.current)setDatabaseStatus(error instanceof Error?error.message:'更新失败，原耳机数据库保留');
    } finally {
      databaseRequest.current=null;databaseSaving.current=false;
      if(mounted.current)setDatabaseBusy(false);
    }
  };
  const data = app.state.settings.headphoneData ?? emptyHeadphoneData();
  const repository = useMemo(
    () => new HeadphoneProfileRepository(data.imported),
    [data.imported],
  );
  const catalog = useMemo(() => new HeadphoneCatalogRepository(data), [data]);
  const [brandId, setBrandId] = useState<string>();
  const [model, setModel] = useState<HeadphoneModelEntity>();
  const [query, setQuery] = useState(''),
    [type, setType] = useState<HeadphoneType>();
  const [selected, setSelected] = useState<HeadphoneEqProfileEntity>();
  const [loadedProfiles, setLoadedProfiles] = useState<HeadphoneEqProfileEntity[]>([]);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileRetry, setProfileRetry] = useState(0);
  const [visibleCount, setVisibleCount] = useState(60);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');
  const syncRequest = useRef<AbortController | null>(null);
  const syncGeneration = useRef(0);
  const mounted = useRef(true);
  const latestData = useRef(data);
  latestData.current = data;
  useEffect(() => {
    mounted.current = true;
    const cancelPendingRequest = () => {
      ++syncGeneration.current;
      syncRequest.current?.abort();
    };
    return () => {
      mounted.current = false;
      cancelPendingRequest();
      if(!databaseSaving.current)databaseRequest.current?.abort();
    };
  }, []);
  const [scheme, setScheme] = useState<HeadphoneScheme>('professional');
  const [customEditing, setCustomEditing] = useState(false);
  const [editor, setEditor] = useState<'eq' | 'advanced'>('eq');
  const [locked, setLocked] = useState(false);
  const [customTarget, setCustomTarget] = useState<{ scope: EffectScope; calibration: HeadphoneCalibration | null }>();
  const [importing, setImporting] = useState(false),
    [file, setFile] = useState<{ fileName: string; content: string }>(),
    [source, setSource] = useState(''),
    [license, setLicense] = useState(''),
    [version, setVersion] = useState(''),
    [sourceUrl, setSourceUrl] = useState(''),
    [measurement, setMeasurement] = useState(''),
    [error, setError] = useState('');
  const profiles = model ? loadedProfiles : [];
  useEffect(() => {
    setVisibleCount(60);
  }, [query, brandId, type]);
  useEffect(() => {
    setLoadedProfiles([]); setProfileError('');
    if (!model) { setProfileLoading(false); return; }
    let cancelled = false;
    setProfileLoading(true);
    repository.loadModel(model.id).then(next => {
      if (!cancelled) setLoadedProfiles(next);
    }).catch(e => {
      if (!cancelled) { setLoadedProfiles(repository.forModel(model.id)); setProfileError(e instanceof Error ? e.message : '本地校准读取失败'); }
    }).finally(() => { if (!cancelled) setProfileLoading(false); });
    return () => { cancelled = true; };
  }, [model, repository, profileRetry, catalogVersion]);
  const chosen =
    selected && selected.modelId === model?.id ? selected : profiles[0];
  const selectedCalibration = headphoneSchemeProfile(chosen, scheme);
  const selectedScope: EffectScope = { modelId: model?.id ?? '', profileId: selectedCalibration?.profileId ?? 'original' };
  const beginCustom = () => {
    if (!model) return;
    if (scheme !== 'custom' || !customTarget)
      setCustomTarget({ scope: selectedScope, calibration: selectedCalibration });
    setCustomEditing(true); setEditor('eq'); setScheme('custom');
  };
  const foreground = { primary: theme.text, secondary: theme.muted };
  const box = { backgroundColor: theme.panelSoft, borderColor: theme.line };
  const saveData = (next: typeof data) => app.setSetting('headphoneData', next);
  const cancelSync = () => {
    ++syncGeneration.current;
    syncRequest.current?.abort();
    syncRequest.current = null;
    setSyncBusy(false);
    setSyncStatus('');
  };
  const sync = async () => {
    if (!chosen || syncRequest.current) return;
    const controller = new AbortController();
    syncRequest.current = controller;
    const generation = ++syncGeneration.current;
    setSyncBusy(true);
    setSyncStatus('正在检查公开配置…');
    try {
      const updated = await HeadphoneProfileSyncManager.refresh(
        chosen,
        controller.signal,
      );
      if (!mounted.current || generation !== syncGeneration.current) return;
      if (updated === chosen) {
        setSyncStatus('已是最新公开配置');
        app.notify('已是最新公开配置');
      } else {
        const current = latestData.current;
        saveData({
          ...current,
          imported: new HeadphoneProfileRepository(current.imported).upsert(
            updated,
          ),
        });
        setSelected(updated);
        setSyncStatus('公开配置已更新，点击应用音效后生效');
        app.notify('公开配置已更新；当前播放音效保持不变，可手动应用');
      }
    } catch (e) {
      if (!mounted.current || generation !== syncGeneration.current) return;
      const message =
        e instanceof Error ? e.message : '下载失败，当前音效保持不变';
      setSyncStatus(message);
      app.notify(message);
    } finally {
      if (syncRequest.current === controller) syncRequest.current = null;
      if (mounted.current && generation === syncGeneration.current)
        setSyncBusy(false);
    }
  };
  const favorite = (id: string) =>
    saveData({
      ...data,
      favorites: data.favorites.includes(id)
        ? data.favorites.filter(v => v !== id)
        : [...data.favorites, id],
    });
  const open = (next: HeadphoneModelEntity) => {
    cancelSync();
    setModel(next);
    setSelected(undefined);
    setCustomEditing(false);
    setScheme('professional');
    setQuery('');
  };
  const apply = async (reset = false) => {
    if (!model) return;
    if (scheme === 'custom') {
      beginCustom();
      return;
    }
    if (scheme !== 'original' && !chosen) {
      app.notify('该型号暂无已验证校准数据，请导入本地配置');
      return;
    }
    const retained = readEffects(app.state.settings, selectedScope);
    const gains = reset
      ? Array(10).fill(0)
      : [...retained.gains];
    const next = headphoneSchemeProfile(chosen, scheme);
    const ok = await app.applyCustomEqualizer(gains, undefined, {
      headphone: next,
      scope: selectedScope,
      advanced: reset
        ? flatAdvancedEffects()
        : retained.advanced,
    });
    if (ok)
      saveData({
        ...data,
        recent: [model.id, ...data.recent.filter(id => id !== model.id)].slice(
          0,
          12,
        ),
      });
  };
  const finishImport = () => {
    try {
      if (!file || !model) throw new Error('请先选择文件');
      const profile = HeadphoneProfileImporter.parse(file.content, {
        modelId: model.id,
        name: file.fileName.replace(/\.txt$/i, ''),
        sourceName: source,
        sourceUrl,
        sourceVersion: version,
        license,
        measurementMode: measurement || '用户指定；测量模式未提供',
        verified: false,
      });
      const imported = repository.upsert(profile);
      saveData({ ...data, imported });
      setSelected(profile);
      setScheme('professional');
      setImporting(false);
      setFile(undefined);
      app.notify('配置已校验并导入；来源声明未经独立核验');
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败');
    }
  };
  const modelRow = (m: HeadphoneModelEntity) => {
    const available = repository.forModel(m.id),
      hasCalibration = hasBundledHeadphoneProfiles(m.id) || available.length > 0,
      fav = data.favorites.includes(m.id);
    return (
      <View key={m.id} style={[styles.model, box]}>
        <Pressable
          testID={`headphone-model-${m.id}`}
          onPress={() => open(m)}
          style={styles.modelButton}
        >
          <HeadphoneTypeIcon type={m.headphoneType} modelId={m.id} />
          <View style={styles.modelCopy}>
          <Text style={[styles.modelTitle, { color: theme.text }]}>
            {m.modelName}
          </Text>
          <Text style={{ color: theme.muted, fontSize: 12, marginTop: 5 }}>
            {headphoneTypeLabel(m.headphoneType)}{' '}
            · {hasCalibration ? '已有调音数据' : '暂无校准数据'}
          </Text>
          {!!available.length && (
            <Text style={{ color: theme.muted, fontSize: 10, marginTop: 5 }}>
              {available[0]!.sourceName}
            </Text>
          )}
          </View>
        </Pressable>
        <Pressable
          testID={`headphone-favorite-${m.id}`}
          accessibilityLabel={`收藏 ${m.modelName}`}
          accessibilityState={{ selected: fav }}
          onPress={() => favorite(m.id)}
          style={{ padding: 12, minWidth: 44, minHeight: 44 }}
        >
          <TrackActionIcon kind="favorite" active={fav} size={22}
            color={fav ? theme.accent : theme.muted} />
        </Pressable>
      </View>
    );
  };
  const brandRow = (b: (typeof headphoneBrands)[number], all = false) => (
    <Pressable
      key={b.id}
      testID={`headphone-${all ? 'all-brand' : 'brand'}-${b.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${b.name} ${b.displayName}`}
      onPress={() => {
        setBrandId(b.id);
        setQuery('');
        setType(undefined);
      }}
      style={[styles.brandRow, box]}
    >
      <HeadphoneBrandLogo brandId={b.id} name={b.name} />
      <View style={styles.brandName}>
        <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>
          {b.name}
        </Text>
        {b.displayName !== b.name && (
          <Text style={{ color: theme.muted, fontSize: 11, marginTop: 2 }}>
            {b.displayName}
          </Text>
        )}
      </View>
      <Text style={{ color: theme.muted, fontSize: 22 }}>›</Text>
    </Pressable>
  );
  return (
    <View testID="headphone-effects" style={styles.root}>
      <ScrollView
        testID="effects-scroll"
        scrollEnabled={!locked}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.content}
        scrollEventThrottle={100}
        onScroll={event => {
          if (model) return;
          const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
          if (contentOffset.y + layoutMeasurement.height >= contentSize.height - 700)
            setVisibleCount(count => count + 60);
        }}
        showsHorizontalScrollIndicator={false}
      >
        {!!app.player?.audioEffectWarning && (
          <Text style={{ color: theme.red }}>
            {app.player.audioEffectWarning}
          </Text>
        )}
        {(brandId || model) && (
          <Pressable
            testID="headphone-back"
            onPress={() => {
              cancelSync();
              if (customEditing) { setCustomEditing(false); setScheme('professional'); }
              else if (model) setModel(undefined);
              else setBrandId(undefined);
              setQuery('');
            }}
          >
            <Text style={{ color: theme.text, marginBottom: 10 }}>
              ‹　{customEditing ? '返回耳机方案' : model ? '返回型号列表' : '全部品牌'}
            </Text>
          </Pressable>
        )}
        <View style={[styles.hero, box, model && styles.compactHero]}>
          <View style={{ flex: 1 }}>
            <Text
              style={[
                styles.heroTitle,
                { color: theme.text },
                model && { fontSize: 13 },
              ]}
            >
              {model
                ? headphoneBrands.find(b => b.id === model.brandId)?.name
                : brandId
                ? headphoneBrands.find(b => b.id === brandId)?.name
                : '耳机音效'}
            </Text>
            <Text
              style={{
                color: theme.text,
                fontSize: model ? 16 : 13,
                marginTop: model ? 3 : 6,
                fontWeight: model ? '600' : '400',
              }}
            >
              {model
                ? model.modelName
                : brandId
                ? '选择耳机型号'
                : '为你的耳机选择专属校准'}
            </Text>
            <Text style={{ color: theme.muted, fontSize: 11, marginTop: 5 }}>
              {model ? '公开测量 · 参数校准' : `${headphoneBrands.length} 个品牌 · ${headphoneModels.length} 个型号／状态 · 离线可用`}
            </Text>
          </View>
          <HeadphoneIllustration size={model ? 54 : 96} />
        </View>
        {!model && !brandId && (
          <View style={{marginTop:12}}>
            <Pressable testID="headphone-database-update" accessibilityRole="button" accessibilityLabel="更新耳机数据库" disabled={databaseBusy}
              accessibilityState={{busy:databaseBusy,disabled:databaseBusy}} onPress={updateDatabase} style={[styles.importButton,box]}>
              <Text style={{color:theme.text}}>更新耳机数据库</Text>
            </Pressable>
            <Text style={{color:theme.muted,fontSize:11,marginTop:5}}>同步官网品牌、型号和校准方案，保存后离线可用；不会自动应用音效。</Text>
            {headphoneDatabaseInfo().checkedAt && <Text testID="headphone-database-checked" style={{color:theme.muted,fontSize:11,marginTop:5}}>最新检查：{new Date(headphoneDatabaseInfo().checkedAt!).toLocaleString()}</Text>}
            {databaseBusy && <View>
              <Text testID="headphone-database-progress" style={{color:theme.muted,fontSize:12,marginTop:8}}>
                {databaseProgress?.phase==='saving'?'正在保存耳机数据库…':databaseProgress?.phase==='downloading'?`正在更新校准方案 ${databaseProgress.completed}／${databaseProgress.total}`:'正在核对官网耳机数据…'}
              </Text>
              <Pressable testID="headphone-database-cancel" disabled={databaseProgress?.phase==='saving'} onPress={()=>databaseRequest.current?.abort()} style={[styles.importButton,box]}>
                <Text style={{color:theme.text}}>取消更新</Text>
              </Pressable>
            </View>}
            {!!databaseStatus && <Text testID="headphone-database-status" accessibilityLiveRegion="polite" style={{color:theme.muted,fontSize:12,marginTop:8}}>{databaseStatus}</Text>}
          </View>
        )}
        {!model && !!app.state.settings.headphoneCalibration && (
          <Text
            testID="headphone-current-model"
            style={{ color: theme.muted, marginTop: 14 }}
          >
            已启用：
            {
              headphoneModels.find(
                m => m.id === app.state.settings.headphoneCalibration?.modelId,
              )?.modelName
            }{' '}
            · {app.state.settings.headphoneCalibration.name}
          </Text>
        )}
        {model && customEditing && customTarget ? (
          <>
            <Text style={[styles.heading, { color: theme.text }]}>当前耳机独立微调</Text>
            <View style={styles.actionRow}>
              {(['eq', 'advanced'] as const).map(value => (
                <Pressable key={value} testID={`effects-editor-${value}`} onPress={() => setEditor(value)}
                  style={[styles.action, box, editor === value && { borderColor: theme.gold }]}>
                  <Text style={{ color: theme.text }}>{value === 'eq' ? '均衡器' : '高级设置'}</Text>
                </Pressable>
              ))}
            </View>
            {editor === 'eq' ? <EqualizerEditor foreground={foreground} scope={customTarget.scope}
              calibration={customTarget.calibration} onScrollLockChange={setLocked} /> :
              <AdvancedEffectsEditor scope={customTarget.scope} calibration={customTarget.calibration} onScrollLockChange={setLocked} />}
          </>
        ) : model ? (
          <>
            <Text style={[styles.heading, { color: theme.text }]}>
              推荐调音方案
            </Text>
            <View style={styles.schemes}>
              {(
                [
                  ['professional', '专业校准'],
                  ['original', '原声模式'],
                  ['soft', '柔和聆听'],
                  ['bass', '低音增强'],
                  ['custom', '我的自定义'],
                ] as const
              ).map(([key, title]) => (
                <Pressable
                  key={key}
                  testID={`headphone-scheme-${key}`}
                  accessibilityState={{ selected: scheme === key }}
                  onPress={() => setScheme(key)}
                  style={[
                    styles.scheme,
                    box,
                    scheme === key && {
                      borderColor: theme.gold,
                      backgroundColor: theme.selectedSurface,
                    },
                  ]}
                >
                  <Text style={{ color: theme.text, fontWeight: '600' }}>
                    {title}
                  </Text>
                  <Text
                    style={{ color: theme.muted, fontSize: 9, marginTop: 3 }}
                  >
                    {key === 'professional'
                      ? '自动校准音效'
                      : key === 'original'
                      ? '关闭耳机校准'
                      : '用户偏好调整'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text
              testID="headphone-active-profile"
              style={{ color: theme.muted, fontSize: 11, marginTop: 8 }}
            >
              {app.player?.audioEffectWarning
                ? app.player.audioEffectWarning
                : app.state.settings.headphoneCalibration
                ? `已应用：${
                    headphoneModels.find(
                      m =>
                        m.id ===
                        app.state.settings.headphoneCalibration?.modelId,
                    )?.modelName ?? ''
                  } · ${app.state.settings.headphoneCalibration.name}`
                : '尚未应用耳机校准 · 原声模式'}
            </Text>
            <Text
              style={{
                color: theme.muted,
                fontSize: 10,
                lineHeight: 15,
                marginTop: 5,
              }}
            >
              选择后点击应用音效；仅保留当前耳机方案的独立微调，不叠加宙斯、GTO 或通用均衡器。
            </Text>
            {profiles.length ? (
              profiles.map(p => (
                <Pressable
                  key={p.profileId}
                  testID={`headphone-profile-${p.profileId}`}
                  onPress={() => {
                    cancelSync();
                    setSelected(p);
                    setScheme('professional');
                  }}
                  style={[
                    styles.profile,
                    box,
                    chosen?.profileId === p.profileId && {
                      borderColor: theme.gold,
                    },
                  ]}
                >
                  <Text style={{ color: theme.text }}>{p.name}</Text>
                  <Text
                    style={{ color: theme.muted, fontSize: 11, marginTop: 6 }}
                  >
                    {p.verified
                      ? '已校验公开参数'
                      : '本地导入 · 来源由用户声明'}{' '}
                    · {p.sourceName}
                  </Text>
                </Pressable>
              ))
            ) : profileLoading ? null : profileError ? (
              <Pressable testID="headphone-profile-retry" onPress={() => setProfileRetry(value => value + 1)}>
                <Text style={{ color: theme.red, marginVertical: 18 }}>{profileError} · 点击重试</Text>
              </Pressable>
            ) : (
              <Text
                testID="headphone-no-data"
                style={{ color: theme.muted, marginVertical: 18 }}
              >
                暂无该型号的校准数据。可使用原声模式，或自行导入合法 EQ 文件。
              </Text>
            )}
            {chosen && (
              <View style={[styles.details, box]}>
                <HeadphoneFrequencyChart
                  profile={chosen}
                  calibration={
                    scheme === 'custom'
                      ? app.state.settings.headphoneCalibration ?? null
                      : headphoneSchemeProfile(chosen, scheme)
                  }
                />
                <Text
                  style={{ color: theme.muted, fontSize: 11, marginTop: 16 }}
                >
                  来源：{chosen.sourceName} · {chosen.license}
                </Text>
                <Text
                  style={{ color: theme.muted, fontSize: 11, marginTop: 8 }}
                >
                  前级增益 {chosen.preampDb} dB · {chosen.filters.length}{' '}
                  个滤波器
                </Text>
                <Pressable
                  testID="headphone-data-toggle"
                  accessibilityState={{ expanded }}
                  onPress={() => setExpanded(!expanded)}
                  style={[styles.importButton, box]}
                >
                  <Text style={{ color: theme.text }}>
                    参数与数据说明　{expanded ? '⌃' : '⌄'}
                  </Text>
                </Pressable>
                {expanded && (
                  <>
                    <Text style={[styles.heading, { color: theme.text }]}>
                      参数均衡器 PEQ
                    </Text>
                    <Text style={{ color: theme.text, marginBottom: 12 }}>
                      前级增益　{chosen.preampDb} dB
                    </Text>
                    {chosen.filters.map((f, i) => (
                      <Text
                        key={i}
                        style={{
                          color: theme.muted,
                          fontSize: 12,
                          lineHeight: 23,
                        }}
                      >
                        {i + 1}. {f.type}　{f.frequency} Hz　
                        {f.gain > 0 ? '+' : ''}
                        {f.gain} dB　Q {f.q}
                      </Text>
                    ))}
                    {chosen.format === 'graphic' && (
                      <Text style={{ color: theme.muted, marginTop: 12 }}>
                        图形 EQ 按 1/3 倍频程 Q=4.318
                        滤波器执行，属于近似实现；不等同于原软件的频响。
                      </Text>
                    )}
                    <Text style={[styles.heading, { color: theme.text }]}>
                      数据说明
                    </Text>
                    <Text
                      selectable
                      style={{
                        color: theme.muted,
                        fontSize: 11,
                        lineHeight: 20,
                      }}
                    >
                      来源：{chosen.sourceName}
                      {'\n'}测量模式：{chosen.measurementMode}
                      {'\n'}版本：{chosen.sourceVersion}
                      {'\n'}许可：{chosen.license}
                      {'\n'}
                      {chosen.sourceUrl}
                      {'\n'}AutoEq
                      为公开测量衍生的自动校准，不代表耳机厂商官方调音。个体佩戴与耳罩状态会影响结果。
                    </Text>
                    {chosen.verified && (
                      <Pressable
                        testID="headphone-sync"
                        accessibilityRole="button"
                        accessibilityLabel={
                          syncBusy ? '正在更新当前方案' : '更新当前方案'
                        }
                        disabled={syncBusy}
                        accessibilityState={{
                          busy: syncBusy,
                          disabled: syncBusy,
                        }}
                        onPress={sync}
                        style={[styles.importButton, box]}
                      >
                        <Text style={{ color: theme.text }}>
                          {syncBusy ? '检查中…' : '更新当前方案'}
                        </Text>
                      </Pressable>
                    )}
                    {!!syncStatus && (
                      <Text
                        testID="headphone-sync-status"
                        accessibilityLiveRegion="polite"
                        style={{
                          color: theme.muted,
                          fontSize: 11,
                          lineHeight: 16,
                          marginTop: 6,
                        }}
                      >
                        {syncStatus}
                      </Text>
                    )}
                    {chosen.license === 'MIT' && (
                      <Text
                        selectable
                        style={{
                          color: theme.muted,
                          fontSize: 9,
                          lineHeight: 14,
                          marginTop: 16,
                        }}
                      >
                        {autoEqLicense.text}
                      </Text>
                    )}
                  </>
                )}
              </View>
            )}
            <SavedEqualizerList
              foreground={foreground}
              presets={(app.state.settings.customEqualizerPresets ?? []).filter(
                p => p.headphone?.modelId === model.id,
              )}
              category="调音台"
              scope={selectedScope}
            />
          </>
        ) : (
          <>
            <TextInput
              testID="headphone-search"
              value={query}
              onChangeText={setQuery}
              placeholder={
                brandId ? '搜索耳机型号，如 WH-1000XM5' : '搜索品牌或耳机型号'
              }
              placeholderTextColor={theme.muted}
              style={[styles.search, box, { color: theme.text }]}
            />
            {brandId ? (
              <>
                <View style={styles.filters}>
                  {(
                    [
                      ['', '全部'],
                      ['over-ear', '头戴式'],
                      ['in-ear', '入耳式'],
                      ['earbud', '平头式'],
                    ] as const
                  ).map(([kind, label]) => (
                    <Pressable
                      key={kind}
                      testID={`headphone-type-${kind || 'all'}`}
                      onPress={() => setType(kind || undefined)}
                      style={[
                        styles.filter,
                        box,
                        (type ?? '') === kind && { borderColor: theme.gold },
                      ]}
                    >
                      <Text style={{ color: theme.text }}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
                {catalog.models(query, brandId, type).slice(0, visibleCount).map(modelRow)}
              </>
            ) : (
              <>
                {query ? (
                  <>
                    {catalog.models(query).slice(0, visibleCount).map(modelRow)}
                    {catalog.brands(query).slice(0, visibleCount).map(b => brandRow(b))}
                  </>
                ) : (
                  <>
                    {!!data.recent.length && (
                      <>
                        <Text style={[styles.heading, { color: theme.text }]}>
                          最近使用的耳机
                        </Text>
                        {data.recent
                          .map(id => headphoneModels.find(m => m.id === id))
                          .filter((m): m is HeadphoneModelEntity => !!m)
                          .map(modelRow)}
                      </>
                    )}
                    {!!data.favorites.length && (
                      <>
                        <Text style={[styles.heading, { color: theme.text }]}>
                          收藏的耳机
                        </Text>
                        {data.favorites
                          .map(id => headphoneModels.find(m => m.id === id))
                          .filter((m): m is HeadphoneModelEntity => !!m)
                          .map(modelRow)}
                      </>
                    )}
                    <Text style={[styles.heading, { color: theme.text }]}>
                      热门品牌
                    </Text>
                    <View style={styles.brands}>
                      {headphoneBrands.slice(0, 9).map(b => (
                        <Pressable
                          key={b.id}
                          testID={`headphone-brand-${b.id}`}
                          onPress={() => {
                            setBrandId(b.id);
                            setType(undefined);
                          }}
                          style={[styles.brandTile, box]}
                        >
                          <HeadphoneBrandLogo brandId={b.id} name={b.name} />
                          <Text
                            style={{
                              color: theme.text,
                              fontWeight: '700',
                              fontSize: 15,
                            }}
                          >
                            {b.name}
                          </Text>
                          <Text
                            style={{
                              color: theme.muted,
                              marginTop: 5,
                              fontSize: 11,
                            }}
                          >
                            {b.displayName}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    <Text style={[styles.heading, { color: theme.text }]}>
                      全部品牌 · {headphoneBrands.length}
                    </Text>
                    {[...headphoneBrands]
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .slice(0, visibleCount)
                      .map(b => brandRow(b, true))}
                    <SavedEqualizerList
                      foreground={foreground}
                      presets={app.state.settings.customEqualizerPresets ?? []}
                      category="调音台"
                    />
                  </>
                )}
              </>
            )}
          </>
        )}
        {importing && (
          <Modal transparent onRequestClose={() => setImporting(false)}>
            <View style={styles.overlay}>
              <View
                style={[styles.importModal, { backgroundColor: theme.panel }]}
              >
                <Text style={[styles.heading, { color: theme.text }]}>
                  导入 {model?.modelName} 配置
                </Text>
                <Pressable
                  testID="headphone-import-file"
                  onPress={async () => {
                    try {
                      const result = await pickHeadphoneProfile();
                      if (result) setFile(result);
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                  style={[styles.importButton, box]}
                >
                  <Text style={{ color: theme.text }}>
                    {file?.fileName ?? '选择本地文本文件'}
                  </Text>
                </Pressable>
                {[
                  [source, setSource, '来源名称（必填）'],
                  [sourceUrl, setSourceUrl, '来源网址（可选）'],
                  [version, setVersion, '数据版本（必填）'],
                  [license, setLicense, '许可声明（必填，未知可填仅个人使用）'],
                  [measurement, setMeasurement, '测量模式（如 ANC 开启）'],
                ].map(([value, setter, label], i) => (
                  <TextInput
                    key={i}
                    testID={`headphone-import-meta-${i}`}
                    value={value as string}
                    onChangeText={setter as (value: string) => void}
                    placeholder={label as string}
                    placeholderTextColor={theme.muted}
                    style={[styles.search, box, { color: theme.text }]}
                  />
                ))}
                <Text style={{ color: theme.muted, fontSize: 11 }}>
                  仅导入你有权使用的文件。来源未独立核验，不会自动同步或随应用分发。
                </Text>
                {!!error && (
                  <Text
                    testID="headphone-import-error"
                    style={{ color: theme.red, marginTop: 10 }}
                  >
                    {error}
                  </Text>
                )}
                <View style={styles.actionRow}>
                  <Pressable
                    onPress={() => setImporting(false)}
                    style={[styles.action, box]}
                  >
                    <Text style={{ color: theme.text }}>取消</Text>
                  </Pressable>
                  <Pressable
                    testID="headphone-import-confirm"
                    onPress={finishImport}
                    style={[
                      styles.action,
                      { backgroundColor: theme.selectedSurface },
                    ]}
                  >
                    <Text style={{ color: theme.text }}>校验并导入</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        )}
      </ScrollView>
      {model && (
        <View
          testID="headphone-action-panel"
          style={[
            styles.actionPanel,
            { backgroundColor: theme.bg, borderTopColor: theme.line },
          ]}
        >
          <View style={styles.actionRow}>
            <Pressable
              testID="headphone-custom"
              onPress={beginCustom}
              style={[styles.action, box]}
            >
              <Text style={{ color: theme.text }}>进入自定义均衡器</Text>
            </Pressable>
            <Pressable
              testID="headphone-apply"
              disabled={profileLoading && scheme !== 'original'}
              onPress={() => apply()}
              style={[
                styles.action,
                { backgroundColor: theme.selectedSurface },
              ]}
            >
              <Text style={{ color: theme.text, fontWeight: '600' }}>
                ✓　应用音效
              </Text>
            </Pressable>
          </View>
          <View style={styles.actionRow}>
            <Pressable
              testID="headphone-original"
              onPress={() =>
                app.applyCustomEqualizer(Array(10).fill(0), undefined, {
                  headphone: null,
                  scope: { modelId: model!.id, profileId: 'original' },
                  advanced: flatAdvancedEffects(),
                })
              }
              style={[styles.action, box]}
            >
              <Text style={{ color: theme.text }}>恢复原声</Text>
            </Pressable>
            <Pressable
              testID="headphone-restore-calibration"
              onPress={() => {
                setScheme('professional');
                if (chosen)
                  app.applyCustomEqualizer(Array(10).fill(0), undefined, {
                    headphone: chosen,
                    scope: { modelId: model!.id, profileId: chosen.profileId },
                    advanced: flatAdvancedEffects(),
                  });
              }}
              style={[styles.action, box]}
            >
              <Text style={{ color: theme.text }}>恢复原始校准</Text>
            </Pressable>
          </View>
          <Pressable
            testID="headphone-import"
            onPress={() => {
              setImporting(true);
              setError('');
            }}
            style={[styles.importButton, box, styles.footerImport]}
          >
            <Text style={{ color: theme.text }}>
              ＋　导入本地 PEQ / GraphicEQ 文件
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  modelButton: { flex: 1, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  modelCopy: { flex: 1 },
  root: { flex: 1 },
  content: { paddingHorizontal: 18, paddingBottom: 12 },
  compactHero: { padding: 8, borderRadius: 16 },
  actionPanel: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 6,
  },
  footerImport: {
    marginTop: 0,
    paddingVertical: 0,
    paddingHorizontal: 12,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 14,
  },
  hero: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroTitle: { fontSize: 22, fontWeight: '700' },
  heading: { fontSize: 16, fontWeight: '600', marginTop: 12, marginBottom: 8 },
  search: {
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: 18,
    minHeight: 46,
    marginTop: 10,
  },
  brands: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  brandTile: {
    width: '31%',
    minHeight: 64,
    borderWidth: 1,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandRow: {
    minHeight: 52,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    marginBottom: 6,
    borderWidth: 1,
  },
  brandName: { flex: 1 },
  model: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 18,
    marginBottom: 8,
  },
  modelTitle: { fontSize: 16, fontWeight: '600' },
  filters: { flexDirection: 'row', gap: 6, marginVertical: 8 },
  filter: {
    borderWidth: 1,
    borderRadius: 22,
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  schemes: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  scheme: {
    minWidth: '30%',
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 12,
    padding: 7,
    minHeight: 44,
  },
  profile: { borderWidth: 1, padding: 10, borderRadius: 14, marginTop: 8 },
  details: { borderWidth: 1, borderRadius: 20, padding: 14, marginTop: 12 },
  actionRow: { flexDirection: 'row', gap: 8 },
  action: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: 14,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  importButton: {
    padding: 16,
    borderWidth: 1,
    borderRadius: 18,
    marginTop: 16,
  },
  overlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(0,0,0,.65)',
  },
  importModal: { padding: 20, borderRadius: 24 },
});
