import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fixtureHost, onHost, previewHost, previewPlan } from './preview-host.mjs'

/**
 * Deliberately not a real host: nothing in this repo may spell a producing
 * repo's preview host, since it is that repo's config value and a copy here is a
 * second definition free to go stale. The cases exercise the shape.
 */
const GATED = { pattern: 'https://pr-{pr}.preview.invalid' }

const FIXTURE = {
  path: 'src/fixture/',
  link: 'https://pr-{pr}.fixture.invalid/admin/collections/{collection}/{id}',
}

const planFor = (previewUrl, fixture, pr = 7) => previewPlan({ previewUrl, fixture, pr })

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
  // the whole origin — and the link check trusts whatever comes
  // back. Each of these parses as a URL, which is why the check is on the input.
  for (const pr of ['1@evil.example/x', ' 7 ', '#7', '7/../..', '-1', '1.0']) {
    assert.equal(previewHost(GATED, pr), null, String(pr))
  }
})

test('only an https pattern yields a host', () => {
  // `http:` names a cleartext host; `file:` would
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

test('a fixture link names its host, with the collection and id slots filled', () => {
  assert.equal(fixtureHost(FIXTURE, 1155), 'https://pr-1155.fixture.invalid')
  assert.equal(fixtureHost({}, 7), null)
  assert.equal(fixtureHost(FIXTURE, undefined), null)
})

test('a fixture link that is not https or hides its host yields no host', () => {
  for (const link of [
    'http://pr-{pr}.fixture.invalid/{collection}/{id}',
    'https://pr-{pr}.fixture.invalid@evil.example/{id}',
    'not-a-url-{pr}',
  ]) {
    assert.equal(fixtureHost({ link }, 7), null, link)
  }
  assert.equal(fixtureHost(FIXTURE, '1@evil.example/x'), null)
})

test('a repo with no fixture block plans no fixture host, and keeps its preview host', () => {
  const plan = planFor(GATED, undefined)

  assert.equal(plan.fixtureHost, null)
  assert.equal(plan.host, 'https://pr-7.preview.invalid')
})

test('a link is on-host only on the plan\'s own origin', () => {
  const host = planFor(GATED, FIXTURE).host

  // Any path on the preview itself, which is what the pair exists to open.
  assert.equal(onHost(host, `${host}/admin/collections/pages`), true)
  assert.equal(onHost(host, `${host}/`), true)
})

test('a link off the plan\'s host is off-host, however it is spelled', () => {
  // ⚠ The case this exists for: `review-pr` reads `## Preview` links out of a
  // body a stranger may have written, and the dispatcher fires it on an outside
  // PR whenever a person asks for one. Each of these would pass as the
  // repo's own preview.
  const host = planFor(GATED, FIXTURE).host

  for (const url of [
    'https://collector.evil.example/admin',
    // A suffix of the host is a different name, and anyone may register it.
    `${host}.evil.example/x`,
    // Cleartext would put the pair on the wire.
    host.replace('https:', 'http:'),
    // A port is part of the origin.
    `${host}:8443/x`,
    // A name that merely ENDS WITH the plan's: `endsWith` would pass this.
    host.replace('//', '//evil-') + '/x',
    // Another PR's preview is another origin.
    'https://pr-8.preview.invalid/x',
    'not a url',
    '',
    null,
  ]) {
    assert.equal(onHost(host, url), false, String(url))
  }

  // No host means no plan, so nothing matches.
  assert.equal(onHost(null, `${host}/x`), false)
})

test('a plan whose host is not https matches nothing either', () => {
  // `previewHost` refuses a non-https pattern, so this shape should not reach
  // here — but the exported check is what a caller trusts before it accepts a
  // link, so it refuses cleartext on its own rather than by inheritance.
  const cleartext = 'http://pr-7.preview.invalid'

  assert.equal(onHost(cleartext, `${cleartext}/x`), false)
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
  const source = readFileSync(new URL('./preview-host.mjs', import.meta.url), 'utf-8')
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
