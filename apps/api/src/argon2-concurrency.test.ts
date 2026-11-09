// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { hash, verify } from '@node-rs/argon2';
import { hashPassword, hashPin, verifyPassword, verifyPin } from './auth.js';

vi.mock('@node-rs/argon2', () => ({ hash: vi.fn(), verify: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

it('shares two Argon2 slots across hashing and verification and releases a slot after failure', async () => {
  const passwordHash = deferred<string>();
  const pinVerification = deferred<boolean>();
  const pinHash = deferred<string>();
  vi.mocked(hash).mockReturnValueOnce(passwordHash.promise).mockReturnValueOnce(pinHash.promise);
  vi.mocked(verify).mockReturnValueOnce(pinVerification.promise).mockResolvedValueOnce(true);

  const first = hashPassword('password');
  const second = verifyPin('pin-hash', '1234');
  const third = hashPin('9876');
  const fourth = verifyPassword('password-hash', 'password');
  expect(hash).toHaveBeenCalledTimes(1);
  expect(verify).toHaveBeenCalledTimes(1);

  passwordHash.resolve('password-hash');
  await expect(first).resolves.toBe('password-hash');
  expect(hash).toHaveBeenLastCalledWith('9876', expect.objectContaining({ memoryCost: 65536 }));
  expect(verify).toHaveBeenCalledTimes(1);

  pinVerification.reject(new Error('Argon2 failed'));
  await expect(second).rejects.toThrow('Argon2 failed');
  await expect(fourth).resolves.toBe(true);
  expect(verify).toHaveBeenLastCalledWith('password-hash', 'password');
  pinHash.resolve('pin-hash');
  await expect(third).resolves.toBe('pin-hash');
});
