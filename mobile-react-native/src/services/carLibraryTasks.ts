import { NativeModules, Platform } from 'react-native';

type CarEvent = 'carLibraryRequest' | 'carLibraryPlay' | 'carConnectionRequest' | 'mediaNotificationAction';
type Handler = (payload: any) => void | Promise<void>;
const handlers = new Map<CarEvent, Handler>();
const queueTasks = new Map<string, Promise<void>>();
let queueTaskSequence = 0;

/** Keep only this directory request's RN timers running on the existing context. */
export async function holdQueuePageTask(): Promise<() => void> {
  const native = NativeModules.LiuliuMediaLibrary;
  if (Platform.OS !== 'android' || !native?.beginQueuePageTask || !native?.completeQueuePageTask)
    return () => undefined;
  const id = `queue-page:${++queueTaskSequence}`;
  let resolve!: () => void;
  queueTasks.set(id, new Promise<void>(done => { resolve = done; }));
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    queueTasks.delete(id);
    resolve();
    native.completeQueuePageTask(id);
  };
  try {
    await native.beginQueuePageTask(id);
    return release;
  } catch (error) {
    release();
    throw error;
  }
}

/** Same mounted phone controller, with RN keeping timers alive for this request only. */
export function addCarLibraryTaskListener(event: CarEvent, handler: Handler) {
  handlers.set(event, handler);
  return { remove() { if (handlers.get(event) === handler) handlers.delete(event); } };
}

export async function runCarLibraryTask(data: any): Promise<void> {
  if (data?.event === 'queuePageTask' && typeof data?.payload?.requestId === 'string') {
    await queueTasks.get(data.payload.requestId);
    return;
  }
  if (!['carLibraryRequest', 'carLibraryPlay', 'carConnectionRequest', 'mediaNotificationAction'].includes(data?.event) || typeof data?.payload?.requestId !== 'string') return;
  await handlers.get(data.event)?.(data.payload);
}
