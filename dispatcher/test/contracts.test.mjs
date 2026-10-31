import { test } from 'node:test'
import assert from 'node:assert/strict'
import { affectedConsumers, isContractSyncOnly, planContractSync, pickFeaturePr } from '../contracts.mjs'
import { evaluatePr } from '../decide.mjs'

const config = {
  org: 'sydevs',
  repos: ['SahajCloud', 'SahajAtlasWeb', 'WeMeditateWeb', 'SahajAtlasWordpress', 'claude-workflow'],
  identity: { expectedLogin: 'sydevs-bot' },
  assignment: { reviewer: 'Ardnived', respondTo: ['Ardnived'] },
  labels: { journal: 'ops-journal', awaiting: 'awaiting', stuck: 'stuck', blocked: 'blocked', lock: 'bot:working', proposal: 'proposal' },
  ceilings: { ciFixIterations: 3 },
  mergePolicy: { loopMayNotMerge: ['claude-workflow'] },
  review: { bodyHeader: '## 🧐 Adversarial review', skipWhen: { maxFiles: 2, maxLines: 40 } },
  dispatch: { commandPrefix: '@sydevs-bot' },
  contractSync: {
    producer: 'SahajCloud',
    branch: 'claude/chore-sync-contracts',
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
