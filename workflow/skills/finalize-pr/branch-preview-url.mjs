#!/usr/bin/env node

/**
 * Print the BRANCH preview alias for a pull request. That is the host that
 * follows the branch, so a link in the PR body still shows current code
 * after the next push.
 *
 * ## Why this is not the repo's own preview script
 *
 * `get-cloudflare-preview-url.mjs` (SahajAtlasWeb, WeMeditateWeb) ranks a
 * per-deployment alias ABOVE a branch alias, on purpose. Its consumer is the
 * CI smoke gate, which must test exactly the SHA it was handed. Its docblock
 * says a branch alias "names one immutable build … a branch alias names
 * none." That is correct there. It is exactly wrong in a PR body, where the
 * reviewer opens the link days and two pushes later.
 *
 * Reusing that script for the PR body caused SahajAtlasWeb#181 to link
 * `c76da223.sahajatlas.pages.dev` twice. The second time it carried a
 * rationale lifted from that script's own header ("these are per-deployment
 * aliases, so they stay pinned to this commit"). Two tools serve two
 * requirements: pinned for the gate, current for the reader. Neither is a
 * bug in the other.
 *
 * ## Discovered, never constructed
 *
 * Cloudflare LABELS the two hosts, on both platforms it deploys here:
 *
 *   Pages    <strong>Branch Preview URL:</strong></td><td><a href='…'>
 *   Workers  <a href='…'>Branch Preview URL</a>
 *
 * So this script reads the alias. It does not derive one. That matters: the
 * documented slug rule (non-alphanumerics to `-`, truncate to 28) is a
 * guess about a host we do not own. Two branches whose names agree in their
 * first 28 characters would produce one alias, which would resolve 200 and
 * serve the wrong branch. A label cannot collide.
 *
 * Sources, both parsed the same way:
 *   1. the Cloudflare bot's PR comments   — Pages and Workers
 *   2. Cloudflare check-run summaries     — Pages only, and the only working
 *                                           source on SahajAtlasWeb, which gets
 *                                           no commit statuses or deployments
 *
 * The construction fallback below fires only when neither source carries a
 * labelled alias. Even then, it derives the host from the COMMIT alias it
 * did observe, never from a hardcoded project name.
 *
 * ## It is handed the text. It does not fetch it.
 *
 * A routine cannot reach the GitHub API by any client
 * (why: docs/why.md#a-routine-cannot-reach-the-github-api). So the caller
 * gathers the Cloudflare bot's comment bodies and each Cloudflare check
 * run's `output.summary` (with MCP in a routine, any way locally) and pipes
 * them in here. One code path runs identically everywhere.
 *
 * ## Usage
 *
 *   branch-preview-url.mjs [--json] < {"branch":"…","bodies":["<body>","<summary>"]}
 *
 * Exits 1 when no alias can be resolved. That is the "preview pending"
 * case. It is not a cue to fall back to a per-commit alias.
 */

import { readFileSync } from 'fs'

const args = process.argv.slice(2)
const JSON_OUT = args.includes('--json')

const PREVIEW_HOST = /^https:\/\/[a-z0-9.-]+\.(pages|workers)\.dev\/?$/i
const COMMIT_LABEL = /^[0-9a-f]{8}(?=[-.])/

/**
 * Every `<a href=…>` in a blob, with its text and where it starts. This is
 * enough to answer "which label is this link under" for both markup shapes.
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
 * Workers wraps the label inside the anchor. Pages puts it in the preceding
 * table cell. Both cases match one rule: use the anchor whose own text says
 * so, or else the first anchor after a cell that does. The second pass is
 * position-based on purpose, not a table parse. Cloudflare can change the
 * row markup, but not the ordering.
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
 * `sahajatlas` from `c76da223.sahajatlas.pages.dev`.
 * `wemeditate-web` from `c14f4e66-wemeditate-web.contact-c66.workers.dev`.
 *
 * This reads the COMMIT alias, not the branch one. Only the commit alias
 * has a prefix of known shape to strip. A branch alias's leading label is
 * an arbitrary slug that may itself contain hyphens, so the same split
 * would cut in the wrong place there.
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

/** Any HTTP answer proves the host exists. Only a transport failure is fatal. */
async function probe(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' })
    return res.status
  } catch {
    return null
  }
}

/** Render the rows both paths produce. */
async function report(results) {
  const rows = []
  for (const row of results.values()) rows.push({ ...row, status: await probe(row.url) })

  if (JSON_OUT) console.log(JSON.stringify(rows, null, 2))
  else {
    for (const r of rows) {
      const note = r.constructed ? '  (constructed — verify before use)' : ''
      console.log(
        `${(r.project || '?').padEnd(20)} ${String(r.status ?? 'unreachable').padEnd(12)} ${r.url}${note}`,
      )
    }
  }
  return rows.some((r) => r.status !== null)
}

/** Parse a set of blobs into `{url → row}`. Shared by both input paths. */
function collect(blobs, branch) {
  const results = new Map()
  for (const { source, body } of blobs) {
    const commit = commitAliasFrom(body)
    const labelled = branchAliasFrom(body)
    const alias = labelled || constructFrom(commit, branch)
    if (!alias || results.has(alias)) continue
    results.set(alias, {
      url: alias,
      project: projectFrom(commit),
      source,
      constructed: !labelled,
    })
  }
  return results
}

async function fromStdin() {
  const input = JSON.parse(readFileSync(0, 'utf-8'))
  const blobs = (input.bodies || []).map((body, i) => ({ source: `stdin[${i}]`, body }))
  const results = collect(blobs, input.branch || '')
  if (!results.size) {
    console.error(
      'No branch preview alias in the supplied bodies. Pass the Cloudflare bot comment bodies and ' +
        'each Cloudflare check run\'s output.summary; if the deploy is still building, say "preview pending".',
    )
    process.exit(1)
  }
  process.exit((await report(results)) ? 0 : 1)
}

// Guarded so a spec can import the parsers without running the CLI.
if (process.argv[1] && process.argv[1].endsWith('branch-preview-url.mjs')) {
  fromStdin().catch((err) => {
    console.error(`branch-preview-url failed: ${err?.message || err}`)
    process.exit(1)
  })
}
