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
  const files = await github.paginate(github.rest.pulls.listFiles, { owner, repo, pull_number: pr.number, per_page: 100 })
  const names = files.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean))
  const out = affectedConsumers(config, repo, names)
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
        if (dep.state !== 'open' || dep.repository?.name !== consumer) continue
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
 * Is this bot PR only a contract re-sync? True on the sync branch when it
 * changes no more files than the copy has. Once `fix-ci` adapts consumer
 * code, the count grows past the copy and the PR is reviewed like any other.
 */
export function isContractSyncOnly(config, repoName, pr) {
  const sync = config.contractSync
  const consumer = sync?.consumers?.[repoName]
  if (!consumer || !sync.branch || pr?.head?.ref !== sync.branch) return false
  return (pr.changed_files ?? Infinity) <= (consumer.paths || []).length
}
