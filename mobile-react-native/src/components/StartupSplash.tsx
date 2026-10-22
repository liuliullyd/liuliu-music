import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, NativeModules, StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { useApp } from '../state/AppContext';
import { paletteForTheme, themeDefaultAccents, type ThemeId } from '../theme';
import { themeOptions } from '../themeCatalog';

interface StartupPalette {
  background: string;
  sky: string;
  track: string;
  text: string;
  muted: string;
  brand: string;
  stream: string;
  streamAlt: string;
  horizon: string;
  dark: boolean;
}

export const STARTUP_TRANSITION_MS = 520;

export const STARTUP_PALETTES: Record<ThemeId, StartupPalette> = {
  white: {
    background: '#FAFBFD',
    sky: '#F1F5FA',
    track: '#D8E0EA',
    text: '#1D1D1F',
    muted: '#747B86',
    brand: '#20242A',
    stream: '#E4ECF5',
    streamAlt: '#4B8FE8',
    horizon: '#91A6C3',
    dark: false,
  },
  sunset: {
    background: '#FBF9F7',
    sky: '#F2EAE4',
    track: '#EEDFD3',
    text: '#2B2521',
    muted: '#7C665D',
    brand: '#D85F35',
    stream: '#E9D7C9',
    streamAlt: '#C97762',
    horizon: '#AA9691',
    dark: false,
  },
  night: {
    background: '#090C12',
    sky: '#151C27',
    track: '#2C3B52',
    text: '#F6F8FC',
    muted: '#AAB5C8',
    brand: '#C7C0FF',
    stream: '#263348',
    streamAlt: '#6EA8E8',
    horizon: '#8797B2',
    dark: true,
  },
  nature: {
    background: '#F7FAF8',
    sky: '#E6F0EB',
    track: '#CFE2D8',
    text: '#18241C',
    muted: '#60776A',
    brand: '#247C5C',
    stream: '#C8DDD3',
    streamAlt: '#4D9A80',
    horizon: '#8EA7A0',
    dark: false,
  },
  mist: {
    background: '#F5FAF6',
    sky: '#E2F0E7',
    track: '#CFE4D6',
    text: '#1A2A22',
    muted: '#6D8477',
    brand: '#3D9A73',
    stream: '#CDE6D6',
    streamAlt: '#62B78D',
    horizon: '#92B8A1',
    dark: false,
  },
  ocean: {
    background: '#F5FAFD',
    sky: '#E1EFF7',
    track: '#C9E0EC',
    text: '#172B3A',
    muted: '#69879A',
    brand: '#2587B8',
    stream: '#C8E1EF',
    streamAlt: '#5AA7CA',
    horizon: '#8EB1C5',
    dark: false,
  },
  lavender: {
    background: '#FAF7FE',
    sky: '#EDE5F8',
    track: '#DED2F0',
    text: '#2A2240',
    muted: '#80759A',
    brand: '#8B6FD3',
    stream: '#E5D9F4',
    streamAlt: '#A58FE0',
    horizon: '#B0A2C9',
    dark: false,
  },
  sakura: {
    background: '#FFF8FA',
    sky: '#F9E3EA',
    track: '#EFCFD9',
    text: '#38232C',
    muted: '#9A7480',
    brand: '#D96B88',
    stream: '#F5D9E2',
    streamAlt: '#E28CA3',
    horizon: '#C99BAA',
    dark: false,
  },
  ...(Object.fromEntries(
    themeOptions
      .filter(item => item.category !== 'classic')
      .map(item => {
        const palette = paletteForTheme(item.id);
        return [
          item.id,
          {
            background: palette.bg,
            sky: palette.panelSoft,
            track: palette.line,
            text: palette.text,
            muted: palette.muted,
            brand: palette.accent,
            stream: palette.panelSoft,
            streamAlt: palette.accent,
            horizon: palette.muted,
            dark: palette.dark,
          },
        ];
      }),
  ) as Record<
    Exclude<
      ThemeId,
      | 'white'
      | 'sunset'
      | 'night'
      | 'nature'
      | 'mist'
      | 'ocean'
      | 'lavender'
      | 'sakura'
    >,
    StartupPalette
  >),
};

export function StartupSplash() {
  const app = useApp();
  return (
    <StartupSplashView
      startup={app.startup}
      theme={app.state.settings.theme}
      accent={app.state.settings.accent}
    />
  );
}

/** Read only the native mirror; no startup work is started by this presentation. */
export function readStartupAppearance() {
  const saved = NativeModules.LiuliuStorage;
  const hasSavedTheme = typeof saved?.startupTheme === 'string' &&
    Object.prototype.hasOwnProperty.call(STARTUP_PALETTES, saved.startupTheme);
  const theme: ThemeId = hasSavedTheme ? saved.startupTheme as ThemeId : 'white';
  const accent = hasSavedTheme && typeof saved?.startupAccent === 'string' && /^#[0-9a-f]{6}$/i.test(saved.startupAccent)
    ? saved.startupAccent : themeDefaultAccents[theme];
  return { theme, accent };
}

type StartupSplashViewProps = {
  startup: { visible: boolean; label: string; progress: number };
  theme: keyof typeof STARTUP_PALETTES;
  accent: string;
};

function GradientMusicNote({
  gradientId,
  accent,
  double = false,
}: {
  gradientId: string;
  accent: string;
  double?: boolean;
}) {
  const fill = `url(#${gradientId})`;
  return (
    <Svg width="100%" height="100%" viewBox="0 0 48 64">
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#79E6FF" />
          <Stop offset="48%" stopColor={accent} />
          <Stop offset="100%" stopColor="#A988FF" />
        </LinearGradient>
      </Defs>
      {double ? (
        <>
          <Path
            d="M13 16 L39 10 L39 43 M13 16 L13 49 M13 25 L39 19"
            fill="none"
            stroke={fill}
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Ellipse
            cx="8"
            cy="51"
            rx="8"
            ry="6"
            fill={fill}
            transform="rotate(-20 8 51)"
          />
          <Ellipse
            cx="34"
            cy="45"
            rx="8"
            ry="6"
            fill={fill}
            transform="rotate(-20 34 45)"
          />
          <Path
            d="M15 18 L37 13"
            fill="none"
            stroke="#FFFFFF"
            strokeOpacity="0.42"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </>
      ) : (
        <>
          <Path
            d="M29 45 V11 C38 13 43 18 43 26 C39 22 35 20 29 20"
            fill="none"
            stroke={fill}
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Ellipse
            cx="21"
            cy="47"
            rx="10"
            ry="7"
            fill={fill}
            transform="rotate(-22 21 47)"
          />
          <Path
            d="M31 13 C36 15 39 18 40 21"
            fill="none"
            stroke="#FFFFFF"
            strokeOpacity="0.44"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </>
      )}
    </Svg>
  );
}

export const StartupSplashView = React.memo(function StartupSplashPresentation({
  startup,
  theme,
  accent,
}: StartupSplashViewProps) {
  const [present, setPresent] = useState(startup.visible);
  const [retired, setRetired] = useState(false);
  const splashOpacity = useRef(new Animated.Value(startup.visible ? 1 : 0)).current,
    breath = useRef(new Animated.Value(0)).current,
    drift = useRef(new Animated.Value(0)).current,
    shimmer = useRef(new Animated.Value(0)).current,
    noteFar = useRef(new Animated.Value(0)).current,
    noteMid = useRef(new Animated.Value(0)).current,
    noteNear = useRef(new Animated.Value(0)).current,
    noteSide = useRef(new Animated.Value(0)).current,
    progressMotion = useRef(
      new Animated.Value(Math.max(0, Math.min(1, startup.progress))),
    ).current,
    palette = STARTUP_PALETTES[theme];

  useEffect(() => {
    if (!present || retired) return;
    if (startup.visible) {
      splashOpacity.setValue(1);
      return;
    }
    const finish = Animated.timing(splashOpacity, {
      toValue: 0,
      duration: STARTUP_TRANSITION_MS,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
      isInteraction: false,
    });
    let active = true;
    finish.start(({ finished }) => {
      if (active && finished) setRetired(true);
    });
    return () => {
      active = false;
      finish.stop();
    };
  }, [present, retired, splashOpacity, startup.visible]);

  useEffect(() => {
    if (!present || !retired) return;
    // Commit the non-animated parent's hard hide before disconnecting native
    // opacity nodes. This cleanup never delays the Home/playback handoff.
    let detachFrame: number | undefined;
    const hiddenFrame = requestAnimationFrame(() => {
      detachFrame = requestAnimationFrame(() => setPresent(false));
    });
    return () => {
      cancelAnimationFrame(hiddenFrame);
      if (detachFrame !== undefined) cancelAnimationFrame(detachFrame);
    };
  }, [present, retired]);

  useEffect(() => {
    if (!present || retired || !startup.visible) return;
    breath.setValue(0);
    drift.setValue(0);
    shimmer.setValue(0);
    noteFar.setValue(0);
    noteMid.setValue(0);
    noteNear.setValue(0);
    noteSide.setValue(0);
    const bounce = (
      value: Animated.Value,
      delay: number,
      rise: number,
      settle: number,
    ) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(value, {
            toValue: 1,
            duration: rise,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
            isInteraction: false,
          }),
          Animated.timing(value, {
            toValue: 0,
            duration: settle,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
            isInteraction: false,
          }),
          Animated.delay(540),
        ]),
      );
    const ambientMotion = Animated.parallel([
      Animated.loop(
        Animated.sequence([
          Animated.timing(breath, {
            toValue: 1,
            duration: 2400,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
            isInteraction: false,
          }),
          Animated.timing(breath, {
            toValue: 0,
            duration: 2400,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
            isInteraction: false,
          }),
        ]),
      ),
      Animated.loop(
        Animated.timing(shimmer, {
          toValue: 1,
          duration: 3200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
          isInteraction: false,
        }),
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(drift, {
            toValue: 1,
            duration: 7000,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
            isInteraction: false,
          }),
          Animated.timing(drift, {
            toValue: 0,
            duration: 7000,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
            isInteraction: false,
          }),
        ]),
      ),
      bounce(noteFar, 180, 460, 680),
      bounce(noteMid, 520, 520, 720),
      bounce(noteNear, 860, 560, 760),
      bounce(noteSide, 1180, 500, 700),
    ]);
    ambientMotion.start();
    return () => ambientMotion.stop();
  }, [
    breath,
    drift,
    noteFar,
    noteMid,
    noteNear,
    noteSide,
    present,
    retired,
    shimmer,
    startup.visible,
  ]);

  useEffect(() => {
    if (!present || retired) return;
    const animation = Animated.spring(progressMotion, {
      toValue: Math.max(0, Math.min(1, startup.progress)),
      stiffness: 72,
      damping: 20,
      mass: 0.82,
      overshootClamping: true,
      restDisplacementThreshold: 0.001,
      restSpeedThreshold: 0.001,
      useNativeDriver: true,
      isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [present, retired, progressMotion, startup.progress]);

  const visualField = useMemo(
    () => (
      <>
        <Svg
          pointerEvents="none"
          width="100%"
          height="100%"
          viewBox="0 0 420 900"
          preserveAspectRatio="xMidYMid slice"
          style={StyleSheet.absoluteFill}
        >
          <Defs>
            <LinearGradient id="sonicBackdrop" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={palette.sky} />
              <Stop offset="34%" stopColor="#FFFFFF" />
              <Stop offset="68%" stopColor={palette.background} />
              <Stop offset="100%" stopColor={palette.sky} />
            </LinearGradient>
            <RadialGradient id="sonicCore" cx="50%" cy="44%" r="50%">
              <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.96" />
              <Stop
                offset="44%"
                stopColor={palette.streamAlt}
                stopOpacity="0.07"
              />
              <Stop
                offset="100%"
                stopColor={palette.background}
                stopOpacity="0"
              />
            </RadialGradient>
          </Defs>
          <Rect width="420" height="900" fill="url(#sonicBackdrop)" />
          <Circle cx="210" cy="382" r="286" fill="url(#sonicCore)" />
        </Svg>

        <Animated.View
          testID="startup-ambient-orb-top"
          pointerEvents="none"
          style={[
            styles.ambientOrb,
            styles.ambientOrbTop,
            {
              transform: [
                {
                  translateX: drift.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-8, 8],
                  }),
                },
                {
                  translateY: drift.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-5, 7],
                  }),
                },
                {
                  scale: breath.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.99, 1.025],
                  }),
                },
              ],
            },
          ]}
        >
          <Animated.Image
            source={require('../assets/startup-orb-glass-v2.png')}
            style={styles.ambientOrbImage}
            resizeMode="contain"
            resizeMethod="resize"
            fadeDuration={0}
          />
        </Animated.View>

        <Animated.View
          testID="startup-ambient-orb-side"
          pointerEvents="none"
          style={[
            styles.ambientOrb,
            styles.ambientOrbSide,
            {
              transform: [
                {
                  translateX: drift.interpolate({
                    inputRange: [0, 1],
                    outputRange: [8, -7],
                  }),
                },
                {
                  translateY: drift.interpolate({
                    inputRange: [0, 1],
                    outputRange: [6, -8],
                  }),
                },
                {
                  scale: breath.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1.015, 0.99],
                  }),
                },
              ],
            },
          ]}
        >
          <Animated.Image
            source={require('../assets/startup-orb-glass-v2.png')}
            style={[styles.ambientOrbImage, styles.ambientOrbSideImage]}
            resizeMode="contain"
            resizeMethod="resize"
            fadeDuration={0}
          />
        </Animated.View>

        <Animated.View
          testID="startup-flowing-ribbons"
          pointerEvents="none"
          style={[
            styles.ribbonStage,
            {
              transform: [
                {
                  translateX: drift.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-14, 10],
                  }),
                },
                {
                  translateY: breath.interpolate({
                    inputRange: [0, 1],
                    outputRange: [5, -4],
                  }),
                },
                {
                  scaleX: drift.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1.01, 1.045],
                  }),
                },
              ],
            },
          ]}
        >
          <Animated.Image
            source={require('../assets/startup-ribbon-glass-v2.png')}
            style={styles.ribbonImage}
            resizeMode="contain"
            resizeMethod="resize"
            fadeDuration={0}
          />
        </Animated.View>

        <Animated.View
          testID="startup-light-stream-primary"
          pointerEvents="none"
          style={[
            styles.lightStream,
            styles.lightStreamPrimary,
            { backgroundColor: palette.stream },
            {
              transform: [
                {
                  translateX: drift.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-28, 18],
                  }),
                },
                {
                  translateY: drift.interpolate({
                    inputRange: [0, 1],
                    outputRange: [8, -6],
                  }),
                },
                {
                  rotate: drift.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['-8deg', '-6deg'],
                  }),
                },
              ],
            },
          ]}
        >
          <Animated.View
            style={[
              styles.streamGlint,
              styles.streamGlintPrimary,
              {
                transform: [
                  {
                    translateX: shimmer.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-180, 540],
                    }),
                  },
                ],
              },
            ]}
          />
        </Animated.View>

        <Animated.View
          testID="startup-light-stream-secondary"
          pointerEvents="none"
          style={[
            styles.lightStream,
            styles.lightStreamSecondary,
            { backgroundColor: palette.streamAlt },
            {
              transform: [
                {
                  translateX: drift.interpolate({
                    inputRange: [0, 1],
                    outputRange: [18, -20],
                  }),
                },
                {
                  translateY: drift.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-6, 9],
                  }),
                },
                {
                  rotate: drift.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['7deg', '5deg'],
                  }),
                },
              ],
            },
          ]}
        >
          <Animated.View
            style={[
              styles.streamGlint,
              styles.streamGlintSecondary,
              {
                transform: [
                  {
                    translateX: shimmer.interpolate({
                      inputRange: [0, 1],
                      outputRange: [480, -180],
                    }),
                  },
                ],
              },
            ]}
          />
        </Animated.View>

        <Animated.View
          testID="startup-note-far"
          accessibilityElementsHidden
          style={[
            styles.spatialNote,
            styles.spatialNoteFar,
            {
              transform: [
                {
                  translateY: noteFar.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -6],
                  }),
                },
                {
                  scale: noteFar.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.98, 1.015],
                  }),
                },
              ],
            },
          ]}
        >
          <GradientMusicNote gradientId="noteFarGradient" accent={accent} />
        </Animated.View>
        <Animated.View
          testID="startup-note-mid"
          accessibilityElementsHidden
          style={[
            styles.spatialNote,
            styles.spatialNoteMid,
            {
              transform: [
                {
                  translateY: noteMid.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -8],
                  }),
                },
                {
                  scale: noteMid.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.985, 1.02],
                  }),
                },
              ],
            },
          ]}
        >
          <GradientMusicNote
            gradientId="noteMidGradient"
            accent={accent}
            double
          />
        </Animated.View>
        <Animated.View
          testID="startup-note-near"
          accessibilityElementsHidden
          style={[
            styles.spatialNote,
            styles.spatialNoteNear,
            {
              transform: [
                {
                  translateY: noteNear.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -10],
                  }),
                },
                {
                  scale: noteNear.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.985, 1.025],
                  }),
                },
              ],
            },
          ]}
        >
          <GradientMusicNote gradientId="noteNearGradient" accent={accent} />
        </Animated.View>
        <Animated.View
          testID="startup-note-side"
          accessibilityElementsHidden
          style={[
            styles.spatialNote,
            styles.spatialNoteSide,
            {
              transform: [
                {
                  translateY: noteSide.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -7],
                  }),
                },
                {
                  scale: noteSide.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.98, 1.018],
                  }),
                },
              ],
            },
          ]}
        >
          <GradientMusicNote
            gradientId="noteSideGradient"
            accent={accent}
            double
          />
        </Animated.View>

        <View
          testID="startup-planet-halo-back"
          pointerEvents="none"
          style={[styles.haloStage, styles.haloBack]}
        >
          <Svg width="340" height="340" viewBox="0 0 340 340">
            <Defs>
              <RadialGradient id="haloEnergy" cx="48%" cy="45%" r="54%">
                <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.88" />
                <Stop offset="56%" stopColor="#DCEEFF" stopOpacity="0.34" />
                <Stop offset="78%" stopColor={accent} stopOpacity="0.08" />
                <Stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
              </RadialGradient>
              <LinearGradient
                id="orbitBackGradient"
                x1="0"
                y1="0"
                x2="1"
                y2="1"
              >
                <Stop offset="0%" stopColor="#67D9FF" />
                <Stop offset="55%" stopColor={accent} />
                <Stop offset="100%" stopColor="#BD91FF" />
              </LinearGradient>
            </Defs>
            <Circle cx="170" cy="170" r="126" fill="url(#haloEnergy)" />
            <Circle
              cx="170"
              cy="170"
              r="112"
              fill="none"
              stroke="#FFFFFF"
              strokeOpacity={palette.dark ? 0.24 : 0.64}
              strokeWidth="12"
            />
            <Circle
              cx="170"
              cy="170"
              r="96"
              fill="none"
              stroke={palette.streamAlt}
              strokeOpacity="0.12"
              strokeWidth="1.4"
            />
            <G transform="rotate(-16 170 170)">
              <Ellipse
                cx="170"
                cy="170"
                rx="142"
                ry="60"
                fill="none"
                stroke="url(#orbitBackGradient)"
                strokeOpacity="0.18"
                strokeWidth="7"
              />
              <Ellipse
                cx="170"
                cy="170"
                rx="142"
                ry="60"
                fill="none"
                stroke="#FFFFFF"
                strokeOpacity={palette.dark ? 0.58 : 0.72}
                strokeWidth="2.2"
              />
            </G>
            <G transform="rotate(12 170 170)">
              <Ellipse
                cx="170"
                cy="170"
                rx="154"
                ry="92"
                fill="none"
                stroke={palette.streamAlt}
                strokeOpacity="0.1"
                strokeWidth="1.2"
              />
            </G>
          </Svg>
        </View>

        <Animated.View
          testID="startup-logo-cutout"
          pointerEvents="none"
          renderToHardwareTextureAndroid
          style={[
            styles.logoNucleus,
            {
              shadowColor: accent,
              transform: [
                {
                  scale: breath.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.996, 1.008],
                  }),
                },
              ],
            },
          ]}
        >
          <Animated.Image
            source={require('../assets/app-logo-cutout.png')}
            style={styles.splashLogo}
            resizeMode="contain"
            resizeMethod="resize"
            fadeDuration={0}
          />
        </Animated.View>

        <View
          testID="startup-planet-halo-front"
          pointerEvents="none"
          style={[styles.haloStage, styles.haloFront]}
        >
          <Svg width="340" height="340" viewBox="0 0 340 340">
            <Defs>
              <LinearGradient
                id="orbitFrontGradient"
                x1="0"
                y1="0"
                x2="1"
                y2="1"
              >
                <Stop offset="0%" stopColor="#6BDFFF" />
                <Stop offset="55%" stopColor={accent} />
                <Stop offset="100%" stopColor="#D29CFF" />
              </LinearGradient>
            </Defs>
            <G transform="rotate(-16 170 170)">
              <Path
                d="M28 170 C28 203 92 230 170 230 C248 230 312 203 312 170"
                fill="none"
                stroke="url(#orbitFrontGradient)"
                strokeOpacity="0.16"
                strokeWidth="7"
                strokeLinecap="round"
              />
              <Path
                d="M28 170 C28 203 92 230 170 230 C248 230 312 203 312 170"
                fill="none"
                stroke="url(#orbitFrontGradient)"
                strokeOpacity="0.76"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </G>
          </Svg>
        </View>
      </>
    ),
    [
      accent,
      breath,
      drift,
      noteFar,
      noteMid,
      noteNear,
      noteSide,
      palette,
      shimmer,
    ],
  );

  // Retire the native overlay after its one exit; Home/playback updates must
  // never keep a transparent, highest-z-index launch surface attached.
  if (!present) return null;
  return (
    <View
      testID="startup-splash-guard"
      collapsable={false}
      pointerEvents={startup.visible && !retired ? 'auto' : 'none'}
      style={[styles.splash, { opacity: retired ? 0 : 1 }]}
    >
    <Animated.View
      testID="startup-splash"
      nativeID="liuliu-startup-splash"
      collapsable={false}
      accessibilityLabel={`应用启动中，${startup.label}`}
      pointerEvents={startup.visible ? 'auto' : 'none'}
      style={[
        styles.splash,
        { opacity: splashOpacity, backgroundColor: palette.background },
      ]}
    >
      {visualField}

      <View style={styles.brandBlock}>
        <View testID="startup-slogan-lockup" style={styles.sloganLockup}>
          <Text
            testID="startup-slogan"
            numberOfLines={1}
            style={[styles.slogan, { color: accent }]}
          >
            音乐，让生活更美好
          </Text>
          <View style={styles.sloganLines}>
            <View
              testID="startup-slogan-line-long"
              style={[
                styles.sloganLine,
                styles.sloganLineLong,
                { backgroundColor: accent },
              ]}
            />
            <View
              testID="startup-slogan-line-short"
              style={[
                styles.sloganLine,
                styles.sloganLineShort,
                { backgroundColor: accent },
              ]}
            />
          </View>
        </View>
      </View>

      <View testID="startup-progress-cluster" style={styles.progressCluster}>
        <Text
          testID="startup-stage-label"
          numberOfLines={1}
          style={[styles.stageLabel, { color: palette.muted }]}
        >
          {startup.label}
        </Text>
        <Animated.View
          testID="startup-progress-track"
          accessibilityRole="progressbar"
          accessibilityLabel={startup.label}
          style={[styles.progressTrack, { backgroundColor: palette.track }]}
        >
          <Animated.View
            style={[
              styles.progressFill,
              {
                backgroundColor: accent,
                transform: [{ scaleX: progressMotion }],
              },
            ]}
          />
        </Animated.View>
      </View>
    </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  splash: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1000,
    alignItems: 'center',
    overflow: 'hidden',
  },
  ambientOrb: {
    position: 'absolute',
    zIndex: 0,
    opacity: 0.28,
  },
  ambientOrbTop: {
    top: -82,
    left: -86,
    width: 240,
    height: 240,
  },
  ambientOrbSide: {
    top: '60%',
    right: -92,
    width: 220,
    height: 220,
    opacity: 0.18,
  },
  ambientOrbImage: {
    width: '100%',
    height: '100%',
  },
  ambientOrbSideImage: {
    transform: [{ rotate: '168deg' }],
  },
  ribbonStage: {
    position: 'absolute',
    bottom: -20,
    left: -50,
    zIndex: 0,
    width: 520,
    height: 220,
    opacity: 0.3,
  },
  ribbonImage: {
    width: '100%',
    height: '100%',
  },
  lightStream: {
    position: 'absolute',
    zIndex: 1,
    width: 520,
    height: 2,
    overflow: 'hidden',
    borderRadius: 99,
  },
  lightStreamPrimary: { top: '77%', left: -74, opacity: 0.24 },
  lightStreamSecondary: {
    top: '84%',
    left: -26,
    width: 480,
    height: 1,
    opacity: 0.16,
  },
  streamGlint: {
    width: 96,
    height: '100%',
    borderRadius: 99,
    backgroundColor: '#FFFFFF',
  },
  streamGlintPrimary: { opacity: 0.64 },
  streamGlintSecondary: { opacity: 0.46 },
  spatialNote: {
    position: 'absolute',
    zIndex: 2,
  },
  spatialNoteFar: {
    top: '14%',
    left: '12%',
    width: 20,
    height: 28,
    opacity: 0.2,
  },
  spatialNoteMid: {
    top: '23%',
    right: '8%',
    width: 38,
    height: 52,
    opacity: 0.62,
  },
  spatialNoteNear: {
    top: '39%',
    left: '8%',
    width: 36,
    height: 50,
    opacity: 0.56,
  },
  spatialNoteSide: {
    top: '61%',
    right: '14%',
    width: 21,
    height: 30,
    opacity: 0.18,
  },
  haloStage: {
    position: 'absolute',
    top: '20%',
    width: 340,
    height: 340,
  },
  haloBack: { zIndex: 1 },
  haloFront: { zIndex: 4 },
  logoNucleus: {
    position: 'absolute',
    top: '29%',
    zIndex: 3,
    width: 176,
    height: 176,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
  },
  splashLogo: { width: 172, height: 172 },
  brandBlock: {
    position: 'absolute',
    top: '58%',
    right: 0,
    left: 0,
    alignItems: 'center',
  },
  sloganLockup: {
    width: '100%',
    alignItems: 'center',
    transform: [{ rotate: '-5deg' }],
  },
  slogan: {
    fontSize: 22,
    lineHeight: 32,
    fontFamily: 'MaShanZheng-Regular',
    fontWeight: '400',
    letterSpacing: 1.2,
    textAlign: 'center',
    includeFontPadding: false,
  },
  sloganLines: {
    width: 148,
    marginTop: 10,
    alignItems: 'flex-end',
  },
  sloganLine: {
    height: 1,
    borderRadius: 2,
  },
  sloganLineLong: {
    width: 148,
    opacity: 0.74,
  },
  sloganLineShort: {
    width: 54,
    marginTop: 6,
    marginRight: 10,
    opacity: 0.34,
  },
  progressCluster: {
    position: 'absolute',
    right: 44,
    bottom: 64,
    left: 44,
    alignItems: 'center',
  },
  stageLabel: {
    width: '100%',
    marginBottom: 13,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'sans-serif',
    fontWeight: '400',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  progressTrack: {
    width: 224,
    height: 3,
    overflow: 'hidden',
    borderRadius: 4,
  },
  progressFill: {
    width: '100%',
    height: '100%',
    borderRadius: 4,
    transformOrigin: 'left center',
  },
});
