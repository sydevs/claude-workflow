import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { listSweepTargets } from '../sweep.mjs'

const config = JSON.parse(readFileSync(new URL('../../loop-config.json', import.meta.url), 'utf-8'))
const repo = { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' }
const now = new Date('2026-09-08T12:00:00Z')

function fake({ issuesByLabel = {}, prs = [], recent = [], graphIssues = null }) {
  const rest = {
    issues: {
      listForRepo: (args) => ({ data: args.labels ? issuesByLabel[args.labels] || [] : recent }),
      listComments: () => ({ data: [] }),
    },
    pulls: { list: () => ({ data: prs }) },
  }
  const graphql = async () => ({ repository: { issues: { pageInfo: { hasNextPage: false }, nodes: graphIssues || [] } } })
  return { rest, graphql, paginate: async (fn, args) => (await fn(args)).data }
}
const bot = { login: config.identity.expectedLogin }

test('every open, unlocked bot PR is re-derived, draft included', async () => {
  const prs = [
    { number: 5, draft: false, user: bot, labels: [], updated_at: '2026-09-08T11:00:00Z' },
    { number: 6, draft: true, user: bot, labels: [], updated_at: '2026-09-08T11:00:00Z' },
    { number: 7, draft: false, user: { login: 'Ardnived' }, labels: [], updated_at: '2026-09-08T11:00:00Z' },
    { number: 8, draft: false, user: bot, labels: [{ name: 'bot:working' }], updated_at: '2026-09-08T11:00:00Z' },
  ]
  const t = await listSweepTargets({ github: fake({ issuesByLabel: { 'bot:working': [{ number: 8, pull_request: {} }] }, prs }), config, repo, now })
  const scans = t.filter((x) => x.reason === 'sweep-pr').map((x) => x.number).sort((a, b) => a - b)
  assert.deepEqual(scans, [5, 6], 'the ready one and the draft; not the human PR, not the locked one')
  assert.ok(!t.some((x) => x.reason === 'sweep-orphan'), 'a fresh draft is not an orphan')
})

test('a stale draft is re-derived first, and only then considered an orphan', async () => {
  // The derivation acts. The orphan notice only tells a human, and stays
  // quiet when the derivation found something to do.
  const prs = [{ number: 9, draft: true, user: bot, labels: [], updated_at: '2026-09-01T00:00:00Z' }]
  const t = await listSweepTargets({ github: fake({ prs }), config, repo, now })
  assert.deepEqual(t.filter((x) => x.number === 9).map((x) => x.reason), ['sweep-pr', 'sweep-orphan'], 'in that order')
})

test('a blocked item is re-checked so a passed Re-check date unparks it', async () => {
  const t = await listSweepTargets({ github: fake({ issuesByLabel: { blocked: [{ number: 3 }] } }), config, repo, now })
  assert.ok(t.some((x) => x.number === 3 && x.reason === 'unblock-check'))
})

const issue = (number, labels, blockers) => ({ number, labels: { nodes: labels.map((name) => ({ name })) }, blockedBy: { nodes: blockers.map((state) => ({ state })) } })

test('an issue GitHub records as blocked is swept even when it carries no label', async () => {
  // SahajAtlasWeb#163, #195 and #198 on 2026-09-09: correct native
  // relationships, no `blocked` label, so nothing ever re-checked them.
  const t = await listSweepTargets({
    github: fake({
      issuesByLabel: { blocked: [{ number: 9 }] },
      graphIssues: [
        issue(163, [], ['OPEN']),
        issue(195, [], ['OPEN']),
        issue(198, [], ['CLOSED', 'OPEN']),
        issue(9, ['blocked'], ['OPEN']),
        issue(40, [], ['CLOSED']),
        issue(41, [], []),
        issue(42, ['ops-journal'], ['OPEN']),
      ],
    }),
    config, repo, now,
  })
  const checks = t.filter((x) => x.reason === 'unblock-check').map((x) => x.number).sort((a, b) => a - b)
  assert.deepEqual(checks, [9, 163, 195, 198], 'the labelled one, plus the three only GitHub knew about')
  assert.equal(checks.filter((n) => n === 9).length, 1, 'the labelled one is not swept twice')
})

test('a GraphQL that cannot answer leaves the label sweep as the guarantee', async () => {
  const github = fake({ issuesByLabel: { blocked: [{ number: 9 }] } })
  github.graphql = async () => { throw new Error('Field blockedBy does not exist') }
  const t = await listSweepTargets({ github, config, repo, now })
  assert.deepEqual(t.filter((x) => x.reason === 'unblock-check').map((x) => x.number), [9])
})
