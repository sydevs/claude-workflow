import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseVerb } from '../verbs.mjs'

const cfg = {
  commandPrefix: '@sydevs-bot',
  verbs: { issue: ['implement', 'revise', 'split', 'answer'], pr: ['address', 'review'], unknownIssue: 'answer', unknownPr: 'address' },
}

test('a known verb is parsed, case-insensitively', () => {
  assert.equal(parseVerb('@sydevs-bot implement this', cfg, 'issue').verb, 'implement')
  assert.equal(parseVerb('@SYDEVS-BOT Implement this', cfg, 'issue').verb, 'implement')
  assert.equal(parseVerb('please @Sydevs-Bot: SPLIT it', cfg, 'issue').verb, 'split')
})

test('no mention means no verb', () => {
  assert.deepEqual(parseVerb('just a comment', cfg, 'issue'), { mentioned: false, verb: null, raw: null })
  assert.equal(parseVerb('email me at foo@sydevs-bot.example', cfg, 'issue').mentioned, false)
})

test('a mention with no verb or an unknown verb falls back per surface', () => {
  assert.equal(parseVerb('@sydevs-bot what do you think?', cfg, 'issue').verb, 'answer')
  assert.equal(parseVerb('@sydevs-bot deploy', cfg, 'issue').verb, 'answer')
  assert.equal(parseVerb('@sydevs-bot', cfg, 'pr').verb, 'address')
  assert.equal(parseVerb('@sydevs-bot fix this', cfg, 'pr').verb, 'address')
  assert.equal(parseVerb('@sydevs-bot review', cfg, 'pr').verb, 'review')
})

test('an issue verb on a PR surface is unknown there', () => {
  assert.equal(parseVerb('@sydevs-bot implement', cfg, 'pr').verb, 'address')
})

test('the first mention wins', () => {
  assert.equal(parseVerb('@sydevs-bot answer\n\n@sydevs-bot implement', cfg, 'issue').verb, 'answer')
})
