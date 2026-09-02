#!/usr/bin/env node

/**
 * Print the BRANCH preview alias for a pull request — the host that follows the
 * branch, so a link in the PR body still shows the current code after the next
 * push.
 *
 * ## Why this is not the repo's own preview script
 *
 * `get-cloudflare-preview-url.mjs` (SahajAtlasWeb, WeMeditateWeb) ranks a
 * per-deployment alias ABOVE a branch alias, deliberately: its consumer is the CI
 * smoke gate, which must test exactly the SHA it was handed, and its docblock
 * says a branch alias "names one immutable build … a branch alias names none."
 * Correct there. Exactly wrong in a PR body, where the reviewer opens the link
 * days and two pushes later.
 *
 * Reusing that script for the body is how SahajAtlasWeb#181 came to link
 * `c76da223.sahajatlas.pages.dev` — twice, the second time with a rationale
 * lifted from that script's own header ("these are per-deployment aliases, so
 * they stay pinned to this commit"). Two tools, two requirements: pinned for the
 * gate, current for the reader. Neither is a bug in the other.
 *
 * ## Discovered, never constructed
 *
 * Cloudflare LABELS the two hosts, on both platforms it deploys here:
 *
 *   Pages    <strong>Branch Preview URL:</strong></td><td><a href='…'>
 *   Workers  <a href='…'>Branch Preview URL</a>
 *
 * so the alias is read, not derived. That matters: the documented slug rule
 * (non-alphanumerics to `-`, truncate to 28) is a guess about a host we do not
 * own, and two branches whose names agree in their first 28 characters produce
 * one alias — which would resolve 200 and serve the wrong branch. A label
 * cannot collide.
 *
 * Sources, both parsed the same way:
 *   1. the Cloudflare bot's PR comments   — Pages and Workers
 *   2. Cloudflare check-run summaries     — Pages only, and the only working
 *                                           source on SahajAtlasWeb, which gets
 *                                           no commit statuses or deployments
 *
 * The construction fallback below fires only when neither source carries a
 * labelled alias, and even then it derives the host from the COMMIT alias we did
 * observe rather than from a hardcoded project name.
 *
 * ## Usage
 *
 *   branch-preview-url.mjs [--repo owner/name] [--pr N] [--wait SECONDS] [--json]
 *
 * Defaults come from `gh` and the current branch. Exits 1 when no alias can be
 * resolved, so a run cannot quietly paste a pinned URL instead.
 */

import { execFileSync } from 'child_process'

const args = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
const JSON_OUT = args.includes('--json')
const WAIT_MS = Number(flag('wait', '0')) * 1000
const POLL_MS = 15_000

/** `gh` with JSON out. Throws with the CLI's own stderr, which is the useful part. */
function gh(argv) {
  const out = execFileSync('gh', argv, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  })
  return out.trim() ? JSON.parse(out) : null
}

const PREVIEW_HOST = /^https:\/\/[a-z0-9.-]+\.(pages|workers)\.dev\/?$/i
const COMMIT_LABEL = /^[0-9a-f]{8}(?=[-.])/

/**
 * Every `<a href=…>` in a blob, with its text and where it started — enough to
 * answer "which label is this link under" for both markup shapes.
 */
function anchors(body) {
  const out = []
  const re = /<a\s+[^>]*href=['"]([^'"]+)['"][^>]*>(.*?)<\/a>/gis
  let m
  while ((m = re.exec(body))) out.push({ url: m[1].trim(), text: m[2], at: m.index })
  return out
}

/**
 * The labelled branch alias, or null.
 *
 * Workers wraps the label in the anchor; Pages puts it in the preceding table
 * cell. Both are covered by "the anchor whose own text says so, else the first
 * anchor after a cell that does" — and the second pass is deliberately
 * position-based rather than a table parse, because the row markup is
 * Cloudflare's to change and the ordering is not.
 */
export function branchAliasFrom(body) {
  if (!body) return null
  const links = anchors(body)

  const own = links.find((a) => /branch\s+preview\s+url/i.test(a.text))
  if (own && PREVIEW_HOST.test(own.url)) return own.url

  for (const label of body.matchAll(/branch\s+preview\s+url/gi)) {
    const next = links.find((a) => a.at > label.index && PREVIEW_HOST.test(a.url))
    if (next) return next.url
  }
  return null
}

/** The per-deployment alias, kept only to name the project and to build a fallback host. */
export function commitAliasFrom(body) {
  if (!body) return null
  const links = anchors(body)
  const hit = links.find(
    (a) => PREVIEW_HOST.test(a.url) && COMMIT_LABEL.test(new URL(a.url).hostname),
  )
  return hit ? hit.url : null
}

/**
 * `sahajatlas` from `c76da223.sahajatlas.pages.dev`;
 * `wemeditate-web` from `c14f4e66-wemeditate-web.contact-c66.workers.dev`.
 *
 * Read off the COMMIT alias rather than the branch one, because only the commit
 * alias has a prefix of known shape to strip. A branch alias's leading label is
 * an arbitrary slug that may itself contain hyphens, so the same split there
 * would cut in the wrong place.
 */
function projectFrom(commitUrl) {
  if (!commitUrl) return null
  const host = new URL(commitUrl).hostname
  const rest = host.replace(COMMIT_LABEL, '').replace(/^[-.]/, '')
  return rest.split('.')[0] || null
}

/** Last resort: the commit alias's host with the branch slug swapped in. */
function constructFrom(commitUrl, branch) {
  if (!commitUrl) return null
  const url = new URL(commitUrl)
  const host = url.hostname
  const slug = branch
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .slice(0, 28)
    .replace(/-+$/, '')
  if (!slug) return null
  // Preserve the separator Cloudflare used: `.` for Pages, `-` for Workers.
  const sep = host.match(COMMIT_LABEL) ? host[8] : '.'
  return `https://${slug}${sep}${host.replace(COMMIT_LABEL, '').replace(/^[-.]/, '')}`
}

/** Collect every Cloudflare-authored blob that might carry a labelled alias. */
function sources(repo, pr, sha) {
  const found = []

  const comments = gh(['api', `repos/${repo}/issues/${pr}/comments`, '--paginate']) || []
  for (const c of comments) {
    if (/cloudflare/i.test(c.user?.login || '')) found.push({ source: 'comment', body: c.body })
  }

  const runs = gh(['api', `repos/${repo}/commits/${sha}/check-runs`, '--paginate'])
  for (const r of runs?.check_runs || []) {
    if (!/cloudflare/i.test(r.app?.slug || '')) continue
    found.push({ source: `check:${r.name}`, body: r.output?.summary || '' })
  }

  return found
}

/** Any HTTP answer proves the host exists; only a transport failure is fatal. */
async function probe(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' })
    return res.status
  } catch {
    return null
  }
}

async function main() {
  const repo = flag('repo') || gh(['repo', 'view', '--json', 'nameWithOwner'])?.nameWithOwner
  const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf-8' }).trim()

  const prArg = flag('pr')
  const prView = prArg
    ? gh(['pr', 'view', prArg, '--repo', repo, '--json', 'number,headRefOid,headRefName'])
    : gh(['pr', 'view', '--json', 'number,headRefOid,headRefName'])
  if (!prView) {
    console.error(`No pull request found for ${branch} in ${repo}.`)
    process.exit(1)
  }

  const deadline = Date.now() + WAIT_MS
  for (;;) {
    const results = new Map()

    for (const { source, body } of sources(repo, prView.number, prView.headRefOid)) {
      const commit = commitAliasFrom(body)
      const alias = branchAliasFrom(body) || constructFrom(commit, prView.headRefName || branch)
      if (!alias || results.has(alias)) continue
      results.set(alias, {
        url: alias,
        project: projectFrom(commit),
        source,
        constructed: !branchAliasFrom(body),
      })
    }

    if (results.size) {
      const rows = []
      for (const row of results.values()) rows.push({ ...row, status: await probe(row.url) })

      if (JSON_OUT) console.log(JSON.stringify(rows, null, 2))
      else {
        for (const r of rows) {
          const note = r.constructed ? '  (constructed — verify before use)' : ''
          console.log(`${(r.project || '?').padEnd(20)} ${String(r.status ?? 'unreachable').padEnd(12)} ${r.url}${note}`)
        }
      }
      // A host that answers nothing at all is not a link worth pasting.
      process.exit(rows.some((r) => r.status !== null) ? 0 : 1)
    }

    if (Date.now() >= deadline) break
    console.error('No branch alias yet — Cloudflare has not posted one. Waiting…')
    await new Promise((r) => setTimeout(r, Math.min(POLL_MS, deadline - Date.now())))
  }

  console.error(
    `No branch preview alias for ${repo}#${prView.number}. The deploy may still be building; ` +
      'say "preview pending" rather than linking a per-commit alias.',
  )
  process.exit(1)
}

// Guarded so a spec can import the parsers without hitting the network.
if (process.argv[1] && process.argv[1].endsWith('branch-preview-url.mjs')) {
  main().catch((err) => {
    console.error(`branch-preview-url failed: ${err?.message || err}`)
    process.exit(1)
  })
}
