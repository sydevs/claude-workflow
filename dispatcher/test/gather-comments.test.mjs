// One comment read serves a leg. `loadRecord` paged from the oldest comment
// while the comment window read the newest, so every leg spent two or three
// calls on one endpoint — three of an issue leg's six REST calls, on every leg
// of every event run. (why: docs/why.md#one-comment-read-serves-the-leg)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gather, newestWindow } from '../gather.mjs'
import { MARKER } from '../record.mjs'

const config = JSON.parse(readFileSync(new URL('../../loop-config.json', import.meta.url), 'utf-8'))
const bot = { login: config.identity.expectedLogin }
const target = { repo: { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' }, kind: 'issue', number: 500, reason: 'reconcile', facts: {} }
const when = { now: new Date('2026-11-02T01:00:00Z') }

/** The status comment, then `n` comments of chatter, oldest first. */
function thread(n) {
  return [
    { id: 1, user: bot, created_at: '2026-11-01T00:00:00Z', body: `${MARKER}${JSON.stringify({ v: 1, fixCi: 4 })} -->\nrunning`, author_association: 'MEMBER' },
    ...Array.from({ length: n }, (_, i) => ({ id: 10 + i, user: { login: 'Ardnived' }, created_at: `2026-11-02T00:${String(i).padStart(2, '0')}:00Z`, body: `c${i}`, author_association: 'MEMBER' })),
  ]
}

/** An issue whose only reads that matter here are its comments. */
function fake(comments) {
  const calls = []
  const gh = {
    rest: {
      issues: {
        get: async () => ({ data: { number: 500, node_id: 'I', state: 'open', title: 't', body: '', labels: [], user: { login: 'Ardnived' }, author_association: 'MEMBER', html_url: 'u', comments: comments.length, updated_at: '2026-11-02T00:00:00Z' } }),
        listComments: async ({ per_page, page = 1 }) => {
          calls.push({ per_page, page })
          return { data: comments.slice((page - 1) * per_page, page * per_page) }
        },
      },
    },
    graphql: async () => ({ repository: { issue: { closedByPullRequestsReferences: { nodes: [] } } } }),
    request: async (route) => {
      if (String(route).includes('/parent')) throw Object.assign(new Error('Not Found'), { status: 404 })
      return { data: [] }
    },
  }
  gh.paginate = async (fn, args) => (typeof fn === 'string' ? (await gh.request(fn, args)).data : (await fn(args)).data)
  return { gh, calls }
}

test('a thread inside one page is read once, and still yields the record and the newest window', async () => {
  const comments = thread(23)
  const { gh, calls } = fake(comments)
  const s = await gather(gh, target, config, when)
  assert.deepEqual(calls, [{ per_page: 100, page: 1 }], 'one read, where three used to go')
  assert.equal(s.recordId, 1, 'the record is still found')
  assert.equal(s.record.fixCi, 4, 'and parsed')
  // 24 comments at ten to a page: the last page holds four, so the page before
  // it comes too — the window the two reads produced.
  assert.equal(s.comments.length, 14)
  assert.equal(s.comments.at(-1).body, 'c22', 'ending at the newest comment')
  assert.equal(s.comments[0].body, 'c9')
})

test('a thread past one page is paged as it always was', async () => {
  const comments = thread(103)
  const { gh, calls } = fake(comments)
  const s = await gather(gh, target, config, when)
  assert.deepEqual(calls, [
    { per_page: 100, page: 1 },
    { per_page: 10, page: 11 },
    { per_page: 10, page: 10 },
  ], 'the record from the first page, the window from the last')
  assert.equal(s.recordId, 1)
  assert.equal(s.comments.length, 14)
  assert.equal(s.comments.at(-1).body, 'c102')
})

test('a thread of exactly one page costs no more than it used to', async () => {
  // A first read of 100 cannot prove it saw the whole thread, so the one-read
  // path is taken only strictly under a page. At 100 the two reads are two
  // calls; asking first and then falling back would have been three.
  const { gh, calls } = fake(thread(99))
  await gather(gh, target, config, when)
  assert.deepEqual(calls, [{ per_page: 100, page: 1 }, { per_page: 10, page: 10 }])
})

test('a count that lagged the thread falls back rather than reading a wrong window', async () => {
  const comments = thread(140)
  const { gh, calls } = fake(comments)
  // GitHub said 30; the thread holds 141. The first read comes back full.
  gh.rest.issues.get = async () => ({ data: { number: 500, node_id: 'I', state: 'open', title: 't', body: '', labels: [], user: { login: 'Ardnived' }, author_association: 'MEMBER', html_url: 'u', comments: 30, updated_at: '2026-11-02T00:00:00Z' } })
  const s = await gather(gh, target, config, when)
  assert.deepEqual(calls[0], { per_page: 100, page: 1 }, 'it asked')
  assert.ok(calls.length > 1, 'and then fell back')
  assert.equal(s.recordId, 1)
})

test('the window is the newest page, and the one before it when the newest is short', () => {
  const all = Array.from({ length: 24 }, (_, i) => i)
  assert.deepEqual(newestWindow(all), all.slice(10), 'four on the last page, so fourteen')
  assert.deepEqual(newestWindow(Array.from({ length: 20 }, (_, i) => i)), [10, 11, 12, 13, 14, 15, 16, 17, 18, 19], 'a full last page stands alone')
  assert.deepEqual(newestWindow([1, 2]), [1, 2], 'a short thread is all of it')
  assert.deepEqual(newestWindow([]), [], 'and an empty one is empty')
})
