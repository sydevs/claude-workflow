import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { projectIds, itemOf, BoardUnreachable } from '../projects.mjs'

const config = JSON.parse(readFileSync(new URL('../../loop-config.json', import.meta.url), 'utf-8'))

test('a null projectV2 is a permission answer, and it is named as one', async () => {
  const gh = { graphql: async () => ({ organization: { projectV2: null } }) }
  await assert.rejects(() => projectIds(gh, config), (e) => {
    assert.equal(e.name, 'BoardUnreachable')
    assert.match(e.message, /organization Projects read and write/)
    return true
  })
})

test('a GraphQL error reading one item is the same failure', async () => {
  const gh = { graphql: async () => { throw new Error('Resource not accessible by integration') } }
  await assert.rejects(() => itemOf(gh, config, 'NODE'), (e) => e instanceof BoardUnreachable)
})
