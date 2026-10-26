import './testSetup.js';
import { describe, it, expect } from 'vitest';
import { activateOfflineAccount, transact } from './database.js';
import {
  acquireLease,
  appendOperation,
  assertLease,
  completeOperation,
  nextOperation,
  readOperations,
  type Intent,
} from './outbox.js';

const account = 'family:user';
const intent = (operationId: string, key = 'list:a', dependsOn: string[] = []): Intent => ({
  operationId,
  submittedAt: Date.now(),
  payload: { name: operationId },
  entityId: operationId,
  orderingKeys: [key],
  dependsOn,
});
describe('durable account outbox', () => {
  it('serializes concurrent appends, orders resources and resolves explicit dependencies atomically', async () => {
    await activateOfflineAccount(account);
    await Promise.all(
      ['a', 'b'].map((id) => transact('readwrite', (tx) => appendOperation(tx, account, 'shopping', intent(id)))),
    );
    await transact('readwrite', async (tx) => {
      await appendOperation(tx, account, 'shopping', intent('c', 'list:b', ['a']));
      const operations = await readOperations(tx, account);
      expect(operations.map((op) => op.sequence)).toEqual([1, 2, 3]);
      expect(nextOperation(operations, Date.now())?.operationId).toBe('a');
      completeOperation(tx, operations, operations[0]!);
    });
    await transact('readonly', async (tx) => expect((await readOperations(tx, account))[1]?.dependsOn).toEqual([]));
  });
  it('rejects duplicate IDs, self/missing dependencies and rolls back the transaction', async () => {
    await activateOfflineAccount(account);
    await expect(
      transact('readwrite', async (tx) => {
        await appendOperation(tx, account, 'shopping', intent('a'));
        await appendOperation(tx, account, 'shopping', intent('a'));
      }),
    ).rejects.toThrow();
    await expect(
      transact('readwrite', (tx) => appendOperation(tx, account, 'shopping', intent('b', 'list:b', ['b']))),
    ).rejects.toThrow();
    await transact('readonly', async (tx) => expect(await readOperations(tx, account)).toEqual([]));
  });
  it('lets independent resources pass a conflict and a persisted retry deadline', async () => {
    await activateOfflineAccount(account);
    await transact('readwrite', async (tx) => {
      await appendOperation(tx, account, 'shopping', { ...intent('a'), reviewReason: 'conflict' });
      await appendOperation(tx, account, 'shopping', intent('b'));
      await appendOperation(tx, account, 'shopping', intent('c', 'list:c', ['a']));
      const d = await appendOperation(tx, account, 'shopping', intent('d', 'list:d'));
      const e = await appendOperation(tx, account, 'shopping', intent('e', 'list:e'));
      d.status = 'retry-wait';
      d.nextAttemptAt = Date.now() + 60000;
      tx.objectStore('outbox').put(d);
      const operations = await readOperations(tx, account);
      expect(nextOperation(operations, Date.now())?.operationId).toBe(e.operationId);
    });
  });
  it('fences an old sender after lease takeover, including a clock jump', async () => {
    await activateOfflineAccount(account);
    const first = await transact('readwrite', (tx) => acquireLease(tx, account, 'first', 1000));
    expect(await transact('readwrite', (tx) => acquireLease(tx, account, 'second', 2000))).toBeUndefined();
    const second = await transact('readwrite', (tx) => acquireLease(tx, account, 'second', 20000));
    expect(second!.epoch).toBe(first!.epoch + 1);
    await expect(transact('readwrite', (tx) => assertLease(tx, account, first!, 2001))).rejects.toThrow('lease');
    await transact('readwrite', (tx) => assertLease(tx, account, second!, 20001));
  });
});
