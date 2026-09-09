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

test('the message guesses at a permission only when the error looks like one', async () => {
  const bad = { graphql: async () => { throw new Error('Variable $n is declared by anonymous query but not used') } }
  await assert.rejects(() => itemOf(bad, config, 'NODE'), (e) => {
    assert.match(e.message, /Variable \$n is declared/)
    assert.ok(!/organization Projects/.test(e.message), 'a query bug must not be reported as a permission')
    return true
  })
  const denied = { graphql: async () => { throw new Error('Resource not accessible by personal access token') } }
  await assert.rejects(() => itemOf(denied, config, 'NODE'), (e) => /organization Projects/.test(e.message))
})

test('every query uses every variable it declares — GraphQL rejects the rest', async () => {
  const src = readFileSync(new URL('../projects.mjs', import.meta.url), 'utf-8')
  for (const [, decl, body] of src.matchAll(/`(query\([^)]*\)|mutation\([^)]*\))\{([\s\S]*?)`/g)) {
    for (const [, name] of decl.matchAll(/\$(\w+)\s*:/g)) {
      assert.ok(body.includes(`$${name}`), `${decl} declares $${name} and never uses it`)
    }
  }
})
