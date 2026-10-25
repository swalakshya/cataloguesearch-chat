import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanChunk } from '../../src/utils/chunk.js';

test('magazine passages expose issue and date to synthesis', () => {
  const passage = cleanChunk({ chunk_id: 'issue-1', category: 'Magazine',
    granth: 'Atmadharma', issue_number: '42', date: '1977-06', text_content: 'Evidence' });
  assert.equal(passage.issue_number, '42');
  assert.equal(passage.date, '1977-06');
});
