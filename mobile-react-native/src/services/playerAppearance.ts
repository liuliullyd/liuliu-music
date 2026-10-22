import { NativeModules } from 'react-native';
import { useEffect, useState } from 'react';
import type { Track } from '../domain/types';

const fallbackTones: Record<Track['coverKey'], string> = {
  // These are sampled from the bundled cover artwork and are only used when
  // a track has no remote artwork URL to sample at runtime.
  train: '#59636A',
  cat: '#26384B',
  ocean: '#1E5B70',
  vinyl: '#5B351F',
};

export function playerBackdropTone(track: Track | null) {
  const candidate = track?.metadata?.dominantColor ?? track?.metadata?.color;
  if (typeof candidate === 'string' && /^#[0-9a-f]{6}$/i.test(candidate))
    return candidate;
  return track ? fallbackTones[track.coverKey] : '#4E3B36';
}

const sampledTones = new Map<string, string>();
let cacheGeneration = 0;
const pendingSamples = new Map<string, Promise<string | null>>();

export function playerBackdropSurfaceTone(tone: string) {
  const match = /^#([0-9a-f]{6})$/i.exec(tone);
  if (!match) return tone;
  const value = parseInt(match[1]!, 16);
  const dim = (channel: number) => Math.round(channel * 0.72);
  return `#${[value >> 16, (value >> 8) & 255, value & 255]
    .map(channel => dim(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}

export function playerForegroundForTone(tone: string) {
  const match = /^#([0-9a-f]{6})$/i.exec(tone);
  if (!match) {
    return {
      primary: '#fff8f5',
      secondary: '#d7d9dc',
      icon: '#fff8f5',
      chip: 'rgba(255,248,245,0.18)',
      track: 'rgba(255,248,245,0.34)',
    };
  }
  const value = parseInt(match[1]!, 16);
  const red = value >> 16;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  const luminance = (red * 0.299 + green * 0.587 + blue * 0.114) / 255;
  const dark = luminance > 0.66;
  return dark
    ? {
        primary: '#142026',
        secondary: '#34434a',
        icon: '#142026',
        chip: 'rgba(20,32,38,0.14)',
        track: 'rgba(20,32,38,0.26)',
      }
    : {
        primary: '#fff8f5',
        secondary: '#d7d9dc',
        icon: '#fff8f5',
        chip: 'rgba(255,248,245,0.18)',
        track: 'rgba(255,248,245,0.34)',
      };
}

const sampledEdgeTones = new Map<string, string>();
const pendingEdgeSamples = new Map<string, Promise<string | null>>();

function sampleImageTone(uri: string, edgesOnly: boolean) {
  const native = NativeModules.LiuliuPlayer as
    | {
        sampleCoverColor?: (value: string) => Promise<string | null>;
        sampleCoverEdgeColor?: (value: string) => Promise<string | null>;
      }
    | undefined;
  const sampler = edgesOnly
    ? native?.sampleCoverEdgeColor
    : native?.sampleCoverColor;
  if (!sampler) return Promise.resolve(null);
  const tones = edgesOnly ? sampledEdgeTones : sampledTones;
  const requests = edgesOnly ? pendingEdgeSamples : pendingSamples;
  const cached = tones.get(uri);
  if (cached) return Promise.resolve(cached);
  const pending = requests.get(uri);
  if (pending) return pending;
  const generation = cacheGeneration;
  const request = sampler
    .call(native, uri)
    .then(value => {
      const color =
        typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
          ? value
          : null;
      if (color && generation === cacheGeneration) tones.set(uri, color);
      return color;
    })
    .catch(() => null)
    .finally(() => {
      requests.delete(uri);
    });
  requests.set(uri, request);
  return request;
}

export const sampleCoverColor = (uri: string) => sampleImageTone(uri, false);
export const sampleCoverEdgeColor = (uri: string) => sampleImageTone(uri, true);

const playerArtworkKey = (track: Track) =>
  `${track.provider}:${track.providerId ?? track.id}:${track.id}:${track.cover ?? ''}:${track.coverKey}`;
const playerArtworkSamples = new Map<
  string,
  { uri: string; tone: string | null }
>();
const playerArtworkListeners = new Map<string, Set<(tone: string) => void>>();

export function clearPlayerAppearanceCache() {
  cacheGeneration += 1;
  sampledTones.clear();
  sampledEdgeTones.clear();
  playerArtworkSamples.clear();
}

/** Only sample artwork the existing decoder has actually accepted. */
export async function preloadPlayerArtworkTone(track: Track, uri: string) {
  const key = playerArtworkKey(track);
  let sample = playerArtworkSamples.get(key);
  if (!sample || sample.uri !== uri) {
    sample = { uri, tone: sampledTones.get(uri) ?? null };
    playerArtworkSamples.set(key, sample);
    if (playerArtworkSamples.size > 128)
      playerArtworkSamples.delete(playerArtworkSamples.keys().next().value!);
  }
  const tone = sample.tone ?? await sampleCoverColor(uri);
  // A late result for a replaced cover may cache its own URL, but must not
  // colour the currently accepted artwork for this song.
  if (tone && playerArtworkSamples.get(key) === sample) {
    sample.tone = tone;
    playerArtworkListeners.get(key)?.forEach(listener => listener(tone));
  }
  return tone;
}

export function usePlayerBackdropTone(
  track: Track | null,
  decodedOnly = false,
) {
  const trackKey = track ? playerArtworkKey(track) : 'none';
  const fallback = playerBackdropTone(track);
  const cachedTone = playerArtworkSamples.get(trackKey)?.tone;
  const [sample, setSample] = useState(() => ({
    key: trackKey,
    tone: cachedTone ?? fallback,
  }));
  useEffect(() => {
    setSample({
      key: trackKey,
      tone: playerArtworkSamples.get(trackKey)?.tone ?? fallback,
    });
    if (trackKey === 'none') return undefined;
    const listener = (tone: string) => setSample({ key: trackKey, tone });
    const listeners = playerArtworkListeners.get(trackKey) ?? new Set();
    listeners.add(listener);
    playerArtworkListeners.set(trackKey, listeners);
    let active = true;
    // Other playback surfaces retain their existing on-entry sampling. The
    // moving player page uses only its accepted decoder result.
    if (!decodedOnly && !playerArtworkSamples.has(trackKey)) {
      const uri = track?.cover?.trim()
        .replace(/^\/\//, 'https://').replace(/^http:/, 'https:');
      if (uri) void sampleCoverColor(uri).then(tone => {
        if (active && tone) listener(tone);
      });
    }
    return () => {
      active = false;
      listeners.delete(listener);
      if (!listeners.size) playerArtworkListeners.delete(trackKey);
    };
  }, [decodedOnly, fallback, track?.cover, trackKey]);
  // A track change must never render the previous track's sampled tone for a
  // frame while the new cover is being sampled. The fallback is derived from
  // the current track and is safe to use until its sample arrives.
  return cachedTone ?? (sample.key === trackKey ? sample.tone : fallback);
}

export function usePlayerBackdropSurfaceTone(
  track: Track | null,
  decodedOnly = false,
) {
  return playerBackdropSurfaceTone(usePlayerBackdropTone(track, decodedOnly));
}
