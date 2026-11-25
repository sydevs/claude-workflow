import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TRANSLATION_APPROVAL_MARKER, generatedAddsOnly, schemaAdds, seedAdds, translationCheckFacts, translationFacts, translationVerdict } from '../translations.mjs'
import { evaluatePr } from '../decide.mjs'
import { apply } from '../apply.mjs'

// A PR of nothing but new translation keys skips the critic, and a bot's own
// is approved by Actions. (why: docs/why.md#a-translation-key-is-approved-by-actions)
const config = {
  org: 'sydevs',
  repos: ['SahajCloud'],
  identity: { expectedLogin: 'sydevs-bot' },
  assignment: { reviewer: 'Ardnived', respondTo: ['Ardnived'] },
  labels: { journal: 'ops-journal', lock: 'bot:working', proposal: 'proposal' },
  ceilings: { ciFixIterations: 3 },
  mergePolicy: { loopMayNotMerge: ['claude-workflow'], proxyApprove: ['Ardnived'] },
  review: { bodyHeader: '## 🧐 Adversarial review', skipWhen: { maxFiles: 2, maxLines: 40 } },
  dispatch: { commandPrefix: '@sydevs-bot' },
  translationOnly: {
    maxFiles: 40,
    repos: {
      SahajCloud: {
        schemas: ['src/globals/*Translations/translationsSchema.json'],
        seeds: ['seeds/*-translations/data.*.json'],
        generated: ['src/payload-types.ts'],
      },
    },
  },
}

const SCHEMA = 'src/globals/SahajAtlasTranslations/translationsSchema.json'
const SEED = 'seeds/sy-atlas-translations/data.de.json'
const TYPES = 'src/payload-types.ts'

const leaf = (description, extra = {}) => ({ type: 'string', description, ...extra })
const schema = (countries) => ({
  type: 'object',
  properties: {
    countries: { type: 'object', description: 'Countries list', properties: countries, additionalProperties: false },
  },
  additionalProperties: false,
})
const BASE_SCHEMA = schema({ title: leaf('Heading') })
const ADDED_SCHEMA = schema({ title: leaf('Heading'), browse_heading: leaf('Above the list', { default: 'Or browse by country' }) })

const TYPES_PATCH = [
  '@@ -9137,6 +9137,10 @@ export interface SyAtlasTranslationsCountriesStrings {',
  '   title?: string;',
  '+  /**',
  '+   * Small section heading above the country list.',
  '+   */',
  '+  browse_heading?: string;',
  '   /**',
].join('\n')

const files = (over = []) => [
  { filename: SCHEMA, status: 'modified' },
  { filename: SEED, status: 'modified' },
  { filename: TYPES, status: 'modified', patch: TYPES_PATCH },
  ...over,
]
const contents = (schemaHead = ADDED_SCHEMA, seedHead = { countries: { title: 'Kurse', browse_heading: 'Oder nach Land' } }) => ({
  [SCHEMA]: { base: JSON.stringify(BASE_SCHEMA), head: JSON.stringify(schemaHead) },
  [SEED]: { base: JSON.stringify({ countries: { title: 'Kurse' } }), head: JSON.stringify(seedHead) },
})

test('a schema, its seeds and its types adding one key is translation-only', () => {
  const v = translationVerdict(config, 'SahajCloud', files(), contents())
  assert.equal(v.ok, true, v.reason)
  assert.match(v.reason, /adds 2 translation key/)
})

test('a new key may be a closed group of string leaves', () => {
  const head = { ...BASE_SCHEMA, properties: { ...BASE_SCHEMA.properties, online: { type: 'object', properties: { title: leaf('Online') }, additionalProperties: false } } }
  assert.equal(schemaAdds(BASE_SCHEMA, head), 1)
})

test('any change to an existing schema node is refused', () => {
  const cases = [
    ['a renamed key', schema({ heading: leaf('Heading') })],
    ['a removed key', schema({})],
    ['a constraint on an existing leaf', schema({ title: leaf('Heading', { maxLength: 5 }) })],
    ['a new required list', { ...BASE_SCHEMA, required: ['countries'] }],
    ['an edited description', schema({ title: leaf('Heading, reworded') })],
    ['a new leaf that is not a plain string', schema({ title: leaf('Heading'), n: { type: 'number', description: 'x' } })],
    ['a new leaf with a constraint', schema({ title: leaf('Heading'), n: leaf('x', { pattern: '^a' }) })],
    ['an open new group', { ...BASE_SCHEMA, properties: { ...BASE_SCHEMA.properties, g: { type: 'object', properties: { a: leaf('a') }, additionalProperties: true } } }],
  ]
  for (const [why, head] of cases) assert.equal(schemaAdds(BASE_SCHEMA, head), -1, why)
})

test('reordering keys is not a change', () => {
  const reordered = { additionalProperties: false, properties: BASE_SCHEMA.properties, type: 'object' }
  assert.equal(schemaAdds(BASE_SCHEMA, reordered), 0)
})

test('a seed may only gain keys, never edit, move or drop one', () => {
  const base = { countries: { title: 'Kurse' }, online: { title: 'Online' } }
  assert.equal(seedAdds(base, { ...base, countries: { title: 'Kurse', more: 'x' } }), 1)
  assert.equal(seedAdds(base, { ...base, countries: { title: 'Kurse neu' } }), -1, 'an edited value')
  assert.equal(seedAdds(base, { countries: base.countries }), -1, 'a dropped group')
  assert.equal(seedAdds(base, { ...base, countries: 'Kurse' }), -1, 'a group turned string')
  assert.equal(seedAdds(base, { ...base, extra: 3 }), -1, 'a non-string value')
})

test('generated types may only gain doc comments and optional fields', () => {
  assert.equal(generatedAddsOnly(TYPES_PATCH), true)
  assert.equal(generatedAddsOnly(`${TYPES_PATCH}\n-  title?: string;`), false, 'a removed line')
  assert.equal(generatedAddsOnly(`${TYPES_PATCH}\n+export const x = 1;`), false, 'runtime code')
  assert.equal(generatedAddsOnly(`${TYPES_PATCH}\n+  title: string;`), false, 'a required field')
  assert.equal(generatedAddsOnly(undefined), false, 'GitHub omitted the patch')
})

test('a PR is refused for a file outside the rules, an added or renamed file, no key, or no rules', () => {
  const no = (fs, c = contents(), repo = 'SahajCloud') => translationVerdict(config, repo, fs, c).ok
  assert.equal(no(files([{ filename: 'src/lib/thing.ts', status: 'modified', patch: '+x' }])), false)
  assert.equal(no([{ filename: 'seeds/sy-atlas-translations/data.it.json', status: 'added' }]), false)
  assert.equal(no([{ filename: TYPES, status: 'modified', patch: TYPES_PATCH }]), false, 'types alone add no key')
  assert.equal(no(files(), contents(BASE_SCHEMA, { countries: { title: 'Kurse' } })), false, 'nothing added')
  assert.equal(no(files(), { [SCHEMA]: { base: '{', head: '{}' } }), false, 'unreadable JSON')
  assert.equal(no(files(), contents(), 'WeMeditateWeb'), false, 'no rules for the repo')
  assert.equal(no([]), false)
})

test('translationFacts reads only when every path qualifies, from the merge base, and never throws', async () => {
  const reads = []
  const body = { [`${SCHEMA}@mb`]: JSON.stringify(BASE_SCHEMA), [`${SCHEMA}@h`]: JSON.stringify(ADDED_SCHEMA), [`${SEED}@mb`]: contents()[SEED].base, [`${SEED}@h`]: contents()[SEED].head }
  const gh = (fs) => ({ rest: { repos: {
    compareCommitsWithBasehead: async () => ({ data: { files: fs, merge_base_commit: { sha: 'mb' } } }),
    getContent: async ({ path, ref }) => { reads.push(`${path}@${ref}`); return { data: body[`${path}@${ref}`] } },
  } } })
  const pr = { base: { sha: 'b' }, head: { sha: 'h' }, changed_files: 3 }
  assert.equal((await translationFacts(gh(files()), { owner: 'sydevs', repo: 'SahajCloud' }, pr, config)).ok, true)
  assert.deepEqual(reads.sort(), [`${SCHEMA}@h`, `${SCHEMA}@mb`, `${SEED}@h`, `${SEED}@mb`].sort())
  reads.length = 0
  assert.equal((await translationFacts(gh(files([{ filename: 'src/x.ts', status: 'modified' }])), { owner: 'sydevs', repo: 'SahajCloud' }, pr, config)).ok, false)
  assert.equal(reads.length, 0, 'no content fetched for a PR a path already refuses')
  const broken = { rest: { repos: { compareCommitsWithBasehead: async () => { throw Object.assign(new Error('boom'), { status: 502 }) } } } }
  assert.match((await translationFacts(broken, { owner: 'sydevs', repo: 'SahajCloud' }, pr, config)).reason, /unread: 502/)
})

test("the check's facts: its approval at the head, its stale ones, and whether it ever approved", () => {
  const mine = (id, commit_id, state = 'APPROVED') => ({ id, commit_id, state, body: `${TRANSLATION_APPROVAL_MARKER}\nok` })
  const person = { id: 9, commit_id: 'old', state: 'APPROVED', body: 'lgtm' }
  assert.deepEqual(translationCheckFacts([mine(1, 'old'), mine(2, 'h'), person], 'h', true), { ever: true, approvedAtHead: true, staleIds: [1] })
  assert.deepEqual(translationCheckFacts([mine(2, 'h')], 'h', false), { ever: true, approvedAtHead: false, staleIds: [2] }, 'outgrown: even the head approval goes')
  assert.deepEqual(translationCheckFacts([mine(1, 'old', 'DISMISSED')], 'h', true), { ever: true, approvedAtHead: false, staleIds: [] })
})

const snap = (pr = {}, rest = {}) => ({
  kind: 'pr',
  repo: { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' },
  item: { number: 1273, labels: [] },
  locked: false,
  record: { fixCi: 0 },
  pr: {
    number: 1273, state: 'open', draft: true, user: { login: 'sydevs-bot' }, head: { sha: 'abc1234', ref: 'claude/feat-x' }, base: { ref: 'main', defaultBranch: 'main' },
    changed_files: 11, additions: 54, deletions: 18, translationOnly: true,
    translationCheck: { ever: false, approvedAtHead: false, staleIds: [], decision: null }, ...pr,
  },
  mergeable: 'MERGEABLE',
  reviews: [], threads: [], comments: [],
  ci: { green: true, reason: 'green', running: [], failing: [] },
  normalized: { reviewDecision: null },
  ...rest,
})
const types = (p) => p.map((a) => a.type)

test('a green translation-only bot draft: no critic, ready, approved by the check, armed, nobody asked', () => {
  const plan = evaluatePr(snap(), config)
  assert.ok(!plan.some((a) => a.type === 'fire'), 'no critic')
  assert.deepEqual(types(plan).filter((t) => ['markReady', 'checkApprove', 'armAutoMerge', 'requestReviewer'].includes(t)), ['markReady', 'checkApprove', 'armAutoMerge'])
  assert.equal(plan.find((a) => a.type === 'checkApprove').sha, 'abc1234')
  assert.match(plan.find((a) => a.type === 'comment').body, /only adds translation keys/)
  // The same PR with a code file is a normal bot PR.
  assert.ok(evaluatePr(snap({ translationOnly: false }), config).some((a) => a.type === 'fire' && a.handler === 'review-pr'))
})

test('a ready translation-only bot PR asks nobody while the check carries it', () => {
  const ready = (c, pr = {}) => evaluatePr(snap({ draft: false, autoMergeArmed: true, translationCheck: { ever: true, staleIds: [], decision: null, ...c }, ...pr }), config)
  assert.deepEqual(types(ready({ approvedAtHead: true, decision: 'APPROVED' })).filter((t) => t !== 'note'), [])
  assert.ok(types(ready({ approvedAtHead: false })).includes('checkApprove'), 'a new head is approved again')
  const uncounted = ready({ approvedAtHead: true, decision: 'REVIEW_REQUIRED' })
  assert.ok(types(uncounted).includes('requestReviewer'))
  assert.match(uncounted.find((a) => a.type === 'comment').body, /ruleset does not count/)
})

test('a bot PR that outgrew the check has its approval dismissed, gets the critic, then its reviewer', () => {
  const s = snap({ draft: false, autoMergeArmed: true, translationOnly: false, translationReason: 'src/x.ts is not a translation file', translationCheck: { ever: true, approvedAtHead: false, staleIds: [5], decision: null } })
  const plan = evaluatePr(s, config)
  assert.deepEqual(plan.find((a) => a.type === 'dismissCheck').ids, [5])
  assert.ok(plan.some((a) => a.type === 'fire' && a.handler === 'review-pr'))
  const reviewed = evaluatePr({ ...s, pr: { ...s.pr, translationCheck: { ...s.pr.translationCheck, staleIds: [] } }, reviews: [{ user: { login: 'sydevs-bot' }, state: 'COMMENTED', body: '## 🧐 Adversarial review\nfine', commit_id: 'abc1234' }] }, config)
  assert.ok(types(reviewed).includes('requestReviewer'))
  assert.match(reviewed.find((a) => a.type === 'comment' && a.key === 'translation-check outgrew').body, /src\/x\.ts is not a translation file/)
})

test("the owner's translation-only PR skips the critic but is never approved by the check", () => {
  const plan = evaluatePr(snap({ draft: false, user: { login: 'Ardnived' } }, { headAuthor: 'Ardnived', headCommittedAt: '2026-11-25T20:00:00Z' }), config)
  assert.ok(!plan.some((a) => a.type === 'fire'), 'no critic')
  assert.ok(!types(plan).includes('checkApprove'))
  assert.ok(types(plan).includes('proxyApprove'), 'approved for its author, as any owner PR')
})

test('checkApprove approves with ACTIONS_TOKEN in its own repo only, pinned to the head', async () => {
  const cfg = { ...config, labels: { lock: 'bot:working' } }
  const target = { repo: { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' }, kind: 'pr', number: 1273, reason: 'ci' }
  const core = { info() {} }
  const run = async (env, snapshot = { record: null, item: { labels: [] }, pr: { head: { sha: 'abc' } } }, plan = [{ type: 'checkApprove', sha: 'abc' }]) => {
    const calls = []
    await apply({ gh: { rest: {} }, target, snapshot, plan, config: cfg, env, dryRun: false, core, fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 } } })
    return calls
  }
  const here = { ACTIONS_TOKEN: 't0k', GITHUB_REPOSITORY: 'sydevs/SahajCloud' }
  const [call] = await run(here)
  assert.equal(call.url, 'https://api.github.com/repos/sydevs/SahajCloud/pulls/1273/reviews')
  assert.equal(call.init.headers.authorization, 'Bearer t0k')
  const body = JSON.parse(call.init.body)
  assert.equal(body.commit_id, 'abc')
  assert.equal(body.event, 'APPROVE')
  assert.ok(body.body.startsWith(TRANSLATION_APPROVAL_MARKER))
  assert.equal((await run({ ...here, GITHUB_REPOSITORY: 'sydevs/claude-workflow' })).length, 0, "another repo's token cannot approve here")
  assert.equal((await run(here, { record: null, item: { labels: [] }, pr: { head: { sha: 'moved' } } })).length, 0, 'head moved')
  assert.equal((await run(here, { record: null, item: { labels: [] }, pr: { draft: true, head: { sha: 'abc' } } })).length, 0, 'a draft whose mark-ready was denied')
  const [dismiss] = await run(here, undefined, [{ type: 'dismissCheck', ids: [5] }])
  assert.equal(dismiss.url, 'https://api.github.com/repos/sydevs/SahajCloud/pulls/1273/reviews/5/dismissals')
  assert.equal(dismiss.init.method, 'PUT')
})
