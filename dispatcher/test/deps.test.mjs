import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dueAlerts, depsPrInFlight, depsTick } from '../deps.mjs'

const config = JSON.parse(readFileSync(new URL('../../loop-config.json', import.meta.url), 'utf-8'))
// 2026-10-09 is a Friday; 2026-10-12 a Monday, the catch-up day.
const FRI = new Date('2026-10-09T13:20:00Z')
const MON = new Date('2026-10-12T13:20:00Z')

const alert = (n, { severity = 'high', scope = 'runtime', created = '2026-10-09T02:00:00Z', fix = '1.2.3', state = 'open' } = {}) => ({
  number: n, state, created_at: created,
  security_advisory: { severity },
  security_vulnerability: { severity, first_patched_version: fix ? { identifier: fix } : null },
  dependency: { scope, package: { name: `pkg${n}` } },
})

test('an alert opened in the last day is due, fixable or not', () => {
  assert.deepEqual(dueAlerts([alert(1), alert(2, { fix: null })], config, FRI), [1, 2])
})

test('an old alert waits for the catch-up day, and then only if a fix exists', () => {
  const old = [alert(3, { created: '2026-09-30T00:00:00Z' }), alert(4, { created: '2026-09-30T00:00:00Z', fix: null })]
  assert.deepEqual(dueAlerts(old, config, FRI), [])
  assert.deepEqual(dueAlerts(old, config, MON), [3])
})

test('severity and scope below the bar never fire a session', () => {
  const low = [alert(5, { severity: 'medium' }), alert(6, { scope: 'development' }), alert(7, { state: 'dismissed' })]
  assert.deepEqual(dueAlerts(low, config, MON), [])
  assert.deepEqual(dueAlerts([alert(8, { severity: 'critical' })], config, FRI), [8])
})

test('a bot PR on the deps branch prefix is the fix in flight; a human one is not', () => {
  const pulls = [{ number: 9, user: { login: 'Ardnived' }, head: { ref: 'claude/chore-deps-x' } }, { number: 10, user: { login: 'sydevs-bot' }, head: { ref: 'claude/feat-1-x' } }]
  assert.equal(depsPrInFlight(pulls, config), null)
  assert.equal(depsPrInFlight([...pulls, { number: 11, user: { login: 'sydevs-bot' }, head: { ref: 'claude/chore-deps-sahajcloud' } }], config).number, 11)
})

function fakeGh({ alerts = {}, pulls = {}, fail = {} }) {
  const comments = []
  return {
    comments,
    paginate: async (route, args) => {
      if (route === 'GET /repos/{owner}/{repo}/dependabot/alerts') {
        if (fail[args.repo]) throw Object.assign(new Error('Resource not accessible'), { status: 403 })
        return alerts[args.repo] || []
      }
      return pulls[args.repo] || []
    },
    rest: {
      pulls: { list: async () => ({ data: [] }) },
      issues: {
        listForRepo: async () => ({ data: [{ number: 500, title: 'Fri', created_at: FRI.toISOString(), labels: [{ name: 'ops-journal' }], body: '' }] }),
        listComments: async () => ({ data: [] }),
        createComment: async ({ body }) => { comments.push(body); return { data: {} } },
        create: async () => ({ data: { number: 500 } }),
      },
    },
  }
}
const core = { lines: [], info(m) { this.lines.push(m) }, warning(m) { this.lines.push('WARN ' + m) } }
const env = { ROUTINE_TOKEN_SAHAJCLOUD: 't', ROUTINE_TOKEN_SAHAJATLASWEB: 't', ROUTINE_TOKEN_WEMEDITATEWEB: 't', ROUTINE_TOKEN_SAHAJATLASWORDPRESS: 't' }

test('the tick fires one repo-scope record where an alert is due and nothing is in flight', async () => {
  const fired = []
  const fetchImpl = async (url, init) => { fired.push({ url, record: JSON.parse(JSON.parse(init.body).text) }); return { status: 200, json: async () => ({ claude_code_session_id: 's', claude_code_session_url: 'u' }) } }
  const gh = fakeGh({
    alerts: { SahajCloud: [alert(1)], SahajAtlasWeb: [alert(2)], WeMeditateWeb: [alert(3, { severity: 'low' })] },
    pulls: { SahajAtlasWeb: [{ number: 7, user: { login: 'sydevs-bot' }, head: { ref: 'claude/chore-deps-atlas' } }] },
  })
  await depsTick({ github: gh, core: { ...core, lines: [] }, config, env, now: FRI, fetchImpl, dryRun: false })
  assert.equal(fired.length, 1)
  const r = fired[0].record
  assert.equal(r.repo, 'sydevs/SahajCloud')
  assert.equal(r.handler, 'audit-deps')
  assert.equal(r.kind, 'repo')
  assert.equal(r.number, null)
  assert.equal(r.lock, null)
  assert.equal(r.flags.mode, 'vulnerabilities')
  assert.ok(fired[0].url.endsWith(`${config.dispatch.routines.SahajCloud}/fire`))
})

test('a dry tick fires nothing, and an unreadable repo is journalled, not thrown', async () => {
  const fetchImpl = async () => { throw new Error('must not fire') }
  const c = { ...core, lines: [] }
  await depsTick({ github: fakeGh({ alerts: { SahajCloud: [alert(1)] } }), core: c, config, env, now: FRI, fetchImpl, dryRun: true })
  assert.ok(c.lines.some((l) => l.includes('dry run')))
  const gh = fakeGh({ fail: { SahajCloud: true } })
  await depsTick({ github: gh, core: { ...core, lines: [] }, config, env, now: FRI, fetchImpl, dryRun: false })
  assert.ok(gh.comments.some((b) => b.includes('deps-check')), 'the 403 reached the journal')
})

test('unreadable alerts fall back to the weekly run: Monday fires anyway, other days only journal', async () => {
  const fired = []
  const fetchImpl = async (url, init) => { fired.push(JSON.parse(JSON.parse(init.body).text)); return { status: 200, json: async () => ({ claude_code_session_id: 's', claude_code_session_url: 'u' }) } }
  const fail = { SahajCloud: true, SahajAtlasWeb: true, WeMeditateWeb: true, SahajAtlasWordpress: true }
  const fri = fakeGh({ fail })
  await depsTick({ github: fri, core: { ...core, lines: [] }, config, env, now: FRI, fetchImpl })
  assert.equal(fired.length, 0)
  assert.ok(fri.comments.some((b) => b.includes('could not read alerts')))
  const mon = fakeGh({ fail })
  await depsTick({ github: mon, core: { ...core, lines: [] }, config, env, now: MON, fetchImpl })
  assert.deepEqual(fired.map((r) => r.repo).sort(), ['sydevs/SahajAtlasWeb', 'sydevs/SahajAtlasWordpress', 'sydevs/SahajCloud', 'sydevs/WeMeditateWeb'])
  assert.ok(mon.comments.some((b) => b.includes('firing the weekly run anyway')))
})
