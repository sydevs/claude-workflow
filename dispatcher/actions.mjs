/**
 * Every action a plan is made of, and the only place one is constructed.
 *
 * A plan is a list of these, and `apply.mjs` executes them in order, matching
 * on `type`. Keeping one home for the vocabulary means a new action is added
 * once and spelled once, however many deciders come to emit it. This module
 * imports nothing, so anything may import it.
 */

export const fire = (handler, flags = {}) => ({ type: 'fire', handler, flags })
export const recheck = () => ({ type: 'recheck' })
/** Put the item on the org board, so `syncStatus` has a row to write. */
export const ensure = () => ({ type: 'ensure' })
export const label = (add = [], remove = []) => ({ type: 'label', add, remove })
/** The last action of every plan: `apply` derives Status from the state the plan left. (why: docs/why.md#status-is-derived-never-read) */
export const syncStatus = () => ({ type: 'syncStatus' })
export const commentOnce = (key, body) => ({ type: 'comment', key, body })
export const markReady = () => ({ type: 'markReady' })
export const requestReviewer = () => ({ type: 'requestReviewer' })
export const armAutoMerge = () => ({ type: 'armAutoMerge' })
/** Turn off an auto-merge the bot armed on the owner's own PR: arming it is theirs. */
export const disarmAutoMerge = () => ({ type: 'disarmAutoMerge' })
/** Approve the owner's own PR at `sha`, standing in for the approval GitHub refuses its author. */
export const proxyApprove = (sha) => ({ type: 'proxyApprove', sha })
/** Dismiss the bot's own approvals, by review id: a commit of its own sits on top of them. */
export const dismissProxy = (ids) => ({ type: 'dismissProxy', ids })
/** Dismiss a person's approvals, by review id: a commit of the bot's own landed after them. */
export const dismissStale = (ids) => ({ type: 'dismissStale', ids })
export const bumpFixCi = () => ({ type: 'bumpFixCi' })
export const rerunJobs = (sha, checks) => ({ type: 'rerunJobs', sha, checks })
export const sentry = (issue, id) => ({ type: 'sentry', issue, id })
/** `strip`: the targets were read from the body, so their lines go once related. A `block on` verb's were not. */
export const relationships = (blockedBy, strip = false) => ({ type: 'relationships', blockedBy, strip })
export const anomaly = (kind, text) => ({ type: 'anomaly', kind, text })
export const targets = (list) => ({ type: 'targets', list })
export const releaseLease = (why) => ({ type: 'releaseLease', why })
/** A session ended: its lease goes with its label, and its dispatch is archived. */
export const unlocked = (handler) => ({ type: 'unlocked', handler })
/** Fire the pending dispatch the record is holding, now that its wait is over. */
export const retry = () => ({ type: 'retry' })
/** The deadline passed: reclaim the lease, whatever the record says. */
export const timeout = () => ({ type: 'timeout' })
export const note = (text) => ({ type: 'note', text })
export const react = (emoji) => ({ type: 'react', emoji })
export const record = (patch) => ({ type: 'record', patch })
/** Set the Hold Until date, or clear it with `null`. */
export const hold = (date) => ({ type: 'hold', date })
/** A pass on an item whose session ended with no unlock seen: archive it, release the lease. */
export const archiveCurrent = () => ({ type: 'archiveCurrent' })
export const transfer = (repo, milestone) => ({ type: 'transfer', repo, milestone })
export const relay = ({ branch, head, sha }) => ({ type: 'relay', branch, head, sha })
