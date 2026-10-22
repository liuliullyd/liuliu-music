import type { ImageSourcePropType } from 'react-native';
import type { CoverKey } from '../domain/types';

export const covers: Record<CoverKey, ImageSourcePropType> = {
  train: require('./editorial/hero-train.png'),
  cat: require('./editorial/playlist-night-cat.png'),
  ocean: require('./editorial/playlist-ocean.png'),
  vinyl: require('./editorial/playlist-vinyl.png'),
};
