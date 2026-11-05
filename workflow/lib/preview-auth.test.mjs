import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { accessPlan, authPlan, previewHost } from './preview-auth.mjs'

// Read through this module's own URL, not the cwd: `implement-ticket` runs the
// gate from a `.claude/worktrees/<slug>` worktree, where a cwd-relative path
// resolves to nothing.
const config = JSON.parse(readFileSync(new URL('../../loop-config.json', import.meta.url), 'utf-8'))

/**
 * A gated repo's block, in the shape a person hand-writes it into that repo's
 * own `.claude/workflow.json`.
 *
 * ⚠ **Deliberately not the real host or address.** Nothing in this repo may
 * spell a producing repo's preview host: it is that repo's config value, and a
 * copy here — in a fixture as much as in a skill — is a second definition free
 * to go stale. What the cases below exercise is the shape, which is this repo's.
 */
const GATED = {
  pattern: 'https://pr-{pr}.preview.invalid',
  seed: 'pnpm seed the-fixture',
  auth: {
    signInPath: '/api/managers/request-magic-link',
    account: 'preview-admin@preview.invalid',
    accountsPage: '/admin/login',
  },
}

/** Every other repo's: a host and nothing else. */
const BARE = { pattern: 'https://example-pr-{pr}.invalid' }

test('the host is the pattern with the PR filled', () => {
  assert.equal(previewHost(GATED, 7), 'https://pr-7.preview.invalid')
  assert.equal(previewHost(GATED, '7'), 'https://pr-7.preview.invalid')
})

test('no pattern and no PR each yield no host, rather than a half-built one', () => {
  assert.equal(previewHost({}, 7), null)
  assert.equal(previewHost(GATED, undefined), null)
  assert.equal(previewHost(GATED, ''), null)
})

test('a trailing slash is dropped, so a path can be appended', () => {
  assert.equal(previewHost({ pattern: 'https://x.invalid/' }, 1), 'https://x.invalid')
})

test('a gated repo gets the sign-in request its own config describes', () => {
  const plan = authPlan({ previewUrl: GATED, pr: 7 }, config, {})

  assert.equal(plan.seedsPreviews, true)
  assert.deepEqual(plan.signIn, {
    method: 'POST',
    url: 'https://pr-7.preview.invalid/api/managers/request-magic-link',
    body: { email: 'preview-admin@preview.invalid' },
    tokenField: 'token',
  })
  assert.equal(plan.accounts, 'https://pr-7.preview.invalid/admin/login')
  assert.equal(plan.seed, 'pnpm seed the-fixture')
})

test('a repo with no auth and no seed does not seed previews, and plans no sign-in', () => {
  // ⚠ The case that keeps today's rule intact for the other four repos: they
  // have no seeding check, so a body line saying a link shows nothing is still
  // the disclosure it always was.
  const plan = authPlan({ previewUrl: BARE, pr: 7 }, config, {})

  assert.equal(plan.seedsPreviews, false)
  assert.equal(plan.signIn, null)
  assert.equal(plan.accounts, null)
  assert.equal(plan.seed, null)
  assert.equal(plan.host, 'https://example-pr-7.invalid')
})

test('a seed command alone is enough to seed previews, with no sign-in planned', () => {
  // `previewUrl.seed` predates `.auth`, so a repo may carry one without the
  // other and the verdict must not require both.
  const plan = authPlan({ previewUrl: { ...BARE, seed: 'pnpm seed x' }, pr: 7 }, config, {})

  assert.equal(plan.seedsPreviews, true)
  assert.equal(plan.signIn, null)
})

test('an incomplete auth block plans no sign-in rather than a wrong request', () => {
  for (const auth of [
    { account: 'a@b.invalid' },
    { signInPath: '/x' },
    { signInPath: '/x', account: '' },
  ]) {
    assert.equal(authPlan({ previewUrl: { ...BARE, auth }, pr: 7 }, config, {}).signIn, null)
  }
})

test('each token variable is reported as set or unset, and never by value', () => {
  const idVar = config.previewAccess.clientIdEnvVar
  const secretVar = config.previewAccess.clientSecretEnvVar
  const plan = accessPlan(config, { [idVar]: 'a-real-client-id' })

  assert.deepEqual(plan.clientId, { envVar: idVar, set: true })
  assert.deepEqual(plan.clientSecret, { envVar: secretVar, set: false })
  assert.equal(JSON.stringify(plan).includes('a-real-client-id'), false)
})

test('the Access headers name the variables, so the plan carries no credential', () => {
  const plan = accessPlan(config, {})

  assert.deepEqual(plan.headers, [
    `CF-Access-Client-Id: $${config.previewAccess.clientIdEnvVar}`,
    `CF-Access-Client-Secret: $${config.previewAccess.clientSecretEnvVar}`,
  ])
})

test('a config with no previewAccess block names no variable and no header', () => {
  const plan = accessPlan({}, {})

  assert.deepEqual(plan.clientId, { envVar: null, set: false })
  assert.deepEqual(plan.headers, [])
})

test('this file opens no connection and names no repo host', () => {
  // ⚠ Both halves are the rule the whole script layer rests on: a routine
  // cannot reach an API from a script, and a preview host typed in here would
  // be a second definition of a producing repo's own config value.
  const source = readFileSync(new URL('./preview-auth.mjs', import.meta.url), 'utf-8')

  assert.equal(/\bfetch\s*\(/.test(source), false)
  assert.equal(/sydevelopers\.com/.test(source), false)
  for (const line of source.split('\n')) {
    if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) continue
    assert.equal(/https?:\/\//.test(line), false, line)
  }
})
