let generation = 0;

export const getSessionGeneration = () => generation;
export const isSessionCurrent = (captured: number) => captured === generation;

export function invalidateSessionRequests() {
  generation += 1;
}

export function assertSessionCurrent(captured: number) {
  if (!isSessionCurrent(captured)) throw new DOMException('Session changed', 'AbortError');
}
