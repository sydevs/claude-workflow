// The lease ref: the one GitHub write that is a compare-and-swap.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { takeLease, releaseLease, listLeases, leaseRef } from '../lease.mjs'
import { buildRecord, dispatchId } from '../fire.mjs'
import { decide } from '../decide.mjs'

const config = JSON.parse(readFileSync(new URL('../../loop-config.json', import.meta.url), 'utf-8'))

/** Refs with GitHub's own semantics: create 422s on a ref that already exists. */
function refWorld() {
  const refs = new Map()
  const calls = []
  return {
    refs,
    calls,
    rest: {
      repos: { get: async () => ({ data: { default_branch: 'main' } }) },
      git: {
        createRef: async (a) => {
          calls.push(['createRef', a.ref])
          if (refs.has(a.ref)) { const e = new Error('Reference already exists'); e.status = 422; throw e }
          refs.set(a.ref, a.sha)
          return { data: {} }
        },
        deleteRef: async (a) => {
          calls.push(['deleteRef', a.ref])
          if (!refs.delete(`refs/${a.ref}`)) { const e = new Error('Reference does not exist'); e.status = 422; throw e }
          return { data: {} }
        },
        getRef: async (a) => ({ data: { object: { sha: 'defaultbranchsha' } } }),
        listMatchingRefs: async (a) => ({ data: [...refs.keys()].filter((r) => r.startsWith(`refs/${a.ref}`)).map((r) => ({ ref: r })) }),
      },
    },
  }
}

const item = { owner: 'sydevs', repo: 'SahajCloud', number: 858 }

test('two concurrent creates of one lease give one 201 and one 422', async () => {
  const gh = refWorld()
  const [a, b] = await Promise.all([takeLease(gh, item, 'headsha'), takeLease(gh, item, 'headsha')])
  assert.equal([a, b].filter((r) => r.won).length, 1, 'exactly one pass wins')
  const loser = [a, b].find((r) => !r.won)
  assert.equal(loser.contended, true, 'and the other is told it is contended, not broken')
  assert.equal(loser.error, undefined)
  assert.equal(gh.refs.get('refs/sydevs-lease/858'), 'headsha')
})

test('listLeases asks for the namespace with no trailing slash, and reads only it', async () => {
  const gh = refWorld()
  let asked = null
  const real = gh.rest.git.listMatchingRefs
  gh.rest.git.listMatchingRefs = async (a) => { asked = a.ref; return real(a) }
  gh.refs.set('refs/sydevs-lease/858', 'x')
  gh.refs.set('refs/sydevs-lease-not-a-lease', 'x')
  gh.refs.set('refs/heads/main', 'x')
  assert.deepEqual(await listLeases(gh, 'sydevs', 'SahajCloud'), [858])
  assert.equal(asked, 'sydevs-lease', 'a trailing slash would land in the URL path')
})

test('a sweep that cannot read the refs reclaims nothing', async () => {
  const gh = refWorld()
  gh.rest.git.listMatchingRefs = async () => { throw Object.assign(new Error('502'), { status: 502 }) }
  assert.deepEqual(await listLeases(gh, 'sydevs', 'SahajCloud'), [])
})

test('a lease is taken under a ref outside heads and tags, so it is not a branch', async () => {
  const gh = refWorld()
  await takeLease(gh, item, 'headsha')
  assert.equal(leaseRef(858), 'refs/sydevs-lease/858')
  assert.deepEqual([...gh.refs.keys()], ['refs/sydevs-lease/858'])
  assert.deepEqual(await listLeases(gh, 'sydevs', 'SahajCloud'), [858])
})

test('an issue has no head sha, so the lease anchors on the default branch', async () => {
  const gh = refWorld()
  assert.deepEqual(await takeLease(gh, { ...item, number: 9 }), { won: true })
  assert.equal(gh.refs.get('refs/sydevs-lease/9'), 'defaultbranchsha')
})

test('a release makes the item leasable again, and a release of nothing still succeeds', async () => {
  const gh = refWorld()
  await takeLease(gh, item, 'headsha')
  assert.equal(await releaseLease(gh, item), true)
  assert.equal(await releaseLease(gh, item), true, 'already gone is the state we wanted')
  assert.deepEqual((await takeLease(gh, item, 'headsha')), { won: true }, 'and the next pass may take it')
})

test('a lease that cannot be written refuses the fire rather than failing open', async () => {
  const gh = refWorld()
  gh.rest.git.createRef = async () => { const e = new Error('Resource not accessible by personal access token'); e.status = 403; throw e }
  const r = await takeLease(gh, item, 'headsha')
  assert.equal(r.won, false)
  assert.equal(r.contended, undefined, 'a 403 is not contention')
  assert.match(r.error, /403 Resource not accessible/)
})

test('two fires in the same second produce two different dispatch ids', () => {
  const now = new Date('2026-10-06T03:48:16.000Z')
  const target = { repo: { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' }, kind: 'pr', number: 858 }
  const args = { handler: 'resolve-conflicts', target, snapshot: { pr: { head: { ref: 'claude/x', sha: 'abc' } } }, flags: {}, attempt: 1, journalNumber: 1, config, now }
  const a = buildRecord(args)
  const b = buildRecord(args)
  assert.notEqual(a.id, b.id, 'the same instant is not the same dispatch')
  assert.equal(a.firedAt, b.firedAt, 'and the ids differ by more than the clock')
  // The stamp keeps its milliseconds too, so the ids sort by time as before.
  assert.match(a.id, /^SahajCloud-858-resolve-conflicts-20261006T034816000Z-[0-9a-f]{4}$/)
})

test('the dispatch id suffix is four hex digits, whatever the random source returns', () => {
  const now = new Date('2026-10-06T03:48:16.000Z')
  const id = (rand) => dispatchId({ repoName: 'SahajCloud', number: 858, handler: 'fix-ci', now, rand })
  assert.match(id(() => 0), /-0000$/, 'the low end still pads to four')
  assert.match(id(() => 0.9999999), /-ffff$/)
})

// --- the reclaim arm ----------------------------------------------------
const leaseTarget = { repo: { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' }, kind: 'issue', number: 858, reason: 'sweep-lease', facts: {} }
const snap = (over) => ({ kind: 'issue', repo: leaseTarget.repo, item: { number: 858, labels: [], body: '', state: 'open' }, locked: false, record: { current: null, dispatches: [] }, ...over })

test('sweep-lease reclaims a ref left on an item with no lock and no session', () => {
  const plan = decide(leaseTarget, snap(), config)
  assert.deepEqual(plan.map((a) => a.type), ['releaseLease'])
  assert.match(plan[0].why, /no lock and no session/)
})

test('sweep-lease leaves a live lease alone — the label or the record is enough', () => {
  const locked = decide(leaseTarget, snap({ locked: true, item: { number: 858, labels: ['bot:working'], body: '', state: 'open' } }), config)
  assert.deepEqual(locked.map((a) => a.type), ['note'])
  const recorded = decide(leaseTarget, snap({ record: { current: { handler: 'fix-ci' }, dispatches: [] } }), config)
  assert.deepEqual(recorded.map((a) => a.type), ['note'])
  assert.match(recorded[0].text, /fix-ci is still recorded/)
})

test('a 422 that is not "already exists" is an error, not contention', async () => {
  // GitHub answers 422 for a stale anchor sha and a malformed ref name too.
  // Reading either as contention suppresses the anomaly and leaves the item
  // silent, which is the failure mode this whole change exists to remove.
  const gh = refWorld()
  gh.rest.git.createRef = async () => { const e = new Error('Object does not exist'); e.status = 422; throw e }
  const r = await takeLease(gh, item, 'deadbee')
  assert.equal(r.won, false)
  assert.equal(r.contended, undefined, 'so the caller journals it')
  assert.match(r.error, /422 Object does not exist/)
})

test('contention is still read from the message GitHub actually sends', async () => {
  const gh = refWorld()
  await takeLease(gh, item, 'headsha')
  const r = await takeLease(gh, item, 'headsha')
  assert.deepEqual(r, { won: false, contended: true })
})

test('a lease ref whose tail is not canonical digits is never read as a number', async () => {
  // `Number()` accepts all of these, and `leaseRef` would rebuild a different
  // name from each — so the reclaim would delete item 858's live lease.
  const gh = refWorld()
  gh.refs.set('refs/sydevs-lease/858', 'live')
  for (const tail of ['858.0', '+858', ' 858', '1e3', '0858', '0', '-5', '', 'abc']) {
    gh.refs.set(`refs/sydevs-lease/${tail}`, 'planted')
  }
  assert.deepEqual(await listLeases(gh, 'sydevs', 'SahajCloud'), [858], 'only the canonical ref is a lease')
})
