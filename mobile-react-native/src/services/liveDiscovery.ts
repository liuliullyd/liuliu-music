import type {
  CatalogDetail,
  DiscoveryCategory,
  PlatformSetting,
  PlaybackQuality,
  SourceSetting,
  Track,
} from '../domain/types';
import {
  getCatalog,
  getCollection,
  newSongChart,
  type OnlineProvider,
} from './onlineCatalog';
import { searchOnline } from './onlineMusic';
import { probeStartupSource } from './sourceRuntime';
import { isSourceEnabled } from './sourcePolicy';
import { isRecommendationMusicTrack } from './recommendationContentPolicy';
import { MIN_PLAYABLE_DURATION_SECONDS } from './trackPlaybackPolicy';
import { sanitizeDiagnostic } from './releaseDiagnostics';

declare const performance: { now(): number };

const queries: Record<DiscoveryCategory, string[]> = {
  综合: ['热门歌曲', '新歌', '流行音乐', '治愈', '经典'],
  新歌: ['新歌', '最新发行'],
  华语: ['华语流行', '国语新歌'],
  欧美: ['欧美流行', '欧美新歌'],
  日韩: ['日语新歌', '韩语流行'],
  粤语: ['粤语经典', '粤语新歌'],
  轻音乐: ['轻音乐', '纯音乐', '钢琴曲'],
  ACG: ['ACG', '动漫原声', '二次元'],
};

export const isMusicTrack = isRecommendationMusicTrack;

export const isOrdinaryTrack = (track: Track) => {
  const text = `${track.title} ${track.artist} ${track.album}`;
  return (
    isMusicTrack(track) &&
    track.duration >= MIN_PLAYABLE_DURATION_SECONDS &&
    track.duration <= 15 * 60 &&
      !/(?:live|现场|演唱会|\bmv\b|video|串烧|medley|伴奏|karaoke|试听|preview)/i.test(
      text,
    ) &&
    !/(?:群星|various artists)/i.test(track.artist)
  );
};
export const constituentArtists = (artist: string) =>
  artist
    .split(/\s*(?:\/|、|&|,|，|feat\.?|ft\.?)\s*/i)
    .map(value => value.trim().toLocaleLowerCase())
    .filter(Boolean);

export async function loadCategoryFeed(
  category: DiscoveryCategory,
  page: number,
  platforms: PlatformSetting[],
): Promise<Track[]> {
  return (await loadCategoryFeedPage(category, page, platforms)).tracks;
}

/** Preserve category ranking while exposing remote continuation to queues. */
export async function loadCategoryFeedPage(
  category: DiscoveryCategory,
  page: number,
  platforms: PlatformSetting[],
): Promise<{ tracks: Track[]; hasMore: boolean; retryable?: boolean }> {
  const enabled = platforms.filter(item => item.enabled).map(item => item.id);
  if (!enabled.length) return { tracks: [], hasMore: false };
  const routes = enabled.flatMap((provider, index) =>
    queries[category].map((query, queryIndex) => ({
      provider,
      query,
      order: queryIndex * enabled.length + index,
    })),
  );
  const settled = await Promise.allSettled(
    routes.map(route => searchOnline(route.query, page, 12, route.provider)),
  );
  const pools = settled.map(result =>
    result.status === 'fulfilled'
      ? result.value.tracks.filter(isOrdinaryTrack)
      : [],
  );
  const output: Track[] = [];
  const songs = new Set<string>();
  const artists = new Set<string>();
  let cursor = 0;
  while (output.length < 20 && pools.some(pool => pool.length)) {
    const pool = pools[cursor % pools.length]!;
    cursor += 1;
    const track = pool.shift();
    if (!track) continue;
    const key = `${track.title}|${track.artist}`.toLocaleLowerCase();
    const parts = constituentArtists(track.artist);
    if (songs.has(key) || parts.some(name => artists.has(name))) continue;
    songs.add(key);
    parts.forEach(name => artists.add(name));
    output.push({ ...track, reason: `${category} · ${track.provider}` });
  }
  return {
    tracks: output,
    retryable: settled.every(result => result.status === 'rejected' ||
      (!result.value.tracks.length && result.value.errors.length > 0 && !Number.isFinite(result.value.rawCount))),
    hasMore: settled.some(result => result.status === 'rejected' ||
      (Number.isFinite(result.value.rawCount)
        ? Number(result.value.rawCount) > 0
        : result.value.tracks.length > 0)),
  };
}

export interface PlatformHealthResult {
  healthy: OnlineProvider[];
  first: OnlineProvider | null;
  /** First successful fixed binding per platform, in observed launch order. */
  passedOrder?: OnlineProvider[];
  sourceIds: string[];
  sourceIdsByProvider: Partial<Record<OnlineProvider, string[]>>;
  backendByProvider: Partial<Record<OnlineProvider, string>>;
  byProvider: Partial<Record<OnlineProvider, PlatformHealthStatus>>;
  /** Unfinished platforms are neither failed nor eligible for catalog/playback. */
  pending?: OnlineProvider[];
  completed?: boolean;
}

export type PlatformHealthCheck = {
  sourceId: string;
  passed: boolean;
  stage: 'search' | 'sample' | 'resolve';
  message?: string;
  backend?: string;
};

export type PlatformHealthStatus = {
  passed: boolean;
  /** Existing resolution + first-64-KiB probe time for the selected source. */
  elapsedMs?: number;
  selectedSourceId?: string;
  backend?: string;
  checks: PlatformHealthCheck[];
  message?: string;
};

/**
 * Keep startup recommendation ordering separate from health aggregation. A
 * failed platform may never become the first platform, but it must not erase
 * other platforms that passed the same launch probe.
 */
export function orderedHealthyProviders(
  health: PlatformHealthResult,
): OnlineProvider[] {
  const passing = new Set(
    health.healthy.filter(
      provider => health.byProvider[provider]?.passed === true,
    ),
  );
  const ordered = [
    ...(health.first && passing.has(health.first) ? [health.first] : []),
    ...health.healthy.filter(
      provider => provider !== health.first && passing.has(provider),
    ),
  ];
  return [...new Set(ordered)];
}

export async function detectHealthyPlatforms(
  platforms: PlatformSetting[],
  sources: SourceSetting[],
  quality: PlaybackQuality,
  multiSourceDetection = false,
): Promise<PlatformHealthResult> {
  return startPlatformHealthDetection(
    platforms,
    sources,
    quality,
    multiSourceDetection,
  ).completed;
}

/** One probe per platform/source, with an early bound result and ongoing progress. */
export function startPlatformHealthDetection(
  platforms: PlatformSetting[],
  sources: SourceSetting[],
  quality: PlaybackQuality,
  multiSourceDetection = false,
  onUpdate?: (health: PlatformHealthResult) => void,
): {
  firstPassed: Promise<PlatformHealthResult>;
  completed: Promise<PlatformHealthResult>;
} {
  const enabled = platforms.filter(item => item.enabled);
  const enabledSources = sources.filter(
    isSourceEnabled,
  );
  if (!enabled.length || !enabledSources.length) {
    const empty: PlatformHealthResult = {
      healthy: [],
      first: null,
      passedOrder: [],
      sourceIds: [],
      sourceIdsByProvider: {},
      backendByProvider: {},
      byProvider: {},
      pending: [],
      completed: true,
    };
    onUpdate?.(empty);
    return {
      firstPassed: Promise.resolve(empty),
      completed: Promise.resolve(empty),
    };
  }
  // Startup health is a fresh probe. A failure saved by an earlier manual test
  // must not prevent the source script from participating in this new probe.
  const probeSources = sources
    .map(source =>
      isSourceEnabled(source) ? { ...source, healthy: true } : source,
    )
    .filter(isSourceEnabled);
  // A single-source launch uses the first enabled source as the fixed source
  // for this launch. Multi-source detection is the explicit opt-in that fans
  // out the same generic LX probe across every enabled source.
  const selectedSources = multiSourceDetection
    ? probeSources
    : probeSources.slice(0, 1);
  type ProbeResult =
    | {
        sourceId: string;
        passed: true;
        backend: string;
        elapsedMs: number;
        sourceIndex: number;
      }
    | {
        sourceId: string;
        passed: false;
        sourceIndex: number;
        message: string;
      };
  let first: OnlineProvider | null = null;
  const passedOrder: OnlineProvider[] = [];
  const backendByProvider: Partial<Record<OnlineProvider, string>> = {};
  const byProvider: Partial<Record<OnlineProvider, PlatformHealthStatus>> = {};
  const pending = new Set(enabled.map(platform => platform.id));
  // A platform can be bound while its slower source checks still finish.
  const unfinished = new Set(pending);
  let releaseFirst!: (health: PlatformHealthResult) => void;
  const firstPassed = new Promise<PlatformHealthResult>(resolve => {
    releaseFirst = resolve;
  });
  let firstReleased = false;
  const snapshot = (): PlatformHealthResult => {
    const passing = enabled.filter(
      platform => byProvider[platform.id]?.passed === true,
    );
    return {
      healthy: passing.map(platform => platform.id),
      first,
      passedOrder: [...passedOrder],
      sourceIds: [
        ...new Set(
          passing.map(platform => byProvider[platform.id]!.selectedSourceId!),
        ),
      ],
      sourceIdsByProvider: Object.fromEntries(
        passing.map(platform => [
          platform.id,
          [byProvider[platform.id]!.selectedSourceId!],
        ]),
      ),
      backendByProvider: { ...backendByProvider },
      byProvider: Object.fromEntries(
        Object.entries(byProvider).map(([provider, status]) => [
          provider,
          { ...status, checks: status!.checks.map(check => ({ ...check })) },
        ]),
      ),
      pending: [...pending],
      completed: unfinished.size === 0,
    };
  };
  const publish = () => {
    const health = snapshot();
    onUpdate?.(health);
    if (!firstReleased && (health.first !== null || health.completed)) {
      firstReleased = true;
      releaseFirst(health);
    }
    return health;
  };
  onUpdate?.(snapshot());
  type PassingProbe = Extract<ProbeResult, { passed: true }>;
  const bestPassingProbe = (probes: ProbeResult[]) =>
    probes
      .filter((result): result is PassingProbe => result.passed)
      .sort(
        (left, right) =>
          (multiSourceDetection ? left.elapsedMs - right.elapsedMs : 0) ||
          left.sourceIndex - right.sourceIndex,
      )[0];
  const healthCheck = (result: ProbeResult): PlatformHealthCheck =>
    result.passed === false
      ? {
          sourceId: result.sourceId,
          passed: false,
          stage: 'resolve',
          message: result.message,
        }
      : {
          sourceId: result.sourceId,
          passed: true,
          stage: 'resolve',
          backend: result.backend || undefined,
        };
  const completed = Promise.all(
    enabled.map(async platform => {
      let bound: PassingProbe | undefined;
      let decisionTimer: ReturnType<typeof setTimeout> | undefined;
      const clearDecisionTimer = () => {
        if (decisionTimer !== undefined) clearTimeout(decisionTimer);
        decisionTimer = undefined;
      };
      const bind = (best: PassingProbe, probes: ProbeResult[]) => {
        bound = best;
        if (!first) first = platform.id;
        if (!passedOrder.includes(platform.id)) passedOrder.push(platform.id);
        if (best.backend) backendByProvider[platform.id] = best.backend;
        byProvider[platform.id] = {
          passed: true,
          elapsedMs: best.elapsedMs,
          selectedSourceId: best.sourceId,
          backend: best.backend || undefined,
          checks: probes.map(healthCheck),
          message: '本次启动检测通过',
        };
        pending.delete(platform.id);
        console.info(
          '[startup-health-bound]',
          JSON.stringify({
            provider: platform.id,
            sourceId: best.sourceId,
            elapsedMs: best.elapsedMs,
            remainingChecks: selectedSources.length - probes.length,
          }),
        );
      };
      try {
        let sample: Track;
        try {
          sample = await loadStartupHealthSample(platform.id);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : '榜单样本获取失败';
          byProvider[platform.id] = {
            passed: false,
            checks: selectedSources.map(source => ({
              sourceId: source.id,
              passed: false,
              stage: 'search' as const,
              message,
            })),
            message,
          };
          return null;
        }
        console.info('[startup-health-sample]', JSON.stringify({
          provider: platform.id, chartId: newSongChart(platform.id),
          id: sample.providerId ?? sample.id, title: sample.title,
          duration: sample.duration,
        }));
        const checks: Array<{ startedAt?: number; result?: ProbeResult }> =
          selectedSources.map(() => ({}));
        const settledProbes = () =>
          checks.flatMap(check => (check.result ? [check.result] : []));
        const bindIfProven = () => {
          clearDecisionTimer();
          if (bound) return;
          const settled = settledProbes();
          const best = bestPassingProbe(settled);
          const waiting = checks.filter(check => !check.result);
          // Complete comparisons use the same final binding path below.
          if (!best || !waiting.length) return;
          const now = performance.now();
          let waitMs = 0;
          for (let index = 0; index < checks.length; index += 1) {
            const check = checks[index]!;
            if (check.result) continue;
            if (check.startedAt === undefined) return;
            const remaining = best.elapsedMs - (now - check.startedAt);
            // A pending earlier source can still win an equal-duration tie.
            if (remaining > 0 || (remaining === 0 && index < best.sourceIndex))
              waitMs = Math.max(
                waitMs,
                Math.ceil(remaining) + (index < best.sourceIndex ? 1 : 0),
              );
          }
          if (waitMs > 0) {
            decisionTimer = setTimeout(bindIfProven, waitMs);
            return;
          }
          // Every unfinished probe already took at least the winner's full
          // resolution + prefix time. None can change this source/backend.
          bind(best, settled);
          publish();
        };
        const probes: ProbeResult[] = await Promise.all(
          selectedSources.map(async (source, sourceIndex) => {
            const startedAt = performance.now();
            checks[sourceIndex]!.startedAt = startedAt;
            let result: ProbeResult;
            try {
              // The original first new-release song uses the same real URL,
              // native evidence and ceiling selection as queue pre-resolution.
              const resolved = await probeStartupSource(sample, source, quality);
              result = {
                sourceId: source.id,
                passed: true,
                backend: resolved.backend ?? '',
                elapsedMs: performance.now() - startedAt,
                sourceIndex,
              };
            } catch (error) {
              result = {
                sourceId: source.id,
                passed: false,
                sourceIndex,
                message:
                  error instanceof Error ? error.message : '播放链路检测失败',
              };
            }
            checks[sourceIndex]!.result = result;
            bindIfProven();
            return result;
          }),
        );
        const best = bound ?? bestPassingProbe(probes);
        if (best) {
          if (!bound) bind(best, probes);
          else
            byProvider[platform.id] = {
              ...byProvider[platform.id]!,
              checks: probes.map(healthCheck),
            };
          return {
            provider: platform.id,
            sourceId: best.sourceId,
            backend: best.backend,
          };
        }
        byProvider[platform.id] = {
          passed: false,
          checks: probes.map(healthCheck),
          message: '所有已参与音源均未通过播放链路检测',
        };
        return null;
      } catch (error) {
        // An unexpected error in one platform's sample/health path must remain
        // local to that platform. Other platform probes still determine the
        // launch recommendation set.
        if (bound) return null;
        const message =
          error instanceof Error ? error.message : '播放链路检测失败';
        byProvider[platform.id] = {
          passed: false,
          checks: selectedSources.map(source => ({
            sourceId: source.id,
            passed: false,
            stage: 'resolve' as const,
            message,
          })),
          message,
        };
        return null;
      } finally {
        clearDecisionTimer();
        pending.delete(platform.id);
        unfinished.delete(platform.id);
        publish();
      }
    }),
  ).then(() => {
    const diagnosticMessage = (message?: string) => {
      const sanitized = sanitizeDiagnostic(message);
      // A decoder can mention a bare decryption key outside a URL/JSON field.
      return typeof sanitized === 'string' ? sanitized.replace(
        /(["']?\bkey["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/gi,
        '$1[redacted]',
      ) : sanitized;
    };
    for (const [provider, status] of Object.entries(byProvider)) {
      const records = [
        { sourceId: undefined, stage: 'complete', passed: status?.passed === true,
          selectedSourceId: status?.selectedSourceId, message: diagnosticMessage(status?.message) },
        ...(status?.checks ?? []).map(check => ({ sourceId: check.sourceId,
          stage: check.stage, passed: check.passed, message: diagnosticMessage(check.message) })),
      ];
      records.forEach((record, index) => {
        // Sanitize the whole record before splitting, so secrets cannot straddle parts.
        const payload = JSON.stringify(sanitizeDiagnostic(record));
        const parts = Math.max(1, Math.ceil(payload.length / 512));
        for (let part = 0; part < parts; part += 1) {
          console.info('[startup-health-detail]', JSON.stringify({
            provider, sourceId: record.sourceId, stage: record.stage, passed: record.passed,
            record: index, part: part + 1, parts, payload: payload.slice(part * 512, (part + 1) * 512),
          }));
        }
      });
    }
    return snapshot();
  });
  return { firstPassed, completed };
}

/** Startup uses the same platform new-song chart and original first track as its detail. */
export async function loadStartupHealthSample(provider: OnlineProvider): Promise<Track> {
  const detail = await getCollection(provider, 'charts', newSongChart(provider));
  const sample = detail.tracks[0];
  if (!sample) throw new Error('平台新歌首发没有第一首歌曲');
  return sample;
}

/** Manual source checks retain their established first-chart sample. */
export async function loadDesktopHealthSample(
  provider: OnlineProvider,
): Promise<Track> {
  const charts = await getCatalog(provider, 'charts', 1);
  const chart = charts[0];
  if (!chart) throw new Error('平台未返回有效榜单');
  const detail = await getCollection(provider, 'charts', chart.id);
  const sample = detail.tracks[0];
  if (!sample) throw new Error('平台榜单没有有效歌曲');
  return sample;
}

export const interleaveStartupTracks = (left: Track[], right: Track[]) => {
  const output: Track[] = [];
  const seen = new Set<string>();
  const indexes = [0, 0];
  let turn = 0;
  for (;;) {
    let added = false;
    for (let attempt = 0; attempt < 2 && !added; attempt += 1) {
      const pool = attempt ? 1 - turn : turn;
      const values = pool ? right : left;
      while (indexes[pool]! < values.length) {
        const track = values[indexes[pool]!]!;
        indexes[pool]! += 1;
        const key = `${track.title}|${track.artist}`.toLocaleLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(track);
        turn = 1 - pool;
        added = true;
        break;
      }
    }
    if (!added) break;
  }
  return output;
};

export async function loadCollectionDetail(
  provider: OnlineProvider,
  kind: 'playlists' | 'charts' | 'new-albums',
  id: string,
): Promise<CatalogDetail> {
  return getCollection(provider, kind, id);
}
