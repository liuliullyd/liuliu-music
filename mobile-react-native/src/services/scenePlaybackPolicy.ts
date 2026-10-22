import type { QueueSource } from './queuePaging';
import { HOME_MENU_SCENES } from './homeMenuScenes';
import { isTrackPlaybackRejected } from './trackPlaybackPolicy';

/** The three menu modes and other song entrances retain their own policy. */
export function isMenuSceneQueue(source: QueueSource | null | undefined) {
  return source?.kind === 'home-menu' &&
    HOME_MENU_SCENES.some(scene => scene.id === source.cursor.choiceId);
}

export type ScenePlaybackStage = 'stop' | 'resolve' | 'load' | 'start' | 'playing';

export function scenePlaybackFailure(stage: ScenePlaybackStage, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  const phase = isTrackPlaybackRejected(error) ? '音频校验失败' : {
    stop: '停止上一首失败',
    resolve: '音源解析或音频校验失败',
    load: '播放器加载失败',
    start: '播放启动失败',
    playing: '播放中断',
  }[stage];
  return `${phase}：${detail.slice(0, 120)}`;
}
