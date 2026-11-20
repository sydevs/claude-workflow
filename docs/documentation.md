# Documentation

The canonical rule for prose about the code — `AGENTS.md` and `CLAUDE.md` guides, `docs/`,
READMEs — in every repo the loop works. Code comments have their own rule,
[`code-comments.md`](code-comments.md). `/workflow:finalize-pr` step 5 applies this one when
writing, `review-pr` flags what breaks it, and `audit-code`'s docs angle reclaims what gets
through.

There are no per-repo copies. A copy is a second home for a fact, which is what this rule forbids.
Skills read it from the claude-workflow checkout. (why: docs/why.md#docs-say-what-the-code-cannot)

## The rule

- **One home per fact.** Every other mention is a link. Authority runs code, types and tests, then
  config, then generated output, then prose. Prose never restates a source above it.
- **Write only what changes when the purpose changes.** Ask of each sentence:
  1. Would a refactor that keeps behaviour change it? Then it is **mechanism**: a symbol
     inventory, a constant's value, a file or directory listing, a retold test case, a commit SHA.
     Delete it. A real *why* inside it moves into a code comment beside the code.
  2. Would a bug fix or a new edge case change it? Then it is **a list of conditions**. Replace it
     with a one-line pointer to the code or test that holds the list.
  3. Would only a change of purpose change it? **Keep it**: intent, invariants, who decides what
     ("the CMS decides, never the widget"), cross-repo contracts, gotchas the code cannot show, how
     to run things.
- **Name, never copy.** Name a constant, never its value. Point at a symbol, never paraphrase its
  logic. Prefer an exported name or a file to a private one, so the pointer survives a refactor.
- **A check that enforces a rule gets one line**: the test file or the lint that holds it. Never
  retell its cases.
- **Default to no doc edit.** Fix or delete what a diff makes stale. Where the code already says
  it, delete rather than rewrite. Add prose only for a new intent, contract or gotcha.
- **A nested guide earns its file.** One that holds no gotcha, invariant or command is a directory
  listing. Delete it and its `CLAUDE.md` symlink once a grep finds nothing linking to it.

## Never delete

- **`⚠` lines.** Tighten the wording. The warning stays.
- **Cross-repo sync pointers and `<Repo>#NNN` breadcrumbs.** Prose is all that holds the five
  repos together.
- **Commands and how-to-run steps.**
- **Contract surfaces read outside the repo** — SahajAtlasWeb's `docs/embedding.md` and every
  `CHANGELOG.md`. Their overlap with the code is the contract.
- **A list of conditions**, unless the same edit leaves the pointer to where the list lives.
- **A rejected alternative and why it lost.** The code never records it.
