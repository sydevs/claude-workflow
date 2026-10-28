import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { applyRelay, pushRoute, relayRefusal } from '../relay.mjs'
import { fullTreatment, decide } from '../decide.mjs'
import { parseRequest } from '../markers.mjs'
import { deriveStatus } from '../status.mjs'

const config = JSON.parse(readFileSync(new URL('../../loop-config.json', import.meta.url), 'utf-8'))
const SHA = 'a'.repeat(40)
const BRANCH = 'claude/relay-318-aaaaaaa'

const err = (status, message) => Object.assign(new Error(message), { status })

/** A fake with just the git and merge calls the relay makes. */
function fakeGit({ relayAt = SHA, update, merge } = {}) {
  const calls = []
  const gh = {
    calls,
    rest: {
      git: {
        getRef: async (a) => {
          calls.push(['getRef', a.ref])
          if (!relayAt) throw err(404, 'Not Found')
          return { data: { object: { sha: relayAt } } }
        },
        updateRef: async (a) => { calls.push(['updateRef', a.ref, a.sha, a.force]); if (update) throw update; return { data: {} } },
        deleteRef: async (a) => { calls.push(['deleteRef', a.ref]); return { data: {} } },
      },
      repos: { merge: async (a) => { calls.push(['merge', a.base, a.head]); if (merge) throw merge; return { status: 201, data: {} } } },
    },
  }
  return gh
}
const req = { branch: BRANCH, head: 'feat/theirs', sha: SHA }
const repo = { owner: 'sydevs', repo: 'SahajAtlasWeb' }

test('relay: a fast-forward lands it and deletes the relay branch', async () => {
  const gh = fakeGit()
  const r = await applyRelay(gh, repo, req)
  assert.deepEqual(r, { landed: true, refusal: null })
  assert.deepEqual(gh.calls.map((c) => c[0]), ['getRef', 'updateRef', 'deleteRef'])
  assert.deepEqual(gh.calls[1], ['updateRef', 'heads/feat/theirs', SHA, false], 'never forced')
})

test('relay: the member pushed meanwhile, so it merges server-side instead', async () => {
  const gh = fakeGit({ update: err(422, 'Update is not a fast forward') })
  const r = await applyRelay(gh, repo, req)
  assert.equal(r.landed, true)
  assert.deepEqual(gh.calls.map((c) => c[0]), ['getRef', 'updateRef', 'merge', 'deleteRef'])
  assert.deepEqual(gh.calls[2], ['merge', 'feat/theirs', BRANCH])
})

test('relay: a conflict is handed back and the relay branch is kept', async () => {
  const gh = fakeGit({ update: err(422, 'Update is not a fast forward'), merge: err(409, 'Merge conflict') })
  const r = await applyRelay(gh, repo, req)
  assert.equal(r.landed, false)
  assert.equal(r.refusal.what, 'merge the relay')
  assert.match(r.refusal.why, /conflicts with feat\/theirs: Merge conflict/)
  assert.ok(!gh.calls.some((c) => c[0] === 'deleteRef'), 'nothing is lost')
})

test('relay: a workflow-scope refusal is handed back in GitHub\'s words, without a merge attempt', async () => {
  const words = 'refusing to allow a Personal Access Token to create or update workflow `.github/workflows/ci.yml` without `workflow` scope'
  const gh = fakeGit({ update: err(422, words) })
  const r = await applyRelay(gh, repo, req)
  assert.equal(r.landed, false)
  assert.equal(r.refusal.why, words)
  assert.ok(!gh.calls.some((c) => c[0] === 'merge'))
})

test('relay: a relay branch at another commit, or missing, is refused before any write', async () => {
  for (const relayAt of ['b'.repeat(40), null]) {
    const gh = fakeGit({ relayAt })
    const r = await applyRelay(gh, repo, req)
    assert.equal(r.landed, false)
    assert.match(r.refusal.why, relayAt ? /not the requested aaaaaaa/ : /does not exist/)
    assert.deepEqual(gh.calls.map((c) => c[0]), ['getRef'])
  }
})

test('relay: an unexpected error is not swallowed', async () => {
  const gh = fakeGit({ update: err(500, 'Server Error') })
  await assert.rejects(() => applyRelay(gh, repo, req), /Server Error/)
})

// ---- where a session may push --------------------------------------------

const prSnap = (over = {}) => ({
  kind: 'pr',
  repo: { owner: 'sydevs', name: 'SahajAtlasWeb', full: 'sydevs/SahajAtlasWeb' },
  item: { number: 318, labels: [] },
  pr: { number: 318, state: 'open', draft: false, user: { login: 'Ardnived' }, head: { ref: 'feat/theirs', sha: SHA, repo: 'sydevs/SahajAtlasWeb' }, base: { ref: 'main', defaultBranch: 'main' }, ...over },
})

test('push route: the branch decides, never the author', () => {
  assert.equal(pushRoute(prSnap({ head: { ref: 'claude/feat-147-submit-a-class', repo: 'sydevs/SahajAtlasWeb' } }), config, fullTreatment), 'direct', 'a member PR on a claude/* branch is pushed to directly (#318)')
  assert.equal(pushRoute(prSnap(), config, fullTreatment), 'relay', 'a member branch goes through the relay')
  assert.equal(pushRoute(prSnap({ user: { login: 'Copilot' }, head: { ref: 'copilot/fix-1', repo: 'sydevs/SahajAtlasWeb' } }), config, fullTreatment), 'relay')
  assert.equal(pushRoute(prSnap({ user: { login: 'someone' } }), config, fullTreatment), 'none', 'an outsider gets answers, not code')
  assert.equal(pushRoute(prSnap({ head: { ref: 'claude/x', repo: 'someone/SahajAtlasWeb' } }), config, fullTreatment), 'none', 'a fork is never pushed to')
})

test('relay request: each refusal names its reason', () => {
  assert.equal(relayRefusal(prSnap(), config, req, fullTreatment), null)
  assert.match(relayRefusal(prSnap(), config, { ...req, branch: 'claude/relay-999-aaaaaaa' }, fullTreatment), /is not `claude\/relay-318-\*`/)
  assert.match(relayRefusal(prSnap(), config, { ...req, branch: 'feat/sneaky' }, fullTreatment), /is not `claude\/relay-318-\*`/)
  assert.match(relayRefusal(prSnap(), config, { ...req, head: 'main' }, fullTreatment), /names `main`/)
  assert.match(relayRefusal(prSnap({ user: { login: 'someone' } }), config, req, fullTreatment), /not a relay PR/)
  assert.match(relayRefusal(prSnap({ head: { ref: 'feat/theirs', repo: 'someone/SahajAtlasWeb' } }), config, req, fullTreatment), /not a relay PR/)
  assert.match(relayRefusal(prSnap({ state: 'closed' }), config, req, fullTreatment), /not open/)
})

test('a relay request is shape-checked when it is read', () => {
  const marker = (r) => `done\n<!-- sydevs-request ${JSON.stringify({ relay: r })} -->`
  assert.deepEqual(parseRequest(marker(req)), { relay: req })
  assert.equal(parseRequest(marker({ ...req, sha: 'abc' })), null, 'a short sha is not a commit')
  assert.equal(parseRequest(marker({ ...req, head: 'feat/a b' })), null)
  assert.equal(parseRequest(marker({ ...req, branch: 'claude/relay-318-$(x)' })), null)
})

// ---- the unlock that lands it --------------------------------------------

const unlocked = (over = {}) => ({
  ...prSnap(),
  record: { current: { handler: 'address-review', firedAt: '2026-10-28T10:00:00Z' } },
  request: { at: '2026-10-28T10:30:00Z', body: { relay: req } },
  reviews: [], threads: [], comments: [], ci: { green: true, running: [], failing: [] }, normalized: { reviewDecision: null }, mergeable: 'MERGEABLE',
  now: new Date('2026-10-28T10:31:00Z'),
  ...over,
})

test('unlock: a valid relay request lands and nothing else runs', () => {
  const plan = decide({ reason: 'unlock', facts: {} }, unlocked(), config).filter((a) => a.type !== 'syncStatus' && a.type !== 'unlocked')
  assert.deepEqual(plan, [{ type: 'relay', ...req }])
})

test('unlock: a refused relay hands the PR back, naming the branch', () => {
  const s = unlocked({ request: { at: '2026-10-28T10:30:00Z', body: { relay: { ...req, branch: 'claude/relay-1-aaaaaaa' } } } })
  const plan = decide({ reason: 'unlock', facts: {} }, s, config)
  assert.ok(plan.some((a) => a.type === 'record' && a.patch.handback?.reason.startsWith('the relay was refused')))
  assert.ok(plan.some((a) => a.type === 'comment' && a.body.includes('claude/relay-1-aaaaaaa')))
  assert.ok(!plan.some((a) => a.type === 'relay' || a.type === 'fire'))
})

test('unlock: a relay request older than the session that just ended is ignored', () => {
  const s = unlocked({ request: { at: '2026-10-28T09:00:00Z', body: { relay: req } } })
  assert.ok(!decide({ reason: 'unlock', facts: {} }, s, config).some((a) => a.type === 'relay'))
})

test('every session fired at a PR carries its push route', () => {
  const s = unlocked({ request: null, mergeable: 'CONFLICTING', ci: { green: false, running: [], failing: [] } })
  const fire = decide({ reason: 'unlock', facts: {} }, s, config).find((a) => a.type === 'fire')
  assert.equal(fire.handler, 'resolve-conflicts')
  assert.equal(fire.flags.push, 'relay')
})

// ---- a stacked PR ----------------------------------------------------------

test('a stacked PR fires nothing, is never armed, and reads Awaiting', () => {
  const s = unlocked({ request: null, pr: { ...prSnap().pr, user: { login: 'sydevs-bot' }, head: { ref: 'claude/refactor-147', repo: 'sydevs/SahajAtlasWeb' }, base: { ref: 'claude/feat-147-submit-a-class', defaultBranch: 'main' } }, normalized: { reviewDecision: 'APPROVED' } })
  for (const reason of ['unlock', 'sweep-pr', 'ci']) {
    const plan = decide({ reason, facts: {} }, s, config)
    assert.ok(!plan.some((a) => ['fire', 'armAutoMerge', 'markReady'].includes(a.type)), reason)
  }
  const plan = decide({ reason: 'sweep-pr', facts: {} }, s, config)
  assert.ok(plan.some((a) => a.type === 'comment' && a.key === 'stacked claude/feat-147-submit-a-class'))
  const st = deriveStatus(s, config)
  assert.equal(st.key, 'awaiting')
  assert.match(st.reason, /stacked on claude\/feat-147-submit-a-class/)
})

test('a stacked PR gets no session on a mention either', () => {
  const s = unlocked({ request: null, record: {}, pr: { ...prSnap().pr, base: { ref: 'feat/parent', defaultBranch: 'main' } } })
  const plan = decide({ reason: 'issue_comment', facts: { author: 'Ardnived', body: '@sydevs-bot please fix', association: 'OWNER', commentId: 1 } }, s, config)
  assert.ok(!plan.some((a) => a.type === 'fire'))
})
