import { NativeModules } from 'react-native';
import { SourceBindingUnavailableError } from './playbackSourceAvailability';
import { isSourceEnabled, isSourceAuthorized } from './sourcePolicy';
import type { AppSettings, SourceSetting, Track } from '../domain/types';
import { normalizeReturnedQuality } from '../domain/types';
import { audioQualityForPreference } from './audioQuality';
import { sourceTypes } from './onlineCatalog';
import {
  clearRuntimeTrackBlacklist,
  isCatalogTrackEligible,
  isRuntimeTrackBlocked,
  throwIfRuntimeTrackBlocked,
  rejectCatalogShortTrack,
  rejectDeterministicNativeFailure,
  TrackPlaybackRejectedError,
  validateResolvedAudio,
  validateQishuiAudioCompleteness,
  type AudioProbeResult,
} from './trackPlaybackPolicy';

type Quality = '128k' | '320k' | 'flac' | 'flac24bit' | 'hires';
const qualityOrder: Quality[] = ['hires', 'flac24bit', 'flac', '320k', '128k'];
const RESOLVED_URL_CACHE_LIMIT = 200;
const STARTUP_FRAME_AFTER_SECONDS = 61;
const qualityRank = (quality?: string) => {
  const index = qualityOrder.indexOf(quality as Quality);
  return index >= 0 ? index : Number.POSITIVE_INFINITY;
};
const validatedPlaybackUrl = (fallback: string, probe: AudioProbeResult) =>
  probe.resolvedUrl?.trim() || fallback;
type ResolvedSource = {
  url: string;
  quality?: Quality;
  reportedQuality?: Quality;
  requestedQuality?: Quality;
  sourceId: string;
  backend?: string;
  backendUrls?: BackendEndpoint[];
  audio?: AudioProbeResult;
};
type BackendEndpoint = { backend?: string; url: string; requestRoute?: string; dependencyRoutes?: string[]; quality?: Quality };
type NativeResolvedSource = string | { url: string; quality?: Quality; reportedQuality?: Quality; backend?: string; backendUrls?: BackendEndpoint[]; audio?: AudioProbeResult };
type SourceResolver = (script: string, source: string, musicInfoJson: string, quality: string) => Promise<NativeResolvedSource>;
type StartupPrefixProbeResult = { sampleBytes: number; mimeType?: string; resolvedUrl?: string };
const resolvedUrls = new Map<string, { value: ResolvedSource }>();
const resolving = new Map<string, Promise<ResolvedSource>>();
const expiredResolutions = new Map<string, Promise<ResolvedSource>>();
// All pre-resolution results live in process memory until explicit cache
// cleanup. Background audio validation never prepares Media3, and actual
// playback still applies its existing native gate.
const prewarmedUrls = new Map<string, { value: ResolvedSource }>();
const prewarming = new Map<string, Promise<ResolvedSource>>();
type BackendRecord = { backend?: string; url?: string; available: boolean };
type BackendRoute = { key: string; backend?: string; routes: string[]; primaryRoutes: string[]; qualities: Quality[]; available: boolean };
type BackendPool = { records: BackendRecord[]; preferred?: string; routes?: BackendRoute[]; preferredRoute?: string };
type BackendAttemptFailures = { routes: Set<string>; backends: Set<string> };
// The imported handler constructs each target request; captured routes select its successful interfaces.
const backendPools = new Map<string, BackendPool>();
let backendPoolGeneration = 0;
let resolutionCacheGeneration = 0;
const addressControllers = new Map<string, AbortController>();
let addressRequestSequence = 0;
const nativeRuntime = () =>
  NativeModules.LiuliuStorage as
    | {
        resolveSourceScript?: (
          script: string,
          source: string,
          musicInfoJson: string,
          quality: string,
        ) => Promise<NativeResolvedSource>;
        resolveSourceScriptAddress?: (
          script: string, source: string, musicInfoJson: string, quality: string, requestId: string,
        ) => Promise<NativeResolvedSource>;
        cancelSourceScriptAddress?: (requestId: string) => Promise<boolean>;
        resolveSourceScriptForHealth?: (
          script: string,
          source: string,
          musicInfoJson: string,
          quality: string,
        ) => Promise<NativeResolvedSource>;
        probeAudioUrl?: (url: string) => Promise<AudioProbeResult>;
        probeBackgroundAudioUrl?: (url: string, requestId: string) => Promise<AudioProbeResult>;
        cancelBackgroundAudioProbe?: (requestId: string) => Promise<boolean>;
        probeStartupAudioUrl?: (url: string, requestId: string) => Promise<AudioProbeResult>;
        probeAudioPrefix?: (url: string) => Promise<StartupPrefixProbeResult>;
      }
    | undefined;

export async function probeManualSource(track: Track, source: SourceSetting, recordBackendResult = true) {
  if (!isSourceAuthorized(source)) throw new Error('尚未取得该同步音源的使用权限');
  const generation = backendPoolGeneration;
  const native = nativeRuntime();
  if (!native?.resolveSourceScriptForHealth || !native.probeAudioPrefix)
    throw new Error('当前 Android 构建不支持启动音源检测');
  const sourceType =
    sourceTypes[track.provider as Exclude<Track['provider'], 'custom'>];
  // The explicit manual check records only its own lightweight response route.
  let resolved: ReturnType<typeof normalizeResolvedSource> | undefined;
  try {
    // One original 128k resolution and one prefix probe, with no registry I/O.
    resolved = normalizeResolvedSource(
      await native.resolveSourceScriptForHealth(
        source.script!,
        sourceType,
        JSON.stringify(
          normalizeLxInfo(
            track,
            sourceType,
            undefined,
            undefined,
          ),
        ),
        '128k',
      ),
    );
    const probe = await native.probeAudioPrefix(resolved.url);
    if (probe.sampleBytes <= 0) throw new Error('播放链路未返回音频数据');
    resolved.url = probe.resolvedUrl?.trim() || resolved.url;
    if (recordBackendResult && generation === backendPoolGeneration) rememberBackendResult(source, sourceType, resolved, '128k');
    return { ...resolved, quality: '128k' as const, probe };
  } catch (error) {
    const failedBackend = resolved?.backend?.trim();
    if (recordBackendResult && failedBackend && generation === backendPoolGeneration)
      markBackendUnavailable(source, sourceType, failedBackend);
    throw error;
  }
}

/** Startup resolves its original chart sample and requires one actual frame after 61s. */
export async function probeStartupSource(track: Track, source: SourceSetting, preferred: AppSettings['quality']) {
  if (!isSourceAuthorized(source)) throw new Error('尚未取得该同步音源的使用权限');
  const result = await resolveImportedSourcePrewarm(
    track,
    [{ ...source, healthy: true, pinnedBackend: undefined }],
    preferred,
    undefined,
    true,
    true,
    STARTUP_FRAME_AFTER_SECONDS,
  );
  console.info('[startup-quality]', JSON.stringify({ key: `${track.provider}:${track.providerId ?? track.id}`,
    ceiling: preferred, quality: result.quality, audioValidated: Boolean(result.audio) }));
  return result;
}

function memoizeAudioProbe(probe: (url: string) => Promise<AudioProbeResult>) {
  const measured = new Map<string, Promise<AudioProbeResult>>();
  return (url: string) => {
    let pending = measured.get(url);
    if (!pending) {
      pending = probe(url).then(audio => {
        if (audio.resolvedUrl) measured.set(audio.resolvedUrl, Promise.resolve(audio));
        return audio;
      }).catch(error => { measured.delete(url); throw error; });
      measured.set(url, pending);
    }
    return pending;
  };
}

export type PlaybackTimingObserver = (
  stage: 'source-url' | 'native-validation',
  detail: { ms: number; quality?: string; outcome: 'success' | 'failure' },
) => void;

async function observePlaybackStage<T>(
  observer: PlaybackTimingObserver | undefined,
  stage: 'source-url' | 'native-validation',
  run: () => Promise<T>,
  quality?: string,
) {
  const startedAt = Date.now();
  const notify = (outcome: 'success' | 'failure') => {
    try { observer?.(stage, { ms: Date.now() - startedAt, quality, outcome }); }
    catch { /* Diagnostics cannot change playback or quality fallback. */ }
  };
  try {
    const value = await run();
    notify('success');
    return value;
  } catch (error) {
    notify('failure');
    throw error;
  }
}

export async function resolveWithImportedSource(
  track: Track,
  sources: SourceSetting[],
  preferred: AppSettings['quality'],
  refreshExpiredUrl = false,
  timing?: PlaybackTimingObserver,
  cachedUrlOnly = false,
) {
  const generation = backendPoolGeneration;
  const cacheGeneration = resolutionCacheGeneration;
  if (track.provider === 'custom') throw new Error('自定义条目缺少平台信息');
  throwIfRuntimeTrackBlocked(track);
  if (!isCatalogTrackEligible(track)) rejectCatalogShortTrack(track);
  const native = nativeRuntime();
  if (!native?.resolveSourceScript)
    throw new Error('当前 Android 构建不支持音乐源解析运行时');
  if (!native.probeAudioUrl)
    throw new Error('当前 Android 构建不支持真实音频时长检测');
  const probeAudio = (url: string) => observePlaybackStage(timing, 'native-validation', () => native.probeAudioUrl!(url));
  const sourceType = sourceTypes[track.provider];
  const candidates = sources.filter(
    source =>
      isSourceEnabled(source) &&
      source.healthy !== false &&
      Boolean(source.script) &&
      (source.capabilities?.includes(sourceType) ||
        Boolean(source.sourceCapabilities?.[sourceType])),
  );
  if (!candidates.length) throw new SourceBindingUnavailableError(sourceType);
  const key = resolutionKey(track, candidates, sourceType, preferred);
  if (cachedUrlOnly) {
    const entry = resolvedUrls.get(key) ?? prewarmedUrls.get(key);
    if (!entry) throw new Error('歌曲预解析缓存尚未就绪');
    const snapshot = entry.value;
    if (!snapshot.audio) throw new Error('歌曲校验缓存尚未就绪');
    validateResolvedAudio(track, snapshot.audio);
    const quality = audioQualityForPreference(snapshot.audio, snapshot.reportedQuality, preferred);
    console.info('[playback-url-cache]', JSON.stringify({ provider: track.provider,
      id: track.providerId ?? track.id, stage: 'prepared-hit', quality: snapshot.quality,
      urlToken: scriptFingerprint(snapshot.url) }));
    // The playlist already checked this exact URL. Complete-page/native queue
    // preparation only consumes that evidence; it must not reopen or reselect it.
    return { ...snapshot, quality };
  }
  if (refreshExpiredUrl) {
    const recovering = expiredResolutions.get(key);
    if (recovering) return recovering;
    // Only this source/backend/track/quality entry is invalidated. Older
    // in-flight work may finish, but cannot repopulate the expired entry.
    resolvedUrls.delete(key);
    prewarmedUrls.delete(key);
    resolving.delete(key);
    addressControllers.get(key)?.abort();
    prewarming.delete(key);
  }
  const cached = resolvedUrls.get(key);
  if (cached) {
    console.info('[playback-url-cache]', JSON.stringify({ provider: track.provider,
      id: track.providerId ?? track.id, stage: 'validated-hit', quality: cached.value.quality,
      urlToken: scriptFingerprint(cached.value.url) }));
    try {
      const probe = await probeAudio(cached.value.url);
      validateResolvedAudio(track, probe);
      const validated = {
        ...cached.value,
        url: validatedPlaybackUrl(cached.value.url, probe),
        quality: audioQualityForPreference(probe, cached.value.reportedQuality, preferred),
        audio: probe,
      };
      if (resolvedUrls.get(key) === cached) resolvedUrls.set(key, { value: validated });
      const warm = prewarmedUrls.get(key);
      if (warm?.value === cached.value) prewarmedUrls.set(key, { value: validated });
      return validated;
    } catch (error) {
      if (error instanceof TrackPlaybackRejectedError) throw error;
      if (resolvedUrls.get(key) === cached) resolvedUrls.delete(key);
      if (prewarmedUrls.get(key)?.value === cached.value) prewarmedUrls.delete(key);
    }
  }
  const prewarmed = prewarmedUrls.get(key);
  if (prewarmed) {
    console.info('[playback-url-cache]', JSON.stringify({ provider: track.provider,
      id: track.providerId ?? track.id, stage: 'prewarm-hit', quality: prewarmed.value.quality,
      urlToken: scriptFingerprint(prewarmed.value.url) }));
    try {
      const probe = await probeAudio(prewarmed.value.url);
      validateResolvedAudio(track, probe);
      const validated = {
        ...prewarmed.value,
        url: validatedPlaybackUrl(prewarmed.value.url, probe),
        quality: audioQualityForPreference(probe, prewarmed.value.reportedQuality, preferred),
        audio: probe,
      };
      if (cacheGeneration === resolutionCacheGeneration && generation === backendPoolGeneration && prewarmedUrls.get(key) === prewarmed)
        resolvedUrls.set(key, { value: validated });
      return validated;
    } catch (error) {
      if (error instanceof TrackPlaybackRejectedError) throw error;
      if (generation === backendPoolGeneration && prewarmedUrls.get(key) === prewarmed) prewarmedUrls.delete(key);
    }
  }
  const warming = prewarming.get(key);
  if (warming) {
    let warmed: ResolvedSource | undefined;
    try {
      warmed = await warming;
      const probe = await probeAudio(warmed.url);
      validateResolvedAudio(track, probe);
      if (cacheGeneration === resolutionCacheGeneration && generation === backendPoolGeneration && prewarmedUrls.get(key)?.value === warmed) resolvedUrls.set(key, {
          value: {
            ...warmed,
            url: validatedPlaybackUrl(warmed.url, probe),
            quality: audioQualityForPreference(probe, warmed.reportedQuality, preferred),
            audio: probe,
          },
        });
      return {
        ...warmed,
        url: validatedPlaybackUrl(warmed.url, probe),
        quality: audioQualityForPreference(probe, warmed.reportedQuality, preferred),
        audio: probe,
      };
    } catch (error) {
      if (error instanceof TrackPlaybackRejectedError) throw error;
      // This failed wait belongs to the captured flight, never a newer warm entry.
      // A superseded selected request must not restart full resolution after
      // its shared URL-only request was cancelled by a newer user selection.
      if (error instanceof Error && error.name === 'AbortError') throw error;
      if (generation === backendPoolGeneration && warmed && prewarmedUrls.get(key)?.value === warmed) prewarmedUrls.delete(key);
    }
  }
  const requestKey = key;
  const pending = resolving.get(requestKey);
  if (pending) return pending;
  const warmBeforeFresh = prewarmedUrls.get(key);
  const warmFlightBeforeFresh = prewarming.get(key);
  const request = resolveFresh(
    track,
    candidates,
    preferred,
    sourceType,
    (...args) => observePlaybackStage(timing, 'source-url', () => native.resolveSourceScript!(...args), args[3]),
    probeAudio,
    generation,
  )
    .then(result => {
      const value = result;
      if (resolving.get(requestKey) !== request || generation !== backendPoolGeneration || cacheGeneration !== resolutionCacheGeneration) return value;
      resolvedUrls.set(key, { value });
      if (!warmBeforeFresh && prewarmedUrls.get(key) === warmBeforeFresh && prewarming.get(key) === warmFlightBeforeFresh)
        prewarmedUrls.set(key, { value });
      while (resolvedUrls.size > RESOLVED_URL_CACHE_LIMIT)
        resolvedUrls.delete(resolvedUrls.keys().next().value!);
      return value;
    })
    .finally(() => {
      if (resolving.get(requestKey) === request) resolving.delete(requestKey);
      if (expiredResolutions.get(key) === request) expiredResolutions.delete(key);
    });
  resolving.set(requestKey, request);
  if (refreshExpiredUrl) expiredResolutions.set(key, request);
  return request;
}

export async function resolveWithImportedSourceAddress(
  track: Track,
  sources: SourceSetting[],
  preferred: AppSettings['quality'],
  signal?: AbortSignal,
) {
  return resolveImportedSourcePrewarm(track, sources, preferred, signal);
}

export async function resolveWithImportedSourcePrewarm(
  track: Track,
  sources: SourceSetting[],
  preferred: AppSettings['quality'],
  signal?: AbortSignal,
) {
  return resolveImportedSourcePrewarm(track, sources, preferred, signal, true);
}

async function resolveImportedSourcePrewarm(
  track: Track,
  sources: SourceSetting[],
  preferred: AppSettings['quality'],
  signal: AbortSignal | undefined,
  validateAudio = false,
  discoverBackends = false,
  requireFrameAfterSeconds?: number,
): Promise<ResolvedSource> {
  const generation = backendPoolGeneration;
  const cacheGeneration = resolutionCacheGeneration;
  throwIfAddressAborted(signal);
  if (track.provider === 'custom') throw new Error('自定义条目缺少平台信息');
  throwIfRuntimeTrackBlocked(track);
  // Startup health validates the original chart sample from its actual audio
  // frame at 61s. Its catalog duration is irrelevant to that decision.
  if (requireFrameAfterSeconds === undefined && !isCatalogTrackEligible(track))
    rejectCatalogShortTrack(track);
  const native = nativeRuntime();
  if (!native?.resolveSourceScriptAddress || !native.cancelSourceScriptAddress)
    throw new Error('当前 Android 构建不支持可取消的 URL 预解析');
  if (validateAudio &&
      (!(requireFrameAfterSeconds === undefined
          ? native.probeBackgroundAudioUrl
          : native.probeStartupAudioUrl) || !native.cancelBackgroundAudioProbe))
    throw new Error('当前 Android 构建不支持可取消的预解析音频校验');
  const sourceType = sourceTypes[track.provider];
  const candidates = sources.filter(
    source =>
      isSourceEnabled(source) &&
      source.healthy !== false &&
      Boolean(source.script) &&
      (source.capabilities?.includes(sourceType) ||
        Boolean(source.sourceCapabilities?.[sourceType])),
  );
  if (!candidates.length) throw new SourceBindingUnavailableError(sourceType);
  const key = resolutionKey(track, candidates, sourceType, preferred);
  const validated = resolvedUrls.get(key);
  const reuseCached = (cached: { value: ResolvedSource }) => {
    if (validateAudio && !cached.value.audio) return undefined;
    try {
      throwIfAddressAborted(signal);
      if (requireFrameAfterSeconds === undefined && cached.value.audio)
        validateResolvedAudio(track, cached.value.audio);
      if (requireFrameAfterSeconds !== undefined &&
          (!cached.value.audio ||
            (cached.value.audio.verifiedThroughSeconds ?? Number.NEGATIVE_INFINITY) <= requireFrameAfterSeconds))
        throw new PrewarmAudioUnavailable(
          `启动样本未读取到 ${requireFrameAfterSeconds} 秒后的实际音频帧`,
        );
      // The process cache owns this exact final URL and its measured evidence.
      // URL-only consumers reuse it; actual playback still reopens and validates it.
      const quality = audioQualityForPreference(cached.value.audio, cached.value.reportedQuality, preferred);
      return quality === cached.value.quality ? cached.value : { ...cached.value, quality };
    } catch (error) {
      throwIfAddressAborted(signal);
      if (error instanceof TrackPlaybackRejectedError) throw error;
      if (resolvedUrls.get(key)?.value === cached.value) resolvedUrls.delete(key);
      if (prewarmedUrls.get(key)?.value === cached.value) prewarmedUrls.delete(key);
      return undefined;
    }
  };
  if (validated) {
    const value = reuseCached(validated);
    if (value) return value;
  }
  const cached = prewarmedUrls.get(key);
  if (cached && (!validateAudio || cached.value.audio)) {
    const value = reuseCached(cached);
    if (value) return value;
  }
  const pending = prewarming.get(key);
  if (pending) {
    const controller = addressControllers.get(key);
    const forwardAbort = () => controller?.abort();
    signal?.addEventListener('abort', forwardAbort, { once: true });
    if (signal?.aborted) forwardAbort();
    try {
      const value = await pending;
      throwIfAddressAborted(signal);
      // A resolved flight can still be visible in the map until its finally
      // callback runs. Remove that stale entry before retrying a startup-only
      // frame-evidence rejection, otherwise the recursive call would await the
      // same short result forever.
      if (prewarming.get(key) === pending) prewarming.delete(key);
      if (addressControllers.get(key) === controller) addressControllers.delete(key);
      let complete = true;
      if (validateAudio && requireFrameAfterSeconds === undefined && value.audio) {
        try { validateQishuiAudioCompleteness(track, value.audio); }
        catch { complete = false; }
      }
      if (complete && (!validateAudio || value.audio) &&
          (requireFrameAfterSeconds === undefined ||
            (value.audio?.verifiedThroughSeconds ?? Number.NEGATIVE_INFINITY) > requireFrameAfterSeconds)) return value;
      return resolveImportedSourcePrewarm(
        track,
        sources,
        preferred,
        signal,
        validateAudio,
        discoverBackends,
        requireFrameAfterSeconds,
      );
    }
    finally { signal?.removeEventListener('abort', forwardAbort); }
  }
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });
  if (signal?.aborted) controller.abort();
  addressControllers.set(key, controller);
  const resolveAddress = () => resolveFreshAddress(
    track,
    candidates,
    preferred,
    sourceType,
    (...args) => runAddressNative(native, args, controller.signal),
    controller.signal,
    generation,
    validateAudio
      ? url => requireFrameAfterSeconds === undefined
        ? runBackgroundAudioNative(native, url, controller.signal)
        : runStartupAudioNative(native, url, controller.signal)
      : undefined,
    discoverBackends,
    requireFrameAfterSeconds,
  );
  const request = (validateAudio && cached
    ? resolveAddressEvidence(track, cached.value, preferred,
        url => requireFrameAfterSeconds === undefined
          ? runBackgroundAudioNative(native, url, controller.signal)
          : runStartupAudioNative(native, url, controller.signal),
        controller.signal,
        requireFrameAfterSeconds)
      .then(result => ({ ...cached.value, ...result }))
      .catch(error => {
        throwIfAddressAborted(controller.signal);
        if (error instanceof TrackPlaybackRejectedError) throw error;
        if (requireFrameAfterSeconds === undefined)
          rejectDeterministicNativeFailure(track, error);
        if (prewarmedUrls.get(key) === cached) prewarmedUrls.delete(key);
        return resolveAddress();
      })
    : resolveAddress())
    .then(result => {
      const value = result;
      throwIfAddressAborted(controller.signal);
      if (generation !== backendPoolGeneration) throw addressAbortError();
      if (prewarming.get(key) !== request || cacheGeneration !== resolutionCacheGeneration) return value;
      prewarmedUrls.set(key, { value });
      return value;
    })
    .finally(() => {
      if (prewarming.get(key) === request) prewarming.delete(key);
      if (addressControllers.get(key) === controller) addressControllers.delete(key);
      signal?.removeEventListener('abort', forwardAbort);
    });
  prewarming.set(key, request);
  return request;
}

function addressAbortError() {
  const error = new Error('URL 预解析已取消');
  error.name = 'AbortError';
  return error;
}

function throwIfAddressAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw addressAbortError();
}

async function runAddressNative(
  native: NonNullable<ReturnType<typeof nativeRuntime>>,
  args: Parameters<SourceResolver>,
  signal: AbortSignal,
): Promise<NativeResolvedSource> {
  throwIfAddressAborted(signal);
  const requestId = `address_${++addressRequestSequence}`;
  const operation = native.resolveSourceScriptAddress!(...args, requestId);
  return new Promise((resolve, reject) => {
    let aborted = false;
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => {
      if (aborted) return;
      aborted = true;
      const acknowledgement = native.cancelSourceScriptAddress!(requestId);
      acknowledgement.then(
        () => { cleanup(); reject(addressAbortError()); },
        () => { cleanup(); reject(addressAbortError()); },
      );
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    operation.then(value => {
      if (aborted) return;
      cleanup();
      resolve(value);
    }, error => {
      if (aborted) return;
      cleanup();
      reject(error);
    });
  });
}

async function runBackgroundAudioNative(
  native: NonNullable<ReturnType<typeof nativeRuntime>>,
  url: string,
  signal: AbortSignal,
): Promise<AudioProbeResult> {
  throwIfAddressAborted(signal);
  const requestId = `prewarm_audio_${++addressRequestSequence}`;
  const operation = native.probeBackgroundAudioUrl!(url, requestId);
  return new Promise((resolve, reject) => {
    let aborted = false;
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => {
      if (aborted) return;
      aborted = true;
      native.cancelBackgroundAudioProbe!(requestId).then(
        () => { cleanup(); reject(addressAbortError()); },
        () => { cleanup(); reject(addressAbortError()); },
      );
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    operation.then(value => {
      if (aborted) return;
      cleanup();
      resolve(value);
    }, error => {
      if (aborted) return;
      cleanup();
      reject(error);
    });
  });
}

async function runStartupAudioNative(
  native: NonNullable<ReturnType<typeof nativeRuntime>>,
  url: string,
  signal: AbortSignal,
): Promise<AudioProbeResult> {
  throwIfAddressAborted(signal);
  const requestId = `startup_audio_${++addressRequestSequence}`;
  const operation = native.probeStartupAudioUrl!(url, requestId);
  return new Promise((resolve, reject) => {
    let aborted = false;
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => {
      if (aborted) return;
      aborted = true;
      native.cancelBackgroundAudioProbe!(requestId).then(
        () => { cleanup(); reject(addressAbortError()); },
        () => { cleanup(); reject(addressAbortError()); },
      );
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    operation.then(value => {
      if (aborted) return;
      cleanup();
      resolve(value);
    }, error => {
      if (aborted) return;
      cleanup();
      reject(error);
    });
  });
}

// A bad song URL does not establish that a resolver is down for every song.
class PrewarmAudioUnavailable extends Error {}
// Preserve playback's original per-quality failure path. A failed audio URL
// never invalidates the resolver interface that produced it for other songs.
class PlaybackAudioUnavailable extends Error {}

async function resolveFresh(
  track: Track,
  candidates: SourceSetting[],
  preferred: AppSettings['quality'],
  sourceType: string,
  resolveSourceScript: SourceResolver,
  probeAudioUrl: (url: string) => Promise<AudioProbeResult>,
  generation = backendPoolGeneration,
) {
  probeAudioUrl = memoizeAudioProbe(probeAudioUrl);
  const failures: string[] = [];
  for (const source of candidates) {
    const declared = source.sourceCapabilities?.[sourceType]?.qualitys;
    const qualities = qualityCandidates(track, declared, preferred);
    const requestFailures: BackendAttemptFailures = { routes: new Set(), backends: new Set() };
    // The setting is the request starting point and ceiling. Stop at the
    // first validated, in-ceiling result, including unknown actual quality.
    for (const quality of qualities) {
      if (generation !== backendPoolGeneration) throw new Error('音源配置已重置，旧解析已失效');
      try {
        const accept = async (result: Exclude<NativeResolvedSource, string>) => {
          if (!/^https?:\/\//i.test(result.url)) throw new Error('音源未返回 HTTP/HTTPS 播放地址');
          try {
            const probe = await probeAudioUrl(result.url);
            validateResolvedAudio(track, probe);
            return { ...result, url: validatedPlaybackUrl(result.url, probe),
              quality: audioQualityForPreference(probe, result.reportedQuality, preferred), audio: probe };
          } catch (error) {
            if (error instanceof TrackPlaybackRejectedError) throw error;
            rejectDeterministicNativeFailure(track, error);
            throw new PlaybackAudioUnavailable(error instanceof Error ? error.message : String(error));
          }
        };
        const result = await resolveWithBackendPool(
          track,
          source,
          sourceType,
          quality,
          resolveSourceScript,
          undefined,
          generation,
          accept,
          preferred,
          false,
          requestFailures,
        );
        const resolved = {
          url: result.url,
          quality: result.quality,
          reportedQuality: result.reportedQuality,
          requestedQuality: quality,
          sourceId: source.id,
          backend: result.backend,
          backendUrls: result.backendUrls,
          audio: result.audio,
        };
        return resolved;
      } catch (error) {
        if (generation !== backendPoolGeneration) throw error;
        if (error instanceof TrackPlaybackRejectedError) throw error;
        rejectDeterministicNativeFailure(track, error);
        failures.push(
          `${source.name}/${quality}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
  throw new Error(`音源解析失败（${failures.join('；')}）`);
}

async function resolveFreshAddress(
  track: Track,
  candidates: SourceSetting[],
  preferred: AppSettings['quality'],
  sourceType: string,
  resolveSourceScript: SourceResolver,
  signal: AbortSignal,
  generation: number,
  probeAudio: ((url: string) => Promise<AudioProbeResult>) | undefined,
  discoverBackends = false,
  requireFrameAfterSeconds?: number,
) {
  const audioProbe = probeAudio ? memoizeAudioProbe(probeAudio) : undefined;
  const failures: string[] = [];
  for (const source of candidates) {
    const declared = source.sourceCapabilities?.[sourceType]?.qualitys;
    const qualities = qualityCandidates(track, declared, preferred);
    // Startup discovery retains its own existing pool-health semantics. Normal
    // song work shares failures only across this song's descending qualities.
    const requestFailures: BackendAttemptFailures | undefined = discoverBackends
      ? undefined : { routes: new Set(), backends: new Set() };
    // Startup and full background validation share the playback preference
    // order; a previous lower-quality song never changes the next song's order.
    for (const quality of qualities) {
      throwIfAddressAborted(signal);
      if (generation !== backendPoolGeneration) throw addressAbortError();
      try {
        const accept = async (result: Exclude<NativeResolvedSource, string>) => {
          throwIfAddressAborted(signal);
          if (!/^https?:\/\//i.test(result.url))
            throw new Error('音源未返回 HTTP/HTTPS 播放地址');
          try {
            return await resolveAddressEvidence(
              track,
              result,
              preferred,
              audioProbe,
              signal,
              requireFrameAfterSeconds,
            );
          } catch (error) {
            throwIfAddressAborted(signal);
            if (error instanceof TrackPlaybackRejectedError) throw error;
            if (requireFrameAfterSeconds === undefined)
              rejectDeterministicNativeFailure(track, error);
            throw new PrewarmAudioUnavailable(error instanceof Error ? error.message : String(error));
          }
        };
        const result = await resolveWithBackendPool(
          track,
          source,
          sourceType,
          quality,
          resolveSourceScript,
          signal,
          generation,
          accept,
          audioProbe ? preferred : undefined,
          discoverBackends,
          requestFailures,
        );
        throwIfAddressAborted(signal);
        if (!/^https?:\/\//i.test(result.url))
          throw new Error('音源未返回 HTTP/HTTPS 播放地址');
        const resolved = {
          url: result.url,
          quality: result.quality,
          reportedQuality: result.reportedQuality,
          requestedQuality: quality,
          sourceId: source.id,
          backend: result.backend,
          backendUrls: result.backendUrls,
          audio: result.audio,
        };
        return resolved;
      } catch (error) {
        throwIfAddressAborted(signal);
        if (generation !== backendPoolGeneration) throw addressAbortError();
        if (error instanceof TrackPlaybackRejectedError) throw error;
        failures.push(
          `${source.name}/${quality}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
  throw new Error(`音源解析失败（${failures.join('；')}）`);
}

async function resolveAddressEvidence(
  track: Track,
  result: Exclude<NativeResolvedSource, string>,
  preferred: Quality,
  probeAudio: ((url: string) => Promise<AudioProbeResult>) | undefined,
  signal: AbortSignal,
  requireFrameAfterSeconds?: number,
) {
  throwIfAddressAborted(signal);
  if (!probeAudio) return { ...result,
    quality: audioQualityForPreference(undefined, result.reportedQuality, preferred) };
  const audio = await probeAudio(result.url);
  throwIfAddressAborted(signal);
  if (requireFrameAfterSeconds === undefined) {
    validateResolvedAudio(track, audio);
  } else if ((audio.verifiedThroughSeconds ?? Number.NEGATIVE_INFINITY) <= requireFrameAfterSeconds)
    throw new PrewarmAudioUnavailable(
      `启动样本未读取到 ${requireFrameAfterSeconds} 秒后的实际音频帧`,
    );
  return { ...result, url: validatedPlaybackUrl(result.url, audio),
    quality: audioQualityForPreference(audio, result.reportedQuality, preferred), audio };
}

function normalizeResolvedSource(value: NativeResolvedSource): Exclude<NativeResolvedSource, string> {
  // A resolver response cannot certify its own audio. Only our native gate can.
  return typeof value === 'string' ? { url: value } : {
    url: value.url, backend: value.backend, backendUrls: value.backendUrls,
    quality: undefined,
    reportedQuality: normalizeReturnedQuality(value.quality),
  };
}

export function clearResolvedSourceCache() {
  backendPoolGeneration += 1;
  for (const controller of addressControllers.values()) controller.abort();
  addressControllers.clear();
  expiredResolutions.clear();
  resolvedUrls.clear();
  resolving.clear();
  prewarmedUrls.clear();
  prewarming.clear();
  backendPools.clear();
  clearRuntimeTrackBlacklist();
}

/**
 * Clear only completed URL resolution entries.  User initiated cache cleanup
 * must not abort an active playback/prewarm request, reset the launch-bound
 * backend selection, or forget deterministic track rejections.
 */
export function clearRuntimeResolutionCache() {
  resolutionCacheGeneration += 1;
  resolvedUrls.clear();
  prewarmedUrls.clear();
}

export function sourceResolutionCacheToken() {
  return resolutionCacheGeneration;
}

export function resetLaunchBackendPools() {
  backendPoolGeneration += 1;
  backendPools.clear();
}

export function sourceAddressCacheKey(track: Track, sources: SourceSetting[], preferred: AppSettings['quality']) {
  const sourceType = track.provider === 'custom' ? 'custom' : sourceTypes[track.provider];
  const candidates = sources.filter(source => isSourceEnabled(source) && source.healthy !== false && Boolean(source.script) &&
    (source.capabilities?.includes(sourceType) || Boolean(source.sourceCapabilities?.[sourceType])));
  return resolutionKey(track, candidates, sourceType, preferred);
}

export function hasPlaybackAddressPrewarm(track: Track, sources: SourceSetting[], preferred: AppSettings['quality']) {
  if (isRuntimeTrackBlocked(track) || !isCatalogTrackEligible(track)) return false;
  const key = sourceAddressCacheKey(track, sources, preferred);
  return resolvedUrls.has(key) || prewarmedUrls.has(key);
}

/** Readiness only: a fully audio-validated result can admit a native neighbour. */
export function hasValidatedPlaybackPrewarm(track: Track, sources: SourceSetting[], preferred: AppSettings['quality']) {
  if (isRuntimeTrackBlocked(track) || !isCatalogTrackEligible(track)) return false;
  const key = sourceAddressCacheKey(track, sources, preferred);
  // Readiness must not evict a valid URL. The consumer owns any authorized
  // reselection after a genuinely new better route is discovered.
  const validated = resolvedUrls.get(key);
  const warmed = prewarmedUrls.get(key);
  return [validated, warmed].some(entry => {
    if (!entry?.value.audio) return false;
    try {
      // Startup's post-61s sample is health evidence, not qs completeness.
      validateQishuiAudioCompleteness(track, entry.value.audio);
      return true;
    } catch { return false; }
  });
}

function resolutionKey(
  track: Track,
  sources: SourceSetting[],
  sourceType: string,
  preferred: AppSettings['quality'],
) {
  const scripts = sources
    .map(
      source =>
        `${source.id}:${source.version ?? ''}:${scriptFingerprint(
          source.script!,
        )}:${source.pinnedBackend ?? ''}`,
    )
    .join(',');
  return `${scripts}|${sourceType}|${
    track.providerId ?? track.id
  }|${preferred}`;
}

function backendPoolKey(source: SourceSetting, sourceType: string) {
  return `${source.id}:${source.version ?? ''}:${scriptFingerprint(source.script!)}:${sourceType}`;
}

function backendPoolHead(source: SourceSetting, sourceType: string, excludedBackends?: ReadonlySet<string>) {
  const pool = backendPools.get(backendPoolKey(source, sourceType));
  const unavailable = (backend: string) => excludedBackends?.has(backend) ||
    pool?.records.some(record => record.backend === backend && !record.available);
  if (pool?.preferred && !unavailable(pool.preferred)) return pool.preferred;
  if (source.pinnedBackend && !unavailable(source.pinnedBackend)) return source.pinnedBackend;
  return pool?.records.find(record => record.available && record.backend && !excludedBackends?.has(record.backend))?.backend;
}

function rememberBackendResult(source: SourceSetting, sourceType: string, result: Exclude<NativeResolvedSource, string>, _requestedQuality: Quality) {
  const key = backendPoolKey(source, sourceType);
  const pool = backendPools.get(key) ?? { records: [] };
  const previousRoute = pool.preferredRoute;
  const endpoints: Array<{ backend?: string; url?: string; requestRoute?: string; dependencyRoutes?: string[]; quality?: Quality }> = (result.backendUrls ?? [])
    .filter(endpoint => typeof endpoint.url === 'string' && /^https?:\/\//i.test(endpoint.url))
    // Pool identity is the interface address; song/quality parameters belong to requests.
    .map(endpoint => ({ backend: endpoint.backend?.trim() || undefined, url: endpoint.url.split(/[?#]/, 1)[0],
       requestRoute: endpoint.requestRoute?.trim() || undefined,
       dependencyRoutes: endpoint.dependencyRoutes?.filter(route => typeof route === 'string'),
       quality: endpoint.quality }));
  const backend = result.backend?.trim();
  for (const endpoint of endpoints) {
    const existing = pool.records.find(record => record.backend === endpoint.backend && record.url === endpoint.url);
    if (existing) existing.available = true;
    else pool.records.push({ backend: endpoint.backend, url: endpoint.url, available: true });
  }
  if (backend && endpoints.length) {
    pool.records.filter(record => record.backend === backend).forEach(record => { record.available = true; });
    pool.preferred = backend;
  }
  const routes = [...new Set(endpoints.flatMap(endpoint => endpoint.requestRoute
    ? [endpoint.requestRoute, ...(endpoint.dependencyRoutes ?? [])] : []))];
  const qualities = [...new Set((result.audio ? [result.quality] : [])
    .filter((quality): quality is Quality => qualityOrder.includes(quality as Quality)))];
  if (routes.length) {
    const primaryRoutes = [...new Set(endpoints.flatMap(endpoint => endpoint.requestRoute ? [endpoint.requestRoute] : []))];
    const routeKey = JSON.stringify([backend ?? '', [...routes].sort()]);
    pool.routes ??= [];
    const existing = pool.routes.find(route => route.key === routeKey);
    if (existing) {
      existing.available = true;
      existing.primaryRoutes = primaryRoutes;
      existing.qualities = [...new Set([...existing.qualities, ...qualities])];
    } else pool.routes.push({ key: routeKey, backend, routes, primaryRoutes, qualities, available: true });
    pool.preferredRoute = routeKey;
  }
  backendPools.set(key, pool);
  if (result.audio || pool.records.length === 1 || previousRoute !== pool.preferredRoute) {
    try {
      console.info('[platform-backend-pool]', JSON.stringify({ platform: sourceType,
        sourceId: source.id, records: pool.records.length, routes: pool.routes?.length ?? 0,
        quality: result.quality, audioValidated: Boolean(result.audio) }));
    } catch { /* Pool diagnostics cannot affect source selection. */ }
  }
}

function markBackendUnavailable(source: SourceSetting, sourceType: string, backend: string) {
  const key = backendPoolKey(source, sourceType);
  const pool = backendPools.get(key) ?? { records: [] };
  const records = pool.records.filter(record => record.backend === backend);
  records.forEach(record => { record.available = false; });
  backendPools.set(key, pool);
}

function normalizeBackendLabels(values: unknown) {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  return values
    .flatMap(value => {
      if (typeof value !== 'string') return [];
      const normalized = value.trim();
      if (!normalized || normalized.length > 128 || seen.has(normalized))
        return [];
      seen.add(normalized);
      return [normalized];
    });
}

function shouldFallbackBackend(error: unknown) {
  if (error instanceof PlaybackAudioUnavailable) return false;
  if (error instanceof PrewarmAudioUnavailable) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /无数据|所有(?:后端|API|接口|音质)均失败|已跳过.*(?:音源后端|其它音质)|请求超时|网络请求超时|timeout|HTTP\s*\d|网络错误|连接失败|ECONN|ENOTFOUND|reset by peer/i.test(
    message,
  );
}

async function resolveWithBackendPool(
  track: Track,
  source: SourceSetting,
  sourceType: string,
  quality: Quality,
  resolveSourceScript: SourceResolver,
  signal?: AbortSignal,
  generation = backendPoolGeneration,
  accept?: (result: Exclude<NativeResolvedSource, string>) => Promise<Exclude<NativeResolvedSource, string>>,
  preferred?: Quality,
  discoverBackends = false,
  requestFailures?: BackendAttemptFailures,
) {
  const attemptedRoutes = new Set<string>();
  const attemptedPrimaryRoutes = new Set<string>();
  const routeAvailable = (route: BackendRoute) => route.available && !requestFailures?.routes.has(route.key);
  const failRoute = (route: BackendRoute) => {
    if (requestFailures) requestFailures.routes.add(route.key);
    else route.available = false;
  };
  const failBackend = (backend: string) => {
    if (requestFailures) requestFailures.backends.add(backend);
    else markBackendUnavailable(source, sourceType, backend);
  };
  const key = backendPoolKey(source, sourceType),
    pool = backendPools.get(key),
    allowDiscovery = discoverBackends || !pool?.routes?.length,
    orderedRoutes = [...(pool?.routes ?? [])].sort((left, right) => {
      const rank = (route: BackendRoute) => Math.min(...route.qualities.filter(tier =>
        qualityRank(tier) >= qualityRank(preferred ?? quality)).map(qualityRank));
      return rank(left) - rank(right);
    }),
    qualityRoute = orderedRoutes.find(route => routeAvailable(route) && route.qualities.includes(preferred ?? quality)) ??
      orderedRoutes.find(route => routeAvailable(route) && route.qualities.includes(quality)),
    pinnedRoute = qualityRoute ?? orderedRoutes.find(route => route.key === pool?.preferredRoute && routeAvailable(route)) ??
      orderedRoutes.find(routeAvailable),
    pinnedBackend = pinnedRoute ? pinnedRoute.backend : backendPoolHead(source, sourceType, requestFailures?.backends),
    pinnedSource = pinnedBackend ? { ...source, pinnedBackend } : source,
    resolveOnce = (candidate: SourceSetting, route?: BackendRoute, discovery = false) => {
      const rejected = discovery ? attemptedPrimaryRoutes : new Set<string>();
      const info = JSON.stringify(
          { ...normalizeLxInfo(track, sourceType, candidate.pinnedBackend), __lxBoundedRequests: true,
            __lxRejectedBackendRoutes: [...rejected],
            ...(route?.routes.length ? { __lxPinnedBackendRoutes: route.routes, __lxBackendPlatform: sourceType } : {}) },
        );
      if (route) {
        attemptedRoutes.add(route.key);
        route.primaryRoutes.forEach(value => attemptedPrimaryRoutes.add(value));
      }
      return resolveSourceScript(
        candidate.script!,
        sourceType,
        info,
        quality,
      );
    };
  for (const route of pool?.routes ?? []) {
    if (requestFailures?.routes.has(route.key))
      route.primaryRoutes.forEach(value => attemptedPrimaryRoutes.add(value));
  }
  const register = async (value: NativeResolvedSource) => {
    throwIfAddressAborted(signal);
    const result = accept ? await accept(normalizeResolvedSource(value)) : normalizeResolvedSource(value);
    throwIfAddressAborted(signal);
    if (generation !== backendPoolGeneration) throw new Error('音源配置已重置，旧解析已失效');
    if (generation === backendPoolGeneration) {
      rememberBackendResult(source, sourceType, result, quality);
    }
    return result;
  };
  const canTryAnotherInterface = (error: unknown) => {
    if (error instanceof TrackPlaybackRejectedError ||
        (error instanceof Error && error.name === 'AbortError')) return false;
    // A response about this song, including an empty-resource response, does
    // not prove that the same imported handler has no other usable interface.
    return Boolean(pool?.routes?.length) || shouldFallbackBackend(error);
  };
  try {
    if (!allowDiscovery && !pinnedRoute?.available)
      throw new Error('所有接口均失败：当前歌曲的池内接口已尝试');
    return await register(await resolveOnce(pinnedSource, pinnedRoute));
  } catch (error) {
    throwIfAddressAborted(signal);
    if ((!pool?.routes?.length && !pinnedBackend && !pinnedRoute && !(error instanceof PrewarmAudioUnavailable)) || !canTryAnotherInterface(error)) throw error;
    if (generation !== backendPoolGeneration) throw error;
    if (!(error instanceof PrewarmAudioUnavailable) && !(error instanceof PlaybackAudioUnavailable) && (!pinnedRoute?.qualities.length || pinnedRoute.qualities.includes(quality))) {
      if (pinnedBackend) failBackend(pinnedBackend);
      if (pinnedRoute) failRoute(pinnedRoute);
    }
    const attemptedBackends = new Set(pinnedBackend ? [pinnedBackend] : []);
    for (const route of orderedRoutes) {
      if (!routeAvailable(route) || route === pinnedRoute) continue;
      if (attemptedRoutes.has(route.key)) continue;
      throwIfAddressAborted(signal);
      if (route.backend) attemptedBackends.add(route.backend);
      try { return await register(await resolveOnce({ ...source, pinnedBackend: route.backend }, route)); }
      catch (nextError) {
        throwIfAddressAborted(signal);
        if (generation !== backendPoolGeneration || !canTryAnotherInterface(nextError)) throw nextError;
        if (!(nextError instanceof PrewarmAudioUnavailable) && !(nextError instanceof PlaybackAudioUnavailable) && (!route.qualities.length || route.qualities.includes(quality))) failRoute(route);
      }
    }
    const known = allowDiscovery ? normalizeBackendLabels(backendPools.get(key)?.records
      .filter(record => record.available && (!record.backend ||
        (!attemptedBackends.has(record.backend) && !requestFailures?.backends.has(record.backend)))).map(record => record.backend)) : [];
    for (const backend of known) {
      throwIfAddressAborted(signal);
      try { return await register(await resolveOnce({ ...source, pinnedBackend: backend })); }
      catch (nextError) {
        throwIfAddressAborted(signal);
        if (generation !== backendPoolGeneration) throw nextError;
        if (!canTryAnotherInterface(nextError)) throw nextError;
        if (!(nextError instanceof PrewarmAudioUnavailable) && !(nextError instanceof PlaybackAudioUnavailable)) failBackend(backend);
      }
    }
    // Discovery belongs to this song, never another song's result or failure.
    // Existing per-song address/playback flights still merge identical work.
    return register(await resolveOnce({ ...source, pinnedBackend: undefined }, undefined, true));
  }
}

function scriptFingerprint(value: string) {
  let result = 5381;
  for (let index = 0; index < value.length; index += 1)
    result = (result * 33 + value.charCodeAt(index)) % 2_147_483_647;
  return result.toString(36);
}

export function qualityCandidates(
  track: Track,
  declared: string[] | undefined,
  preferred: AppSettings['quality'],
) {
  const desired = preferred as Quality;
  const start = Math.max(0, qualityOrder.indexOf(desired));
  const metadata = track.metadata ?? {};
  const actual = qualityMap(track, metadata);
  const actualSet = Object.keys(actual).length
    ? new Set(Object.keys(actual))
    : null;
  // Imported declarations may list only legacy tiers even when their handler
  // can resolve high-resolution files. They cannot lower the user's ceiling
  // before a URL has been requested and measured. Keep catalog requirements
  // (including hash-specific assets), then let request failures/native evidence
  // drive the existing descending fallback.
  const candidates = qualityOrder
    .slice(start)
    .filter(
      quality =>
        (!actualSet || actualSet.has(quality)),
    );
  console.info('[audio-quality-candidates]', JSON.stringify({
    key: `${track.provider}:${track.providerId ?? track.id}`,
    ceiling: preferred,
    declared: declared ?? [],
    catalog: Object.keys(actual),
    candidates,
  }));
  return candidates;
}

export function normalizeLxInfo(
  track: Track,
  sourceType?: string,
  pinnedBackend?: string,
  preferredBackend?: string,
  rejectedBackends: string[] = [],
) {
  const metadata = JSON.parse(JSON.stringify(track.metadata ?? {})) as Record<
    string,
    any
  >;
  const source =
    sourceType ??
    (track.provider === 'custom' ? 'custom' : sourceTypes[track.provider]);
  const songmid = platformSongId(track, source, metadata);
  const _types = qualityMap(track, metadata);
  const mappedTypes = Object.entries(_types).map(([type, value]: [string, any]) => ({
        type,
        size: value?.size ?? null,
        ...(source === 'kg' && value?.hash ? { hash: value.hash } : {}),
      }));
  const rawTypes = Array.isArray(metadata.types)
    ? [...metadata.types, ...mappedTypes.filter(value =>
        ['wy', 'tx'].includes(source) && ['hires', 'flac24bit'].includes(value.type) &&
        !metadata.types.some((entry: any) => entry?.type === value.type))]
    : mappedTypes;
  // Keep the payload on the mobile Scheme contract.  Desktop-only quality
  // labels or malformed entries must not reach a mobile source handler.
  const types = rawTypes.flatMap((value: any) => {
    const type = String(value?.type ?? '').trim();
    if (!['128k', '320k', 'flac', 'flac24bit', 'hires'].includes(type)) return [];
    return [
      {
        type,
        size: value?.size ?? null,
        ...(source === 'kg' && value?.hash ? { hash: String(value.hash) } : {}),
      },
    ];
  });
  const info: Record<string, unknown> = {
    name: String(metadata.name ?? metadata.songName ?? track.title),
    singer: String(metadata.singer ?? metadata.artist ?? track.artist),
    source,
    songmid,
    interval:
      metadata.interval ??
      `${Math.floor(track.duration / 60)
        .toString()
        .padStart(2, '0')}:${Math.floor(track.duration % 60)
        .toString()
        .padStart(2, '0')}`,
    albumName: String(metadata.albumName ?? metadata.album ?? track.album),
    albumId: metadata.albumId ?? '',
    img:
      metadata.img ??
      metadata.picUrl ??
      metadata.coverUrl ??
      track.cover ??
      null,
    types,
    _types,
    typeUrl: {},
  };
  if (source === 'kg')
    info.hash = String(metadata.hash ?? metadata.fileHash ?? track.providerId);
  if (source === 'tx') {
    info.strMediaMid = String(
      metadata.strMediaMid ??
        metadata.media_mid ??
        metadata.file?.media_mid ??
        songmid,
    );
    info.albumMid = String(
      metadata.albumMid ?? metadata.albummid ?? metadata.album?.mid ?? '',
    );
    info.songId = metadata.songId ?? metadata.id;
  }
  if (source === 'mg') {
    info.copyrightId = String(metadata.copyrightId ?? track.providerId ?? '');
    info.lrcUrl = metadata.lrcUrl;
    info.mrcUrl = metadata.mrcUrl ?? metadata.mrcurl;
    info.trcUrl = metadata.trcUrl;
  }
  if (pinnedBackend) info.__lxPinnedBackend = pinnedBackend;
  if (preferredBackend) info.__lxPreferredBackend = preferredBackend;
  if (rejectedBackends.length)
    info.__lxRejectedBackends = normalizeBackendLabels(rejectedBackends);
  return info;
}

function platformSongId(
  track: Track,
  source: string,
  metadata: Record<string, any>,
) {
  if (source === 'kg')
    return (
      metadata.songmid ??
      metadata.audio_id ??
      metadata.audioId ??
      metadata.Audioid ??
      track.providerId
    );
  if (source === 'tx')
    return metadata.songmid ?? metadata.mid ?? track.providerId;
  if (source === 'mg')
    return metadata.songmid ?? metadata.songId ?? track.providerId;
  return metadata.songmid ?? metadata.id ?? track.providerId;
}

function qualityMap(track: Track, metadata: Record<string, any>) {
  const existing = metadata._types ?? metadata._qualitys;
  if (existing && typeof existing === 'object') {
    // NetEase/QQ catalogs and imported handlers use both request names for
    // high-resolution files. These are request aliases, never measured tiers.
    // Compact ID-based search rows omit high-resolution fields. Absence is
    // not evidence of unavailability: keep both handler request names with an
    // unreadable size, then let the returned URL's native evidence decide.
    const highResolution = existing.hires ?? existing.flac24bit ?? { size: null };
    if (['netease', 'qq'].includes(track.provider) && Object.keys(existing).length)
      return { ...existing, hires: existing.hires ?? highResolution,
        flac24bit: existing.flac24bit ?? highResolution };
    return existing;
  }
  if (track.provider === 'kugou') {
    const base = String(metadata.hash ?? metadata.fileHash ?? track.providerId);
    return Object.fromEntries(
      [
        ['128k', base],
        ['320k', metadata['320hash'] ?? metadata.hash320],
        ['flac', metadata.sqhash ?? metadata.flacHash],
        ['flac24bit', metadata.hash_high ?? metadata.flac24bitHash],
        ['hires', metadata.hiresHash],
      ]
        .filter((pair): pair is string[] => Boolean(pair[1]))
        .map(([type, hash]) => [type, { size: null, hash }]),
    );
  }
  if (track.provider === 'migu') {
    const aliases: Record<string, Quality> = {
      PQ: '128k',
      LQ: '128k',
      HQ: '320k',
      SQ: 'flac',
      ZQ: 'flac24bit',
      ZQ24: 'flac24bit',
      HIRES: 'hires',
    };
    const result: Record<string, { size: string | null }> = {};
    for (const format of Array.isArray(metadata.audioFormats)
      ? metadata.audioFormats
      : []) {
      const quality = aliases[String(format.formatType ?? '').toUpperCase()];
      if (quality)
        result[quality] = {
          size:
            format.asize || format.isize
              ? String(format.asize ?? format.isize)
              : null,
        };
    }
    return result;
  }
  return {};
}
