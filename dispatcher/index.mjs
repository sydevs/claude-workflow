/**
 * Entry points for the two jobs of `.github/workflows/dispatcher.yml`.
 *
 *   resolveTargets({ github, context, core, config })          — the `resolve` job
 *   act({ github, context, core, config, target, env, dryRun }) — one `act` matrix leg
 *
 * `act` gathers a snapshot, decides a plan, applies it, and then handles any
 * targets the plan emitted (dependents, a conflict scan, the implement
 * queue) in the same job — those run after the originating item, which is
 * the ordering the plan wants.
 */

import { readFileSync } from 'node:fs'
import { resolve as resolveEvent } from './resolve.mjs'
import { gather } from './gather.mjs'
import { decide, pendingVerb } from './decide.mjs'
import { apply } from './apply.mjs'
import { approvedIssues } from './projects.mjs'
import { ensureJournalDay, refreshTitle } from './journal.mjs'
import { wip } from './gather.mjs'

export function loadConfig(path) {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

export async function resolveTargets({ github, context, core, config }) {
  const targets = await resolveEvent({ github, context, config })
  core.info(`${context.eventName}.${context.payload.action || ''} → ${targets.length} target(s): ${targets.map((t) => `${t.kind}#${t.number}:${t.reason}`).join(', ') || 'none'}`)
  return targets
}

async function drain({ github, core, config, repo, env, dryRun, now, fetchImpl }) {
  const log = (m) => core.info(`${repo.name} drain: ${m}`)
  const bot = config.identity.expectedLogin
  const slots = await wip(github, config, { owner: repo.owner, repo: repo.name }, bot)
  if (slots.slots <= 0) return log(`no slot (${slots.names.join(', ')})`)
  const queue = await approvedIssues(github, config, repo.name)
  const candidates = queue.filter((i) => !i.labels.includes(config.labels.lock))
  log(`${candidates.length} approved issue(s) without a lock`)
  let free = slots.slots
  for (const c of candidates) {
    if (free <= 0) break
    const target = { repo, kind: 'issue', number: c.number, reason: 'drain-candidate', event: 'drain', facts: {} }
    const snapshot = await gather(github, target, config, { now })
    const v = pendingVerb(snapshot, config, 'issue')
    if (v) target.facts = { author: v.comment.author, commentId: v.comment.id, triggerType: 'comment' }
    const plan = decide(target, snapshot, config)
    await apply({ gh: github, target, snapshot, plan, config, env, dryRun, core, now, fetchImpl })
    if (plan.some((a) => a.type === 'fire')) free -= 1
  }
}

export async function act({ github, context, core, config, target, env = process.env, dryRun = false, now = new Date(), fetchImpl }) {
  if (target.reason === 'drain') return drain({ github, core, config, repo: target.repo, env, dryRun, now, fetchImpl })

  const queue = [target]
  const seen = new Set()
  while (queue.length) {
    const t = queue.shift()
    const key = `${t.repo.full}#${t.number}:${t.reason}`
    if (seen.has(key)) continue
    seen.add(key)
    if (t.reason === 'drain') { await drain({ github, core, config, repo: t.repo, env, dryRun, now, fetchImpl }); continue }
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
  const counts = await refreshTitle(github, config, j.number, now)
  core.info(`journal #${j.number}${j.created ? ' created' : ''}: ${JSON.stringify(counts)}`)
}
