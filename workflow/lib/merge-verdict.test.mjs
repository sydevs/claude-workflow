// node --test workflow/lib/merge-verdict.test.mjs
//
// merge-verdict.mjs is a stdin -> stdout/exit-code contract, so each case runs
// the real script. Exit 0 is MERGE, exit 1 is HOLD or unusable input.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), 'merge-verdict.mjs')
let tmp, config

before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'merge-verdict-'))
  config = join(tmp, 'loop-config.json')
  writeFileSync(
    config,
    JSON.stringify({ assignment: { reviewer: 'boss' }, mergePolicy: { loopMayNotMerge: ['no-merge-repo'] } }),
  )
})
after(() => rmSync(tmp, { recursive: true, force: true }))

const snap = (over = {}) => ({
  repo: 'org/app',
  hasWorkflows: true,
  pr: { number: 9, draft: false, mergeable: true, mergeable_state: 'clean' },
  reviews: [{ user: { login: 'boss' }, state: 'APPROVED', submitted_at: '2026-01-01T00:00:00Z' }],
  checkRuns: { check_runs: [{ name: 'test', status: 'completed', conclusion: 'success' }] },
  reviewThreads: { review_threads: [] },
  ...over,
})

function verdict(input, args = ['--config', config]) {
  const r = spawnSync(process.execPath, [script, ...args], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf-8',
    // Run from a directory with no loop-config.json above it, when the case passes no --config.
    cwd: tmp,
  })
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() }
}

test('merge-verdict: exit code and line follow the verdict', () => {
  const rows = [
    ['merge', snap(), 0, /^org\/app#9 {2}MERGE/],
    ['draft', snap({ pr: { number: 9, draft: true, mergeable: true } }), 1, /HOLD {2}— draft/],
    ['no approval', snap({ reviews: [] }), 1, /no approving review/],
    ['stranger approval', snap({ reviews: [{ user: { login: 'rando' }, state: 'APPROVED', submitted_at: '2026-01-01T00:00:00Z' }] }), 1, /no approving review/],
    ['failing check', snap({ checkRuns: { check_runs: [{ name: 'test', status: 'completed', conclusion: 'failure' }] } }), 1, /failing: test/],
    ['loopMayNotMerge', snap({ repo: 'org/no-merge-repo' }), 1, /merged by a human/],
    ['no CI at all, and none expected', snap({ hasWorkflows: false, checkRuns: { check_runs: [] } }), 0, /no CI configured/],
    ['no checks, CI expected', snap({ checkRuns: { check_runs: [] } }), 1, /no check runs/],
  ]
  for (const [name, input, code, line] of rows) {
    const r = verdict(input)
    assert.equal(r.code, code, name)
    assert.match(r.out, line, name)
  }
})

test('merge-verdict: a snapshot cannot widen the approval allowlist', () => {
  const r = verdict(
    snap({
      reviewAuthority: ['rando'],
      reviews: [{ user: { login: 'rando' }, state: 'APPROVED', submitted_at: '2026-01-01T00:00:00Z' }],
    }),
  )
  assert.equal(r.code, 1)
  assert.match(r.out, /no approving review/)
})

test('merge-verdict: --json prints the structured verdict', () => {
  const r = verdict(snap(), ['--config', config, '--json'])
  assert.equal(r.code, 0)
  const o = JSON.parse(r.out)
  assert.equal(o.repo, 'org/app')
  assert.equal(o.pr, 9)
  assert.equal(o.verdict, 'MERGE')
  assert.equal(o.unresolved, 0)
})

test('merge-verdict: unusable input exits 1 and says why', () => {
  const rows = [
    ['not json', 'nope', /expected a JSON snapshot/],
    ['no repo', snap({ repo: undefined }), /`repo` must be "owner\/name"/],
    ['repo without owner', snap({ repo: 'app' }), /`repo` must be "owner\/name"/],
  ]
  for (const [name, input, msg] of rows) {
    const r = verdict(input)
    assert.equal(r.code, 1, name)
    assert.match(r.err, msg, name)
  }
})

test('merge-verdict: an unreadable config fails closed, and says so', () => {
  const r = verdict(snap(), ['--config', join(tmp, 'missing.json')])
  assert.equal(r.code, 1, 'no authority means no derived approval')
  assert.match(r.err, /loop-config\.json not found/)
  assert.match(r.out, /no approving review/)
})
