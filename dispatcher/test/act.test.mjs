// End-to-end over a fake Octokit: resolve → gather → decide → apply, dry-run and live.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { act, resolveTargets } from '../index.mjs'
import { gather } from '../gather.mjs'

const config = JSON.parse(readFileSync(new URL('../../loop-config.json', import.meta.url), 'utf-8'))
config.dispatch.routines.SahajCloud = 'trig_sc'

function fakeGithub(world) {
  const calls = []
  // `refs` is real CAS: create 422s on a ref that exists, which is the whole
  // mechanism the lease rests on. Share one `world` between two fake clients
  // and they contend exactly as two `act` passes do.
  world.refs ||= new Map()
  const rec = (name, args) => { calls.push({ name, args }); return args }
  const issue = (n) => world.issues[n]
  const gh = {
    calls,
    rest: {
      issues: {
        get: async ({ issue_number }) => ({ data: issue(issue_number) }),
        listComments: async ({ issue_number, per_page = 30, page = 1 }) => ({ data: (world.comments[issue_number] || []).slice((page - 1) * per_page, page * per_page) }),
        createComment: async (a) => { rec('createComment', a); const c = { id: 900 + calls.length, body: a.body, user: { login: 'sydevs-bot' }, created_at: '2026-09-08T12:00:00Z' }; (world.comments[a.issue_number] ||= []).push(c); return { data: c } },
        updateComment: async (a) => { rec('updateComment', a); return { data: {} } },
        addLabels: async (a) => { rec('addLabels', a); issue(a.issue_number).labels.push(...a.labels.map((n) => ({ name: n }))); return {} },
        removeLabel: async (a) => { rec('removeLabel', a); const i = issue(a.issue_number); i.labels = i.labels.filter((l) => l.name !== a.name); return {} },
        listForRepo: async (a) => ({ data: Object.values(world.issues).filter((i) => !a.labels || i.labels.some((l) => l.name === a.labels)) }),
        create: async (a) => { rec('createIssue', a); return { data: { number: 410 } } },
        update: async (a) => { rec('updateIssue', a); return { data: {} } },
      },
      pulls: {
        get: async ({ pull_number }) => ({ data: world.prs[pull_number] }),
        listReviews: async () => ({ data: world.reviews || [] }),
        list: async () => ({ data: Object.values(world.prs) }),
        requestReviewers: async (a) => rec('requestReviewers', a),
        merge: async (a) => rec('merge', a),
      },
      checks: { listForRef: async () => ({ data: { check_runs: world.checks || [] } }) },
      repos: {
        get: async () => ({ data: { default_branch: 'main' } }),
        getCombinedStatusForRef: async () => ({ data: { statuses: [] } }),
        listPullRequestsAssociatedWithCommit: async () => ({ data: Object.values(world.prs) }),
      },
      git: {
        createRef: async (a) => {
          rec('createRef', a)
          if (world.refs.has(a.ref)) { const e = new Error('Reference already exists'); e.status = 422; throw e }
          world.refs.set(a.ref, a.sha)
          return { data: {} }
        },
        deleteRef: async (a) => {
          rec('deleteRef', a)
          if (!world.refs.delete(`refs/${a.ref}`)) { const e = new Error('Reference does not exist'); e.status = 422; throw e }
          return { data: {} }
        },
        getRef: async (a) => ({ data: { ref: `refs/${a.ref}`, object: { sha: 'defaultbranchsha' } } }),
        listMatchingRefs: async (a) => ({ data: [...world.refs.keys()].filter((r) => r.startsWith(`refs/${a.ref}`)).map((r) => ({ ref: r })) }),
      },
      reactions: { createForIssueComment: async (a) => rec('react', a) },
    },
    request: async (route, a) => {
      rec('request:' + route, a)
      if (route.includes('dependencies')) return { data: [] }
      if (route.includes('sub_issues')) return { data: world.subIssues?.[a.n] || [] }
      return { data: {} }
    },
    graphql: async (q, v) => {
      rec('graphql', { q: q.slice(0, 160), v })
      // `world.gate` lets a test hold every pass here — the last read `gather`
      // makes — so two passes both finish gathering before either applies.
      if (world.gate && /closingIssuesReferences|closedByPullRequestsReferences/.test(q)) await world.gate()
      if (q.includes('reviewThreads')) return { repository: { pullRequest: { reviewThreads: { nodes: world.threads || [] } } } }
      if (q.includes('closingIssuesReferences')) return { repository: { pullRequest: { closingIssuesReferences: { nodes: [] } } } }
      if (q.includes('closedByPullRequestsReferences')) return { repository: { issue: { closedByPullRequestsReferences: { nodes: [] } } } }
      if (q.includes('projectV2(number')) return { organization: { projectV2: { id: 'P1', status: { id: 'F1', options: [{ id: 'o1', name: 'Proposed' }, { id: 'o2', name: 'Revising' }, { id: 'o3', name: 'Approved' }, { id: 'o4', name: 'Done' }] } } } }
      if (q.includes('projectItems')) return { node: { projectItems: { nodes: [{ id: 'I1', project: { number: 2 }, fieldValueByName: { name: 'Proposed' } }] } } }
      if (q.includes('updateProjectV2ItemFieldValue')) return { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'I1' } } }
      if (q.includes('markPullRequestReadyForReview')) return { markPullRequestReadyForReview: { pullRequest: { id: 'PR1' } } }
      return {}
    },
    // Octokit paginates a route string as well as a method; sub-issues use the route.
    paginate: async (fn, args) => (typeof fn === 'string' ? await gh.request(fn, args) : await fn(args)).data,
  }
  return gh
}

const core = { info: () => {}, warning: () => {} }
const now = new Date('2026-09-08T12:00:00Z')

function issueWorld() {
  return {
    issues: { 9: { number: 9, node_id: 'N9', state: 'open', title: 't', body: '## Notes\nBlocked by: https://github.com/sydevs/SahajCloud/issues/2', labels: [{ name: 'proposal' }, { name: 'awaiting' }], user: { login: 'sydevs-bot' }, html_url: 'https://github.com/sydevs/SahajCloud/issues/9', comments: 1, updated_at: '2026-09-08T11:00:00Z' } },
    comments: { 9: [{ id: 77, body: '@SYDEVS-BOT implement it', user: { login: 'Ardnived' }, created_at: '2026-09-08T11:59:00Z', author_association: 'MEMBER' }] },
    prs: {},
  }
}

test('resolve maps an issue_comment event to one issue target', async () => {
  const github = fakeGithub(issueWorld())
  const context = { eventName: 'issue_comment', repo: { owner: 'sydevs', repo: 'SahajCloud' }, payload: { action: 'created', issue: { number: 9 }, comment: { id: 77, body: '@sydevs-bot implement', user: { login: 'Ardnived' }, author_association: 'MEMBER' } } }
  const t = await resolveTargets({ github, context, core, config })
  assert.equal(t.length, 1)
  assert.equal(t[0].reason, 'issue_comment')
  assert.equal(t[0].kind, 'issue')
})

test('resolve gives a review comment its own reason, and carries no association', async () => {
  const github = fakeGithub(issueWorld())
  const context = {
    eventName: 'pull_request_review_comment',
    repo: { owner: 'sydevs', repo: 'SahajCloud' },
    payload: { action: 'created', pull_request: { number: 212 }, comment: { id: 88, body: 'this is wrong', user: { login: 'Ardnived' }, author_association: 'CONTRIBUTOR' } },
  }
  const t = await resolveTargets({ github, context, core, config })
  assert.equal(t.length, 1)
  assert.equal(t[0].reason, 'review_comment')
  assert.equal(t[0].kind, 'pr')
  assert.equal(t[0].facts.association, undefined)
  // The record still points a handler at the comment it was woken for.
  assert.equal(t[0].facts.triggerType, 'review_comment')
  assert.equal(t[0].facts.commentId, 88)
})

test('dry-run implement: the plan is logged and nothing is written or fired', async () => {
  const github = fakeGithub(issueWorld())
  const target = { repo: { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' }, kind: 'issue', number: 9, reason: 'issue_comment', event: 'issue_comment.created', facts: { author: 'Ardnived', body: '@sydevs-bot implement it', association: 'MEMBER', commentId: 77 } }
  let fired = 0
  await act({ github, context: {}, core, config, target, env: { ROUTINE_TOKEN_SAHAJCLOUD: 'tok' }, dryRun: true, now, fetchImpl: async () => { fired += 1 } })
  assert.equal(fired, 0)
  assert.ok(!github.calls.some((c) => ['addLabels', 'removeLabel', 'createComment', 'updateComment'].includes(c.name)), 'no writes in dry run')
})

test('live implement: labels, status, lock, fire, status comment', async () => {
  const github = fakeGithub(issueWorld())
  const target = { repo: { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' }, kind: 'issue', number: 9, reason: 'issue_comment', event: 'issue_comment.created', facts: { author: 'Ardnived', body: '@sydevs-bot implement it', association: 'MEMBER', commentId: 77 } }
  const fetches = []
  const fetchImpl = async (url, init) => { fetches.push({ url, init }); return { status: 200, json: async () => ({ claude_code_session_id: 'cse_1', claude_code_session_url: 'https://claude.ai/code/session_1' }), headers: new Map() } }
  await act({ github, context: {}, core, config, target, env: { ROUTINE_TOKEN_SAHAJCLOUD: 'tok' }, dryRun: false, now, fetchImpl })
  // the blocker in the body is not open (fake returns none), so implement proceeds
  assert.equal(fetches.length, 1)
  assert.match(fetches[0].url, /routines\/trig_sc\/fire$/)
  const body = JSON.parse(JSON.parse(fetches[0].init.body).text)
  assert.equal(body.handler, 'implement')
  assert.equal(body.number, 9)
  assert.equal(body.lock, 'bot:working')
  assert.equal(body.journal.repo, 'sydevs/claude-workflow')
  const labels = github.calls.filter((c) => c.name === 'addLabels').flatMap((c) => c.args.labels)
  assert.ok(labels.includes('bot:working'))
  assert.ok(github.calls.some((c) => c.name === 'removeLabel' && c.args.name === 'proposal'))
  assert.ok(github.calls.some((c) => c.name === 'createComment' && c.args.body.startsWith('<!-- sydevs-status v1 ')), 'status comment created')
  assert.ok(github.calls.some((c) => c.name === 'graphql' && c.args.q.includes('updateProjectV2ItemFieldValue')), 'status written')
})

test('a 429 on fire releases the lock, marks stuck, and records the retry window', async () => {
  const github = fakeGithub(issueWorld())
  const target = { repo: { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' }, kind: 'issue', number: 9, reason: 'issue_comment', event: 'issue_comment.created', facts: { author: 'Ardnived', body: '@sydevs-bot answer?', association: 'MEMBER', commentId: 77 } }
  const fetchImpl = async () => ({ status: 429, headers: new Map([['retry-after', '3600']]), text: async () => 'limit' })
  await act({ github, context: {}, core, config, target, env: { ROUTINE_TOKEN_SAHAJCLOUD: 'tok' }, dryRun: false, now, fetchImpl })
  const final = github.rest.issues.get && (await github.rest.issues.get({ issue_number: 9 })).data.labels.map((l) => l.name)
  assert.ok(final.includes('stuck'))
  assert.ok(!final.includes('bot:working'))
  const status = github.calls.filter((c) => c.name === 'updateComment' || c.name === 'createComment').map((c) => c.args.body).filter((b) => b.startsWith('<!-- sydevs-status')).pop()
  assert.match(status, /"reason":"429 rate limited"/)
  assert.match(status, /retryAfter":"2026-09-08T13:00:00/)
})

test('green draft bot PR above the threshold fires the critic; under it marks ready', async () => {
  const pr = (over) => ({ number: 5, node_id: 'PR1', state: 'open', draft: true, merged: false, user: { login: 'sydevs-bot' }, head: { ref: 'claude/x', sha: 'abc' }, base: { ref: 'main' }, mergeable: true, mergeable_state: 'clean', changed_files: 8, additions: 120, deletions: 4, requested_reviewers: [], ...over })
  const world = { issues: { 5: { number: 5, node_id: 'PR1', state: 'open', title: 'x', body: '', labels: [], user: { login: 'sydevs-bot' }, pull_request: {}, html_url: 'https://github.com/sydevs/SahajCloud/pull/5', comments: 0 } }, comments: {}, prs: { 5: pr() }, checks: [{ name: 'Lint, Test & Smoke', status: 'completed', conclusion: 'success' }, { name: 'dispatch / act', status: 'in_progress', conclusion: null }] }
  const github = fakeGithub(world)
  const target = { repo: { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' }, kind: 'pr', number: 5, reason: 'ci', event: 'workflow_run.completed', facts: { sha: 'abc' } }
  const fetches = []
  const fetchImpl = async (url) => { fetches.push(url); return { status: 200, json: async () => ({ claude_code_session_id: 'cse_2', claude_code_session_url: 'u' }), headers: new Map() } }
  await act({ github, context: {}, core, config, target, env: { ROUTINE_TOKEN_SAHAJCLOUD: 'tok' }, dryRun: false, now, fetchImpl })
  assert.equal(fetches.length, 1, 'the dispatcher\'s own in_progress check run was ignored (L11)')
  assert.match(fetches[0], /trig_sc/)

  const small = fakeGithub({ ...world, prs: { 5: pr({ changed_files: 1, additions: 3, deletions: 1 }) }, issues: { 5: { ...world.issues[5], labels: [] } } })
  await act({ github: small, context: {}, core, config, target, env: {}, dryRun: false, now, fetchImpl: async () => { throw new Error('must not fire') } })
  assert.ok(small.calls.some((c) => c.name === 'graphql' && c.args.q.includes('markPullRequestReadyForReview')))
  assert.ok(small.calls.some((c) => c.name === 'requestReviewers'))
  assert.ok(small.calls.some((c) => c.name === 'addLabels' && c.args.labels.includes('awaiting')))
})

test('a write the token is refused hands the step to a human, and the plan finishes', async () => {
  // sydevs/SahajCloud#744 on 2026-09-09: CI green, the critic done, and
  // markPullRequestReadyForReview came back FORBIDDEN. The job died, so the
  // reviewer request and the label after it never ran either.
  const pr = { number: 5, node_id: 'PR1', state: 'open', draft: true, merged: false, user: { login: 'sydevs-bot' }, head: { ref: 'claude/x', sha: 'abc' }, base: { ref: 'main' }, mergeable: true, mergeable_state: 'clean', changed_files: 1, additions: 3, deletions: 1, requested_reviewers: [] }
  const world = { issues: { 5: { number: 5, node_id: 'PR1', state: 'open', title: 'x', body: '', labels: [], user: { login: 'sydevs-bot' }, pull_request: {}, html_url: 'u', comments: 0 } }, comments: {}, prs: { 5: pr }, checks: [{ name: 'Lint, Test & Smoke', status: 'completed', conclusion: 'success' }] }
  const github = fakeGithub(world)
  const realGraphql = github.graphql
  github.graphql = async (q, v) => {
    if (String(q).includes('markPullRequestReadyForReview')) {
      const e = new Error('Resource not accessible by personal access token')
      e.status = 403
      throw e
    }
    return realGraphql(q, v)
  }
  const target = { repo: { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' }, kind: 'pr', number: 5, reason: 'ci', event: 'workflow_run.completed', facts: { sha: 'abc' } }
  await act({ github, context: {}, core, config, target, env: {}, dryRun: false, now, fetchImpl: async () => { throw new Error('must not fire') } })

  const labels = github.calls.filter((c) => c.name === 'addLabels').flatMap((c) => c.args.labels)
  assert.ok(labels.includes('awaiting'), 'the step is handed to a human')
  const comment = github.calls.filter((c) => c.name === 'createComment').map((c) => c.args.body).find((b) => b.includes('step left for you'))
  assert.ok(comment, 'and the item says which step')
  assert.match(comment, /mark ready/)
  assert.match(comment, /GitHub said/, 'quoting the refusal, not naming a cause')
  assert.match(comment, /Resource not accessible/, "in GitHub's own words")
})

/** Hold every caller until `n` of them have arrived, then release all of them. */
function barrier(n) {
  let arrived = 0
  let release
  const open = new Promise((r) => { release = r })
  return async () => { arrived += 1; if (arrived >= n) release(); await open }
}

test('two act passes that both gathered an unlocked item fire once, and the loser gets a 422', async () => {
  // sydevs/SahajCloud#858 on 2026-10-01: two resolve-conflicts dispatches one
  // second apart, both of which had read `locked: false` before either wrote
  // the label. The lease ref is the only thing that can decide between them.
  const world = issueWorld()
  world.gate = barrier(2)
  const first = fakeGithub(world)
  const second = fakeGithub(world)
  const target = { repo: { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' }, kind: 'issue', number: 9, reason: 'issue_comment', event: 'issue_comment.created', facts: { author: 'Ardnived', body: '@sydevs-bot implement it', association: 'MEMBER', commentId: 77 } }
  const fires = []
  const fetchImpl = async (url) => { fires.push(url); return { status: 200, json: async () => ({ claude_code_session_id: 'cse_1', claude_code_session_url: 'u' }), headers: new Map() } }
  const run = (github) => act({ github, context: {}, core, config, target, env: { ROUTINE_TOKEN_SAHAJCLOUD: 'tok' }, dryRun: false, now, fetchImpl })
  await Promise.all([run(first), run(second)])

  const creates = [...first.calls, ...second.calls].filter((c) => c.name === 'createRef')
  assert.equal(creates.length, 2, 'both passes tried for the lease')
  assert.equal(world.refs.size, 1, 'and exactly one ref exists')
  assert.equal(fires.length, 1, 'so exactly one session started')

  const locked = [first, second].filter((g) => g.calls.some((c) => c.name === 'addLabels' && c.args.labels.includes('bot:working')))
  assert.equal(locked.length, 1, 'only the winner writes the lock')
  const loser = [first, second].find((g) => !locked.includes(g))
  const status = loser.calls.filter((c) => ['createComment', 'updateComment'].includes(c.name)).map((c) => c.args.body).filter((b) => b.startsWith('<!-- sydevs-status')).pop()
  assert.match(status, /"recheck":true/, 'the loser records a recheck and writes nothing else')
})

test('a fire refused for the lease does not spend a ciFixIterations attempt', async () => {
  // sydevs/SahajAtlasWeb#245: the duplicates consumed the ceiling, which is
  // what later refuses a real fix.
  const pr = { number: 5, node_id: 'PR1', state: 'open', draft: false, merged: false, user: { login: 'sydevs-bot' }, head: { ref: 'claude/x', sha: '19a284d' }, base: { ref: 'main' }, mergeable: true, mergeable_state: 'clean', changed_files: 3, additions: 10, deletions: 1, requested_reviewers: [] }
  const world = {
    issues: { 5: { number: 5, node_id: 'PR1', state: 'open', title: 'x', body: '', labels: [], user: { login: 'sydevs-bot' }, pull_request: {}, html_url: 'u', comments: 0, updated_at: '2026-09-08T11:00:00Z' } },
    comments: {}, prs: { 5: pr }, checks: [{ name: 'Lint, Test & Smoke', status: 'completed', conclusion: 'failure' }],
    gate: barrier(2),
  }
  const first = fakeGithub(world)
  const second = fakeGithub(world)
  const target = { repo: { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' }, kind: 'pr', number: 5, reason: 'ci', event: 'workflow_run.completed', facts: { sha: '19a284d' } }
  const fires = []
  const fetchImpl = async (url) => { fires.push(url); return { status: 200, json: async () => ({ claude_code_session_id: 'cse_2', claude_code_session_url: 'u' }), headers: new Map() } }
  const run = (github) => act({ github, context: {}, core, config, target, env: { ROUTINE_TOKEN_SAHAJCLOUD: 'tok' }, dryRun: false, now, fetchImpl })
  await Promise.all([run(first), run(second)])

  assert.equal(fires.length, 1, 'one fix-ci session')
  const bodies = [...first.calls, ...second.calls].filter((c) => ['createComment', 'updateComment'].includes(c.name)).map((c) => c.args.body).filter((b) => b.startsWith('<!-- sydevs-status'))
  assert.ok(bodies.length, 'both passes wrote the record')
  for (const b of bodies) assert.doesNotMatch(b, /"fixCi":2/, 'a refused fire never counts against the ceiling')
  assert.ok(bodies.some((b) => /"fixCi":1/.test(b)), 'the one that started does')
})

test('sweep-timeout releases the dead session\'s lease along with its label', async () => {
  const world = issueWorld()
  world.issues[9].labels = [{ name: 'bot:working' }]
  const github = fakeGithub(world)
  world.refs.set('refs/sydevs-lease/9', 'stale')
  world.comments[9] = [{ id: 1, body: `<!-- sydevs-status v1 ${JSON.stringify({ v: 1, fixCi: 0, recheck: false, pending: null, current: { id: 'x', handler: 'implement', attempt: 3, firedAt: '2026-09-08T09:00:00Z', deadline: '2026-09-08T10:00:00Z' }, dispatches: [] })} -->\nrunning`, user: { login: 'sydevs-bot' }, created_at: '2026-09-08T09:00:00Z' }]
  const target = { repo: { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' }, kind: 'issue', number: 9, reason: 'sweep-timeout', event: 'schedule', facts: { handler: 'implement', attempt: 3 } }
  await act({ github, context: {}, core, config, target, env: {}, dryRun: false, now, fetchImpl: async () => { throw new Error('attempts are exhausted — must not fire') } })
  assert.ok(github.calls.some((c) => c.name === 'deleteRef' && c.args.ref === 'sydevs-lease/9'), 'the lease is reclaimed')
  assert.equal(world.refs.size, 0, 'so the item is leasable again')
  assert.ok(github.calls.some((c) => c.name === 'removeLabel' && c.args.name === 'bot:working'))
})

test('a lease that will not delete posts an anomaly instead of going quiet', async () => {
  // The silent failure: the next `takeLease` answers 422 `already exists`,
  // which reads as contention and posts nothing, so the item stops for good.
  const world = issueWorld()
  world.issues[9].labels = [{ name: 'bot:working' }]
  const github = fakeGithub(world)
  world.refs.set('refs/sydevs-lease/9', 'stale')
  github.rest.git.deleteRef = async () => { const e = new Error('Resource not accessible'); e.status = 403; throw e }
  world.comments[9] = [{ id: 1, body: `<!-- sydevs-status v1 ${JSON.stringify({ v: 1, fixCi: 0, recheck: false, pending: null, current: { id: 'x', handler: 'implement', attempt: 3, firedAt: '2026-09-08T09:00:00Z', deadline: '2026-09-08T10:00:00Z' }, dispatches: [] })} -->\nrunning`, user: { login: 'sydevs-bot' }, created_at: '2026-09-08T09:00:00Z' }]
  const target = { repo: { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' }, kind: 'issue', number: 9, reason: 'sweep-timeout', event: 'schedule', facts: { handler: 'implement', attempt: 3 } }
  await act({ github, context: {}, core, config, target, env: {}, dryRun: false, now, fetchImpl: async () => { throw new Error('attempts are exhausted — must not fire') } })
  const bodies = github.calls.filter((c) => c.name === 'createComment').map((c) => String(c.args.body))
  assert.ok(bodies.some((b) => b.includes('lease-release-failed')), 'the failed release is journalled')
  assert.ok(github.calls.some((c) => c.name === 'removeLabel' && c.args.name === 'bot:working'), 'and the label still comes off')
})

// ---- a roadmap goal's children (why: docs/why.md#a-goal-is-verified-not-assumed)

// sydevs/SahajCloud#897's shape: a goal whose children closed seconds apart.
function goalWorld(reasons = ['not_planned', 'not_planned', 'not_planned']) {
  const child = (number, i) => ({ number, state: 'closed', state_reason: reasons[i], closed_at: `2026-09-08T11:40:${[24, 27, 30][i]}Z`, repository_url: 'https://api.github.com/repos/sydevs/SahajCloud' })
  return {
    issues: { 897: { number: 897, node_id: 'N897', state: 'open', title: 'goal', body: '## The goal\nx', labels: [], user: { login: 'Ardnived' }, author_association: 'MEMBER', type: { name: 'Roadmap' }, html_url: 'https://github.com/sydevs/SahajCloud/issues/897', comments: 0, updated_at: '2026-09-08T11:40:30Z' } },
    comments: {},
    prs: {},
    subIssues: { 897: [881, 883, 884].map(child) },
  }
}
const goal = (reason) => ({ repo: { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' }, kind: 'issue', number: 897, reason, event: 'issues.closed', facts: {} })

test("a goal's gathered children carry why and when each one closed", async () => {
  const s = await gather(fakeGithub(goalWorld(['not_planned', 'completed', null])), goal('child-closed'), config, { now })
  assert.deepEqual(s.children.map((c) => [c.number, c.state, c.stateReason, c.closedAt]), [
    [881, 'closed', 'not_planned', '2026-09-08T11:40:24Z'],
    [883, 'closed', 'completed', '2026-09-08T11:40:27Z'],
    [884, 'closed', null, '2026-09-08T11:40:30Z'],
  ])
})

test('dry-run: a withdrawn goal prints the flag in the verify record, and writes nothing', async () => {
  const run = async (world) => {
    const github = fakeGithub(world)
    const lines = []
    let fired = 0
    await act({ github, context: {}, core: { info: (m) => lines.push(m), warning: () => {} }, config, target: goal('child-closed'), env: { ROUTINE_TOKEN_SAHAJCLOUD: 'tok' }, dryRun: true, now, fetchImpl: async () => { fired += 1 } })
    assert.equal(fired, 0)
    assert.ok(!github.calls.some((c) => ['addLabels', 'removeLabel', 'createComment', 'updateComment', 'createRef'].includes(c.name)), 'no writes in dry run')
    return JSON.parse(lines.find((l) => l.includes(': record: ')).split(': record: ')[1])
  }
  assert.deepEqual((await run(goalWorld())).flags, { onDemand: false, delegated: false, mode: 'verify', withdrawn: true })
  assert.deepEqual((await run(goalWorld(['not_planned', 'completed', 'not_planned']))).flags, { onDemand: false, delegated: false, mode: 'verify' }, 'something shipped: no flag')
})

test('a verify session that times out is re-fired by the deadline path, with its own flags', async () => {
  const world = goalWorld()
  world.issues[897].labels = [{ name: 'bot:working' }]
  const current = { id: 'x', handler: 'revise-roadmap', flags: { mode: 'verify', withdrawn: true }, attempt: 1, firedAt: '2026-09-08T09:00:00Z', deadline: '2026-09-08T10:00:00Z' }
  world.comments[897] = [{ id: 1, body: `<!-- sydevs-status v1 ${JSON.stringify({ v: 1, fixCi: 0, recheck: false, pending: null, verifyDue: false, current, dispatches: [] })} -->\nrunning`, user: { login: 'sydevs-bot' }, created_at: '2026-09-08T09:00:00Z' }]
  world.refs = new Map([['refs/sydevs-lease/897', 'stale']])
  const github = fakeGithub(world)
  const sent = []
  const fetchImpl = async (url, opts) => { sent.push(JSON.parse(JSON.parse(opts.body).text)); return { status: 200, json: async () => ({ claude_code_session_id: 'cse_9', claude_code_session_url: 'u' }), headers: new Map() } }
  await act({ github, context: {}, core, config, target: { ...goal('sweep-timeout'), event: 'schedule', facts: { handler: 'revise-roadmap', attempt: 1 } }, env: { ROUTINE_TOKEN_SAHAJCLOUD: 'tok' }, dryRun: false, now, fetchImpl })
  assert.deepEqual(sent.map((r) => [r.handler, r.attempt, r.flags]), [['revise-roadmap', 2, { onDemand: false, delegated: false, mode: 'verify', withdrawn: true }]])
})

// ---- a converted blocker line is deleted (why: docs/why.md#a-converted-blocker-line-is-deleted)
const NOTES = '## Summary\nx\n\n## Notes\nBlocked by: https://github.com/sydevs/SahajCloud/issues/2 — the endpoint\n'

function blockerWorld(body, item = {}) {
  const w = issueWorld()
  Object.assign(w.issues[9], { body }, item)
  w.issues[2] = { number: 2, id: 1002, state: 'open', labels: [] }
  w.issues[3] = { number: 3, id: 1003, state: 'open', labels: [] }
  return w
}

/** Relationships the fake already holds, POSTs it refuses, and a hook run as each POST lands. */
function withDependencies(github, { related = [], refuse = [], onPost } = {}) {
  const base = github.request
  github.request = async (route, a) => {
    const res = await base(route, a)
    if (!route.includes('dependencies')) return res
    if (route.startsWith('GET')) return { data: route.endsWith('blocked_by') ? related : [] }
    if (refuse.includes(a.issue_id)) throw Object.assign(new Error('Validation Failed'), { status: 422 })
    onPost?.(a)
    return res
  }
  return github
}

const onIssue = (reason, facts = {}) => ({ repo: { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' }, kind: 'issue', number: 9, reason, event: reason, facts })
const puts = (github) => github.calls.filter((c) => c.name === 'updateIssue')
const posts = (github) => github.calls.filter((c) => c.name.startsWith('request:POST') && c.name.includes('dependencies'))

test('the relationships action PUTs the live body without the converted line', async () => {
  const world = blockerWorld(NOTES)
  // A session rewrites the body between gather and the strip: the PUT must
  // carry its words, so the strip reads the body again, never the snapshot.
  const github = withDependencies(fakeGithub(world), { onPost: () => { world.issues[9].body = NOTES.replace('\nx\n', '\nrewritten by a session\n') } })
  await act({ github, context: {}, core, config, target: onIssue('issues.edited', { sender: 'Ardnived' }), env: {}, dryRun: false, now })
  assert.equal(posts(github).length, 1)
  assert.deepEqual(puts(github).map((c) => c.args.body), ['## Summary\nrewritten by a session\n\n## Notes\n'])
})

test('a line naming a closed blocker that is already related is stripped, not re-POSTed', async () => {
  const github = withDependencies(fakeGithub(blockerWorld(NOTES)), { related: [{ number: 2, state: 'closed', repository: { name: 'SahajCloud', owner: { login: 'sydevs' } } }] })
  await act({ github, context: {}, core, config, target: onIssue('issues.edited', { sender: 'Ardnived' }), env: {}, dryRun: false, now })
  assert.equal(posts(github).length, 0)
  assert.deepEqual(puts(github).map((c) => c.args.body), ['## Summary\nx\n\n## Notes\n'])
})

test('one failed POST keeps the whole line', async () => {
  const body = '## Notes\nBlocked by: sydevs/SahajCloud#2 and sydevs/SahajCloud#3\n'
  const github = withDependencies(fakeGithub(blockerWorld(body)), { refuse: [1003] })
  await act({ github, context: {}, core, config, target: onIssue('issues.edited', { sender: 'Ardnived' }), env: {}, dryRun: false, now })
  assert.equal(posts(github).length, 2)
  assert.equal(puts(github).length, 0)
})

test('a dry run names the line it would strip and PUTs nothing', async () => {
  const logs = []
  const github = withDependencies(fakeGithub(blockerWorld(NOTES)))
  await act({ github, context: {}, core: { info: (m) => logs.push(m), warning: () => {} }, config, target: onIssue('issues.edited', { sender: 'Ardnived' }), env: {}, dryRun: true, now })
  assert.equal(posts(github).length, 0)
  assert.equal(puts(github).length, 0)
  assert.ok(logs.some((m) => m.includes('strip: Blocked by: https://github.com/sydevs/SahajCloud/issues/2')), 'the line is named')
})

test("a non-member's own line is never converted or stripped, and a verb leaves the body alone", async () => {
  const stranger = { user: { login: 'drive-by' }, author_association: 'NONE' }
  for (const target of [onIssue('issues.opened'), onIssue('issues.edited', { sender: 'drive-by' })]) {
    const github = withDependencies(fakeGithub(blockerWorld(NOTES, stranger)))
    await act({ github, context: {}, core, config, target, env: {}, dryRun: false, now })
    assert.equal(posts(github).length, 0, `${target.reason}: no relationship`)
    assert.equal(puts(github).length, 0, `${target.reason}: no strip`)
  }
  // A member's `block on` makes the relationship from a comment, not the body.
  const world = blockerWorld(NOTES, stranger)
  world.comments[9] = [{ id: 78, body: '@sydevs-bot block on sydevs/SahajCloud#2', user: { login: 'Ardnived' }, created_at: '2026-09-08T11:59:00Z', author_association: 'MEMBER' }]
  const github = withDependencies(fakeGithub(world))
  await act({ github, context: {}, core, config, target: onIssue('issue_comment', { author: 'Ardnived', body: '@sydevs-bot block on sydevs/SahajCloud#2', association: 'MEMBER', commentId: 78 }), env: {}, dryRun: false, now })
  assert.equal(posts(github).length, 1, 'the verb is obeyed')
  assert.equal(puts(github).length, 0, "and the stranger's line stays")
})

// ---- a wake hint promises only what wakes the bot ------------------------

const exhaustedRecord = (handler) => `<!-- sydevs-status v1 ${JSON.stringify({ v: 1, fixCi: 0, recheck: false, pending: null, current: { id: 'x', handler, attempt: 3, firedAt: '2026-09-08T09:00:00Z', deadline: '2026-09-08T10:00:00Z' }, dispatches: [] })} -->\nrunning`
const exhaustedNotice = (github) => github.calls.filter((c) => c.name === 'createComment').map((c) => String(c.args.body)).find((b) => b.includes('sydevs-dispatcher: attempts-exhausted x '))

test('attempts-exhausted on an issue asks for a verb or a mention', async () => {
  const world = issueWorld()
  world.issues[9].labels = [{ name: 'bot:working' }]
  world.comments[9] = [{ id: 1, body: exhaustedRecord('implement'), user: { login: 'sydevs-bot' }, created_at: '2026-09-08T09:00:00Z' }]
  const github = fakeGithub(world)
  const target = { repo: { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' }, kind: 'issue', number: 9, reason: 'sweep-timeout', event: 'schedule', facts: { handler: 'implement', attempt: 3 } }
  await act({ github, context: {}, core, config, target, env: {}, dryRun: false, now, fetchImpl: async () => { throw new Error('must not fire') } })
  const body = exhaustedNotice(github)
  assert.match(body, /A `@sydevs-bot` verb or mention from you starts me again\./)
  assert.doesNotMatch(body, /A comment/)
})

test('attempts-exhausted on a PR asks for a mention or a push', async () => {
  const pr = { number: 5, node_id: 'PR1', state: 'open', draft: true, merged: false, user: { login: 'sydevs-bot' }, head: { ref: 'claude/x', sha: 'abc' }, base: { ref: 'main' }, mergeable: true, mergeable_state: 'clean', changed_files: 8, additions: 120, deletions: 4, requested_reviewers: [] }
  const world = { issues: { 5: { number: 5, node_id: 'PR1', state: 'open', title: 'x', body: '', labels: [{ name: 'bot:working' }], user: { login: 'sydevs-bot' }, pull_request: {}, html_url: 'u', comments: 1 } }, comments: { 5: [{ id: 1, body: exhaustedRecord('fix-ci'), user: { login: 'sydevs-bot' }, created_at: '2026-09-08T09:00:00Z' }] }, prs: { 5: pr } }
  const github = fakeGithub(world)
  const target = { repo: { owner: 'sydevs', name: 'SahajCloud', full: 'sydevs/SahajCloud' }, kind: 'pr', number: 5, reason: 'sweep-timeout', event: 'schedule', facts: { handler: 'fix-ci', attempt: 3 } }
  await act({ github, context: {}, core, config, target, env: {}, dryRun: false, now, fetchImpl: async () => { throw new Error('must not fire') } })
  const body = exhaustedNotice(github)
  assert.match(body, /A mention \(`@sydevs-bot`\) or a push from you starts me again\./)
  assert.doesNotMatch(body, /A comment/)
})
