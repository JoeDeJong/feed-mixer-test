import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Attempts, LOCKOUT_MS, MAX_ATTEMPTS, checkPin, createUser, managerCount, pinProblem, setPin,
} from '../js/users.js';

test('PINs must be 4 to 6 digits', () => {
  assert.equal(pinProblem('1234'), null);
  assert.equal(pinProblem('123456'), null);
  assert.ok(pinProblem('123'));
  assert.ok(pinProblem('1234567'));
  assert.ok(pinProblem('12a4'));
  assert.ok(pinProblem(''));
});

test('a user is created with a hashed PIN that checks correctly', async () => {
  const u = await createUser({ name: '  Joe ', pin: '4321', role: 'manager' });
  assert.equal(u.name, 'Joe');
  assert.equal(u.role, 'manager');
  assert.ok(!JSON.stringify(u).includes('4321'), 'PIN is not stored as typed');
  assert.match(u.pinHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(await checkPin(u, '4321'), true);
  assert.equal(await checkPin(u, '1234'), false);
});

test('the same PIN hashes differently for different users', async () => {
  const a = await createUser({ name: 'A', pin: '1111' });
  const b = await createUser({ name: 'B', pin: '1111' });
  assert.notEqual(a.pinHash, b.pinHash);
  assert.equal(a.role, 'operator');
});

test('changing a PIN replaces the old one', async () => {
  const u = await createUser({ name: 'Sam', pin: '1111' });
  await setPin(u, '2222');
  assert.equal(await checkPin(u, '1111'), false);
  assert.equal(await checkPin(u, '2222'), true);
});

test('managerCount counts managers only', () => {
  assert.equal(managerCount([{ role: 'manager' }, { role: 'operator' }, { role: 'manager' }]), 2);
});

test('too many wrong PINs locks sign-in for a while', () => {
  const a = new Attempts();
  for (let i = 0; i < MAX_ATTEMPTS - 1; i++) a.fail(1000);
  assert.equal(a.waitMs(1000), 0);
  a.fail(1000);
  assert.equal(a.waitMs(1000), LOCKOUT_MS);
  assert.equal(a.waitMs(1000 + LOCKOUT_MS), 0);
  a.fail(50_000);
  a.succeed();
  assert.equal(a.failures, 0);
});
