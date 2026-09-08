/**
 * The per-item status comment: one comment per issue or PR, for its whole
 * life, edited in place by the dispatcher. It holds what the lock label
 * cannot — which handler, which attempt, the session link, the fix-ci
 * counter, the recheck flag, and a pending retry — and a short history.
 * The session never writes it. (why: docs/why.md#the-lock-label-is-the-lease)
 */

export const MARKER = '<!-- sydevs-status v1 '
const END = ' -->'

export function emptyRecord() {
  return { v: 1, fixCi: 0, recheck: false, pending: null, current: null, dispatches: [] }
}

export function parseRecord(body) {
  const s = String(body || '')
  if (!s.startsWith(MARKER)) return null
  const end = s.indexOf(END)
  if (end === -1) return null
  try {
    return { ...emptyRecord(), ...JSON.parse(s.slice(MARKER.length, end)) }
  } catch {
    return null
  }
}

function fmtTime(iso) {
  return iso ? String(iso).slice(11, 16) + 'Z' : '?'
}

export function renderRecord(rec) {
  const lines = []
  const c = rec.current
  if (c) {
    lines.push(`🤖 **${c.handler}** · started ${fmtTime(c.firedAt)} · attempt ${c.attempt}${c.url ? ` · [session](${c.url})` : ''}`)
  } else if (rec.pending) {
    const p = rec.pending
    const when = p.retryAfter ? ` · retry after ${fmtTime(p.retryAfter)}` : ''
    lines.push(`⏳ **${p.handler}** · ${p.reason}${when} · attempt ${p.attempt}`)
  } else {
    lines.push('🤖 no session running')
  }
  if (rec.fixCi) lines.push(`CI fix ${rec.fixCi}`)
  if (rec.recheck) lines.push('an event arrived while a session held the lock — re-derived on unlock')
  const hist = (rec.dispatches || []).slice(-5).reverse()
  if (hist.length) {
    lines.push('', '<details><summary>recent dispatches</summary>', '')
    for (const d of hist) {
      lines.push(`- ${fmtTime(d.firedAt)} ${d.handler} · attempt ${d.attempt}${d.url ? ` · [session](${d.url})` : ''}${d.outcome ? ` · ${d.outcome}` : ''}`)
    }
    lines.push('', '</details>')
  }
  const json = JSON.stringify({ ...rec, dispatches: (rec.dispatches || []).slice(-20) })
  return `${MARKER}${json}${END}\n${lines.join('\n')}\n\n<sub>Written by the sydevs dispatcher. Sessions never edit this comment.</sub>`
}

/** Find the status comment. Returns `{ id, rec }`, with `id` null when absent. */
export async function loadRecord(gh, { owner, repo, number }) {
  let page = 1
  for (;;) {
    const { data } = await gh.rest.issues.listComments({ owner, repo, issue_number: number, per_page: 100, page })
    for (const c of data) {
      const rec = parseRecord(c.body)
      if (rec) return { id: c.id, rec }
    }
    if (data.length < 100) break
    page += 1
  }
  return { id: null, rec: emptyRecord() }
}

export async function saveRecord(gh, { owner, repo, number }, id, rec) {
  const body = renderRecord(rec)
  if (id) {
    await gh.rest.issues.updateComment({ owner, repo, comment_id: id, body })
    return id
  }
  const { data } = await gh.rest.issues.createComment({ owner, repo, issue_number: number, body })
  return data.id
}
