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
 * (why: docs/why.md#a-contract-sync-is-a-pr-not-a-ticket)
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
  return out.map((c) => ({ ...c, sourcePr: `https://github.com/${owner}/${repo}/pull/${pr.number}` }))
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
