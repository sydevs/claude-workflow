#!/usr/bin/env node
/**
 * Validate one dispatch record, the pointer GitHub Actions fires a routine with.
 *
 * ## Why this is a script
 *
 * A routine session starts with one untrusted block on its prompt: the
 * `<routine-fire-payload>` the `/fire` endpoint wraps around whatever the
 * caller sent. Anyone holding a routine's bearer token can send anything.
 * So a handler must treat the block as data, and the only data it may act
 * on is a pointer: which repo, which item, which handler, which lock.
 *
 * A prose rule saying "check the fields" is evaluated once per fire, by a
 * model, forty times a day. This script evaluates it the same way every
 * time and refuses anything that is not a well-formed pointer at the item
 * this routine exists to handle. It reads the record from stdin and the
 * values from `loop-config.json`. It never fetches.
 * (why: docs/why.md#the-payload-is-a-pointer)
 *
 * Usage, from a handler skill:
 *
 *   ${CLAUDE_PLUGIN_ROOT}/lib/payload.mjs --expect-handler answer < record.json
 *
 * stdout: the normalized record as JSON, with `owner`, `name`, `lock`,
 * `skill`, `model`, `deadlineMs` and `resume` added.
 * stderr: every reason the record was refused.
 * exit:   0 valid, 1 refused.
 */

import { existsSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import { loadLoopConfig, flag } from './config.mjs'

export const SCHEMA_VERSION = 1

const KINDS = new Set(['issue', 'pr'])
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/

/**
 * Validate a record against the config. Pure: no I/O except the optional
 * `attachedDir` existence check, which the CLI passes through.
 *
 * Returns `{ ok: true, record }` with the normalized record, or
 * `{ ok: false, errors }` listing every problem at once, so a refused fire
 * is diagnosed in one read of the journal.
 */
export function validate(input, config, { expectHandler = null, now = Date.now(), attachedDir = null } = {}) {
  const errors = []
  const r = input && typeof input === 'object' && !Array.isArray(input) ? input : {}

  if (r.v !== SCHEMA_VERSION) errors.push(`v must be ${SCHEMA_VERSION}`)
  if (typeof r.id !== 'string' || r.id.length === 0) errors.push('id must be a non-empty string')

  const handlers = config?.handlers && typeof config.handlers === 'object' ? config.handlers : null
  if (!handlers) errors.push('loop-config.json has no `handlers` block')
  const handler = typeof r.handler === 'string' ? r.handler : ''
  if (handlers && !Object.hasOwn(handlers, handler)) errors.push(`unknown handler "${handler}"`)
  if (expectHandler && handler !== expectHandler) {
    errors.push(`record is for handler "${handler}" but this routine runs "${expectHandler}"`)
  }

  const org = typeof config?.org === 'string' ? config.org : ''
  const repos = Array.isArray(config?.repos) ? config.repos : []
  const [owner, name, ...rest] = typeof r.repo === 'string' ? r.repo.split('/') : []
  if (!owner || !name || rest.length || owner !== org || !repos.includes(name)) {
    errors.push(`repo "${r.repo}" is not one of ${org}/{${repos.join(', ')}}`)
  }

  if (!KINDS.has(r.kind)) errors.push('kind must be "issue" or "pr"')
  if (!Number.isInteger(r.number) || r.number < 1) errors.push('number must be a positive integer')
  if (typeof r.url !== 'string' || !r.url.startsWith(`https://github.com/${r.repo}/`)) {
    errors.push('url must be an https://github.com/<repo>/… link')
  }

  const lock = config?.labels?.lock
  if (typeof lock !== 'string' || !lock) errors.push('loop-config.json has no `labels.lock`')

  const maxAttempts = Number.isInteger(config?.dispatch?.maxAttempts) ? config.dispatch.maxAttempts : 3
  if (!Number.isInteger(r.attempt) || r.attempt < 1 || r.attempt > maxAttempts) {
    errors.push(`attempt must be an integer from 1 to ${maxAttempts}`)
  }

  if (!ISO_UTC.test(String(r.firedAt))) errors.push('firedAt must be an ISO-8601 UTC timestamp')
  if (!ISO_UTC.test(String(r.deadline))) errors.push('deadline must be an ISO-8601 UTC timestamp')
  else if (Date.parse(r.deadline) <= now) errors.push(`deadline ${r.deadline} has passed`)

  const journalRepo = `${org}/${config?.journalRepo}`
  if (r.journal?.repo !== journalRepo) errors.push(`journal.repo must be ${journalRepo}`)
  if (!Number.isInteger(r.journal?.issue) || r.journal.issue < 1) errors.push('journal.issue must be a positive integer')

  if (attachedDir && name) {
    const dir = join(resolve(attachedDir), name)
    if (!existsSync(dir)) errors.push(`no checkout of ${name} at ${dir}`)
  }

  if (errors.length) return { ok: false, errors }

  const h = handlers[handler]
  return {
    ok: true,
    errors: [],
    record: {
      ...r,
      flags: { onDemand: r.flags?.onDemand === true, delegated: r.flags?.delegated === true },
      owner,
      name,
      lock,
      skill: typeof h.skill === 'string' ? h.skill : handler,
      model: typeof h.model === 'string' ? h.model : null,
      deadlineMs: Date.parse(r.deadline),
      resume: r.attempt > 1,
    },
  }
}

/**
 * Pull the first JSON object out of whatever arrived on stdin. A handler
 * may pipe the bare record, or the whole `<routine-fire-payload>` block it
 * was given. Either works; anything else is refused.
 */
export function extractJson(text) {
  const s = String(text)
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) throw new Error('no JSON object found on stdin')
  return JSON.parse(s.slice(start, end + 1))
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())
if (isMain) {
  const argv = process.argv.slice(2)
  let text = ''
  process.stdin.on('data', (d) => { text += d })
  process.stdin.on('end', () => {
    let input
    try {
      input = extractJson(text)
    } catch (err) {
      console.error(`payload: ${err.message}`)
      process.exit(1)
    }

    let config
    try {
      config = loadLoopConfig(flag(argv, 'config'))
    } catch (err) {
      console.error(`payload: ${err.message}`)
      process.exit(1)
    }

    const nowFlag = flag(argv, 'now')
    const now = nowFlag ? Date.parse(nowFlag) : Date.now()
    if (Number.isNaN(now)) {
      console.error(`payload: --now "${nowFlag}" is not a timestamp`)
      process.exit(1)
    }

    const result = validate(input, config, {
      expectHandler: flag(argv, 'expect-handler'),
      now,
      attachedDir: flag(argv, 'attached'),
    })

    if (!result.ok) {
      for (const e of result.errors) console.error(`payload: ${e}`)
      process.exit(1)
    }
    console.log(JSON.stringify(result.record, null, 2))
  })
}
