// @vitest-environment node
import type { IncomingHttpHeaders } from 'node:http';
import { describe, expect, it } from 'vitest';
import { isTrustedMutationSource } from './auth.js';

describe('isTrustedMutationSource', () => {
  it.each<{ name: string; headers: IncomingHttpHeaders; trusted: boolean }>([
    { name: 'missing source', headers: { host: 'localhost:3000' }, trusted: false },
    { name: 'missing host', headers: { origin: 'http://localhost:3000' }, trusted: false },
    { name: 'matching Origin', headers: { host: 'localhost:3000', origin: 'http://localhost:3000' }, trusted: true },
    { name: 'foreign Origin', headers: { host: 'localhost:3000', origin: 'https://evil.example' }, trusted: false },
    {
      name: 'matching Referer with path and query',
      headers: { host: 'localhost:3000', referer: 'http://localhost:3000/calendar?day=20' },
      trusted: true,
    },
    { name: 'foreign Referer', headers: { host: 'localhost:3000', referer: 'https://evil.example/' }, trusted: false },
    { name: 'malformed Origin', headers: { host: 'localhost:3000', origin: 'invalid' }, trusted: false },
    { name: 'null Origin', headers: { host: 'localhost:3000', origin: 'null' }, trusted: false },
    { name: 'malformed Referer', headers: { host: 'localhost:3000', referer: '/calendar' }, trusted: false },
    { name: 'different port', headers: { host: 'localhost:3000', origin: 'http://localhost:3001' }, trusted: false },
    {
      name: 'foreign Origin takes precedence over matching Referer',
      headers: { host: 'localhost:3000', origin: 'https://evil.example', referer: 'http://localhost:3000/' },
      trusted: false,
    },
    {
      name: 'empty Origin cannot fall back to Referer',
      headers: { host: 'localhost:3000', origin: '', referer: 'http://localhost:3000/' },
      trusted: false,
    },
    {
      name: 'valid Origin takes precedence over foreign Referer',
      headers: { host: 'localhost:3000', origin: 'http://localhost:3000', referer: 'https://evil.example/' },
      trusted: true,
    },
    ...['origin', 'referer'].flatMap((source) => [
      {
        name: `${source} uses forwarded host`,
        headers: {
          host: 'internal:3000',
          'x-forwarded-host': 'rodzina.preficze.pl',
          [source]: 'https://rodzina.preficze.pl',
        },
        trusted: true,
      },
      {
        name: `${source} cannot use internal host when forwarded host exists`,
        headers: { host: 'internal:3000', 'x-forwarded-host': 'rodzina.preficze.pl', [source]: 'http://internal:3000' },
        trusted: false,
      },
    ]),
    {
      name: 'array forwarded host stays untrusted',
      headers: { 'x-forwarded-host': ['localhost:3000'], origin: 'http://localhost:3000' },
      trusted: false,
    },
  ])('$name', ({ headers, trusted }) => {
    expect(isTrustedMutationSource(headers)).toBe(trusted);
  });
});
