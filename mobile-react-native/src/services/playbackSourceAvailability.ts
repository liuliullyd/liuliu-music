export const PLATFORM_UNBOUND_MESSAGE = '该平台未绑定暂不可用';

/** A platform has no eligible source; this is not evidence against a song. */
export class SourceBindingUnavailableError extends Error {
  readonly code = 'SOURCE_BINDING_UNAVAILABLE';

  constructor(readonly sourceType: string) {
    super(`没有已启用的音源支持 ${sourceType}`);
    this.name = 'SourceBindingUnavailableError';
  }
}

export function isSourceBindingUnavailable(error: unknown) {
  return error instanceof SourceBindingUnavailableError ||
    (error as { code?: unknown })?.code === 'SOURCE_BINDING_UNAVAILABLE';
}
