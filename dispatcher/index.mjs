/**
 * Entry points for the two jobs of `.github/workflows/dispatcher.yml`.
 *
 *   resolveTargets({ github, context, core, config })          — the `resolve` job
 *   act({ github, context, core, config, target, env, dryRun }) — one `act` matrix leg
 *   planContractSync({ github, context, core, config })        — the `contracts-plan` job
 *   depsTick({ github, core, config, env, dryRun })             — the `deps` job
 *
 * `act` gathers a snapshot, decides a plan, applies it, and then handles any
 * targets the plan emitted (dependents, a conflict scan) in the same job —
 * those run after the originating item, which is the ordering the plan wants.
 * It starts from the target's own `reasons`, so one matrix leg carries every
 * reason resolve found for that item. (why: docs/why.md#one-target-per-item)
 */

import { readFileSync } from 'node:fs'
import { resolve as resolveEvent, coalesceTargets } from './resolve.mjs'
import { gather } from './gather.mjs'
import { decide } from './decide.mjs'
import { apply } from './apply.mjs'
import { ensureJournalDay, refreshTally, closeDuplicateDays, previousJournalDay, postAnomaly } from './journal.mjs'

export { planContractSync } from './contracts.mjs'
export { depsTick } from './deps.mjs'

export function loadConfig(path) {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

export async function resolveTargets({ github, context, core, config }) {
  const targets = coalesceTargets(await resolveEvent({ github, context, config }))
  core.info(`${context.eventName}.${context.payload.action || ''} → ${targets.length} target(s): ${targets.map((t) => `${t.kind}#${t.number}:${t.reasons.map((r) => r.reason).join('+')}`).join(', ') || 'none'}`)
  return targets
}

export async function act({ github, context, core, config, target, env = process.env, dryRun = false, now = new Date(), fetchImpl }) {
  // One leg, every reason resolve found for this item, in the order it found
  // them — then whatever the plans emit. (why: docs/why.md#one-target-per-item)
  const queue = (target.reasons || [{ reason: target.reason, facts: target.facts }])
    .map(({ reason, facts }) => ({ ...target, reason, facts: facts || {}, reasons: undefined }))
  const seen = new Set()
  while (queue.length) {
    const t = queue.shift()
    const key = `${t.repo.full}#${t.number}:${t.reason}`
    if (seen.has(key)) continue
    seen.add(key)
    const snapshot = await gather(github, t, config, { now })
    const plan = decide(t, snapshot, config)
    core.info(`${t.repo.name}#${t.number} ${t.reason}: plan = ${plan.map((a) => a.type + (a.handler ? ':' + a.handler : '') + (a.value ? ':' + a.value : '')).join(', ')}`)
    const emitted = await apply({ gh: github, target: t, snapshot, plan, config, env, dryRun, core, now, fetchImpl })
    queue.push(...emitted)
  }
}

/**
 * Journal maintenance for the journal repo's schedule: today's issue, its
 * title, and one more true count for the day that rolled.
 *
 * Three properties made a single bad tick permanent. This is unguarded, so a
 * throw in one step skipped the next; nothing revisited a day once the local
 * date moved on; and the failure was invisible, because `dispatch / journal`
 * is in `ci.ignoreCheckNames` and nothing posted an anomaly.
 * (why: docs/why.md#the-journal-tally-needs-a-writer-that-cannot-stop)
 */
export async function journalTick({ github, core, config, dryRun = false, now = new Date() }) {
  if (dryRun) return core.info('journal tick (dry run)')
  const j = await ensureJournalDay(github, config, now)

  const failures = []
  const step = async (what, fn) => {
    try { return { ok: true, value: await fn() } } catch (e) {
      const why = `${what}: ${e?.status || '?'} ${String(e?.message || e).replace(/\s+/g, ' ').slice(0, 160)}`
      core.warning(`journal tick — ${why}`)
      failures.push(why)
      return { ok: false }
    }
  }

  const closed = await step('close duplicates', () => closeDuplicateDays(github, config, now))
  if (closed.ok && closed.value.length) core.info(`closed duplicate journal issue(s): ${closed.value.join(', ')}`)

  const today = await step('tally today', () => refreshTally(github, config, j.number, now))
  core.info(`journal #${j.number}${j.created ? ' created' : ''}: ${today.ok ? JSON.stringify(today.value) : 'tally failed'}`)

  // The schedule does not keep to its cron: the `*/30` sweeper lands about
  // eight times a day, at gaps of two to five hours. So a day rolls with its
  // last true count hours old and nothing came back for it — #134 froze at
  // 00:31Z with 6.5 hours of its journal day left. Re-counting yesterday is
  // idempotent, and does not depend on which cron fired.
  const prev = await step('find yesterday', () => previousJournalDay(github, config, now))
  if (prev.ok && prev.value) {
    const back = await step('tally yesterday', () => refreshTally(github, config, prev.value.number, now, prev.value.label))
    if (back.ok && back.value) core.info(`journal #${prev.value.number} ${prev.value.day} (${prev.value.label}): ${JSON.stringify(back.value)}`)
  }

  if (failures.length) {
    try {
      await postAnomaly(github, config, j.number, { kind: 'journal-tally', text: `the journal tick could not finish — ${failures.join(' · ')}` })
    } catch { /* the day's own issue is the only place to say it, and it is unreachable */ }
  }
}
