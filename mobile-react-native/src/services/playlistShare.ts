import type { CatalogItem } from '../domain/types';
import { collectionEntityKind } from './collectionIdentity';
import type { PlaylistReference } from './playlistImport';

const metadataKey = '#liuliu_playlist=';
const remoteCover = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const cover = value.trim();
  return cover.length <= 2048 && /^https?:\/\/[^/?#\s@]+(?:[/?#][^\s]*)?$/i.test(cover)
    ? cover : undefined;
};
const playlistTitle = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length <= 500 ? value.trim() || undefined : undefined;

export const formatPlaylistShare = (title: string, url: string) =>
  `分享歌单《${title}》 ${url} 复制进行打开六六音乐导入吧`;

/** The URL outside the quoted title is the shared entity, even if the title contains links. */
export function plainPlaylistShare(input: string): { title: string; url: string } | undefined {
  const match = /^分享歌单《([\s\S]{1,500})》\s+((?:https?|liuliu):\/\/[^\s<>"“”，。；！？（）]+)\s+复制进行打开六六音乐导入吧$/.exec(input.trim());
  const title = playlistTitle(match?.[1]);
  return match && title ? { title, url: match[2] } : undefined;
}

function platformPlaylistUrl({ provider, id }: PlaylistReference) {
  const encoded = encodeURIComponent(id);
  const links: Record<PlaylistReference['provider'], string> = {
    netease: `https://music.163.com/playlist?id=${encoded}`,
    qq: `https://i2.y.qq.com/n3/other/pages/details/playlist.html?id=${encoded}&hosteuin=`,
    kugou: /^gcid_/i.test(id) ? `https://m.kugou.com/songlist/${encoded}/` : `https://www.kugou.com/yy/special/single/${encoded}.html`,
    kuwo: `https://www.kuwo.cn/playlist_detail/${encoded}`,
    migu: `https://music.migu.cn/v3/music/playlist/${encoded}`,
    qishui: `https://www.qishui.com/share/playlist?playlist_id=${encoded}`,
  };
  return links[provider];
}

/** Share a clean platform URL in the same readable envelope used by personal lists. */
export function createPlaylistShare(item: CatalogItem) {
  if (collectionEntityKind(item) !== 'playlist') throw new Error('当前内容不是平台歌单');
  const id = item.id;
  const numeric = /^[0-9]+$/.test(id) && !/^0+$/.test(id);
  const global = item.provider === 'kugou' && /^gcid_[a-z0-9_]{1,128}$/i.test(id);
  if (!numeric && !global) throw new Error('歌单链接暂不可用，请稍后重试');
  const title = playlistTitle(item.title);
  if (!title) throw new Error('歌单名称暂不可用，请稍后重试');
  const url = platformPlaylistUrl(item);
  return { title, message: formatPlaylistShare(title, url), url };
}

/** Used only after the normal platform/collection identity has been resolved. */
export function sharedPlaylistMetadata(url: string, reference: PlaylistReference): { title?: string; cover?: string } {
  const plain = plainPlaylistShare(url);
  if (plain) return plain.url === platformPlaylistUrl(reference) ? { title: plain.title } : {};
  const offset = url.indexOf(metadataKey);
  if (offset < 0) return {};
  const encoded = url.slice(offset + metadataKey.length).split(/\s/, 1)[0];
  if (!encoded || encoded.length > 12000) return {};
  try {
    const value = JSON.parse(decodeURIComponent(encoded));
    if (!value || value.v !== 1 || value.provider !== reference.provider || value.id !== reference.id) return {};
    return { title: playlistTitle(value.title), cover: remoteCover(value.cover) };
  } catch { return {}; }
}
