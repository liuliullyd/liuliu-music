export type HomeTimingFields = Record<string, string | number | boolean>;
export type HomeTimingTrace = (
  stage: string,
  fields?: HomeTimingFields,
) => void;

/** Diagnostic events only: no media identities, query strings or scheduling state. */
export function createHomeTimingTrace(
  generation: string | number,
  section: string,
): HomeTimingTrace {
  return (stage, fields = {}) => {
    console.info(
      '[home-timing]',
      JSON.stringify({ ...fields, at: Date.now(), generation, section, stage }),
    );
  };
}
