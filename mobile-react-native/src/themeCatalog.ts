import type { AppSettings } from './domain/types';

export type ThemeCategory =
  | 'classic'
  | 'anime'
  | 'sports'
  | 'film'
  | 'featured';
export type ThemeFilter = ThemeCategory;
export interface ThemeOption {
  id: AppSettings['theme'];
  label: string;
  copy: string;
  category: ThemeCategory;
}

/** One directory drives the compact rail and the complete theme browser. */
export const themeOptions: readonly ThemeOption[] = [
  {
    id: 'white',
    label: '清新白昼',
    copy: '明亮舒适',
    category: 'classic',
  },
  {
    id: 'sunset',
    label: '日落黄昏',
    copy: '温暖治愈',
    category: 'classic',
  },
  {
    id: 'night',
    label: '深邃夜空',
    copy: '沉浸专注',
    category: 'classic',
  },
  {
    id: 'nature',
    label: '自然森系',
    copy: '清新自然',
    category: 'classic',
  },
  {
    id: 'mist',
    label: '晨雾青绿',
    copy: '轻盈呼吸',
    category: 'classic',
  },
  {
    id: 'ocean',
    label: '海岸蓝调',
    copy: '自由开阔',
    category: 'classic',
  },
  {
    id: 'lavender',
    label: '薰衣草梦境',
    copy: '柔和沉浸',
    category: 'classic',
  },
  {
    id: 'sakura',
    label: '樱粉薄暮',
    copy: '轻柔浪漫',
    category: 'classic',
  },
  {
    id: 'anime-school',
    label: '樱色学园',
    copy: '青春晴空',
    category: 'anime',
  },
  {
    id: 'anime-voyage',
    label: '航海冒险',
    copy: '向海而行',
    category: 'anime',
  },
  {
    id: 'anime-ninja',
    label: '忍者月影',
    copy: '静夜锋芒',
    category: 'anime',
  },
  {
    id: 'anime-train',
    label: '夏日列车',
    copy: '晴夏回忆',
    category: 'anime',
  },
  {
    id: 'sport-basketball',
    label: '篮球燃场',
    copy: '热血上场',
    category: 'sports',
  },
  {
    id: 'sport-football',
    label: '绿茵时刻',
    copy: '奔跑绿茵',
    category: 'sports',
  },
  {
    id: 'sport-tennis',
    label: '网球晴日',
    copy: '晴日开球',
    category: 'sports',
  },
  {
    id: 'sport-swimming',
    label: '泳池蔚蓝',
    copy: '自在畅游',
    category: 'sports',
  },
  {
    id: 'film-space',
    label: '星际远航',
    copy: '浩瀚银幕',
    category: 'film',
  },
  {
    id: 'film-cyber',
    label: '赛博都市',
    copy: '霓虹夜行',
    category: 'film',
  },
  {
    id: 'film-wuxia',
    label: '武侠竹影',
    copy: '江湖听风',
    category: 'film',
  },
  {
    id: 'film-romance',
    label: '都市爱情',
    copy: '温柔片刻',
    category: 'film',
  },
  {
    id: 'curated-dunhuang',
    label: '敦煌飞天',
    copy: '飘带与壁画色',
    category: 'featured',
  },
  {
    id: 'curated-deer',
    label: '山海神鹿',
    copy: '白鹿与青绿山海',
    category: 'featured',
  },
  {
    id: 'curated-butterfly',
    label: '赤霄凤舞',
    copy: '赤羽掠过金色云山',
    category: 'featured',
  },
  {
    id: 'curated-rose',
    label: '蝶影玫瑰',
    copy: '深红花瓣与黑蝶轮廓',
    category: 'featured',
  },
];

export const themeFilters: readonly { id: ThemeFilter; label: string }[] = [
  { id: 'classic', label: '风景' },
  { id: 'anime', label: '动漫' },
  { id: 'sports', label: '运动' },
  { id: 'film', label: '影视' },
  { id: 'featured', label: '精选' },
];

export const themesForFilter = (filter: ThemeFilter) =>
  themeOptions.filter(item => item.category === filter);
