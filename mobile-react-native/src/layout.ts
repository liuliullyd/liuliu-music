export const DESIGN_WIDTH = 420;
export const BOTTOM_NAV_HEIGHT = 58;
// Shared lift keeps the full-width navigation and mini-player aligned.
export const BOTTOM_NAV_LIFT = 12;
/** One logical pixel of overlap prevents scaled rounding from exposing a seam. */
export const BOTTOM_NAV_SEAM_OVERLAP = 1;
export const HOME_TOP_NAV_HEIGHT = 70;

/**
 * Logical Android DP tokens.  The outer canvas scales these values to the
 * current window; no physical resolution is a layout breakpoint.
 */
export const LAYOUT_TOKENS = {
  canvas: { width: DESIGN_WIDTH, nominalHeight: 720 },
  page: {
    horizontalPadding: 22,
    topPadding: 8,
    sectionGap: 18,
    scrollBottomPadding: 20,
  },
  header: { height: 76, buttonSize: 48 },
  topNavigation: {
    height: 70,
    horizontalPadding: 26,
    buttonSize: 49,
    labelFontSize: 20,
  },
  list: { rowHeight: 62, coverSize: 52 },
  bottomNavigation: {
    height: BOTTOM_NAV_HEIGHT,
    lift: BOTTOM_NAV_LIFT,
    playerSize: 46,
    labelFontSize: 18,
  },
  miniPlayer: {
    height: 52,
    coverSize: 58,
    actionWidth: 40,
    actionHeight: 44,
    titleFontSize: 13,
    titleLineHeight: 18,
    artistFontSize: 11,
    artistLineHeight: 15,
    progressHeight: 1.5,
  },
  player: {
    coverMin: 190,
    coverMax: DESIGN_WIDTH - 52,
    headerHeight: 60,
    headerHorizontalPadding: 26,
    headerButtonSize: 40,
    coverTopGap: 14,
    songMarginTop: 24,
    lyricMarginTop: 16,
    lyricFontSize: 18,
    lyricLineHeight: 26,
    lyricLineGap: 8,
    titleFontSize: 22,
    titleLineHeight: 28,
    artistFontSize: 16,
    artistLineHeight: 21,
    artistMarginTop: 6,
    artistToActionGap: 33,
    actionBottom: 52,
    // Keep the progress hit target above the lifted bottom navigation. The
    // player screen is stacked above the nav, so this gap is part of the
    // shared player geometry rather than an overlay-only offset.
    progressBottom: 20,
    actionSize: 38,
    actionScale: 1.22,
  },
} as const;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const responsive = (
  base: number,
  ratio: number,
  minimum: number,
  maximum: number,
  exponent = 1,
) => clamp(base * Math.pow(ratio, exponent), minimum, maximum);

const playerGeometryForHeight = (
  designHeight: number,
  actionScale: number,
  bottomNavHeight: number,
) => {
  const player = LAYOUT_TOKENS.player;
  const actionHeight = player.actionSize * actionScale;
  const actionTop =
    designHeight - bottomNavHeight - player.actionBottom - actionHeight;
  const artistBlockHeight =
    player.titleLineHeight + player.artistMarginTop + player.artistLineHeight;
  const minimumLyricHeight = 2 * player.lyricLineHeight + player.lyricLineGap;
  // The cover gets the remaining space after all fixed DP relationships have
  // been reserved.  It never uses a device-specific reference height.
  const coverFit =
    actionTop -
    player.artistToActionGap -
    (player.headerHeight +
      player.coverTopGap +
      player.lyricMarginTop +
      player.songMarginTop +
      artistBlockHeight +
      minimumLyricHeight);
  const coverSize = Math.round(
    clamp(coverFit, player.coverMin, player.coverMax),
  );
  const artistBeforeLyrics =
    player.headerHeight +
    player.coverTopGap +
    coverSize +
    player.lyricMarginTop +
    player.songMarginTop +
    artistBlockHeight;
  const availableHeight = Math.max(
    minimumLyricHeight,
    actionTop - player.artistToActionGap - artistBeforeLyrics,
  );
  const lineCount = Math.max(
    2,
    Math.floor(
      (availableHeight + player.lyricLineGap) /
        (player.lyricLineHeight + player.lyricLineGap),
    ),
  );
  return {
    coverSize,
    headerHeight: player.headerHeight,
    lineCount,
    lyricHeight: availableHeight,
  };
};

export type HomeLayoutMetrics = {
  sectionMarginTop: number;
  playlistCount: number;
  playlistCardWidth: number;
  playlistImageHeight: number;
  playlistFooterHeight: number;
  playlistHeight: number;
  rankingCount: number;
  rankingHeight: number;
  rankingRowHeight: number;
  releaseRows: number;
  releaseCardWidth: number;
  releaseHeight: number;
  releaseCardHeight: number;
  releaseCoverSize: number;
};

export type AdaptivePageMetrics = {
  scale: number;
  density: 'tight' | 'compact' | 'full';
  tokens: typeof LAYOUT_TOKENS;
  pageHorizontalPadding: number;
  pageTopPadding: number;
  sectionGap: number;
  headerButtonSize: number;
  homeTopNavigationHeight: number;
  homeTopNavigationPadding: number;
  homeTopNavigationButtonSize: number;
  homeTopNavigationFontSize: number;
  scrollBottomPadding: number;
  headerHeight: number;
  trackRowHeight: number;
  trackCoverSize: number;
  searchHotCount: number;
  searchCategoryCardHeight: number;
  detailHeroHeight: number;
  collectionHeroHeight: number;
  libraryPlaylistCount: number;
  libraryRecentCount: number;
  libraryPlaylistCardWidth: number;
  libraryPlaylistCoverHeight: number;
  libraryCollectionRowHeight: number;
  libraryTitleHeight: number;
  librarySectionMarginTop: number;
  libraryPlaylistTopPadding: number;
  settingsRowHeight: number;
  bottomNavHeight: number;
  bottomNavLift: number;
  bottomNavPlayerSize: number;
  bottomNavLabelFontSize: number;
  miniPlayerHeight: number;
  miniPlayerCoverSize: number;
  miniPlayerActionWidth: number;
  miniPlayerActionHeight: number;
  miniPlayerTitleFontSize: number;
  miniPlayerTitleLineHeight: number;
  miniPlayerArtistFontSize: number;
  miniPlayerArtistLineHeight: number;
  miniPlayerProgressHeight: number;
  playerCoverSize: number;
  playerHeaderHeight: number;
  playerHeaderHorizontalPadding: number;
  playerHeaderButtonSize: number;
  playerCoverTopGap: number;
  playerSongMarginTop: number;
  playerControlsHeight: number;
  playerToolsHeight: number;
  playerTitleFontSize: number;
  playerTitleLineHeight: number;
  playerArtistFontSize: number;
  playerArtistLineHeight: number;
  playerArtistMarginTop: number;
  playerLyricFontSize: number;
  playerLyricLineHeight: number;
  playerLyricMarginTop: number;
  playerLyricLines: number;
  playerLyricHeight: number;
  playerLyricLineGap: number;
  playerActionBottom: number;
  playerProgressBottom: number;
  playerActionScale: number;
};

/** Shared responsive contract for every non-Home Android surface. */
export const adaptivePageMetrics = (
  designHeight: number,
  scale = 1,
): AdaptivePageMetrics => {
  const ratio = Math.max(
    0.5,
    designHeight / LAYOUT_TOKENS.canvas.nominalHeight,
  );
  const density = ratio < 0.972 ? 'tight' : ratio < 1.167 ? 'compact' : 'full';
  const playerActionScale = responsive(
    LAYOUT_TOKENS.player.actionScale,
    ratio,
    1.08,
    1.38,
    0.4,
  );
  const bottomNavHeight = Math.round(
    responsive(LAYOUT_TOKENS.bottomNavigation.height, ratio, 52, 64, 0.2),
  );
  const playerGeometry = playerGeometryForHeight(
    designHeight,
    playerActionScale,
    bottomNavHeight,
  );
  const libraryPlaylistCardWidth = Math.round(
    responsive(98, ratio, 92, 121, 0.25),
  );
  return {
    scale,
    density,
    tokens: LAYOUT_TOKENS,
    pageHorizontalPadding: LAYOUT_TOKENS.page.horizontalPadding,
    pageTopPadding: LAYOUT_TOKENS.page.topPadding,
    sectionGap: LAYOUT_TOKENS.page.sectionGap,
    headerButtonSize: LAYOUT_TOKENS.header.buttonSize,
    homeTopNavigationHeight: Math.round(
      responsive(LAYOUT_TOKENS.topNavigation.height, ratio, 62, 82, 0.25),
    ),
    homeTopNavigationPadding: Math.round(
      responsive(
        LAYOUT_TOKENS.topNavigation.horizontalPadding,
        ratio,
        20,
        30,
        0.2,
      ),
    ),
    homeTopNavigationButtonSize: Math.round(
      responsive(LAYOUT_TOKENS.topNavigation.buttonSize, ratio, 44, 54, 0.2),
    ),
    homeTopNavigationFontSize: Math.round(
      responsive(
        LAYOUT_TOKENS.topNavigation.labelFontSize,
        ratio,
        18,
        22,
        0.15,
      ),
    ),
    scrollBottomPadding: Math.round(
      responsive(LAYOUT_TOKENS.page.scrollBottomPadding, ratio, 12, 28, 0.35),
    ),
    headerHeight: Math.round(
      responsive(LAYOUT_TOKENS.header.height, ratio, 70, 82, 0.25),
    ),
    trackRowHeight: Math.round(
      responsive(LAYOUT_TOKENS.list.rowHeight, ratio, 54, 62, 0.16),
    ),
    trackCoverSize: Math.round(
      responsive(LAYOUT_TOKENS.list.coverSize, ratio, 44, 52, 0.16),
    ),
    searchHotCount: Math.round(clamp(4 + (ratio - 1) * 6, 3, 10)),
    searchCategoryCardHeight: Math.round(responsive(80, ratio, 72, 88, 0.2)),
    detailHeroHeight: Math.round(responsive(260, ratio, 230, 350, 0.65)),
    collectionHeroHeight: Math.round(responsive(220, ratio, 200, 280, 0.55)),
    libraryPlaylistCount: Math.round(
      clamp(2 + Math.max(0, ratio - 1) * 4, 2, 6),
    ),
    libraryRecentCount: Math.round(clamp(3 + Math.max(0, ratio - 1) * 5, 3, 8)),
    libraryPlaylistCardWidth,
    libraryPlaylistCoverHeight: Math.round(
      libraryPlaylistCardWidth *
        clamp(1 - Math.max(0, ratio - 1) * 0.06, 0.94, 1),
    ),
    libraryCollectionRowHeight: Math.round(responsive(60, ratio, 51, 60, 0.15)),
    libraryTitleHeight: Math.round(
      clamp(78 - Math.max(0, ratio - 1) * 10, 65, 78),
    ),
    librarySectionMarginTop: Math.round(
      clamp(19 - Math.max(0, ratio - 1) * 10, 9, 19),
    ),
    libraryPlaylistTopPadding: Math.round(
      clamp(10 - Math.max(0, ratio - 1) * 8, 0, 10),
    ),
    settingsRowHeight: Math.round(responsive(60, ratio, 54, 60, 0.12)),
    bottomNavHeight,
    bottomNavLift: Math.round(
      responsive(LAYOUT_TOKENS.bottomNavigation.lift, ratio, 10, 14, 0.2),
    ),
    bottomNavPlayerSize: Math.round(
      responsive(LAYOUT_TOKENS.bottomNavigation.playerSize, ratio, 42, 52, 0.2),
    ),
    bottomNavLabelFontSize: Math.round(
      responsive(
        LAYOUT_TOKENS.bottomNavigation.labelFontSize,
        ratio,
        16,
        20,
        0.15,
      ),
    ),
    miniPlayerHeight: Math.round(
      responsive(LAYOUT_TOKENS.miniPlayer.height, ratio, 48, 60, 0.25),
    ),
    miniPlayerCoverSize: Math.round(
      responsive(LAYOUT_TOKENS.miniPlayer.coverSize, ratio, 52, 64, 0.25),
    ),
    miniPlayerActionWidth: Math.round(
      responsive(LAYOUT_TOKENS.miniPlayer.actionWidth, ratio, 36, 46, 0.2),
    ),
    miniPlayerActionHeight: Math.round(
      responsive(LAYOUT_TOKENS.miniPlayer.actionHeight, ratio, 40, 50, 0.2),
    ),
    miniPlayerTitleFontSize: Math.round(
      responsive(LAYOUT_TOKENS.miniPlayer.titleFontSize, ratio, 12, 15, 0.15),
    ),
    miniPlayerTitleLineHeight: Math.round(
      responsive(LAYOUT_TOKENS.miniPlayer.titleLineHeight, ratio, 16, 20, 0.15),
    ),
    miniPlayerArtistFontSize: Math.round(
      responsive(LAYOUT_TOKENS.miniPlayer.artistFontSize, ratio, 10, 13, 0.15),
    ),
    miniPlayerArtistLineHeight: Math.round(
      responsive(
        LAYOUT_TOKENS.miniPlayer.artistLineHeight,
        ratio,
        13,
        17,
        0.15,
      ),
    ),
    miniPlayerProgressHeight: responsive(
      LAYOUT_TOKENS.miniPlayer.progressHeight,
      ratio,
      1,
      2,
      0.15,
    ),
    playerCoverSize: playerGeometry.coverSize,
    playerHeaderHeight: playerGeometry.headerHeight,
    playerHeaderHorizontalPadding: LAYOUT_TOKENS.player.headerHorizontalPadding,
    playerHeaderButtonSize: Math.round(
      responsive(LAYOUT_TOKENS.player.headerButtonSize, ratio, 36, 44, 0.2),
    ),
    playerCoverTopGap: LAYOUT_TOKENS.player.coverTopGap,
    playerSongMarginTop: LAYOUT_TOKENS.player.songMarginTop,
    playerControlsHeight: Math.round(responsive(76, ratio, 68, 104, 0.4)),
    playerToolsHeight: Math.round(responsive(62, ratio, 54, 62, 0.15)),
    playerTitleFontSize: LAYOUT_TOKENS.player.titleFontSize,
    playerTitleLineHeight: LAYOUT_TOKENS.player.titleLineHeight,
    playerArtistFontSize: LAYOUT_TOKENS.player.artistFontSize,
    playerArtistLineHeight: LAYOUT_TOKENS.player.artistLineHeight,
    playerArtistMarginTop: LAYOUT_TOKENS.player.artistMarginTop,
    playerLyricFontSize: LAYOUT_TOKENS.player.lyricFontSize,
    playerLyricLineHeight: LAYOUT_TOKENS.player.lyricLineHeight,
    playerLyricMarginTop: LAYOUT_TOKENS.player.lyricMarginTop,
    playerLyricLines: playerGeometry.lineCount,
    playerLyricHeight: playerGeometry.lyricHeight,
    playerLyricLineGap: LAYOUT_TOKENS.player.lyricLineGap,
    playerActionBottom: LAYOUT_TOKENS.player.actionBottom,
    playerProgressBottom: LAYOUT_TOKENS.player.progressBottom,
    playerActionScale,
  };
};

/**
 * Distribute the visible Home space between its three content modules. Item
 * Chart counts follow available height. New releases always occupy three rows;
 * remaining releases are available by swiping horizontally.
 */
export const homeLayoutMetrics = (designHeight: number): HomeLayoutMetrics => {
  const ratio = Math.max(
    0.5,
    designHeight / LAYOUT_TOKENS.canvas.nominalHeight,
  );
  const bottomNavHeight = responsive(
    LAYOUT_TOKENS.bottomNavigation.height,
    ratio,
    52,
    64,
    0.2,
  );
  const screenHeight = Math.max(560, designHeight - bottomNavHeight);
  const sectionMarginTop = Math.round(responsive(4, ratio, 0, 8, 0.35));
  const playlistImageHeight = Math.round(responsive(97, ratio, 82, 145, 0.55));
  const playlistFooterHeight = Math.round(responsive(42, ratio, 40, 46, 0.3));
  const playlistHeight = playlistImageHeight + playlistFooterHeight + 12;
  const playlistCardWidth = Math.round(responsive(211, ratio, 200, 258, 0.45));
  const playlistCount = Math.round(
    clamp(5 + Math.max(0, ratio - 1) * 2.5, 5, 8),
  );
  const releaseRows = 3;
  // Keep the next three-row column close enough to preview on narrow screens.
  const releaseCardWidth = 264;
  const releaseCardHeight = Math.round(responsive(58, ratio, 56, 62, 0.2));
  const releaseCoverSize = releaseCardHeight - 4;
  const releaseHeight =
    8 + 27 + 4 + releaseRows * releaseCardHeight + (releaseRows - 1) * 6;
  const rankingHeight = Math.max(
    156,
    Math.round(
      screenHeight -
        HOME_TOP_NAV_HEIGHT -
        27 -
        playlistHeight -
        releaseHeight -
        sectionMarginTop -
        23,
    ),
  );
  const rankingCount = Math.round(
    clamp(Math.floor((rankingHeight - 66) / 36), 3, 8),
  );
  const rankingRowHeight = (rankingHeight - 66) / rankingCount;
  return {
    sectionMarginTop,
    playlistCount,
    playlistCardWidth,
    playlistImageHeight,
    playlistFooterHeight,
    playlistHeight,
    rankingCount,
    rankingHeight,
    rankingRowHeight,
    releaseRows,
    releaseCardWidth,
    releaseHeight,
    releaseCardHeight,
    releaseCoverSize,
  };
};

/**
 * Fill the available width with the approved composition. The virtual height
 * follows the real aspect ratio, so taller windows reveal more scroll content
 * and shorter windows reveal less without clipping or reflowing components.
 */
export const fluidCanvasMetrics = (
  windowWidth: number,
  windowHeight: number,
  insetTop = 0,
  insetBottom = 0,
  insetLeft = 0,
  insetRight = 0,
) => {
  const availableWidth = Math.max(1, windowWidth - insetLeft - insetRight);
  const availableHeight = Math.max(1, windowHeight - insetTop - insetBottom);
  const scale = availableWidth / DESIGN_WIDTH;
  return {
    scale,
    designHeight: availableHeight / scale,
    renderedWidth: DESIGN_WIDTH * scale,
    renderedHeight: availableHeight,
  };
};
