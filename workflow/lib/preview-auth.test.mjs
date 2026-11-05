import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { accessPlan, authPlan, previewHost } from './preview-auth.mjs'

// Read through this module's own URL, not the cwd: `implement-ticket` runs the
// gate from a `.claude/worktrees/<slug>` worktree, where a cwd-relative path
// resolves to nothing.
const config = JSON.parse(readFileSync(new URL('../../loop-config.json', import.meta.url), 'utf-8'))

const ID_VAR = config.previewAccess.clientIdEnvVar
const SECRET_VAR = config.previewAccess.clientSecretEnvVar
const TOKEN = { [ID_VAR]: 'a-real-client-id', [SECRET_VAR]: 'a-real-client-secret' }

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
  },
}

/** Every other repo's: a host and nothing else. */
const BARE = { pattern: 'https://example-pr-{pr}.invalid' }

const planFor = (previewUrl, pr = 7, env = {}) => authPlan({ previewUrl, pr }, config, env)

test('the host is the pattern with the PR filled, at every occurrence', () => {
  assert.equal(previewHost(GATED, 7), 'https://pr-7.preview.invalid')
  assert.equal(previewHost(GATED, '7'), 'https://pr-7.preview.invalid')
  // `replaceAll`, not `replace`: a pattern may name the number twice.
  assert.equal(previewHost({ pattern: 'https://pr-{pr}.x-{pr}.invalid' }, 7), 'https://pr-7.x-7.invalid')
  // Zero is a number, not an absence. `if (!pr)` would drop it.
  assert.equal(previewHost(GATED, 0), 'https://pr-0.preview.invalid')
})

test('no pattern and no PR each yield no host, rather than a half-built one', () => {
  assert.equal(previewHost({}, 7), null)
  assert.equal(previewHost(GATED, undefined), null)
  assert.equal(previewHost(GATED, ''), null)
})

test('a trailing slash is dropped, however many, so a path can be appended', () => {
  assert.equal(previewHost({ pattern: 'https://x.invalid/' }, 1), 'https://x.invalid')
  assert.equal(previewHost({ pattern: 'https://x.invalid///' }, 1), 'https://x.invalid')
})

test('a PR number that is not digits yields no host', () => {
  // ⚠ The `{pr}` slot sits inside the hostname, so anything but digits can move
  // the whole origin — and the caller sends the Access token to whatever comes
  // back. Each of these parses as a URL, which is why the check is on the input.
  for (const pr of ['1@evil.example/x', ' 7 ', '#7', '7/../..', '-1', '1.0']) {
    assert.equal(previewHost(GATED, pr), null, String(pr))
  }
})

test('only an https pattern yields a host', () => {
  // `http:` would put the service token on the wire in cleartext; `file:` would
  // make a request of the disk. Userinfo hides the real host behind an `@`.
  for (const pattern of [
    'http://pr-{pr}.preview.invalid',
    'file:///etc/{pr}',
    'https://pr-{pr}.preview.invalid@evil.example',
    'not-a-url-{pr}',
  ]) {
    assert.equal(previewHost({ pattern }, 7), null, pattern)
  }
})

test('a gated repo gets the sign-in request its own config describes', () => {
  const plan = planFor(GATED)

  assert.equal(plan.seedsPreviews, true)
  assert.deepEqual(plan.signIn, {
    method: 'POST',
    url: 'https://pr-7.preview.invalid/api/managers/request-magic-link',
    body: { email: 'preview-admin@preview.invalid' },
    tokenField: 'token',
  })
  assert.equal(plan.seed, 'pnpm seed the-fixture')
})

test('the account and token field names come from the producing repo, not Payload', () => {
  // The whole reason this plan is not SahajCloud-shaped: a repo whose route
  // names the account differently says so in its own block.
  const auth = { ...GATED.auth, accountField: 'login', tokenField: 'sessionToken' }
  const plan = planFor({ ...GATED, auth })

  assert.deepEqual(plan.signIn.body, { login: 'preview-admin@preview.invalid' })
  assert.equal(plan.signIn.tokenField, 'sessionToken')
})

test('a blank field name falls back rather than naming a blank field', () => {
  const auth = { ...GATED.auth, accountField: '', tokenField: '' }
  const plan = planFor({ ...GATED, auth })

  assert.deepEqual(plan.signIn.body, { email: 'preview-admin@preview.invalid' })
  assert.equal(plan.signIn.tokenField, 'token')
})

test('a sign-in route that would leave the host plans no sign-in', () => {
  // ⚠ Each of these composes a URL on another origin, or one curl cannot send.
  // `finalize-pr` attaches the Access headers to this request, so a route that
  // escapes the host hands the service token to whoever owns that origin.
  for (const signInPath of [
    '.evil.example/x',
    '@evil.example/x',
    '//evil.example/x',
    '/../../x',
    'https://evil.example/x',
    '/x\\y',
    '/x y',
  ]) {
    const plan = planFor({ ...GATED, auth: { ...GATED.auth, signInPath } })
    assert.equal(plan.signIn, null, signInPath)
  }
})

test('a repo with no auth and no seed does not seed previews, and plans no sign-in', () => {
  // ⚠ The case that keeps today's rule intact for the other four repos: they
  // have no seeding check, so a body line saying a link shows nothing is still
  // the disclosure it always was.
  const plan = planFor(BARE)

  assert.equal(plan.seedsPreviews, false)
  assert.equal(plan.signIn, null)
  assert.equal(plan.seed, null)
  assert.equal(plan.host, 'https://example-pr-7.invalid')
})

test('a seed command alone is enough to seed previews, with no sign-in planned', () => {
  // `previewUrl.seed` predates `.auth`, so a repo may carry one without the
  // other and the verdict must not require both.
  const plan = planFor({ ...BARE, seed: 'pnpm seed x' })

  assert.equal(plan.seedsPreviews, true)
  assert.equal(plan.signIn, null)
})

test('an incomplete auth block plans no sign-in rather than a wrong request', () => {
  for (const auth of [
    { account: 'a@b.invalid' },
    { signInPath: '/x' },
    { signInPath: '/x', account: '' },
  ]) {
    assert.equal(planFor({ ...BARE, auth }).signIn, null, JSON.stringify(auth))
  }
})

test('an auth block too incomplete to use does not claim the repo seeds previews', () => {
  // ⚠ `seedsPreviews` is what makes `review-pr` raise a `should-fix` on an empty
  // preview whatever the body says. Reported for a repo no run can sign into or
  // seed, that is a finding its author cannot comply with.
  for (const auth of [{}, true, [], { signInPath: '/x' }]) {
    assert.equal(planFor({ ...BARE, auth }).seedsPreviews, false, JSON.stringify(auth))
  }
})

test('each token variable is reported as set or unset, and never by value', () => {
  const plan = accessPlan(config, { [ID_VAR]: 'a-real-client-id' })

  assert.deepEqual(plan.clientId, { envVar: ID_VAR, set: true })
  assert.deepEqual(plan.clientSecret, { envVar: SECRET_VAR, set: false })
  assert.equal(JSON.stringify(plan).includes('a-real-client-id'), false)
})

test('the Access headers name the variables, so the plan carries no credential', () => {
  const plan = accessPlan(config, TOKEN)

  assert.deepEqual(plan.headers, [
    `CF-Access-Client-Id: $${ID_VAR}`,
    `CF-Access-Client-Secret: $${SECRET_VAR}`,
  ])
  assert.equal(JSON.stringify(plan).includes('a-real-client-secret'), false)
})

test('half a token is no token, so a missing half emits no headers at all', () => {
  // ⚠ The names are configured in every repo, so a header built on the NAME
  // expands to empty and Cloudflare logs a failed service-token attempt — while
  // the run reads two headers as a working credential.
  for (const env of [{}, { [ID_VAR]: 'x' }, { [SECRET_VAR]: 'x' }]) {
    assert.deepEqual(accessPlan(config, env).headers, [], JSON.stringify(Object.keys(env)))
  }
})

test('a config with no previewAccess block names no variable and no header', () => {
  const plan = accessPlan({}, TOKEN)

  assert.deepEqual(plan.clientId, { envVar: null, set: false })
  assert.deepEqual(plan.headers, [])
})

test('the Access pair rides only with a gated request', () => {
  // ⚠ A repo that declares no `.auth` has no Access in front of it. Sending the
  // pair there puts it on an ordinary host — and a preview host a repo has since
  // moved is a name anyone may claim.
  assert.deepEqual(planFor(BARE, 7, TOKEN).access.headers, [])
  assert.equal(planFor(GATED, 7, TOKEN).access.headers.length, 2)
  // Still reported, so a run can say which half is missing rather than guessing.
  assert.deepEqual(planFor(BARE, 7, TOKEN).access.clientId, { envVar: ID_VAR, set: true })
})

test('this file opens no connection and names no repo host', () => {
  // ⚠ Both halves are the rule the whole script layer rests on: a routine
  // cannot reach an API from a script, and a preview host typed in here would
  // be a second definition of a producing repo's own config value.
  //
  // The import list is the load-bearing half. A `fetch(` grep alone passed a
  // module that imported `node:https` and called it — `node:net`,
  // `child_process` and `await import()` are the same hole, so what is asserted
  // is the allowlist, with the grep as a second line.
  const source = readFileSync(new URL('./preview-auth.mjs', import.meta.url), 'utf-8')
  const specifiers = [...source.matchAll(/\bfrom\s+'([^']+)'/g)].map((m) => m[1])

  assert.deepEqual(specifiers, ['./config.mjs', './payload.mjs'])
  assert.equal(/\bimport\s*\(/.test(source), false)
  assert.equal(/\brequire\s*\(/.test(source), false)
  assert.equal(/\bfetch\s*\(/.test(source), false)

  assert.equal(/sydevelopers\.com/.test(source), false)
  for (const line of source.split('\n')) {
    if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) continue
    assert.equal(/https?:\/\//.test(line), false, line)
  }
})
