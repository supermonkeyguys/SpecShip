import test from 'node:test';
import assert from 'node:assert/strict';

import { add, multiply } from '../src/math';

test('add should handle basic positive numbers', (): void => {
  assert.equal(add(2, 3), 5);
});

test('add should handle negative numbers', (): void => {
  assert.equal(add(-2, -3), -5);
  assert.equal(add(-2, 3), 1);
});

test('add should handle zero', (): void => {
  assert.equal(add(0, 5), 5);
  assert.equal(add(0, 0), 0);
});

test('multiply should handle basic positive numbers', (): void => {
  assert.equal(multiply(2, 3), 6);
});

test('multiply should handle negative numbers', (): void => {
  assert.equal(multiply(-2, -3), 6);
  assert.equal(multiply(-2, 3), -6);
});

test('multiply should handle zero', (): void => {
  assert.equal(multiply(0, 5), 0);
  assert.equal(multiply(0, 0), 0);
});
