import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OperationTimings } from '../../src/utils/operation_timings.js';
test('phase wall times are disjoint while backend work is explicitly nested', () => {
  let now = 0;
  const timing = new OperationTimings(() => now);
  timing.stage('understanding'); now = 100;
  timing.stage('searching'); now = 500;
  timing.search({ operations: { context: 25, reranking: 200 } });
  timing.stage('preparing'); now = 800;
  const result = timing.finish();
  assert.equal(result.total_ms, 800);
  assert.equal(result.operations.understanding, 100);
  assert.equal(result.operations.searching, 400);
  assert.equal(result.operations.preparing, 300);
  assert.equal(result.search_work.context, 25);
});
test('repeated stages and retry transitions accumulate correctly', () => {
  let now = 0;
  const timing = new OperationTimings(() => now);
  timing.stage('understanding'); now = 100; timing.stage('searching');
  now = 200; timing.stage('understanding'); now = 250; timing.stage('understanding');
  now = 300;
  assert.equal(timing.finish().operations.understanding, 200);
});
