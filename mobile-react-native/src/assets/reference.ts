import type { ImageSourcePropType } from 'react-native';

/** Original abstract artwork created for the open-source edition. */
export const referenceArtwork = {
  libraryHero: require('./reference/library-hero.png') as ImageSourcePropType,
  settingsHero: require('./reference/settings-hero.png') as ImageSourcePropType,
  recommendations: {
    large: require('./reference/recommend-large.png') as ImageSourcePropType,
    plant: require('./reference/recommend-plant.png') as ImageSourcePropType,
    city: require('./reference/recommend-city.png') as ImageSourcePropType,
  },
  recent: [
    require('./reference/recent-1.png') as ImageSourcePropType,
    require('./reference/recent-2.png') as ImageSourcePropType,
    require('./reference/recent-3.png') as ImageSourcePropType,
  ],
  themes: {
    day: require('./reference/theme-day.png') as ImageSourcePropType,
    sunset: require('./reference/theme-sunset.png') as ImageSourcePropType,
    night: require('./reference/theme-night.png') as ImageSourcePropType,
    nature: require('./reference/theme-nature.png') as ImageSourcePropType,
  },
} as const;
