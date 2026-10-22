import { useEffect, useRef } from 'react';
import { AppState, NativeEventEmitter, NativeModules, Platform } from 'react-native';
import type { useApp } from './AppContext';
import { playlistClipboardCandidate, resolvePlaylistReference, type PlaylistClipboardReference } from '../services/playlistImport';
import { personalPlaylistClipboardCandidate } from '../services/personalPlaylistShare';

type App = ReturnType<typeof useApp>;
/** One foreground read after the existing startup reveal; no background polling. */
export function usePlaylistClipboard(app: App) {
  const latest = useRef(app); latest.current = app;
  const seen = useRef<{ key: string; token: string; reference: PlaylistClipboardReference; handled: boolean } | null>(null);
  const requestCheck = useRef<(() => void) | null>(null);
  const enabled = Platform.OS === 'android' && app.ready && !app.startup.visible;
  useEffect(() => {
    const native = NativeModules.LiuliuMediaLibrary;
    if (!enabled || !native?.readUriPlaylistClipboard) return;
    let live = true, generation = 0;
    let resolving: AbortController | undefined;
    let foreground = AppState.currentState === 'active';
    let backgrounded = AppState.currentState === 'background';
    let clipboardChanged = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async (token: number, retry = true): Promise<void> => {
      if (!live || !foreground || latest.current.playlistImportRequest) return;
      try {
        const snapshot = await native.readUriPlaylistClipboard();
        if (!live || !foreground || token !== generation || latest.current.playlistImportRequest) return;
        // Modal closure also restores focus. Our own share is for the recipient;
        // an external recopy has a different native owner and remains eligible.
        if (snapshot?.owned === true) return;
        if (typeof snapshot?.text !== 'string' || typeof snapshot?.token !== 'string' || !snapshot.token) {
          // One bounded retry covers Android's delayed foreground window focus.
          if (retry) timer = setTimeout(() => { check(token, false).catch(() => undefined); }, 500);
          return;
        }
        const personal = personalPlaylistClipboardCandidate(snapshot.text);
        const platform = personal ? null : playlistClipboardCandidate(snapshot.text);
        const candidate = personal ?? platform;
        if (!candidate) return;
        const previous = seen.current?.key === candidate.key ? seen.current : null;
        if (previous?.handled && previous.token === snapshot.token && !clipboardChanged) return;
        resolving = new AbortController();
        const reference: PlaylistClipboardReference = personal ? { kind: 'personal', id: personal.key }
          : platform!.reference ?? previous?.reference ?? await resolvePlaylistReference(candidate.input, resolving.signal);
        if (!live || !foreground || token !== generation || latest.current.playlistImportRequest) return;
        clipboardChanged = false;
        seen.current = { key: candidate.key, token: snapshot.token, reference, handled: true };
        latest.current.openPlaylistImport(candidate.input, true, { token: snapshot.token, reference });
      } catch { /* A system-denied/empty clipboard leaves manual import available. */ }
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      resolving?.abort();
      const token = ++generation;
      // AppState can precede Android window focus; read once after that transition.
      timer = setTimeout(() => { check(token).catch(() => undefined); }, 250);
    };
    requestCheck.current = () => { if (foreground) schedule(); };
    if (foreground) schedule();
    const subscription = AppState.addEventListener('change', next => {
      const wasForeground = foreground;
      foreground = next === 'active';
      if (foreground && !wasForeground) {
        // Cancelled/unsaved links may be offered again in a new foreground round.
        // Keep the resolved identity so short shares do not need another request.
        if (backgrounded && seen.current) {
          seen.current.handled = false;
        }
        backgrounded = false;
        schedule();
      }
      else if (!foreground) {
        if (next === 'background') backgrounded = true;
        generation++; resolving?.abort(); if (timer) clearTimeout(timer);
        if (latest.current.playlistImportRequest?.autoRead) latest.current.closePlaylistImport();
      }
    });
    const focus = AppState.addEventListener('focus', () => { if (foreground) schedule(); });
    const clipboard = new NativeEventEmitter(native).addListener('playlistClipboardChanged', () => {
      clipboardChanged = true;
      if (foreground) schedule();
    });
    return () => { live = false; generation++; resolving?.abort(); requestCheck.current = null; if (timer) clearTimeout(timer); subscription.remove(); focus.remove(); clipboard.remove(); };
  }, [enabled]);
  useEffect(() => { requestCheck.current?.(); }, [app.tab, app.page, app.playlistImportRequest]);
}
