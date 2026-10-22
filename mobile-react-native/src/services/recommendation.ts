import { catalog } from '../data/catalog';
import type { DiscoveryCategory, MusicProfile, Track } from '../domain/types';

const forbidden =
  /(live|现场|演唱会|\bmv\b|video|广播|radio|podcast|播客|有声|朗读|串烧|medley|伴奏|karaoke|试听|preview)/i;
export const isOrdinaryCompleteSong = (track: Track) =>
  !forbidden.test(`${track.title} ${track.album}`) &&
  track.duration >= 90 &&
  track.duration <= 900;
export const constituentArtists = (artist: string) =>
  artist
    .toLowerCase()
    .split(/\s*(?:\/|、|,|，|&|＆| feat\.? | featuring | ft\.? | x )\s*/i)
    .map(value => value.trim())
    .filter(Boolean);
const slot = () => {
  const hour = new Date().getHours();
  return hour < 6
    ? '深夜'
    : hour < 11
    ? '清晨'
    : hour < 14
    ? '午间'
    : hour < 18
    ? '午后'
    : '夜晚';
};
const weight = (map: Record<string, number>, key: string) =>
  Number(map[key] ?? 0);
const categoryMatch = (track: Track, category: DiscoveryCategory) =>
  category === '综合' ||
  (category === '新歌'
    ? track.isNew || track.releaseYear >= 2025
    : category === '轻音乐'
    ? track.language === '纯音乐'
    : category === '日韩'
    ? track.language === '日韩'
    : track.language === category);

export function rankFeed(
  category: DiscoveryCategory,
  page: number,
  profile: MusicProfile,
  source: Track[] = catalog,
  pageSize = 20,
) {
  const evidence =
    profile.longTermTrackIds.length +
    profile.shortTermTrackIds.length +
    profile.sessionTrackIds.length;
  const filtered = source
    .filter(isOrdinaryCompleteSong)
    .filter(track => categoryMatch(track, category));
  const ranked = filtered
    .map((track, index) => {
      const artistSignals = constituentArtists(track.artist).reduce(
        (total, name) => total + weight(profile.artists, name),
        0,
      );
      const score =
        artistSignals * 4 +
        weight(profile.languages, track.language) * 2.5 +
        weight(profile.genres, track.genre) * 2 +
        weight(profile.moods, track.mood) * 1.8 +
        weight(profile.timeSlots, slot()) * 0.5 +
        (profile.shortTermTrackIds.includes(track.id) ? 3 : 0) +
        (profile.sessionTrackIds.includes(track.id) ? 2 : 0) +
        (track.isNew ? (category === '新歌' ? 4 : 0.35) : 0) +
        ((index * 37) % 19) / 100;
      return {
        ...track,
        reason: evidence
          ? `基于你的${artistSignals ? '歌手、' : ''}${track.genre}与${
              track.mood
            }偏好`
          : '冷启动本地精选',
        _score: score,
      };
    })
    .sort((a, b) => b._score - a._score);
  const selected: (Track & { _score: number })[] = [];
  const usedArtists = new Set<string>(),
    usedAlbums = new Set<string>();
  for (const candidate of ranked) {
    const artists = constituentArtists(candidate.artist);
    if (artists.some(name => usedArtists.has(name))) continue;
    if (
      selected.at(-1)?.album === candidate.album &&
      ranked.some(
        item =>
          item.album !== candidate.album &&
          !selected.some(row => row.id === item.id),
      )
    )
      continue;
    selected.push(candidate);
    artists.forEach(name => usedArtists.add(name));
    usedAlbums.add(candidate.album);
  }
  const start = (Math.max(1, page) - 1) * pageSize;
  return selected
    .slice(start, start + pageSize)
    .map(({ _score, ...track }) => track);
}

export function learn(
  profile: MusicProfile,
  track: Track,
  seconds: number,
  completed: boolean,
  skipped: boolean,
): MusicProfile {
  const strength = skipped
      ? -0.45
      : completed
      ? 1.5
      : Math.min(1, seconds / 90),
    next: MusicProfile = JSON.parse(JSON.stringify(profile)),
    inc = (map: Record<string, number>, key: string, value: number) =>
      (map[key] = Math.max(0, (map[key] ?? 0) + value));
  constituentArtists(track.artist).forEach(artist =>
    inc(next.artists, artist, strength),
  );
  inc(next.languages, track.language, strength);
  inc(next.genres, track.genre, strength);
  inc(next.moods, track.mood, strength);
  inc(next.timeSlots, slot(), strength);
  next.sessionTrackIds = [
    track.id,
    ...next.sessionTrackIds.filter(id => id !== track.id),
  ].slice(0, 30);
  next.shortTermTrackIds = [
    track.id,
    ...next.shortTermTrackIds.filter(id => id !== track.id),
  ].slice(0, 80);
  if (completed)
    next.longTermTrackIds = [
      track.id,
      ...next.longTermTrackIds.filter(id => id !== track.id),
    ].slice(0, 300);
  return next;
}
