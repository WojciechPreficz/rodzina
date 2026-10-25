// Keep the server's response retention longer than this automatic replay window.
export const OFFLINE_REPLAY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export class OfflineOperationExpiredError extends Error {
  constructor() {
    super('Oczekująca zmiana ma ponad 30 dni. Sprawdź dane na serwerze przed ponownym wprowadzeniem zmiany.');
    this.name = 'OfflineOperationExpiredError';
  }
}

export function assertOfflineReplayAge(submittedAt: number) {
  if (!Number.isFinite(submittedAt) || Date.now() - submittedAt > OFFLINE_REPLAY_MAX_AGE_MS)
    throw new OfflineOperationExpiredError();
}
