/**
 * Which consumers a merged producer PR leaves behind.
 *
 * `contractSync` in loop-config.json names every copy a consumer commits of
 * a producer's file: SahajCloud's generated types in WeMeditateWeb and
 * SahajAtlasWeb, the atlas URL contract in the WordPress plugin. A merged
 * producer PR that touches one of a consumer's sources leaves that copy
 * stale on the consumer's `main`. The `contracts-sync` job in dispatcher.yml
 * then runs the consumer's own sync command and opens one bot PR, which the
 * loop carries like any other. No ticket: a sync is the fix, not a proposal.
 * (why: docs/why.md#a-contract-sync-is-a-pr-not-a-ticket) When a goal built a
 * consumer PR beside the merged producer, the re-sync is a commit on that PR
 * instead. (why: docs/why.md#docs-fixes-and-re-syncs-ride-the-feature)
 */

/** The consumers whose copy one of `changedFiles` feeds. Pure. */
export function affectedConsumers(config, repoName, changedFiles) {
  const sync = config.contractSync
  if (!sync?.branch || repoName !== sync.producer) return []
  const changed = new Set(changedFiles)
  return Object.entries(sync.consumers || {})
    .filter(([name, c]) => (config.repos || []).includes(name) && (c.sources || []).some((p) => changed.has(p)))
    .map(([name, c]) => ({ repo: `${config.org}/${name}`, name, command: c.command, paths: c.paths, branch: sync.branch }))
}

/**
 * Every path a PR changes, a rename's old name included. The sync rule reads
 * this twice — the plan below, and `contractSyncOnly` in gather.mjs — so the
 * fetch and the rename pair live here once and cannot drift apart.
 */
export async function changedPaths(github, { owner, repo, number }) {
  const files = await github.paginate(github.rest.pulls.listFiles, { owner, repo, pull_number: number, per_page: 100 })
  return files.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean))
}

/**
 * The `contracts-plan` job: list the merged PR's files, a rename's old name
 * included, and name the consumers to re-sync. Only a merge into the default
 * branch counts, because every consumer syncs from `main`.
 */
export async function planContractSync({ github, context, core, config }) {
  const pr = context.payload.pull_request
  const { owner, repo } = context.repo
  if (!pr?.merged) return []
  if (repo !== config.contractSync?.producer) {
    core.info(`${repo} produces no synced contract`)
    return []
  }
  if (pr.base?.ref !== context.payload.repository?.default_branch) {
    core.info(`#${pr.number} merged into ${pr.base?.ref}, not the default branch`)
    return []
  }
  const out = affectedConsumers(config, repo, await changedPaths(github, { owner, repo, number: pr.number }))
  core.info(`#${pr.number} → ${out.length ? out.map((c) => c.name).join(', ') : 'no consumer'} to re-sync`)
  const plan = []
  for (const c of out) {
    const feature = await featurePrFor({ github, config, owner, repo, prNumber: pr.number, consumer: c.name })
    if (feature) core.info(`${c.name}: the re-sync rides #${feature.number}`)
    plan.push({ ...c, sourcePr: `https://github.com/${owner}/${repo}/pull/${pr.number}`, featurePr: feature?.number || null, featureBranch: feature?.branch || '' })
  }
  return plan
}

/** The open bot PR on a `claude/*` branch among `nodes`, as `{ number, branch }`, or null. Pure. */
export function pickFeaturePr(nodes, bot) {
  const p = (nodes || []).find((n) => n.state === 'OPEN' && String(n.author?.login || '').toLowerCase() === String(bot || '').toLowerCase() && String(n.headRefName || '').startsWith('claude/'))
  return p ? { number: p.number, branch: p.headRefName } : null
}

/**
 * The consumer PR a goal built beside this producer, or null: the open bot PR
 * closing a ticket that a ticket the merged PR closes blocks. Unreadable
 * relationships mean null, and the standalone sync PR, as before.
 */
export async function featurePrFor({ github, config, owner, repo, prNumber, consumer }) {
  const closing = `query($o:String!,$r:String!,$n:Int!){ repository(owner:$o,name:$r){ pullRequest(number:$n){ closingIssuesReferences(first:10){ nodes { number } } } } }`
  const prs = `query($o:String!,$r:String!,$n:Int!){ repository(owner:$o,name:$r){ issue(number:$n){ closedByPullRequestsReferences(first:10){ nodes { number state headRefName author { login } } } } } }`
  try {
    const d = await github.graphql(closing, { o: owner, r: repo, n: prNumber })
    for (const { number } of d.repository.pullRequest.closingIssuesReferences.nodes || []) {
      const { data } = await github.request('GET /repos/{owner}/{repo}/issues/{n}/dependencies/blocking', { owner, repo, n: number, per_page: 100 })
      for (const dep of data || []) {
        const depRepo = dep.repository?.name || /\/repos\/[^/]+\/([^/]+)$/.exec(String(dep.repository_url || ''))?.[1] || repo
        if (dep.state !== 'open' || depRepo !== consumer) continue
        const p = await github.graphql(prs, { o: owner, r: consumer, n: dep.number })
        const found = pickFeaturePr(p.repository.issue.closedByPullRequestsReferences.nodes, config.identity?.expectedLogin)
        if (found) return found
      }
    }
  } catch {
    return null
  }
  return null
}

/**
 * Is this bot PR only a contract re-sync? True on the sync branch when every
 * file it changes is one of the copy's `paths`. Once `fix-ci` adapts consumer
 * code, a file outside the copy appears and the PR is reviewed like any other.
 * A file list that is empty or absent proves nothing, and `[].every` is true,
 * so an unreadable list is not a sync: the critic runs and nothing is armed.
 */
export function isContractSyncOnly(config, repoName, pr, files) {
  const sync = config.contractSync
  const consumer = sync?.consumers?.[repoName]
  if (!consumer || !sync.branch || pr?.head?.ref !== sync.branch) return false
  if (!Array.isArray(files) || !files.length) return false
  return files.every((f) => (consumer.paths || []).includes(f))
}

/**
 * The contract check's newest verdict on a head, as `{ state, description }`,
 * or null. `statuses` is the REST list, newest first. Only one sydevs-bot
 * posted counts: anyone who can push can post a status. Pure.
 */
export function contractVerifyStatus(statuses, config) {
  const ctx = config.contractSync?.verifyContext
  const bot = String(config.identity?.expectedLogin || '').toLowerCase()
  if (!ctx || !bot) return null
  const v = (statuses || []).find((x) => x.context === ctx && String(x.creator?.login || '').toLowerCase() === bot)
  return v ? { state: v.state, description: v.description || '' } : null
}

/**
 * Whether the `contracts-verify` job may check this PR, as
 * `{ verify, reason, sha, command, paths }`. Only an open, ready bot PR from
 * this repo that changes nothing but the copy qualifies; anything else is left
 * to the dispatcher, which asks the reviewer as on any other PR. Pure.
 * (why: docs/why.md#a-verified-contract-sync-is-approved-by-actions)
 */
export function contractVerifyGate(config, repoName, pr, files) {
  const skip = (reason) => ({ verify: false, reason })
  const bot = String(config.identity?.expectedLogin || '').toLowerCase()
  if (pr?.state !== 'open') return skip('not open')
  if (pr.draft) return skip('a draft: checked once it is ready')
  if (!bot || String(pr.user?.login || '').toLowerCase() !== bot) return skip('not opened by the bot')
  if (!pr.head?.repo?.full_name || pr.head.repo.full_name !== pr.base?.repo?.full_name) return skip('the head is in another repository')
  if (!isContractSyncOnly(config, repoName, pr, files)) return skip('it changes more than the copied contract')
  const c = config.contractSync.consumers[repoName]
  return { verify: true, reason: 'a contract-only sync', sha: pr.head.sha, command: c.command, paths: c.paths }
}

/** The `contracts-verify` job's first step: read the PR fresh, and gate it. */
export async function planContractVerify({ github, context, core, config }) {
  const { owner, repo } = context.repo
  const number = context.payload.pull_request?.number
  if (!number) return { verify: false, reason: 'no pull request in the event' }
  const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: number })
  const v = contractVerifyGate(config, repo, pr, await changedPaths(github, { owner, repo, number }))
  core.info(`#${number}: ${v.verify ? 'verifying' : 'skipped'}, ${v.reason}`)
  return v
}

/**
 * The `contracts-verify` job's approval, with the consumer's own token: the
 * PAT is sydevs-bot, the PR's author, whose approval GitHub refuses. Pinned to
 * the head that was compared, so a later push leaves it stale. A head that
 * moved is left to the run it started. Any approval at that head is this
 * check's own: nothing else approves a contract-only sync.
 */
export async function approveContractSync({ github, context, core, sha, command }) {
  const { owner, repo } = context.repo
  const number = context.payload.pull_request.number
  const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: number })
  if (pr.head.sha !== sha) return core.info(`#${number}: the head moved past ${sha.slice(0, 7)}; its own run decides`)
  const reviews = await github.paginate(github.rest.pulls.listReviews, { owner, repo, pull_number: number, per_page: 100 })
  if (reviews.some((r) => r.state === 'APPROVED' && r.commit_id === sha)) return core.info(`#${number}: ${sha.slice(0, 7)} is already approved`)
  core.info(`#${number}: ${sha.slice(0, 7)} matches its source; approving`)
  await github.rest.pulls.createReview({
    owner, repo, pull_number: number, commit_id: sha, event: 'APPROVE',
    body: `The copied contract matches what \`${command}\` writes from \`main\`, byte for byte, and the PR changes nothing else. Approved by the contract check; the merge queue still runs CI.`,
  })
}

/**
 * The verdict, as `{ state, description }` for `contractSync.verifyContext`.
 * Pure. `matched` is the compare step's output; `approved` is whether the
 * approve step succeeded. Only `failure` and `error` make the dispatcher ask
 * the reviewer. (why: docs/why.md#a-verified-contract-sync-is-approved-by-actions)
 */
export function contractVerdict({ matched, approved, command }) {
  if (matched === 'true' && approved) return { state: 'success', description: `Matches what ${command} writes on main` }
  if (matched === 'false') return { state: 'failure', description: `Differs from what ${command} writes on main` }
  return { state: 'error', description: 'The contract check did not finish' }
}

/**
 * Post the verdict on the compared head, as sydevs-bot: a status posted with
 * the consumer's own token would fire no event, and the dispatcher is woken by
 * this one (`status` resolves to the PR).
 */
export async function reportContractVerify({ github, context, core, config, sha, verdict }) {
  const { owner, repo } = context.repo
  const description = verdict.description.length > 140 ? `${verdict.description.slice(0, 139)}…` : verdict.description
  core.info(`${sha.slice(0, 7)}: ${verdict.state}, ${description}`)
  await github.rest.repos.createCommitStatus({
    owner, repo, sha, state: verdict.state, context: config.contractSync.verifyContext, description,
    target_url: `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`,
  })
}
