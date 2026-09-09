/**
 * Entry points for the two jobs of `.github/workflows/dispatcher.yml`.
 *
 *   resolveTargets({ github, context, core, config })          — the `resolve` job
 *   act({ github, context, core, config, target, env, dryRun }) — one `act` matrix leg
 *
 * `act` gathers a snapshot, decides a plan, applies it, and then handles any
 * targets the plan emitted (dependents, a conflict scan) in the same job —
 * those run after the originating item, which is the ordering the plan wants.
 */

import { readFileSync } from 'node:fs'
import { resolve as resolveEvent } from './resolve.mjs'
import { gather } from './gather.mjs'
import { decide } from './decide.mjs'
import { apply } from './apply.mjs'
import { ensureJournalDay, refreshTally, closeDuplicateDays } from './journal.mjs'

export function loadConfig(path) {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

export async function resolveTargets({ github, context, core, config }) {
  const targets = await resolveEvent({ github, context, config })
  core.info(`${context.eventName}.${context.payload.action || ''} → ${targets.length} target(s): ${targets.map((t) => `${t.kind}#${t.number}:${t.reason}`).join(', ') || 'none'}`)
  return targets
}

export async function act({ github, context, core, config, target, env = process.env, dryRun = false, now = new Date(), fetchImpl }) {
  const queue = [target]
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

/** Journal maintenance for the journal repo's schedule: ensure today's issue and refresh its title. */
export async function journalTick({ github, core, config, dryRun = false, now = new Date() }) {
  if (dryRun) return core.info('journal tick (dry run)')
  const j = await ensureJournalDay(github, config, now)
  const closed = await closeDuplicateDays(github, config, now)
  if (closed.length) core.info(`closed duplicate journal issue(s): ${closed.join(', ')}`)
  const counts = await refreshTally(github, config, j.number, now)
  core.info(`journal #${j.number}${j.created ? ' created' : ''}: ${JSON.stringify(counts)}`)
}
