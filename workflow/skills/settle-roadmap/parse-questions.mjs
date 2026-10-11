#!/usr/bin/env node
/**
 * Read a roadmap body on stdin and print its open questions as JSON, in the
 * shape `settle-roadmap` asks them. format-ticket defines the format; this
 * script only reads it, so a routine and a laptop always agree. It never
 * fetches. (why: docs/why.md#a-script-here-never-fetches)
 *
 *   gh api repos/<o>/<r>/issues/<n> --jq .body | node parse-questions.mjs
 *
 * Output: { questions: [{ n, text, ticked, context, reopened, conditional,
 *   options: [{ letter, label, recommended, previous, text }] }] }
 */

const QUESTION = /^- \[( |x|X)\] \*\*(\d+)\.\s+(.+?)\*\*\s*(.*)$/
const OPTION = /^\s+- \*\*([A-Z])\s+[—–-]\s+(.+?)\*\*\s*:?\s*(.*)$/
const REOPENED = /^\s+- Reopened (\d{4}-\d{2}-\d{2}) by ([^.]+)\.\s+Was:\s+(.+)$/
const CONDITION = /\bonly if (\d+)([A-Z])\b/i
const RECOMMENDED = /\s*\((recommended)\)\s*/i

/** The `## Open questions` section, up to the next `## ` heading. */
export function openQuestionsSection(body) {
  const lines = String(body || '').replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((l) => /^## Open questions\s*$/.test(l))
  if (start === -1) return []
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => /^## /.test(l))
  return end === -1 ? rest : rest.slice(0, end)
}

const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean)

/** True when every word of the option's label appears in the previous answer. */
function matchesPrevious(label, was) {
  const w = new Set(words(was))
  const l = words(label)
  return l.length > 0 && l.every((x) => w.has(x))
}

export function parseQuestions(body) {
  const questions = []
  let q = null
  let last = null
  for (const line of openQuestionsSection(body)) {
    let m
    if ((m = line.match(QUESTION))) {
      q = { n: Number(m[2]), text: m[3].trim(), ticked: m[1].toLowerCase() === 'x', context: m[4].trim(), reopened: null, conditional: null, options: [] }
      questions.push(q)
      last = q
    } else if (q && (m = line.match(REOPENED))) {
      q.reopened = { date: m[1], by: m[2].trim(), was: m[3].trim() }
    } else if (q && (m = line.match(OPTION))) {
      const raw = m[2].replace(/:\s*$/, '')
      const opt = { letter: m[1], label: raw.replace(RECOMMENDED, ' ').trim(), recommended: RECOMMENDED.test(raw), previous: false, text: m[3].trim() }
      q.options.push(opt)
      last = opt
    } else if (q && line.trim() && /^\s/.test(line)) {
      const t = line.trim().replace(/^- /, '')
      if (last === q) q.context = [q.context, t].filter(Boolean).join(' ')
      else last.text = [last.text, t].filter(Boolean).join(' ')
    }
  }
  for (const x of questions) {
    const c = `${x.text} ${x.context}`.match(CONDITION)
    if (c) x.conditional = { question: Number(c[1]), option: c[2].toUpperCase() }
    if (x.reopened) for (const o of x.options) o.previous = matchesPrevious(o.label, x.reopened.was)
  }
  return { questions }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let input = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) input += chunk
  process.stdout.write(JSON.stringify(parseQuestions(input), null, 2) + '\n')
}
