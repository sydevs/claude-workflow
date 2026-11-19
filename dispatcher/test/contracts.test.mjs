import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHECK_APPROVAL_MARKER, affectedConsumers, changedPaths, contractSyncAttestedAt, contractVerifyGate, isContractSyncOnly, planContractSync, pickFeaturePr, verifyContractSync } from '../contracts.mjs'
import { evaluatePr } from '../decide.mjs'

const config = {
  org: 'sydevs',
  repos: ['SahajCloud', 'SahajAtlasWeb', 'WeMeditateWeb', 'SahajAtlasWordpress', 'claude-workflow'],
  identity: { expectedLogin: 'sydevs-bot' },
  assignment: { reviewer: 'Ardnived', respondTo: ['Ardnived'] },
  labels: { journal: 'ops-journal', lock: 'bot:working', proposal: 'proposal' },
  ceilings: { ciFixIterations: 3 },
  mergePolicy: { loopMayNotMerge: ['claude-workflow'] },
  review: { bodyHeader: '## 🧐 Adversarial review', skipWhen: { maxFiles: 2, maxLines: 40 } },
  dispatch: { commandPrefix: '@sydevs-bot' },
  contractSync: {
    producer: 'SahajCloud',
    branch: 'claude/chore-sync-contracts',
    attestContext: 'sydevs / contract-sync',
    consumers: {
      WeMeditateWeb: { sources: ['src/payload-types.ts'], command: 'pnpm run types:cms', paths: ['server/payload-types.ts'] },
      SahajAtlasWeb: { sources: ['src/payload-types.ts', 'src/collections/Events/endpoints/responseTypes.ts'], command: 'pnpm run types:cms', paths: ['src/types/payload/payload-types.ts', 'src/types/payload/response-types.ts'] },
      SahajAtlasWordpress: { sources: ['src/lib/atlas/atlas-url-contract.json'], command: 'curl …', paths: ['tests/atlas-url-contract.json'] },
    },
  },
}

test('a producer merge touching the types re-syncs both type consumers, and only them', () => {
  const out = affectedConsumers(config, 'SahajCloud', ['src/payload-types.ts', 'src/collections/Events/index.ts'])
  assert.deepEqual(out.map((c) => c.name), ['WeMeditateWeb', 'SahajAtlasWeb'])
  assert.deepEqual(out[0], { repo: 'sydevs/WeMeditateWeb', name: 'WeMeditateWeb', command: 'pnpm run types:cms', paths: ['server/payload-types.ts'], branch: 'claude/chore-sync-contracts', attestContext: 'sydevs / contract-sync' })
})

test('a source only one consumer copies re-syncs only that consumer', () => {
  assert.deepEqual(affectedConsumers(config, 'SahajCloud', ['src/lib/atlas/atlas-url-contract.json']).map((c) => c.name), ['SahajAtlasWordpress'])
  assert.deepEqual(affectedConsumers(config, 'SahajCloud', ['src/collections/Events/endpoints/responseTypes.ts']).map((c) => c.name), ['SahajAtlasWeb'])
})

test('nothing re-syncs for a non-producer, an untouched source, or no config', () => {
  assert.deepEqual(affectedConsumers(config, 'WeMeditateWeb', ['server/payload-types.ts']), [])
  assert.deepEqual(affectedConsumers(config, 'SahajCloud', ['README.md']), [])
  assert.deepEqual(affectedConsumers({ ...config, contractSync: undefined }, 'SahajCloud', ['src/payload-types.ts']), [])
})

test('a consumer that is not one of the repos is never synced', () => {
  const cfg = { ...config, repos: ['SahajCloud', 'WeMeditateWeb'] }
  assert.deepEqual(affectedConsumers(cfg, 'SahajCloud', ['src/payload-types.ts']).map((c) => c.name), ['WeMeditateWeb'])
})

const core = { info() {} }
const ctx = (over = {}) => ({
  repo: { owner: 'sydevs', repo: 'SahajCloud' },
  payload: { repository: { default_branch: 'main' }, pull_request: { number: 850, merged: true, base: { ref: 'main' }, ...over } },
})
const github = (files) => ({ rest: { pulls: { listFiles: 'listFiles' } }, paginate: async () => files })

test('the plan reads the merged PR files, a rename included, and names the source PR', async () => {
  const out = await planContractSync({ github: github([{ filename: 'src/types.ts', previous_filename: 'src/payload-types.ts' }]), context: ctx(), core, config })
  assert.deepEqual(out.map((c) => c.name), ['WeMeditateWeb', 'SahajAtlasWeb'])
  assert.equal(out[0].sourcePr, 'https://github.com/sydevs/SahajCloud/pull/850')
})

test('with no readable goal sibling, the plan keeps the standalone sync PR', async () => {
  const out = await planContractSync({ github: github([{ filename: 'src/payload-types.ts' }]), context: ctx(), core, config })
  assert.ok(out.every((c) => c.featurePr === null && c.featureBranch === ''))
})

test('a goal sibling built beside the producer takes the re-sync on its branch', async () => {
  const gh = {
    ...github([{ filename: 'src/payload-types.ts' }]),
    graphql: async (q, v) => (q.includes('closingIssuesReferences')
      ? { repository: { pullRequest: { closingIssuesReferences: { nodes: [{ number: 10 }] } } } }
      : { repository: { issue: { closedByPullRequestsReferences: { nodes: v.r === 'SahajAtlasWeb' ? [{ number: 77, state: 'OPEN', headRefName: 'claude/feat-12-map', author: { login: 'sydevs-bot' } }] : [] } } } }),
    request: async () => ({ data: [{ number: 12, state: 'open', repository: { name: 'SahajAtlasWeb' } }] }),
  }
  const out = await planContractSync({ github: gh, context: ctx(), core, config })
  assert.deepEqual(out.map((c) => [c.name, c.featurePr, c.featureBranch]), [['WeMeditateWeb', null, ''], ['SahajAtlasWeb', 77, 'claude/feat-12-map']])
})

test('the shared path list carries a rename under both names', async () => {
  const gh = github([{ filename: 'src/types.ts', previous_filename: 'src/payload-types.ts' }, { filename: 'src/app.ts' }])
  assert.deepEqual(await changedPaths(gh, { owner: 'sydevs', repo: 'SahajCloud', number: 850 }), ['src/types.ts', 'src/payload-types.ts', 'src/app.ts'])
})

test('only an open bot PR on a claude branch is a feature PR', () => {
  const pr = (over) => ({ number: 1, state: 'OPEN', headRefName: 'claude/feat-1-x', author: { login: 'sydevs-bot' }, ...over })
  assert.deepEqual(pickFeaturePr([pr()], 'sydevs-bot'), { number: 1, branch: 'claude/feat-1-x' })
  for (const bad of [pr({ state: 'MERGED' }), pr({ author: { login: 'Ardnived' } }), pr({ headRefName: 'feature/x' })]) assert.equal(pickFeaturePr([bad], 'sydevs-bot'), null)
})

test('the plan skips an unmerged PR and a merge into another branch', async () => {
  const files = github([{ filename: 'src/payload-types.ts' }])
  assert.deepEqual(await planContractSync({ github: files, context: ctx({ merged: false }), core, config }), [])
  assert.deepEqual(await planContractSync({ github: files, context: ctx({ base: { ref: 'release' } }), core, config }), [])
})

test('a PR is a sync only on the sync branch and within the copy', () => {
  const pr = { head: { ref: 'claude/chore-sync-contracts' } }
  const copy = ['src/types/payload/payload-types.ts', 'src/types/payload/response-types.ts']
  assert.equal(isContractSyncOnly(config, 'SahajAtlasWeb', pr, copy), true)
  assert.equal(isContractSyncOnly(config, 'WeMeditateWeb', pr, ['server/payload-types.ts', 'server/atlas-client.ts']), false, 'fix-ci touched a second file')
  // A count within the copy's is not a sync: fix-ci edited code beside one copied file.
  assert.equal(isContractSyncOnly(config, 'SahajAtlasWeb', pr, [copy[0], 'src/App.tsx']), false)
  assert.equal(isContractSyncOnly(config, 'SahajAtlasWeb', { ...pr, head: { ref: 'claude/feat-1-x' } }, copy), false)
  assert.equal(isContractSyncOnly(config, 'SahajCloud', pr, copy), false)
  // An empty list satisfies `every`. It must not arm auto-merge on a list we never read.
  assert.equal(isContractSyncOnly(config, 'SahajAtlasWeb', pr, []), false, 'an empty file list is not a sync')
  assert.equal(isContractSyncOnly(config, 'SahajAtlasWeb', pr, undefined), false, 'an absent file list is not a sync')
})

test('a green sync draft skips the critic and says why', () => {
  const s = {
    kind: 'pr',
    repo: { owner: 'sydevs', name: 'WeMeditateWeb', full: 'sydevs/WeMeditateWeb' },
    item: { number: 140, labels: [] },
    locked: false,
    record: { fixCi: 0 },
    pr: { number: 140, state: 'open', draft: true, user: { login: 'sydevs-bot' }, head: { sha: 'abc', ref: 'claude/chore-sync-contracts' }, changed_files: 1, additions: 400, deletions: 90, contractSyncOnly: true },
    mergeable: 'MERGEABLE',
    reviews: [], threads: [], comments: [],
    ci: { green: true, reason: 'green', running: [], failing: [] },
    normalized: { reviewDecision: null },
  }
  const plan = evaluatePr(s, config)
  assert.ok(!plan.some((a) => a.type === 'fire'), 'no critic')
  assert.ok(plan.some((a) => a.type === 'markReady'))
  assert.match(plan.find((a) => a.type === 'comment').body, /only re-syncs a copied contract/)
  assert.ok(evaluatePr({ ...s, pr: { ...s.pr, contractSyncOnly: false } }, config).some((a) => a.type === 'fire' && a.handler === 'review-pr'))
})

test('a green sync draft is marked ready without asking the reviewer: contract-verify asks on a mismatch', () => {
  const s = {
    kind: 'pr',
    repo: { owner: 'sydevs', name: 'WeMeditateWeb', full: 'sydevs/WeMeditateWeb' },
    item: { number: 140, labels: [] },
    locked: false,
    record: { fixCi: 0 },
    pr: { number: 140, state: 'open', draft: true, user: { login: 'sydevs-bot' }, head: { sha: 'abc', ref: 'claude/chore-sync-contracts' }, changed_files: 1, additions: 400, deletions: 90, contractSyncOnly: true },
    mergeable: 'MERGEABLE',
    reviews: [], threads: [], comments: [],
    ci: { green: true, reason: 'green', running: [], failing: [] },
    normalized: { reviewDecision: null },
  }
  const types = (p) => p.map((a) => a.type)
  assert.ok(!types(evaluatePr(s, config)).includes('requestReviewer'))
  assert.ok(types(evaluatePr(s, config)).includes('armAutoMerge'), 'still armed: the approval is what it waits on')
  // fix-ci adapted code beside the copy: reviewed like any other bot PR.
  assert.ok(types(evaluatePr({ ...s, pr: { ...s.pr, contractSyncOnly: false, changed_files: 1, additions: 3, deletions: 1 } }, config)).includes('requestReviewer'))
})

const verifyPr = (over = {}) => ({
  number: 292, state: 'open', draft: false, user: { login: 'sydevs-bot' },
  head: { sha: 'abc1234', ref: 'claude/chore-sync-contracts', repo: { full_name: 'sydevs/WeMeditateWeb' } },
  base: { ref: 'main', repo: { full_name: 'sydevs/WeMeditateWeb', default_branch: 'main' } },
  ...over,
})

test('the contract check vouches only for a ready, same-repo bot PR into main that changes nothing but the copy', () => {
  const files = ['server/payload-types.ts']
  assert.deepEqual(contractVerifyGate(config, 'WeMeditateWeb', verifyPr(), files), { ok: true, reason: 'a contract-only sync' })
  const ok = (pr, f = files, repo = 'WeMeditateWeb') => contractVerifyGate(config, repo, pr, f).ok
  assert.equal(ok(verifyPr({ draft: true })), false, 'a draft')
  assert.equal(ok(verifyPr({ state: 'closed' })), false, 'closed')
  assert.equal(ok(verifyPr({ user: { login: 'Ardnived' } })), false, 'not the bot')
  assert.equal(ok(verifyPr({ head: { ...verifyPr().head, repo: { full_name: 'someone/WeMeditateWeb' } } })), false, 'a fork')
  assert.equal(ok(verifyPr({ head: { ...verifyPr().head, ref: 'claude/feat-1' } })), false, 'another branch')
  assert.equal(ok(verifyPr({ base: { ...verifyPr().base, ref: 'release' } })), false, 'retargeted off main')
  assert.equal(ok(verifyPr(), [...files, 'server/atlas-client.ts']), false, 'a file beside the copy')
  assert.equal(ok(verifyPr(), []), false, 'an unread file list')
  assert.equal(ok(verifyPr(), files, 'SahajCloud'), false, 'the producer')
})

const ATTEST = (login = 'sydevs-bot', over = {}) => ({ context: 'sydevs / contract-sync', state: 'success', creator: { login }, created_at: '2026-11-20T10:00:00Z', ...over })

test("only the bot's success status on the head vouches for it", () => {
  assert.equal(contractSyncAttestedAt([ATTEST()], config), '2026-11-20T10:00:00Z')
  assert.equal(contractSyncAttestedAt([ATTEST('someone')], config), null, 'anyone with push access can post a status')
  assert.equal(contractSyncAttestedAt([ATTEST('sydevs-bot', { state: 'pending' })], config), null)
  assert.equal(contractSyncAttestedAt([ATTEST('sydevs-bot', { context: 'other' })], config), null)
  assert.equal(contractSyncAttestedAt([], config), null)
})

function verifyGithub({ pr = verifyPr(), reviews = [], statuses = [ATTEST()], files = ['server/payload-types.ts'], associated = [] } = {}) {
  const calls = []
  const rec = (name) => async (args) => { calls.push({ name, args }); return { data: {} } }
  const github = {
    paginate: async (fn, args) => (await fn(args)).data,
    rest: {
      pulls: { get: async () => ({ data: pr }), listReviews: async () => ({ data: reviews }), listFiles: async () => ({ data: files.map((filename) => ({ filename })) }) },
      repos: { listCommitStatusesForRef: async () => ({ data: statuses }), listPullRequestsAssociatedWithCommit: async () => ({ data: associated }) },
    },
  }
  const approver = { rest: { pulls: { createReview: rec('createReview'), dismissReview: rec('dismissReview') } } }
  return { github, approver, calls }
}
const prEvent = { repo: { owner: 'sydevs', repo: 'WeMeditateWeb' }, payload: { pull_request: { number: 292 } } }
const quiet = { info: () => {} }
const verify = (g, over = {}) => verifyContractSync({ github: g.github, approver: g.approver, context: prEvent, core: quiet, config, ...over })
const ownApproval = (commit_id, id = 1) => ({ id, state: 'APPROVED', commit_id, body: `${CHECK_APPROVAL_MARKER}\nApproved`, user: { login: 'github-actions[bot]' } })

test('a head the sync wrote is approved with the consumer token, pinned to it, once', async () => {
  const g = verifyGithub()
  await verify(g)
  assert.deepEqual(g.calls.map((c) => c.name), ['createReview'])
  assert.equal(g.calls[0].args.commit_id, 'abc1234')
  assert.equal(g.calls[0].args.event, 'APPROVE')
  assert.ok(g.calls[0].args.body.startsWith(CHECK_APPROVAL_MARKER))
  const again = verifyGithub({ reviews: [ownApproval('abc1234')] })
  await verify(again)
  assert.deepEqual(again.calls, [])
})

test('a head the sync did not write, or the gate refuses, dismisses only the check\'s own earlier approval', async () => {
  const person = { id: 9, state: 'APPROVED', commit_id: 'old0000', body: 'LGTM', user: { login: 'Ardnived' } }
  const unattested = verifyGithub({ statuses: [], reviews: [ownApproval('old0000', 5), person] })
  await verify(unattested)
  assert.deepEqual(unattested.calls.map((c) => [c.name, c.args.review_id]), [['dismissReview', 5]])
  const outgrown = verifyGithub({ files: ['server/payload-types.ts', 'server/atlas-client.ts'], reviews: [ownApproval('old0000', 6)] })
  await verify(outgrown)
  assert.deepEqual(outgrown.calls.map((c) => [c.name, c.args.review_id]), [['dismissReview', 6]])
  const never = verifyGithub({ statuses: [] })
  await verify(never)
  assert.deepEqual(never.calls, [], 'nothing approved, nothing to take back')
})

test('a status event finds the open sync PR at that head; a dry run writes nothing', async () => {
  const g = verifyGithub({ associated: [{ number: 292, state: 'open', head: { ref: 'claude/chore-sync-contracts', sha: 'abc1234' } }, { number: 7, state: 'open', head: { ref: 'claude/feat-1', sha: 'abc1234' } }] })
  await verifyContractSync({ github: g.github, approver: g.approver, context: { repo: prEvent.repo, payload: { sha: 'abc1234' } }, core: quiet, config })
  assert.deepEqual(g.calls.map((c) => c.name), ['createReview'])
  const dry = verifyGithub()
  await verify(dry, { dryRun: true })
  assert.deepEqual(dry.calls, [])
})

const readySync = (contractSync, over = {}) => ({
  kind: 'pr',
  repo: { owner: 'sydevs', name: 'WeMeditateWeb', full: 'sydevs/WeMeditateWeb' },
  item: { number: 292, labels: [] },
  locked: false,
  record: { fixCi: 0 },
  now: new Date('2026-11-20T10:10:00Z'),
  pr: { number: 292, state: 'open', draft: false, user: { login: 'sydevs-bot' }, head: { sha: 'abc1234', ref: 'claude/chore-sync-contracts' }, base: { ref: 'main', defaultBranch: 'main' }, changed_files: 1, additions: 11, deletions: 0, contractSyncOnly: true, contractSync, autoMergeArmed: true, ...over },
  mergeable: 'MERGEABLE',
  reviews: [], threads: [], comments: [],
  ci: { green: true, reason: 'green', running: [], failing: [] },
  normalized: { reviewDecision: null },
})

test('a ready sync asks the reviewer only when the check cannot carry it, and says why', () => {
  const at = '2026-11-20T10:00:00Z'
  const plan = (c, over) => evaluatePr(readySync(c, over), config)
  const asked = (p) => p.some((a) => a.type === 'requestReviewer')
  const said = (p) => p.find((a) => a.type === 'comment' && a.key.startsWith('contract-check'))
  assert.ok(!asked(plan({ attestedAt: at, approvedByCheck: false, decision: null })), 'waits for the check, inside the window')
  assert.ok(!asked(plan({ attestedAt: at, approvedByCheck: true, decision: 'APPROVED' })), 'approved and counted: the queue merges it')
  const cases = [
    [{ attestedAt: null, approvedByCheck: false }, {}, /commits the contract sync did not write/, 'contract-check abc1234'],
    [{ attestedAt: at, approvedByCheck: true, decision: 'REVIEW_REQUIRED' }, {}, /ruleset does not count/, 'contract-check abc1234'],
    [{ attestedAt: '2026-11-20T09:00:00Z', approvedByCheck: false }, {}, /has not approved it/, 'contract-check abc1234'],
    [{ attestedAt: at, approvedByCheck: true, decision: 'APPROVED' }, { contractSyncOnly: false }, /changes more than the copied contract/, 'contract-check outgrew'],
  ]
  for (const [c, over, why, key] of cases) {
    const p = plan(c, over)
    assert.ok(asked(p), String(why))
    assert.match(said(p).body, why)
    assert.equal(said(p).key, key)
  }
  assert.ok(!asked(plan(null)), 'not a sync PR')
})
