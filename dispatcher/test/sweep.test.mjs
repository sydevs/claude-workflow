import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { listSweepTargets } from '../sweep.mjs'

const config = JSON.parse(readFileSync(new URL('../../loop-config.json', import.meta.url), 'utf-8'))
const repo = { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' }
const now = new Date('2026-09-08T12:00:00Z')

function fake({ issuesByLabel = {}, prs = [], recent = [], blockedSearch = [] }) {
  const rest = {
    issues: {
      listForRepo: (args) => ({ data: args.labels ? issuesByLabel[args.labels] || [] : recent }),
      listComments: () => ({ data: [] }),
    },
    pulls: { list: () => ({ data: prs }) },
    search: { issuesAndPullRequests: async () => ({ data: { items: blockedSearch } }) },
  }
  return { rest, paginate: async (fn, args) => (await fn(args)).data }
}
const bot = { login: config.identity.expectedLogin }

test('every open, unlocked, non-draft bot PR is re-derived — a resolved thread fires no workflow', async () => {
  const prs = [
    { number: 5, draft: false, user: bot, labels: [], updated_at: '2026-09-08T11:00:00Z' },
    { number: 6, draft: true, user: bot, labels: [], updated_at: '2026-09-08T11:00:00Z' },
    { number: 7, draft: false, user: { login: 'Ardnived' }, labels: [], updated_at: '2026-09-08T11:00:00Z' },
    { number: 8, draft: false, user: bot, labels: [{ name: 'bot:working' }], updated_at: '2026-09-08T11:00:00Z' },
  ]
  const t = await listSweepTargets({ github: fake({ issuesByLabel: { 'bot:working': [{ number: 8, pull_request: {} }] }, prs }), config, repo, now })
  const scans = t.filter((x) => x.reason === 'conflict-scan').map((x) => x.number)
  assert.deepEqual(scans, [5], 'only the open, unlocked, non-draft bot PR')
  assert.ok(!t.some((x) => x.reason === 'sweep-orphan'), 'a fresh draft is not an orphan')
})

test('a stale draft is an orphan, and is not also re-derived', async () => {
  const prs = [{ number: 9, draft: true, user: bot, labels: [], updated_at: '2026-09-01T00:00:00Z' }]
  const t = await listSweepTargets({ github: fake({ prs }), config, repo, now })
  assert.deepEqual(t.filter((x) => x.number === 9).map((x) => x.reason), ['sweep-orphan'])
})

test('a blocked item is re-checked so a passed Re-check date unparks it', async () => {
  const t = await listSweepTargets({ github: fake({ issuesByLabel: { blocked: [{ number: 3 }] } }), config, repo, now })
  assert.ok(t.some((x) => x.number === 3 && x.reason === 'unblock-check'))
})

test('an issue GitHub calls blocked is swept even when it carries no label', async () => {
  // SahajAtlasWeb#195 and #198 on 2026-09-09: correct native relationships,
  // no `blocked` label, so nothing would ever have re-checked them.
  const t = await listSweepTargets({
    github: fake({ issuesByLabel: { blocked: [{ number: 9 }] }, blockedSearch: [{ number: 195 }, { number: 198 }, { number: 9 }] }),
    config, repo, now,
  })
  const checks = t.filter((x) => x.reason === 'unblock-check').map((x) => x.number).sort((a, b) => a - b)
  assert.deepEqual(checks, [9, 195, 198], 'the labelled one and the two only GitHub knew about')
  assert.equal(checks.filter((n) => n === 9).length, 1, 'the labelled one is not swept twice')
})
