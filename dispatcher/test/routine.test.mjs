import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routineFor } from '../fire.mjs'

// (why: docs/why.md#a-mechanical-handler-runs-on-a-lighter-model)
const config = {
  handlers: { 'fix-ci': { model: 'sonnet' }, implement: { model: 'opus' } },
  dispatch: { routines: { SahajCloud: 'trig_repo' }, routineIdVarPrefix: 'ROUTINE_ID_', routineTokenSecretPrefix: 'ROUTINE_TOKEN_' },
}
const repoOnly = { ROUTINE_TOKEN_SAHAJCLOUD: 'tok_repo' }
const withLane = { ...repoOnly, ROUTINE_ID_SONNET: 'trig_lane', ROUTINE_TOKEN_SONNET: 'tok_lane' }

test('a handler whose model has a lane routine fires on it', () => {
  assert.deepEqual(routineFor('SahajCloud', 'fix-ci', config, withLane), { routineId: 'trig_lane', token: 'tok_lane', lane: 'sonnet' })
})

test('a handler whose model has no lane routine fires on the repo routine', () => {
  assert.deepEqual(routineFor('SahajCloud', 'implement', config, withLane), { routineId: 'trig_repo', token: 'tok_repo', lane: null, unsetLane: 'opus' })
})

test('a lane missing its id or token falls back to the repo routine, and says which lane', () => {
  assert.deepEqual(routineFor('SahajCloud', 'fix-ci', config, repoOnly), { routineId: 'trig_repo', token: 'tok_repo', lane: null, unsetLane: 'sonnet' })
  assert.equal(routineFor('SahajCloud', 'fix-ci', config, { ...repoOnly, ROUTINE_ID_SONNET: 'trig_lane' }).routineId, 'trig_repo', 'an id with no token is unset')
})
