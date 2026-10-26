// Locks identify live protocol-aware clients; silence is never evidence that old clients are closed.
const CLIENT_PREFIX = 'offline-client:1:';
export const COORDINATION_KEY = 'offline-coordination:1';
const instanceId = crypto.randomUUID();
let participating: Promise<void> | undefined;
let invalidate = () => {};
let acknowledge: ((id: string) => void) | undefined;
type Message = { type: 'freeze' | 'frozen' | 'resume'; sender: string; requestId: string };
function send(message: Message) {
  localStorage.setItem(COORDINATION_KEY, JSON.stringify(message));
}
window.addEventListener('storage', (event) => {
  if (event.key !== COORDINATION_KEY || !event.newValue) return;
  try {
    const message = JSON.parse(event.newValue) as Message;
    if (message.type === 'freeze' && message.sender !== instanceId) {
      invalidate();
      window.dispatchEvent(new Event('offline-context-invalidated'));
      send({ type: 'frozen', sender: instanceId, requestId: message.requestId });
    } else if (message.type === 'frozen') acknowledge?.(`${message.requestId}:${message.sender}`);
    else if (message.type === 'resume') window.dispatchEvent(new Event('offline-storage-resumed'));
  } catch {
    /* Ignore unrelated or malformed coordination signals. */
  }
});
export async function participate(onFreeze: () => void) {
  invalidate = onFreeze;
  if (!navigator.locks?.query || participating) return participating;
  participating = new Promise<void>((resolve) => {
    void navigator.locks.request(`${CLIENT_PREFIX}${instanceId}`, async () => {
      resolve();
      await new Promise<void>((release) =>
        window.addEventListener(
          'pagehide',
          () => {
            participating = undefined;
            release();
          },
          { once: true },
        ),
      );
    });
  });
  return participating;
}
export async function freezeParticipants() {
  const snapshot = await navigator.locks?.query?.();
  const peers = new Set(
    snapshot?.held
      ?.map((lock) => lock.name)
      .filter((name): name is string => !!name?.startsWith(CLIENT_PREFIX) && name !== `${CLIENT_PREFIX}${instanceId}`)
      .map((name) => name.slice(CLIENT_PREFIX.length)),
  );
  const requestId = crypto.randomUUID();
  if (peers.size)
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        acknowledge = undefined;
        reject(new Error('Inna karta nie zatrzymała dostępu do danych. Zamknij ją i ponów aktualizację.'));
      }, 2000);
      acknowledge = (id) => {
        for (const peer of peers) if (id === `${requestId}:${peer}`) peers.delete(peer);
        if (!peers.size) {
          window.clearTimeout(timer);
          acknowledge = undefined;
          resolve();
        }
      };
      send({ type: 'freeze', sender: instanceId, requestId });
    });
}
export function resumeParticipants() {
  send({ type: 'resume', sender: instanceId, requestId: crypto.randomUUID() });
}
