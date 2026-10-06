/**
 * The lease: `refs/sydevs-lease/<number>` in the target repo.
 *
 * `POST /repos/:owner/:repo/git/refs` is the one GitHub write that is a
 * compare-and-swap: it answers 422 when the ref already exists, so exactly
 * one of two concurrent creates wins, with no read in between. The lock label
 * and the status comment are both last-writer-wins, and no concurrency group
 * spans repositories, so this ref is the only thing that can serialize two
 * `act` passes. (why: docs/why.md#the-lease-is-a-ref-not-a-label)
 *
 * The ref's **existence** is the lease. Where it points is never read, so any
 * object sha in the repo will do. The status comment stays the record.
 *
 * A ref that outlives its session is a permanent lock on that item — a worse
 * failure than the duplicate dispatch this replaces. Every release path calls
 * `releaseLease`, `sweep-timeout` deletes unconditionally, and `sweep-lease`
 * reclaims a ref left on an item carrying no lock.
 */

export const LEASE_PREFIX = 'refs/sydevs-lease/'

/** The full ref name. `createRef` wants this; `getRef`/`deleteRef` want it without `refs/`. */
export function leaseRef(number) {
  return `${LEASE_PREFIX}${number}`
}

function shortRef(number) {
  return leaseRef(number).slice('refs/'.length)
}

/**
 * The lease numbers this repo currently holds. Empty on any read failure —
 * a sweep that cannot read the refs reclaims nothing, which is the safe way
 * round.
 *
 * `matching-refs` takes the ref with no `refs/` and **no trailing slash**: the
 * slash would land in the URL path. So it matches a prefix, and the filter
 * below is what makes it the lease namespace and not a name beginning with it.
 */
export async function listLeases(gh, owner, repo) {
  let data
  try {
    ({ data } = await gh.rest.git.listMatchingRefs({ owner, repo, ref: shortRef('').replace(/\/$/, '') }))
  } catch {
    return []
  }
  return (data || [])
    .map((r) => String(r.ref))
    .filter((r) => r.startsWith(LEASE_PREFIX))
    .map((r) => Number(r.slice(LEASE_PREFIX.length)))
    .filter((n) => Number.isInteger(n) && n > 0)
}

/** Any object sha in the repo, preferring one the snapshot already read. */
async function anchorSha(gh, owner, repo, hintSha) {
  if (hintSha) return hintSha
  const { data: r } = await gh.rest.repos.get({ owner, repo })
  const { data: ref } = await gh.rest.git.getRef({ owner, repo, ref: `heads/${r.default_branch}` })
  return ref.object.sha
}

/**
 * Take the lease. Returns `{ won }`, and never throws:
 *   { won: true }                     — this pass owns the item
 *   { won: false, contended: true }   — 422, another pass holds it
 *   { won: false, error: '<reason>' } — the lease could not be read or written
 *
 * A lease we cannot take means no fire. Failing open would restore the defect
 * this exists to fix, so the caller records a `recheck` and journals instead.
 */
export async function takeLease(gh, { owner, repo, number }, hintSha) {
  let sha
  try {
    sha = await anchorSha(gh, owner, repo, hintSha)
  } catch (e) {
    return { won: false, error: `cannot read an anchor sha: ${e?.status || '?'} ${e?.message || e}` }
  }
  try {
    await gh.rest.git.createRef({ owner, repo, ref: leaseRef(number), sha })
    return { won: true }
  } catch (e) {
    if (e?.status === 422) return { won: false, contended: true }
    return { won: false, error: `cannot create ${leaseRef(number)}: ${e?.status || '?'} ${e?.message || e}` }
  }
}

/** Release the lease. A ref that is already gone is success — the point is that it is not there. */
export async function releaseLease(gh, { owner, repo, number }) {
  try {
    await gh.rest.git.deleteRef({ owner, repo, ref: shortRef(number) })
    return true
  } catch (e) {
    if (e?.status === 404 || e?.status === 422) return true
    return false
  }
}
