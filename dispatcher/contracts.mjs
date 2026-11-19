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
    .map(([name, c]) => ({ repo: `${config.org}/${name}`, name, command: c.command, paths: c.paths, branch: sync.branch, attestContext: sync.attestContext || '' }))
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

/** Marks the contract check's own approval, so only that one is ever dismissed. */
export const CHECK_APPROVAL_MARKER = '<!-- sydevs-contract-check -->'

/**
 * When `contracts-sync` vouched for this head, or null if it never did. It
 * posts `contractSync.attestContext` on every commit it pushes to the sync
 * branch, as sydevs-bot; anyone who can push can post a status, so only the
 * bot's counts. `statuses` is the REST list for the head. Pure.
 */
export function contractSyncAttestedAt(statuses, config) {
  const ctx = config.contractSync?.attestContext
  const bot = String(config.identity?.expectedLogin || '').toLowerCase()
  if (!ctx || !bot) return null
  const x = (statuses || []).find((x) => x.context === ctx && x.state === 'success' && String(x.creator?.login || '').toLowerCase() === bot)
  return x ? x.created_at || x.updated_at || 'unknown' : null
}

/**
 * May the contract check approve this PR? Only an open, ready bot PR from this
 * repo, into its default branch, that changes nothing but the copy, as
 * `{ ok, reason }`. Pure. (why: docs/why.md#a-verified-contract-sync-is-approved-by-actions)
 */
export function contractVerifyGate(config, repoName, pr, files) {
  const no = (reason) => ({ ok: false, reason })
  const bot = String(config.identity?.expectedLogin || '').toLowerCase()
  if (pr?.state !== 'open') return no('not open')
  if (pr.draft) return no('a draft: checked once it is ready')
  if (!bot || String(pr.user?.login || '').toLowerCase() !== bot) return no('not opened by the bot')
  if (!pr.head?.repo?.full_name || pr.head.repo.full_name !== pr.base?.repo?.full_name) return no('the head is in another repository')
  if (!pr.base?.ref || pr.base.ref !== pr.base?.repo?.default_branch) return no('it does not target the default branch, which the sync is generated from')
  if (!isContractSyncOnly(config, repoName, pr, files)) return no('it changes more than the copied contract')
  return { ok: true, reason: 'a contract-only sync' }
}

/**
 * The `contracts-verify` job. Approves a sync PR whose head `contracts-sync`
 * wrote, with `approver` (the consumer's own token: `github` is the PAT, which
 * is sydevs-bot, the PR's author, whose approval GitHub refuses). A head it
 * cannot vouch for has any earlier approval of its own dismissed, whatever
 * the ruleset does on push. Asking the reviewer is `decide`'s. A status event
 * names a commit, not a PR, so the open sync PR at that head is looked up.
 */
export async function verifyContractSync({ github, approver, context, core, config, dryRun = false }) {
  const { owner, repo } = context.repo
  const branch = config.contractSync?.branch
  let numbers = context.payload.pull_request ? [context.payload.pull_request.number] : []
  if (!numbers.length && context.payload.sha) {
    const { data } = await github.rest.repos.listPullRequestsAssociatedWithCommit({ owner, repo, commit_sha: context.payload.sha })
    numbers = data.filter((p) => p.state === 'open' && p.head?.ref === branch && p.head?.sha === context.payload.sha).map((p) => p.number)
  }
  for (const number of numbers) {
    const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: number })
    if (pr.state !== 'open' || pr.head?.ref !== branch) { core.info(`#${number}: not an open sync PR`); continue }
    const sha = pr.head.sha
    const gate = contractVerifyGate(config, repo, pr, await changedPaths(github, { owner, repo, number }))
    const attested = gate.ok && contractSyncAttestedAt((await github.rest.repos.listCommitStatusesForRef({ owner, repo, ref: sha, per_page: 100 })).data, config)
    const own = (await github.paginate(github.rest.pulls.listReviews, { owner, repo, pull_number: number, per_page: 100 }))
      .filter((r) => r.state === 'APPROVED' && String(r.body || '').includes(CHECK_APPROVAL_MARKER))
    if (attested) {
      if (own.some((r) => r.commit_id === sha)) { core.info(`#${number}: ${sha.slice(0, 7)} is already approved`); continue }
      core.info(`#${number}: ${sha.slice(0, 7)} was written by the contract sync; approving`)
      if (!dryRun) {
        await approver.rest.pulls.createReview({
          owner, repo, pull_number: number, commit_id: sha, event: 'APPROVE',
          body: `${CHECK_APPROVAL_MARKER}\nThis head was written by the contract sync from \`main\`, and the PR changes nothing but the copied contract. Approved by the contract check; the merge queue still runs CI.`,
        })
      }
      continue
    }
    core.info(`#${number}: ${sha.slice(0, 7)} not approved: ${gate.ok ? 'the contract sync did not write it' : gate.reason}`)
    for (const r of own.filter((x) => x.commit_id !== sha)) {
      core.info(`#${number}: dismissing the check's approval of ${String(r.commit_id).slice(0, 7)}`)
      if (!dryRun) await approver.rest.pulls.dismissReview({ owner, repo, pull_number: number, review_id: r.id, message: 'The head moved to a commit the contract check cannot vouch for.' })
    }
  }
}
