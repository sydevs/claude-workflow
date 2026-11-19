import { test } from 'node:test'
import assert from 'node:assert/strict'
import { affectedConsumers, approveContractSync, changedPaths, contractVerdict, contractVerifyGate, contractVerifyStatus, isContractSyncOnly, planContractSync, pickFeaturePr, reportContractVerify } from '../contracts.mjs'
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
    verifyContext: 'sydevs / contract-verify',
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
  assert.deepEqual(out[0], { repo: 'sydevs/WeMeditateWeb', name: 'WeMeditateWeb', command: 'pnpm run types:cms', paths: ['server/payload-types.ts'], branch: 'claude/chore-sync-contracts' })
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
  base: { repo: { full_name: 'sydevs/WeMeditateWeb' } },
  ...over,
})

test('contract-verify checks only a ready, same-repo bot PR that changes nothing but the copy', () => {
  const files = ['server/payload-types.ts']
  const ok = contractVerifyGate(config, 'WeMeditateWeb', verifyPr(), files)
  assert.deepEqual(ok, { verify: true, reason: 'a contract-only sync', sha: 'abc1234', command: 'pnpm run types:cms', paths: ['server/payload-types.ts'] })
  const no = (pr, f = files, repo = 'WeMeditateWeb') => contractVerifyGate(config, repo, pr, f).verify
  assert.equal(no(verifyPr({ draft: true })), false, 'a draft')
  assert.equal(no(verifyPr({ state: 'closed' })), false, 'closed')
  assert.equal(no(verifyPr({ user: { login: 'Ardnived' } })), false, 'not the bot')
  assert.equal(no(verifyPr({ head: { ...verifyPr().head, repo: { full_name: 'someone/WeMeditateWeb' } } })), false, 'a fork')
  assert.equal(no(verifyPr({ head: { ...verifyPr().head, ref: 'claude/feat-1' } })), false, 'another branch')
  assert.equal(no(verifyPr(), [...files, 'server/atlas-client.ts']), false, 'a file beside the copy')
  assert.equal(no(verifyPr(), []), false, 'an unread file list')
  assert.equal(no(verifyPr(), files, 'SahajCloud'), false, 'the producer')
})

function verifyGithub({ pr = verifyPr(), reviews = [] } = {}) {
  const calls = []
  const rec = (name) => async (args) => { calls.push({ name, args }); return { data: {} } }
  return {
    calls,
    paginate: async (fn) => (await fn()).data,
    rest: {
      pulls: { get: async () => ({ data: pr }), listReviews: async () => ({ data: reviews }), createReview: rec('createReview') },
      repos: { createCommitStatus: rec('createCommitStatus') },
    },
  }
}
const verifyCtx = { repo: { owner: 'sydevs', repo: 'WeMeditateWeb' }, payload: { pull_request: { number: 292 } }, serverUrl: 'https://github.com', runId: 7 }
const verifyCore = { info: () => {} }
const approve = (github) => approveContractSync({ github, context: verifyCtx, core: verifyCore, sha: 'abc1234', command: 'pnpm run types:cms' })

test('a matching sync is approved, pinned to the head it compared, once', async () => {
  const gh = verifyGithub()
  await approve(gh)
  assert.deepEqual(gh.calls.map((c) => c.name), ['createReview'])
  assert.equal(gh.calls[0].args.commit_id, 'abc1234')
  assert.equal(gh.calls[0].args.event, 'APPROVE')
  const again = verifyGithub({ reviews: [{ state: 'APPROVED', commit_id: 'abc1234', user: { login: 'anyone' } }] })
  await approve(again)
  assert.deepEqual(again.calls, [])
})

test('a head that moved is not approved: its own run decides', async () => {
  const gh = verifyGithub({ pr: verifyPr({ head: { ...verifyPr().head, sha: 'def5678' } }) })
  await approve(gh)
  assert.deepEqual(gh.calls, [])
})

test('the verdict: success only when matched and approved, failure on a mismatch, error otherwise', () => {
  const command = 'pnpm run types:cms'
  assert.equal(contractVerdict({ matched: 'true', approved: true, command }).state, 'success')
  assert.equal(contractVerdict({ matched: 'true', approved: false, command }).state, 'error', 'the approval failed')
  assert.equal(contractVerdict({ matched: 'false', approved: false, command }).state, 'failure')
  assert.match(contractVerdict({ matched: 'false', approved: false, command }).description, /Differs from what pnpm run types:cms writes/)
  assert.equal(contractVerdict({ matched: '', approved: false, command: '' }).state, 'error', 'the compare never ran')
})

test('the verdict is posted on the compared head, under the configured context, within 140 characters', async () => {
  const gh = verifyGithub()
  await reportContractVerify({ github: gh, context: verifyCtx, core: verifyCore, config, sha: 'abc1234', verdict: { state: 'failure', description: 'x'.repeat(200) } })
  const [c] = gh.calls
  assert.equal(c.name, 'createCommitStatus')
  assert.equal(c.args.sha, 'abc1234')
  assert.equal(c.args.context, 'sydevs / contract-verify')
  assert.equal(c.args.state, 'failure')
  assert.equal(c.args.description.length, 140)
  assert.equal(c.args.target_url, 'https://github.com/sydevs/WeMeditateWeb/actions/runs/7')
})

test('only the bot\'s newest verdict counts', () => {
  const st = (login, state, context = 'sydevs / contract-verify') => ({ context, state, description: state, creator: { login } })
  assert.deepEqual(contractVerifyStatus([st('someone', 'success'), st('sydevs-bot', 'failure')], config), { state: 'failure', description: 'failure' })
  assert.deepEqual(contractVerifyStatus([st('sydevs-bot', 'success'), st('sydevs-bot', 'failure')], config), { state: 'success', description: 'success' }, 'newest first')
  assert.equal(contractVerifyStatus([st('sydevs-bot', 'failure', 'other')], config), null)
  assert.equal(contractVerifyStatus([], config), null)
})

const readySync = (contractVerify, over = {}) => ({
  kind: 'pr',
  repo: { owner: 'sydevs', name: 'WeMeditateWeb', full: 'sydevs/WeMeditateWeb' },
  item: { number: 292, labels: [] },
  locked: false,
  record: { fixCi: 0 },
  pr: { number: 292, state: 'open', draft: false, user: { login: 'sydevs-bot' }, head: { sha: 'abc1234', ref: 'claude/chore-sync-contracts' }, base: { ref: 'main', defaultBranch: 'main' }, changed_files: 1, additions: 11, deletions: 0, contractSyncOnly: true, contractVerify, autoMergeArmed: true, ...over },
  mergeable: 'MERGEABLE',
  reviews: [], threads: [], comments: [],
  ci: { green: true, reason: 'green', running: [], failing: [] },
  normalized: { reviewDecision: null },
})

test('a ready sync asks the reviewer only on a failed or unfinished check, and says why once per head', () => {
  const asks = (v, over) => evaluatePr(readySync(v, over), config)
  for (const v of [null, { state: 'pending' }, { state: 'success', description: 'Matches' }]) {
    assert.ok(!asks(v).some((a) => a.type === 'requestReviewer'), `quiet on ${v?.state || 'no verdict'}`)
  }
  for (const state of ['failure', 'error']) {
    const p = asks({ state, description: 'Differs from what pnpm run types:cms writes on main' })
    assert.ok(p.some((a) => a.type === 'requestReviewer'), `asks on ${state}`)
    const c = p.find((a) => a.type === 'comment')
    assert.equal(c.key, 'contract-verify abc1234')
    assert.match(c.body, /Not approved automatically: Differs from what/)
  }
  // fix-ci touched code beside the copy: the verdict is not read at all.
  assert.ok(!asks({ state: 'failure' }, { contractSyncOnly: false }).some((a) => a.type === 'comment' && a.key?.startsWith('contract-verify')))
})
