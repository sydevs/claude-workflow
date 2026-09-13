---
name: handler-journal
description: Write the run's journal comment, then release the lock — the closing step for every handler skill and for survey-routine, not standalone.
allowed-tools: Read, Grep, Glob, Bash(node:*)
---

# Handler journal

Every run ends here. **One comment on the day's journal issue, then the lock comes off, then
stop.** The unlock is the event Actions acts on, so the journal comes first.

## Find the issue

The record names it: `journal.repo` and `journal.issue`. Never search for it. **Never call
`get_comments` on a journal issue.** (why: docs/why.md#ground-from-the-body-never-the-thread)

**`journal.issue` of 0 means the dispatcher could not name it.** Find it yourself, as in cron
mode, and say so under `🧭 Friction`.
(why: docs/why.md#the-journal-pointer-is-an-optimisation)

Cron mode (the survey) has no record. Search open `labels.journal` issues in `journalRepo`, take
the one created today in `journal.timezone`, and create it with a one-line body if absent.

## The entry

````markdown
<!-- sydevs-dispatch-done v1 {"id":"<record.id>","handler":"<handler>","repo":"<org/repo>","number":<n>,"session":"<session url>","outcome":"<glyph>","failed":<count>,"friction":<count>} -->
<glyph> **<handler>** · [<org/repo>#<n> — <title>](url) · [session](<session url>) · `<HH:MM>`–`<HH:MM>`

### ⚠️ Failed
- none

### 🧭 Friction
- <a rule that misfired, a tool that refused> — <the call that showed it>

### 📄 Did
- 📦 [<org/repo>#<pr> — <title>](url) — pushed `<sha>`, draft
````

Your session URL is `https://claude.ai/code/${CLAUDE_CODE_REMOTE_SESSION_ID/#cse_/session_}`.

- **`⚠️ Failed` always appears.** "none" is complete.
- Omit `🧭 Friction` and `📄 Did` when empty.
- **Evidence for failures and friction: name the call.** None for pushes, CI, or review counts —
  GitHub records those. (why: docs/why.md#every-claim-names-the-call-that-produced-it)
- Glyphs: 🔀 merged · 📦 built · 💬 replied · 🧐 reviewed · 🔬 investigated · 🔍 surveyed ·
  🩹 fixed CI · 🧶 resolved conflicts · ✂️ split · ✍️ revised · ⏭️ stopped · 🛑 not started.
- Full `org/repo#N` everywhere. Say `attempt <n>` on the first line when resuming.

Fit it with the script. Never trim by hand:

```bash
${CLAUDE_PLUGIN_ROOT}/lib/budget.mjs --fit --kind journalEntry < entry.md > fitted.md
```

Exit 1 → cut prose from Friction, and never a failure. Post with
`mcp__github__add_issue_comment`. Trust the 200. The MCP read path strips `<details>`.
(why: docs/why.md#details-survives-the-write-path)

## Release the lock — the last GitHub write

Read the item's labels with `issue_read method:get` — `get_labels` refuses a PR number — and write
them back without `labels.lock`. Touch no other label. That event tells Actions the item is free.
(why: docs/why.md#the-lock-label-is-the-lease)

## Stop

No polling. No timers. Do not try to end the session — a run cannot. Leave nothing that could
wake you. Cron mode has no lock to release. (why: docs/why.md#sessions-linger)

## Local mode

No journal comment and no lock. Report the same three sections to the person who invoked you.
