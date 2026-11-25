/**
 * Is this PR only new translation keys? `translationOnly.repos` in
 * loop-config.json names, per repo, the translation schemas, the per-locale
 * seed files and the generated types a key addition touches. A PR whose every
 * file is one of those, and whose every change only adds a key, needs no
 * critic, and a bot's own is approved by Actions as a contract sync is.
 * (why: docs/why.md#a-translation-key-is-approved-by-actions)
 *
 * It reads contents, not just paths: a path check alone would pass a PR that
 * renames a key the consumers read, or adds `maxLength` to a leaf that
 * production data already breaks. Anything it cannot read, or cannot prove
 * an addition, is not translation-only, and gets the full treatment.
 */

import { matchesGlob } from 'node:path'
import { isDeepStrictEqual as same } from 'node:util'

/** Marks the translation check's own approval, so only that one is ever dismissed. */
export const TRANSLATION_APPROVAL_MARKER = '<!-- sydevs-translation-check -->'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** The repo's rules, or null when it declares none. */
export function translationRules(config, repoName) {
  return config.translationOnly?.repos?.[repoName] || null
}

/** Which kind of translation file a path is, or null. */
export function kindOf(rules, path) {
  for (const kind of ['schemas', 'seeds', 'generated']) {
    if ((rules?.[kind] || []).some((g) => matchesGlob(path, g))) return kind
  }
  return null
}

const LEAF_KEYS = new Set(['type', 'description', 'default'])
const GROUP_KEYS = new Set(['type', 'description', 'properties', 'additionalProperties'])

/** A schema node a PR may add: a plain string leaf, or a closed group of them. */
function newSchemaNode(n) {
  if (!isObj(n)) return false
  const keys = Object.keys(n)
  if (n.type === 'string') {
    return keys.every((k) => LEAF_KEYS.has(k)) && ['description', 'default'].every((k) => n[k] === undefined || typeof n[k] === 'string')
  }
  if (n.type !== 'object' || !keys.every((k) => GROUP_KEYS.has(k))) return false
  if (n.description !== undefined && typeof n.description !== 'string') return false
  if (n.additionalProperties !== undefined && n.additionalProperties !== false) return false
  const props = Object.values(n.properties || {})
  return props.length > 0 && props.every(newSchemaNode)
}

/**
 * How many keys `head` adds to the schema `base`, or -1 when it changes
 * anything else. A group may gain `properties` and nothing more; every leaf
 * it already had is unchanged, so no `required`, no constraint, no rename.
 */
export function schemaAdds(base, head) {
  if (!(isObj(base) && base.type === 'object' && isObj(base.properties))) return same(base, head) ? 0 : -1
  if (!isObj(head) || !isObj(head.properties)) return -1
  const rest = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'properties'))
  if (!same(rest(base), rest(head))) return -1
  let adds = 0
  for (const [k, v] of Object.entries(head.properties)) {
    if (!Object.hasOwn(base.properties, k)) {
      if (!newSchemaNode(v)) return -1
      adds++
      continue
    }
    const n = schemaAdds(base.properties[k], v)
    if (n < 0) return -1
    adds += n
  }
  return Object.keys(base.properties).every((k) => Object.hasOwn(head.properties, k)) ? adds : -1
}

const newSeedValue = (v) => typeof v === 'string' || (isObj(v) && Object.keys(v).length > 0 && Object.values(v).every(newSeedValue))

/** How many keys `head` adds to the seed `base`, or -1 when it edits, moves or drops one. */
export function seedAdds(base, head) {
  if (!isObj(base)) return same(base, head) ? 0 : -1
  if (!isObj(head)) return -1
  let adds = 0
  for (const [k, v] of Object.entries(base)) {
    if (!Object.hasOwn(head, k)) return -1
    const n = seedAdds(v, head[k])
    if (n < 0) return -1
    adds += n
  }
  for (const [k, v] of Object.entries(head)) {
    if (Object.hasOwn(base, k)) continue
    if (!newSeedValue(v)) return -1
    adds++
  }
  return adds
}

/** The only lines a key addition writes into generated types: doc comments, optional fields, interfaces. */
const GENERATED_LINE = [
  /^\s*$/,
  /^\s*\/\*\*$/,
  /^\s*\*( .*)?$/,
  /^\s*\*\/$/,
  /^\s*[A-Za-z_$][\w$]*\?: [A-Za-z_$][\w$]*( \| null)?;$/,
  /^export interface [A-Za-z_$][\w$]* \{$/,
  /^\s*\}$/,
]

/**
 * A comment delimiter anywhere but alone on its own line. The patterns above
 * carry no lexer state, so a body line that closes the doc comment, calls a
 * function and reopens it still reads as a doc-comment body: all three lines
 * match, and a statement lands at module scope. The generated file is
 * the one translation file that is code, and this check is all that stands
 * between it and an unattended merge, so the guard is separate from the
 * patterns — a pattern added later cannot reopen the hole.
 * (why: docs/why.md#a-translation-key-is-approved-by-actions)
 */
function escapesComment(line) {
  const t = line.trim()
  return t !== '/**' && t !== '*/' && /\/\*|\*\//.test(t)
}

/** Whether a unified diff only adds lines a key addition would generate. A missing patch proves nothing. */
export function generatedAddsOnly(patch) {
  if (typeof patch !== 'string' || !patch) return false
  return patch.split('\n').every((l) => {
    if (l.startsWith('-')) return false
    if (!l.startsWith('+')) return true
    const body = l.slice(1)
    return !escapesComment(body) && GENERATED_LINE.some((re) => re.test(body))
  })
}

/**
 * The verdict for one PR, as `{ ok, reason }`. Pure. `files` is the compare's
 * file list (`filename`, `status`, `patch`); `contents` maps each JSON file's
 * path to `{ base, head }` text.
 */
export function translationVerdict(config, repoName, files, contents) {
  const no = (reason) => ({ ok: false, reason })
  const rules = translationRules(config, repoName)
  if (!rules) return no('this repo declares no translation files')
  if (!Array.isArray(files) || !files.length) return no('no file list')
  const max = config.translationOnly?.maxFiles ?? 40
  if (files.length > max) return no(`more than ${max} files`)
  let adds = 0
  for (const f of files) {
    const kind = kindOf(rules, f.filename)
    if (!kind) return no(`${f.filename} is not a translation file`)
    if (f.status !== 'modified') return no(`${f.filename} is ${f.status}, not modified`)
    if (kind === 'generated') {
      if (!generatedAddsOnly(f.patch)) return no(`${f.filename} changes more than added fields`)
      continue
    }
    const c = contents?.[f.filename]
    let base, head
    try { base = JSON.parse(c?.base); head = JSON.parse(c?.head) } catch { return no(`${f.filename} could not be read as JSON`) }
    const n = kind === 'schemas' ? schemaAdds(base, head) : seedAdds(base, head)
    if (n < 0) return no(`${f.filename} changes or removes an existing key`)
    adds += n
  }
  return adds ? { ok: true, reason: `adds ${adds} translation key(s) and nothing else` } : no('adds no key')
}

/**
 * Fetch what `translationVerdict` reads, for one open PR, and return its
 * verdict. The file list is the merge base's, so a base that moved on adds
 * nothing. Paths are checked before any content is fetched. Any read that
 * fails is a refusal, never a throw: the PR just gets the full treatment.
 */
export async function translationFacts(gh, { owner, repo }, pr, config) {
  if (!translationRules(config, repo)) return { ok: false, reason: 'this repo declares no translation files' }
  if ((pr.changed_files ?? Infinity) > (config.translationOnly?.maxFiles ?? 40)) return { ok: false, reason: 'too many files' }
  try {
    const { data: cmp } = await gh.rest.repos.compareCommitsWithBasehead({ owner, repo, basehead: `${pr.base.sha}...${pr.head.sha}` })
    const files = cmp.files || []
    const rules = translationRules(config, repo)
    const early = files.find((f) => !kindOf(rules, f.filename))
    if (early) return { ok: false, reason: `${early.filename} is not a translation file` }
    const raw = async (path, ref) => {
      const { data } = await gh.rest.repos.getContent({ owner, repo, path, ref, mediaType: { format: 'raw' } })
      return typeof data === 'string' ? data : null
    }
    const contents = {}
    for (const f of files) {
      if (kindOf(rules, f.filename) === 'generated' || f.status !== 'modified') continue
      contents[f.filename] = { base: await raw(f.filename, cmp.merge_base_commit.sha), head: await raw(f.filename, pr.head.sha) }
    }
    return translationVerdict(config, repo, files, contents)
  } catch (e) {
    return { ok: false, reason: `unread: ${e?.status || ''} ${String(e?.message || '').slice(0, 80)}`.trim() }
  }
}
