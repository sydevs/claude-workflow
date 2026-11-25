# loop-config.json, key by key

Reference for each section of [`loop-config.json`](../loop-config.json).
The file itself keeps a one-line `$comment` per section, because every run reads it.
This page holds the full meaning of each value. The rules live in the skills, and the story in [why.md](why.md).

## The file

VALUES the loop reads, nothing else. This file holds only numbers, names, and ids, never rules or rationale. The rule lives in the skill that enforces it. The story lives in docs/why.md. Each run reads this file fresh from main, so a merge here changes only the next run.

## ceilings

Stock caps. The dispatcher enforces ciFixIterations (fix-ci per PR) and ciInfraReruns (re-runs of an infrastructure failure per head, why: docs/why.md#an-infrastructure-failure-is-re-run-not-repaired); run-audit's proposal rule enforces the proposal ceilings. There is no WIP cap (why: docs/why.md#there-is-no-wip-cap).

## findings

Routing for a real defect a run trips over, applied by the incidental-finding rule in start-run/SKILL.md. directFixMaxFiles bounds a fix small enough to skip the ticket and go straight to a ticketless PR. testGlobs are the paths workflow/lib/test-only.mjs accepts as a test-only change.

## labels

journal excludes the diary from every worklist. lock = a session holds the item (the lease a session reads, the unlock event, the kill switch), proposal = bot-filed with no human verb yet. Where an item stands is the board's Status, not a label. Actions writes both but the lock's release. Rules in start-run/SKILL.md.

## assignment

No assignee carries meaning, and the loop writes none. reviewer is requested at mark-ready. respondTo lists the logins whose comments count as feedback. Rules in format-ticket/SKILL.md.

## handlers

One skill per handler; the dispatch record's handler field selects it, and its flags.mode names the job for a multi-mode skill. model also selects the lane a handler fires on: a routine keyed like a repo (ROUTINE_ID_<MODEL>, ROUTINE_TOKEN_<MODEL>), used once both are set, else the repo's routine (dispatch.routines) runs it, unless the handler names its own. scope "repo" marks a handler fired at a repository with no item or lock. Rules in start-run/SKILL.md.

## dispatch

Values the GitHub Actions dispatcher reads. routines: one routine per repo, keyed by repo name; the ROUTINE_ID_<REPO> org variable wins when set. verbs.aliases maps a verb to the one it means on that surface. timeoutsMinutes is how long a lease holds before the sweeper re-fires; maxAttempts bounds re-fires, and overdue checks of a Pending item, before it is handed to you. pendingDueMinutes is how long a wait the machinery owns may sit Pending before it is checked. reconcileMaxPerEvent caps what one event run adds besides its own item: the record reads that look for an expired lock, then the drift targets left over. githubRetry retries a GitHub 5xx under every dispatcher call, and waits out a rate limit for up to rateLimitMaxWaitSeconds. rateLimitFloor is the REST budget below which an event run returns only its own targets and sheds the drift ones. sessionBranchPrefix is the one branch prefix a cloud session can push to; relayBranchPrefix + <pr>- names the branch a session leaves for Actions to move a PR branch to (docs/why.md#the-relay). enabledHandlers null = all. Rules in .github/workflows/dispatcher.yml and docs/why.md#actions-observes-classifies-locks-and-fires.

## roadmap

The Roadmap tier. type is the org issue type a roadmap ticket carries. notesMarker opens the Technical notes block at the end of a roadmap body; its v1 spelling marked the old notes comment, which is folded into the block once. spikeBranchPrefix marks a review session's throwaway preview branch, which the dispatcher never touches. readOnlyKeys are the only environment variables a review experiment may call production with. settledMarker opens the comment settle-roadmap posts after writing answers into a body. Rules in format-ticket/SKILL.md and revise-roadmap/SKILL.md (why: docs/why.md#the-roadmap-tier).

## ci

noCi lists repos with workflows but no CI, so a PR there is green at once. ignoreCheckNames are the dispatcher's own check runs, matched as a name or as that name followed by a matrix suffix — GitHub names a matrix leg `<job> (<params>)`, and cancel-in-progress cancels ours routinely, which reads as failing CI (why: docs/why.md#our-own-check-runs-are-not-ci). infraLabel is the error-annotation title a check writes to mark its failure as infrastructure, not the change.

## mergePolicy

loopMayNotMerge: repos never armed, whatever the gate says. proxyApprove: authors whose own ready PR the bot approves once CI is green and the critic has run, because GitHub refuses their approval and the ruleset needs one. The bot never arms their PRs: the author does. Rules in dispatcher/approvals.mjs.

## auditCalendar

Weekday -> audit skill, or a list of skills that take turns on that weekday, one per run, counted from rotationEpoch. Only run-audit dispatches these. monthly.<weekday>.<n>, when present, overrides the nth such weekday of the month. Keys are lowercase UTC weekday names, from `date -u +%A | tr A-Z a-z`.

## auditAngles

audit-code's three rotations, one per weekday it runs. Each advances one angle per run of its own day, counted from auditCalendar.rotationEpoch; an overridden day does not count. workflow/skills/run-audit/calendar.mjs is the one reader.

## deps

The dispatcher's daily vulnerability check (dispatcher/deps.mjs). It fires handler in a repo when an open Dependabot alert at these severities and scopes opened within windowHours, or on catchUpDay is still open with a fix, and no bot PR on branchPrefix is open there. routineBranchPrefix is the routine-updates job's; the dispatcher ignores it.

## sentry

DE region: the global sentry.io host 404s here. The token lacks org:read, so /organizations/ also 403s. SahajAtlasWordpress ships no Sentry.

## railway

statusContexts are the commit-status contexts a Railway preview posts. logLines bounds each log read.

## mailpit

Basic-auth credentials live in the cloud environment as MAILPIT_UI_AUTH, never here.

## storybook

The one Storybook version every library pins, so their component manifests stay comparable.

## contractSync

Copies of a producer's files that consumers commit. A merged producer PR touching a source re-runs each affected consumer's command: as a commit on the consumer PR its goal built beside it, else on main, in one bot PR on branch. Each consumer's paths and command also drive .github/actions/contract-check, a step in its required CI, so an edit here can block merges in three repos. Rules in audit-contracts/SKILL.md (why: docs/why.md#a-contract-sync-is-a-pr-not-a-ticket). attestContext is the commit status contracts-sync posts on each commit it writes, which contracts-verify approves; past approveWithinMinutes unapproved, the reviewer is asked.

## issueFields

GitHub's native org-level issue fields, not Projects v2, not labels. You can read and write them, but not search them. See format-ticket/SKILL.md for read/write rules and the PUT-replaces-everything trap.

## issueFields.holdUntil

Where a hold lives: the date a ticket comes back to you. Status is Hold while it is ahead. A bare `hold` picks a day between defaultDays[0] and defaultDays[1] from now, spread by item number; no hold may reach past maxHorizonDays (why: docs/why.md#a-hold-is-a-date-not-a-recheck).

## relationships

No MCP tool writes a native relationship, so a session writes this marker and the dispatcher converts it. The reader matches the words, not the punctuation (why: docs/why.md#the-marker-reader-matches-words-not-punctuation). A date park is the Hold Until field, not a marker.

## identity

expectedLogin is authoritative, and is the sessions' login. Each run checks it against get_me once. dispatcherLogins are every login the loop writes under — the sessions' and the dispatcher App's — and the dispatcher reads its own writes under any of them, so an item written before the App switch keeps its record. REST's spelling only: a GraphQL actor is normalised to it by restLogin, because a bare slug is a name a user account could hold and this list is trusted. Attribution rules in implement-ticket/SKILL.md.

## review

review-pr. Advisory only. skipWhen: the dispatcher marks a draft ready without a critic at or under both, and finalize-pr skips its `/simplify` pass on such a diff. selfReview.level is the `/code-review` level finalize-pr step 2 runs, and tinyLevel the one it runs at or under skipWhen. Rules in review-pr/SKILL.md and finalize-pr/SKILL.md.

## review.streamline

The pieces workflow/lib/new-pieces.mjs lists for review-pr's streamliner. Rules in review-pr/SKILL.md.

## journal

One issue per day in journalRepo, created lazily. The title reports run health. Volume lives on the board. No issue number appears here, since the run finds today's by creation date.

## projects

The org board, public as the roadmap. The dispatcher derives every open item's Status, Roadmap tickets included, after each plan, and never reads it back to decide (why: docs/why.md#status-is-derived-never-read). status maps the derivation's keys to the board's option names.

## writing

Character budgets for everything the loop writes, counted including <details>. Ticket and PR bodies are deliberately unbudgeted, except notes, the Technical notes block of a roadmap body, which is measured but never refused. Bodies are state, and grounding reads them instead of the thread. workflow/lib/budget.mjs enforces this. Rules are in start-run/SKILL.md.
