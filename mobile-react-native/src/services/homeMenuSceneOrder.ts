/** Freshly shuffle scene recall choices or its accepted playback batch. */
export function shuffleHomeMenuSceneValues<T>(
  values: readonly T[],
  random: () => number = Math.random,
): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target]!, shuffled[index]!];
  }
  return shuffled;
}

/** Weighted sampling without replacement; even a zero-score song can enter. */
export function sampleHomeMenuSceneCandidates<T extends { score: number }>(
  candidates: readonly T[],
  random: () => number = Math.random,
): T[] {
  return candidates
    .map(candidate => {
      const score = Number.isFinite(candidate.score) ? Math.max(0, candidate.score) : 0;
      const weight = 1 + score;
      const priority = -Math.log(Math.max(Number.EPSILON, 1 - random())) / weight;
      return { candidate, priority };
    })
    .sort((left, right) => left.priority - right.priority)
    .map(item => item.candidate);
}
