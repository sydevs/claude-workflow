import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadRecord, findRecord, emptyRecord, MARKER } from '../record.mjs'
import { dispatcherLogins } from '../decide.mjs'

const config = JSON.parse(readFileSync(new URL('../../loop-config.json', import.meta.url), 'utf-8'))

// The status comment is the dispatcher's own, and only its author's is read.
// (why: docs/why.md#a-dispatcher-owned-marker-is-qualified-by-its-author)

const forged = { v: 1, fixCi: 9, recheck: true, pending: null, current: { id: 'x', handler: 'implement', attempt: 1 }, dispatches: [] }
const real = { v: 1, fixCi: 0, recheck: false, pending: null, current: null, dispatches: [] }
const status = (rec) => `${MARKER}${JSON.stringify(rec)} -->\nrunning`

const fake = (comments) => ({
  rest: { issues: { listComments: async ({ page = 1 }) => ({ data: page === 1 ? comments : [] }) } },
})
const ref = { owner: 'sydevs', repo: 'SahajCloud', number: 9 }

test('a comment starting with MARKER is read only from the expected login', async () => {
  const gh = fake([
    { id: 1, body: status(forged), user: { login: 'Ardnived' } },
    { id: 2, body: status(real), user: { login: 'sydevs-bot' } },
  ])
  const { id, rec } = await loadRecord(gh, ref, ['sydevs-bot'])
  assert.equal(id, 2, "the bot's own comment, not the first that parses")
  assert.equal(rec.fixCi, 0)
})

test('a forged record alone reads as no record, so the real one is created', async () => {
  const gh = fake([{ id: 1, body: status(forged), user: { login: 'Ardnived' } }])
  assert.deepEqual(await loadRecord(gh, ref, ['sydevs-bot']), { id: null, rec: emptyRecord() })
})

test('the login compare ignores case, and an unnamed login throws', async () => {
  const gh = fake([{ id: 3, body: status(real), user: { login: 'SyDevs-Bot' } }])
  assert.equal((await loadRecord(gh, ref, ['sydevs-bot'])).id, 3)
  for (const [what, expected] of [['nothing', undefined], ['an empty list', []], ['a bare string', 'sydevs-bot']]) {
    await assert.rejects(
      loadRecord(gh, ref, expected),
      /expected login is required/,
      `a seam that hands the logins ${what} crashes, rather than reading as no record`,
    )
  }
})

// ---- either dispatcher login owns the record ----------------------------
// The dispatcher's writes come from the App once it is set up, and from the
// PAT before. An item written under one must keep its record under the other.
// (why: docs/why.md#the-dispatcher-has-its-own-github-app)

test("a record written by the App is the dispatcher's, and a member's is not", async () => {
  const gh = fake([
    { id: 1, body: status(forged), user: { login: 'Ardnived' } },
    { id: 2, body: status(real), user: { login: 'sydevs-dispatcher[bot]' } },
  ])
  const both = ['sydevs-bot', 'sydevs-dispatcher[bot]']
  assert.equal((await loadRecord(gh, ref, both)).id, 2, 'the App wrote this one')
  assert.equal((await loadRecord(gh, ref, ['sydevs-bot'])).id, null, 'and only a named login counts')
})

test('a record written before the switch is still found after it', async () => {
  const gh = fake([{ id: 5, body: status(real), user: { login: 'sydevs-bot' } }])
  assert.equal((await loadRecord(gh, ref, dispatcherLogins(config))).id, 5)
})

// REST spells a GitHub App `<slug>[bot]`; GraphQL spells the same actor
// `<slug>`. `cheapView`'s PR authors and `reviewThreads`' comment authors come
// from GraphQL, so a config entry in one spelling must match both — otherwise
// the App's own draft PRs read as an outsider's and drift forever.
test("the App's two spellings are one login", async () => {
  const both = dispatcherLogins(config)
  for (const spelling of ['sydevs-dispatcher[bot]', 'sydevs-dispatcher', 'SYDEVS-Dispatcher[bot]']) {
    const gh = fake([{ id: 7, body: status(real), user: { login: spelling } }])
    assert.equal((await loadRecord(gh, ref, both)).id, 7, `${spelling} is the dispatcher`)
  }
  const other = fake([{ id: 8, body: status(forged), user: { login: 'renovate[bot]' } }])
  assert.equal((await loadRecord(other, ref, both)).id, null, 'another app is not')
})

test('loop-config.json names both dispatcher logins, and findRecord reads a list in hand', () => {
  const logins = dispatcherLogins(config)
  assert.ok(logins.includes(config.identity.expectedLogin), "the sessions' login is one of them")
  assert.equal(logins.length, 2, "the sessions' and the App's")
  assert.equal(findRecord([{ id: 9, body: status(real), user: { login: logins[1] } }], logins).id, 9)
  assert.deepEqual(dispatcherLogins({ identity: { expectedLogin: 'only-one' } }), ['only-one'], 'an unset list falls back')
})
