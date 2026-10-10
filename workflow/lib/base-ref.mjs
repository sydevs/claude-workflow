#!/usr/bin/env node
/**
 * The one baseline a `--base` comparison is taken against.
 *
 * ## Why this exists
 *
 * `rule-delta.mjs`, `comment-lint.mjs` and `comment-fingerprint.mjs` each
 * answer "what did this branch change". Each took the ref it was handed raw,
 * and each got two things wrong, in two directions.
 *
 * A routine clone never checks out the default branch, so `refs/heads/main` is
 * whatever the clone was seeded with. On one clean tree it sat 25 skill files
 * behind `origin/main`, and `rule-delta.mjs --base main` reported 50 additions
 * and one removal that nobody had made. A stale ref is also an ancestor of
 * HEAD, so `git merge-base main HEAD` returns the stale commit and rescues
 * nothing. The remote counterpart has to win first.
 *
 * The mirror case is a base that moved ON. Compare against the tip of
 * `origin/main` and every commit the base gained since the branch point reads
 * as this branch's work, backwards: a rule the base added shows up as REMOVED,
 * a rule it dropped as ADDED. The branch point is the only honest baseline.
 *
 * ## What it does NOT do
 *
 * It resolves a ref and nothing else. It never fetches — a routine has no
 * network inside these scripts — so it can only be as fresh as the last
 * `git fetch`. `start-run` step 6 is what makes `refs/remotes/origin/*`
 * current, and this module trusts that step rather than repeating it.
 */

import { execFileSync } from 'node:child_process'

/** A base ref that does not resolve. Carries the one message a CLI prints. */
export class BaseRefError extends Error {}

const git = (root, args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 }).trim()

const tryGit = (root, args) => {
  try {
    return git(root, args)
  } catch {
    return null
  }
}

const rev = (root, ref) => tryGit(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])

/**
 * Resolve `ref` to the commit a delta should be measured from.
 *
 * A bare name — one with no `/` — prefers `refs/remotes/origin/<name>` when
 * that ref exists, and warns once when the local branch of the same name
 * disagrees with it. The warning is the point: a run that prints a clean
 * report cannot otherwise say which of the two refs it compared, and that
 * ambiguity is what produced the phantom removal above. `--base <sha>` and
 * `--base <other-branch>` stay unsurprising, because no remote counterpart
 * exists to prefer or to differ from.
 *
 * Returns `{ ref, named, resolved, baseline, branchPoint }`. `baseline` is
 * what callers pass to `git show` and `git diff`.
 */
export function resolveBaseRef(ref, { root = process.cwd(), onWarn } = {}) {
  const name = String(ref ?? '').trim()
  if (!name || name.startsWith('--')) {
    throw new BaseRefError('--base needs a ref, for example --base origin/main.')
  }

  let named = name
  if (!name.includes('/')) {
    const remote = rev(root, `refs/remotes/origin/${name}`)
    if (remote) {
      named = `refs/remotes/origin/${name}`
      const local = rev(root, `refs/heads/${name}`)
      if (local && local !== remote) {
        const warn = onWarn ?? ((m) => process.stderr.write(`${m}\n`))
        warn(
          `warning: local ${name} is ${local.slice(0, 7)} and origin/${name} is ` +
            `${remote.slice(0, 7)}. Comparing against origin/${name}.`,
        )
      }
    }
  }

  const resolved = rev(root, named)
  if (!resolved) {
    throw new BaseRefError(`base ref '${name}' does not resolve to a commit in ${root}.`)
  }

  const head = rev(root, 'HEAD')
  const branchPoint = head ? tryGit(root, ['merge-base', resolved, head]) : null
  return { ref: name, named, resolved, baseline: branchPoint || resolved, branchPoint }
}

/**
 * Same, for a CLI: one message and a non-zero exit instead of a stack trace.
 *
 * All three readers diverged here, and two of the three were worse than
 * useless. `rule-delta.mjs` swallowed every `git show` failure, so an
 * unresolvable base yielded an empty before-set and the reassuring words `No
 * directive disappeared.` at exit 0. The other two threw 20 and 39 lines of
 * uncaught stack. Exit 2 matches what each already uses for a usage error.
 */
export function resolveBaseRefOrExit(ref, opts) {
  try {
    return resolveBaseRef(ref, opts)
  } catch (e) {
    if (e instanceof BaseRefError) {
      console.error(e.message)
      process.exit(2)
    }
    throw e
  }
}
