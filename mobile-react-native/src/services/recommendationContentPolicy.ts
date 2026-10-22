import type { CatalogItem, Track } from '../domain/types';

// These are provider entity enums and identities. Titles, artist names,
// descriptions, genres and tags never determine the search result type.
const excludedEntities = new Set([
  'podcast',
  'audiobook',
  'longaudio',
  'spokenword',
  'radio',
  'djradio',
  'djprogram',
  'program',
  'episode',
  'chapter',
  'book',
  'video',
  'mv',
  '播客',
  '听书',
  '聽書',
  '有声书',
  '有聲書',
  '广播剧',
  '廣播劇',
  '电台',
  '電台',
]);
const typeKeys = [
  'mediaType',
  'media_type',
  'mediaKind',
  'media_kind',
  'discoveryEntity',
  'discovery_entity',
  'contentType',
  'content_type',
  'resourceType',
  'resource_type',
  'type',
  'typeName',
  'type_name',
  'entityType',
  'entity_type',
  'kind',
  'contentTypeName',
  'content_type_name',
  'mediaTypeName',
  'media_type_name',
  'trackTypeName',
  'track_type_name',
  'audioTypeName',
  'audio_type_name',
];
const spokenIdentityKeys = [
  'bookId',
  'book_id',
  'audioBookId',
  'audiobookId',
  'audiobook_id',
  'audio_book_id',
  'podcastId',
  'podcast_id',
  'radioId',
  'radio_id',
  'programId',
  'program_id',
  'episodeId',
  'episode_id',
  'chapterId',
  'chapter_id',
  'program',
  'radio',
  'book',
  'chapter',
  'episode',
  'podcast',
];
const spokenFlags = [
  'isPodcast',
  'is_podcast',
  'isAudiobook',
  'isAudioBook',
  'is_audiobook',
  'is_audio_book',
  'isLongAudio',
  'is_long_audio',
  'isSpoken',
  'is_spoken',
  'isRadio',
  'is_radio',
  'isDjRadio',
  'is_dj_radio',
  'isProgram',
  'is_program',
  'audioBookColumn',
  'audiobookColumn',
  'audio_book_column',
];
const songContainers = [
  'album',
  'al',
  'media',
  'content',
  'resource',
  'entity',
  'track',
  'track_wrapper',
  'song',
  'songInfo',
  'trans_param',
] as const;
const songRecords = (value: unknown, depth = 0): Record<string, unknown>[] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  return [
    record,
    ...(depth < 4
      ? songContainers.flatMap(key => songRecords(record[key], depth + 1))
      : []),
  ];
};
const textValues = (value: unknown, depth = 0): string[] => {
  if (depth > 4) return [];
  if (Array.isArray(value))
    return value.flatMap(item => textValues(item, depth + 1));
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return [
      'name',
      'title',
      'type',
      'typeName',
      'category',
      'categoryName',
      'tags',
      'genre',
      'style',
      'language',
    ].flatMap(key => textValues(record[key], depth + 1));
  }
  return typeof value === 'string' || typeof value === 'number'
    ? [String(value)]
    : [];
};
const entityEnum = (value: string) =>
  value.trim().toLowerCase().replace(/[ _-]/g, '');
const rootIsAlbum = (value: unknown) =>
  Boolean(
    value &&
      typeof value === 'object' &&
      typeKeys.some(key =>
        textValues((value as Record<string, unknown>)[key]).some(type =>
          ['album', 'albums', '专辑', '專輯'].includes(entityEnum(type)),
        ),
      ),
  );
const nonZeroIdentity = (value: unknown) =>
  value != null &&
  value !== false &&
  !['', '0', '-1'].includes(String(value).trim());
const hasAllowedEntityType = (value: unknown) =>
  songRecords(value).every(
    record =>
      !typeKeys.some(key =>
        textValues(record[key]).some(type =>
          excludedEntities.has(entityEnum(type)),
        ),
      ) &&
      !spokenIdentityKeys.some(key => nonZeroIdentity(record[key])) &&
      !spokenFlags.some(key =>
        ['1', 'true', 'yes'].includes(String(record[key]).trim().toLowerCase()),
      ) &&
      !['resType', 'res_type'].some(
        key => String(record[key]).trim() === '2013',
      ),
  );

/** Retain provider classification without copying whole search payloads into metadata. */
export function recommendationEntityMetadata(
  value: unknown,
  depth = 0,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>,
    result: Record<string, unknown> = {};
  for (const key of [
    ...typeKeys,
    ...spokenIdentityKeys,
    ...spokenFlags,
    'resType',
    'res_type',
  ]) {
    if (!(key in record)) continue;
    const field = record[key];
    if (
      field === null ||
      ['string', 'number', 'boolean'].includes(typeof field)
    )
      result[key] = field;
    else if (Array.isArray(field))
      result[key] = field
        .filter(item => ['string', 'number', 'boolean'].includes(typeof item))
        .slice(0, 16);
    else if (
      spokenIdentityKeys.includes(key) &&
      field &&
      typeof field === 'object'
    )
      result[key] = true;
    else if (typeKeys.includes(key) && field && typeof field === 'object')
      result[key] = textValues(field).slice(0, 16);
  }
  if (depth < 4)
    for (const key of songContainers) {
      const nested = recommendationEntityMetadata(record[key], depth + 1);
      if (Object.keys(nested).length) result[key] = nested;
    }
  return result;
}

/** Only structured result types/identities exclude a record, never title words. */
export function isRecommendationMusicTrack(track: Track) {
  return (
    !rootIsAlbum(track) &&
    !rootIsAlbum(track.metadata) &&
    hasAllowedEntityType(track) &&
    hasAllowedEntityType(track.metadata)
  );
}
export const isMusicOnlyRecommendationTrack = isRecommendationMusicTrack;

/** Music library entities include artists and albums as well as playlists. */
export function isMusicLibraryCollection(item: CatalogItem) {
  return hasAllowedEntityType(item) && hasAllowedEntityType(item.metadata);
}

/** Playlist dependencies stay eligible; album/program search entities cannot enter them. */
export function isRecommendationMusicCollection(item: CatalogItem) {
  return (
    item.kind === 'playlists' &&
    !rootIsAlbum(item.metadata) &&
    hasAllowedEntityType(item) &&
    hasAllowedEntityType(item.metadata)
  );
}

/** A preference, not a music eligibility rejection; scarce catalogs may use these versions. */
export function recommendationRecordingPenalty(track: Track) {
  const versions = [
    track.title,
    track.album,
    ...songRecords(track.metadata).flatMap(record =>
      [
        'version',
        'versionName',
        'version_name',
        'recordingVersion',
        'songVersion',
        'typeName',
        'tags',
      ].flatMap(key => textValues(record[key])),
    ),
  ].join(' ');
  return /钢琴|鋼琴|\bpiano\b|ピアノ|纯演奏|純演奏|器乐版|器樂版|纯音乐版|純音樂版|instrumental|オルゴール|music[ -]?box/i.test(
    versions,
  ) ||
    track.metadata?.isInstrumental === true ||
    track.metadata?.hasVocals === false ||
    (track.provider === 'qq' && track.metadata?.language === 9)
    ? 1
    : 0;
}
