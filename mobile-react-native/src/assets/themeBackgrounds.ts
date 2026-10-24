import type { ImageSourcePropType } from 'react-native';
import type { ThemeId } from '../theme';

/** Complete bundled backgrounds; each upper-right scene is part of its bitmap. */
export const themeBackgroundArtwork: Record<ThemeId, ImageSourcePropType> = {
  white: require('./theme-background/fresh-day.png') as ImageSourcePropType,
  sunset: require('./theme-background/sunset.png') as ImageSourcePropType,
  night: require('./theme-background/night.png') as ImageSourcePropType,
  nature: require('./theme-background/nature.png') as ImageSourcePropType,
  mist: require('./theme-background/mist.png') as ImageSourcePropType,
  ocean: require('./theme-background/ocean.png') as ImageSourcePropType,
  lavender: require('./theme-background/lavender.png') as ImageSourcePropType,
  sakura: require('./theme-background/sakura.png') as ImageSourcePropType,
  'anime-school':
    require('./theme-background/anime-school.png') as ImageSourcePropType,
  'anime-voyage':
    require('./theme-background/anime-voyage.png') as ImageSourcePropType,
  'anime-ninja':
    require('./theme-background/anime-ninja.png') as ImageSourcePropType,
  'anime-train':
    require('./theme-background/anime-train.png') as ImageSourcePropType,
  'sport-basketball':
    require('./theme-background/sport-basketball.png') as ImageSourcePropType,
  'sport-football':
    require('./theme-background/sport-football.png') as ImageSourcePropType,
  'sport-tennis':
    require('./theme-background/sport-tennis.png') as ImageSourcePropType,
  'sport-swimming':
    require('./theme-background/sport-swimming.png') as ImageSourcePropType,
  'film-space':
    require('./theme-background/film-space.png') as ImageSourcePropType,
  'film-cyber':
    require('./theme-background/film-cyber.png') as ImageSourcePropType,
  'film-wuxia':
    require('./theme-background/film-wuxia.png') as ImageSourcePropType,
  'film-romance':
    require('./theme-background/film-romance.png') as ImageSourcePropType,
  'curated-dunhuang':
    require('./theme-background/curated-dunhuang.png') as ImageSourcePropType,
  'curated-deer':
    require('./theme-background/curated-deer.png') as ImageSourcePropType,
  'curated-butterfly':
    require('./theme-background/curated-butterfly.png') as ImageSourcePropType,
  'curated-rose':
    require('./theme-background/curated-rose.png') as ImageSourcePropType,
};
