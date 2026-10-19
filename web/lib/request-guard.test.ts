import { describe, it, expect } from 'vitest';
import { hostname, refusal, REFUSED_HOST, REFUSED_ORIGIN } from './request-guard';

const headers = (h: Record<string, string>) => new Headers(h);
const CROSS_SITE = { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' };

describe('request-guard.ts', () => {
  it('reads a host name the way the browser sent it', () => {
    expect(['127.0.0.1:3000', 'localhost', 'LocalHost:3001', '[::1]:3000'].map(hostname)).toEqual(['127.0.0.1', 'localhost', 'localhost', '::1']);
  });

  it('answers only under this computer\'s names — a rebound page reads nothing', () => {
    for (const host of ['127.0.0.1:3000', 'localhost:3001', '[::1]:3000']) expect(refusal('GET', headers({ host }))).toBeNull();
    for (const host of ['evil.example:3000', '192.168.1.20:3000', 'localhost.evil.example', 'backend:8000', ''])
      expect(refusal('GET', headers({ host }))).toBe(REFUSED_HOST);
  });

  it('lets a write through only from the app itself', () => {
    const host = { host: 'localhost:3000' };
    const allowed: Record<string, string>[] = [{}, { 'sec-fetch-site': 'same-origin', origin: 'http://localhost:3000' }, { 'sec-fetch-site': 'none' }];
    for (const extra of allowed)
      expect(refusal('POST', headers({ ...host, ...extra }))).toBeNull();
    const refused: Record<string, string>[] = [
      { 'sec-fetch-site': 'cross-site' },
      { 'sec-fetch-site': 'same-site', origin: 'http://localhost:5173' },   // another app on this computer
      { origin: 'https://evil.example' },                                  // a browser without Sec-Fetch-Site
      { origin: 'null' },
      { origin: 'pas une adresse' },
    ];
    for (const extra of refused)
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(refusal(method, headers({ ...host, ...extra }))).toBe(REFUSED_ORIGIN);
  });

  it('does not refuse a read for its origin: the browser hides the answer from another site', () => {
    expect(refusal('GET', headers({ host: 'localhost:3000', ...CROSS_SITE }))).toBeNull();
  });
});
