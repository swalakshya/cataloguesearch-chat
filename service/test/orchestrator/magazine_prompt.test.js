import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getKeywordPrompt } from '../../src/orchestrator/prompts.js';

test('keyword prompts explain Magazine and keep it in the configured default', () => {
  const prompt = getKeywordPrompt('Atmadharma में आत्मा', '[]', { promptVersion: 'v2', env: {} });
  assert.match(prompt, /Magazine refers to periodical issues/);
  assert.match(prompt, /"Pravachan","Granth","Books","Magazine"/);
});
