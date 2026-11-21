import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadRecord, findRecord, emptyRecord, MARKER } from '../record.mjs'
import { dispatcherLogins, restLogin, isLogin } from '../decide.mjs'

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

// `findRecord` authenticates the dispatcher's own state store by author login
// alone, and these repos are public. So the trusted list holds no login a user
// account could register: an App is trusted as `<slug>[bot]`, which no username
// can be, since `[` is not a legal username character. GraphQL spells the same
// actor `<slug>`, and `restLogin` normalises it rather than the list trusting
// the bare form. (why: docs/why.md#the-dispatcher-has-its-own-github-app)
test('the trusted list holds no login a user could register', async () => {
  const all = dispatcherLogins(config)
  for (const login of all) {
    assert.ok(
      login === config.identity.expectedLogin || login.endsWith('[bot]'),
      `${login} must be the sessions' own account or an App — a bare slug a stranger could squat is not trusted`,
    )
  }
  for (const spelling of ['sydevs-dispatcher[bot]', 'SYDEVS-Dispatcher[bot]']) {
    const gh = fake([{ id: 7, body: status(real), user: { login: spelling } }])
    assert.equal((await loadRecord(gh, ref, all)).id, 7, `${spelling} is the dispatcher`)
  }
  for (const other of ['sydevs-dispatcher', 'renovate[bot]', 'sydevs-dispatcher-2']) {
    const gh = fake([{ id: 8, body: status(forged), user: { login: other } }])
    assert.equal((await loadRecord(gh, ref, all)).id, null, `${other} is not, so a forged record from it is ignored`)
  }
})

test('a GraphQL Bot actor is normalised to the spelling the list trusts', () => {
  const all = dispatcherLogins(config)
  assert.equal(restLogin({ login: 'sydevs-dispatcher', __typename: 'Bot' }), 'sydevs-dispatcher[bot]')
  assert.ok(isLogin(restLogin({ login: 'sydevs-dispatcher', __typename: 'Bot' }), all), 'the App is itself through GraphQL')
  // A user of that name is not the App, however its actor is spelled.
  assert.equal(restLogin({ login: 'sydevs-dispatcher', __typename: 'User' }), 'sydevs-dispatcher')
  assert.ok(!isLogin(restLogin({ login: 'sydevs-dispatcher', __typename: 'User' }), all), 'and a squatter is not')
  assert.equal(restLogin({ login: 'Ardnived', __typename: 'User' }), 'Ardnived')
  assert.equal(restLogin(null), '', 'a deleted actor is nobody')
})

test('loop-config.json names every dispatcher login, and findRecord reads a list in hand', () => {
  const logins = dispatcherLogins(config)
  assert.ok(logins.includes(config.identity.expectedLogin), "the sessions' login is one of them")
  assert.equal(logins.length, 2, "the sessions' and the App's")
  assert.equal(findRecord([{ id: 9, body: status(real), user: { login: logins[1] } }], logins).id, 9)
  assert.deepEqual(dispatcherLogins({ identity: { expectedLogin: 'only-one' } }), ['only-one'], 'an unset list falls back')
})
