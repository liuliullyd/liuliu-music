import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { UIManager } from 'react-native';
import {
  PlayerPageMotion,
  type PageMotionHandle,
} from '../src/components/PlayerPageMotion';

jest.mock('react-native', () => ({
  NativeModules: {},
  UIManager: { dispatchViewManagerCommand: jest.fn() },
  requireNativeComponent: () => 'LiuliuPlayerPageMotion',
  findNodeHandle: () => 77,
}));

let renderer: Renderer.ReactTestRenderer;
let handle: React.RefObject<PageMotionHandle | null>;
let onGesture: jest.Mock;
const native = () =>
  renderer.root.findByType('LiuliuPlayerPageMotion' as never);
const dispatch = jest.spyOn(UIManager, 'dispatchViewManagerCommand');
const gesture = (phase: string, gestureId: number) =>
  native().props.onPageGesture({
    nativeEvent: {
      phase,
      gestureId,
      position: -320,
      dx: 0,
      dy: -80,
    },
  });
const finish = (id: number, finished: boolean, position = -800) =>
  native().props.onMotionComplete({
    nativeEvent: { id, finished, position },
  });
beforeEach(async () => {
  dispatch.mockClear();
  onGesture = jest.fn();
  handle = React.createRef<PageMotionHandle>();
  await act(async () => {
    renderer = Renderer.create(
      <PlayerPageMotion ref={handle} pageExtent={800} onGesture={onGesture} />,
      { createNodeMock: () => ({}) },
    );
  });
});
afterEach(async () => {
  await act(async () => renderer.unmount());
});

test('one stable native node owns set, stop and 240ms animation commands', () => {
  handle.current!.setPosition(-100);
  handle.current!.animateTo(-800, false);
  handle.current!.animateTo(0, true);
  handle.current!.stop();
  expect(dispatch.mock.calls).toEqual([
    [77, 'motion', ['set', 1, 0, -100]],
    [77, 'motion', ['animate', 2, 0, -800]],
    [77, 'motion', ['spring', 3, 0, 0]],
    [77, 'motion', ['stop', 4, 0, 0]],
  ]);
});

test('each command carries the native finger owner and older events cannot reclaim it', () => {
  gesture('grant', 2);
  gesture('move', 2);
  gesture('release', 2);
  gesture('release', 1);
  handle.current!.animateTo(-800, false);
  expect(onGesture).toHaveBeenCalledTimes(3);
  expect(dispatch).toHaveBeenLastCalledWith(77, 'motion', [
    'animate',
    1,
    2,
    -800,
  ]);
});

test('animation completions are delivered to their command once without any pixel write', () => {
  const first = jest.fn(),
    second = jest.fn();
  handle.current!.animateTo(-800, false, first);
  gesture('grant', 1);
  handle.current!.animateTo(0, true, second);
  finish(2, true, 0);
  finish(1, false, -320);
  finish(1, true, -800);
  expect(second).toHaveBeenCalledTimes(1);
  expect(first).toHaveBeenCalledTimes(1);
  expect(first).toHaveBeenCalledWith({
    id: 1,
    finished: false,
    position: -320,
  });
  expect(dispatch).toHaveBeenCalledTimes(2);
});

test('stopped actual position is consumed once and rejected stop never starts recovery', () => {
  const accepted = jest.fn(),
    rejected = jest.fn();
  handle.current!.stop(accepted);
  handle.current!.stop(rejected);
  finish(2, false, -200);
  finish(1, true, -320);
  finish(1, true, -900);
  expect(accepted).toHaveBeenCalledWith(-320);
  expect(accepted).toHaveBeenCalledTimes(1);
  expect(rejected).not.toHaveBeenCalled();
});

test('React updates retain the same native motion view and emit no reset commands', async () => {
  const view = native();
  gesture('grant', 1);
  await act(async () =>
    renderer.update(
      <PlayerPageMotion
        ref={handle}
        pageExtent={800}
        onGesture={onGesture}
        style={{ opacity: 1 }}
      />,
    ),
  );
  expect(native()).toBe(view);
  expect(dispatch).not.toHaveBeenCalled();
});

test('unmount rejects pending callback delivery', async () => {
  const callback = jest.fn();
  handle.current!.animateTo(-800, false, callback);
  const complete = native().props.onMotionComplete;
  await act(async () => renderer.unmount());
  complete({ nativeEvent: { id: 1, finished: true, position: -800 } });
  expect(callback).not.toHaveBeenCalled();
});
