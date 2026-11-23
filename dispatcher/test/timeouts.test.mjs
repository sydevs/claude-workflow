// A job must outlive the longest wait it can take, or the wait is spent and
// the job is killed anyway — the exact failure the rate-limit wait exists to
// end. The wait is a value in loop-config.json and the job budgets are
// literals in YAML, so nothing but this couples them.
// (why: docs/why.md#a-rate-limited-call-waits-for-the-reset)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const config = JSON.parse(readFileSync(new URL('../../loop-config.json', import.meta.url), 'utf-8'))

// `dispatch.workflow` names the file, so the test follows the config here too.
const workflow = readFileSync(new URL(`../../${config.dispatch.workflow}`, import.meta.url), 'utf-8')

test('every dispatcher job outlives the longest rate-limit wait', () => {
  const waitSeconds = config.dispatch.githubRetry.rateLimitMaxWaitSeconds
  assert.ok(Number.isFinite(waitSeconds) && waitSeconds > 0, 'rateLimitMaxWaitSeconds is a number of seconds')

  const timeouts = [...workflow.matchAll(/^\s*timeout-minutes:\s*(\d+)\s*$/gm)].map((m) => Number(m[1]))
  assert.ok(timeouts.length >= 7, `every job sets one — found ${timeouts.length}`)

  const waitMinutes = waitSeconds / 60
  for (const minutes of timeouts) {
    assert.ok(
      minutes > waitMinutes,
      `a job capped at ${minutes} min cannot wait out a ${waitMinutes} min reset: raise it, or lower dispatch.githubRetry.rateLimitMaxWaitSeconds`,
    )
  }
})

test('every entry point a job calls installs the retry that waits', () => {
  // A job whose timeout clears the wait but whose entry point never installs
  // the hook cannot wait at all — and died at once on a 5xx too.
  const index = readFileSync(new URL('../index.mjs', import.meta.url), 'utf-8')
  const deps = readFileSync(new URL('../deps.mjs', import.meta.url), 'utf-8')
  const contracts = readFileSync(new URL('../contracts.mjs', import.meta.url), 'utf-8')
  for (const [name, source, fn] of [
    ['resolve', index, 'resolveTargets'],
    ['act', index, 'act'],
    ['journal', index, 'journalTick'],
    ['deps', deps, 'depsTick'],
    ['contracts-plan', contracts, 'planContractSync'],
    ['contracts-verify', contracts, 'verifyContractSync'],
  ]) {
    const body = source.slice(source.indexOf(`export async function ${fn}(`))
    assert.ok(
      body.slice(0, 400).includes('installRetry('),
      `the ${name} job's entry point ${fn} must call installRetry, or its timeout promises a wait it cannot take`,
    )
  }
})

test('the App token step gates on a variable, never on a secret', () => {
  // `secrets` is not available to a step-level `if:`. A workflow that reads it
  // there fails to parse, which would stop dispatch in all five repos at once.
  const guards = [...workflow.matchAll(/^\s*if:\s*(.+)$/gm)].map((m) => m[1])
  for (const guard of guards) {
    assert.ok(!/\bsecrets\./.test(guard), `a step or job \`if:\` cannot read secrets: ${guard.trim()}`)
  }
})
