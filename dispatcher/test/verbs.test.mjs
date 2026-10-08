import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseVerb, parseBlock } from '../verbs.mjs'

const cfg = {
  commandPrefix: '@sydevs-bot',
  verbs: { issue: ['implement', 'revise', 'review', 'block'], pr: ['address', 'review', 'revise'], aliases: { issue: { review: 'revise' }, pr: { revise: 'review' } }, unknownIssue: 'revise', unknownPr: 'address' },
}

test('a known verb is parsed, case-insensitively', () => {
  assert.equal(parseVerb('@sydevs-bot implement this', cfg, 'issue').verb, 'implement')
  assert.equal(parseVerb('@SYDEVS-BOT Implement this', cfg, 'issue').verb, 'implement')
  assert.equal(parseVerb('please @Sydevs-Bot: BLOCK it', cfg, 'issue').verb, 'block')
})

test('no mention means no verb', () => {
  assert.deepEqual(parseVerb('just a comment', cfg, 'issue'), { mentioned: false, verb: null, raw: null })
  assert.equal(parseVerb('email me at foo@sydevs-bot.example', cfg, 'issue').mentioned, false)
})

test('a mention with no verb or an unknown verb falls back per surface', () => {
  assert.equal(parseVerb('@sydevs-bot what do you think?', cfg, 'issue').verb, 'revise')
  assert.equal(parseVerb('@sydevs-bot deploy', cfg, 'issue').verb, 'revise')
  assert.equal(parseVerb('@sydevs-bot answer this', cfg, 'issue').verb, 'revise', 'answer is retired')
  assert.equal(parseVerb('@sydevs-bot', cfg, 'pr').verb, 'address')
  assert.equal(parseVerb('@sydevs-bot fix this', cfg, 'pr').verb, 'address')
  assert.equal(parseVerb('@sydevs-bot review', cfg, 'pr').verb, 'review')
})

test('an issue verb on a PR surface is unknown there', () => {
  assert.equal(parseVerb('@sydevs-bot implement', cfg, 'pr').verb, 'address')
})

test('the first mention wins', () => {
  assert.equal(parseVerb('@sydevs-bot block\n\n@sydevs-bot implement', cfg, 'issue').verb, 'block')
})

test('review and revise are one verb on each surface', () => {
  assert.equal(parseVerb('@sydevs-bot review', cfg, 'issue').verb, 'revise')
  assert.equal(parseVerb('@sydevs-bot revise', cfg, 'pr').verb, 'review')
})

test('block reads the rest of its own line', () => {
  assert.deepEqual(parseBlock('@sydevs-bot block until 2026-11-15 — waiting on Payload 3.x\nmore', cfg, 'sydevs'), { form: 'until', date: '2026-11-15', reason: 'waiting on Payload 3.x' })
  assert.deepEqual(parseBlock('@sydevs-bot block on https://github.com/sydevs/SahajCloud/issues/632', cfg, 'sydevs'), { form: 'on', refs: [{ owner: 'sydevs', repo: 'SahajCloud', number: 632 }] })
  assert.deepEqual(parseBlock('@sydevs-bot block on #632', cfg, 'sydevs'), { form: 'on', refs: [] }, 'a bare #N names no repository')
  assert.deepEqual(parseBlock('@sydevs-bot block', cfg, 'sydevs'), { form: 'reason', reason: '' })
})
