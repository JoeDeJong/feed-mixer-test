// Users and PIN sign-in. PINs are stored salted and hashed, never as typed.
//
// Everything lives on this device, so a PIN records who did each load and keeps
// operators out of the manager screens. It is not protection against someone
// who can get at the tablet's browser storage.

import { newId } from './calc.js';

export const ROLES = { manager: 'Manager', operator: 'Operator' };

export const MAX_ATTEMPTS = 5;
export const LOCKOUT_MS = 30_000;

export function pinProblem(pin) {
  return /^\d{4,6}$/.test(String(pin)) ? null : 'PIN must be 4 to 6 digits.';
}

const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

// SHA-256 via Web Crypto where available. Pages served over plain http on a
// local network don't get Web Crypto, so fall back to a simple 32-bit hash
// there (labelled, so it is never confused with the real one).
export async function hashPin(pin, salt) {
  const text = `${salt}:${pin}`;
  if (globalThis.crypto?.subtle) {
    return `sha256:${hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))}`;
  }
  let h = 0x811c9dc5;
  for (let round = 0; round < 1000; round++) {
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return `fnv:${h.toString(16)}`;
}

export async function createUser({ name, pin, role = 'operator' }) {
  const salt = newId();
  return { id: newId(), name: name.trim(), role, salt, pinHash: await hashPin(pin, salt) };
}

export async function setPin(user, pin) {
  user.salt = newId();
  user.pinHash = await hashPin(pin, user.salt);
}

export async function checkPin(user, pin) {
  return (await hashPin(pin, user.salt)) === user.pinHash;
}

export const isManager = (user) => user?.role === 'manager';

export const managerCount = (users) => users.filter(isManager).length;

// Wrong-PIN tracking for one device: after MAX_ATTEMPTS misses in a row,
// sign-in is refused for LOCKOUT_MS.
export class Attempts {
  failures = 0;
  lockedUntil = 0;

  waitMs(now = Date.now()) {
    return Math.max(0, this.lockedUntil - now);
  }

  fail(now = Date.now()) {
    this.failures += 1;
    if (this.failures >= MAX_ATTEMPTS) {
      this.failures = 0;
      this.lockedUntil = now + LOCKOUT_MS;
    }
  }

  succeed() {
    this.failures = 0;
    this.lockedUntil = 0;
  }
}
