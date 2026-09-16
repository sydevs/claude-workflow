# Code comments

The canonical rule. Each product repo carries a copy at `docs/rules/code-comments.md`, symlinked
into `.claude/rules/`, plus its own carve-outs. `survey-contracts` checks the copies against this
file every Thursday.

Keep the copies short. A person reads this file. An agent reads each copy on every session in four
repos, so every line in a copy costs tokens daily.

## The rule

- **Default to no comment.** Code shows *how*. A comment earns its place only by carrying *why* — a
  non-obvious constraint, a deliberate deviation, a gotcha, a workaround, or the reason a simpler
  version is wrong.
- **Never narrate the code.** No "loop over the users", no restating a name, a type or a signature,
  no `} // end if`.
- **Never narrate the change.** No "updated to", "removed the old", "as requested", "fixed the
  off-by-one". A comment must read correctly to someone who opens the file fresh and never saw the
  diff. Change context belongs in the commit message.
- **Never point at a moving target.** A spec section, a requirements doc, a design doc — all get
  superseded. Encode the substance instead. A ticket number, an RFC, a permalink, or a maintained
  doc at a stable path stays fine as a breadcrumb.
- **A comment must stand on its own with its link cut.** The address survives. What sits
  behind it can change.
- **Apply the razor to every comment you keep, not only to the ones you cut.** "Carries a real
  *why*" and "is worded minimally" are separate judgements. A genuine *why* can still be three times
  too long. Cut the mechanism the code already shows, the consequence of the consequence, and the
  justification of the justification. A five-line block rarely survives intact.
- **A one-line summary on a public function or endpoint is fine.** Restating a single clear line
  never is.
- **Never delete a tool directive, a `⚠` line, a cross-repo sync pointer, or a `#NNN` breadcrumb.**
  The next section says what each is and why.
- **TODOs are fine and need no issue ID.** A TODO is a marker, not a substitute for the work.

## What to protect, in every repo

Never delete these. `workflow/lib/comment-protect.json` holds the machine-readable form, and
`comment-fingerprint.mjs` counts them before and after any sweep.

- **Tool directives** — `eslint-disable`, `@ts-expect-error`, `prettier-ignore`,
  `@vitest-environment`, `@package`, `Plugin Name:`, `Copyright`. Each changes what a compiler,
  linter, formatter or bundler does.
- **`⚠` lines.** These repos already mark their own load-bearing constraints this way. 362 of them.
  It is the highest-confidence do-not-delete signal in the codebase, written by the people who paid
  for each one.
- **Cross-repo sync pointers** — "keep in sync with", "must match", "source of truth", and any
  `<Repo>#NNN`. Nothing enforces the couplings between these five repos except prose. That giving
  `<sahaj-atlas>` a height is the opt-in for a contained map lives in four files across three repos,
  one of them a CSS comment with no type system behind it.
- **Issue breadcrumbs** — a `#NNN` carries evidence a compressed comment cannot.

## Why this exists

An agent over-comments by default, and instruction alone does not stop it. The behaviour survives a
rule, a memory entry and a hook, so this repo runs three layers: this rule to steer the writing,
`/workflow:comment-cleanup` to reclaim what gets through, and `comment-fingerprint.mjs` to prove a
cleanup changed nothing but comments.

The reviewer profile already carries the evidence from real review rounds: *"Comments that
over-explain, narrate history, or describe removed systems"* — SahajAtlasWeb#184, SahajCloud#675.

Two repos have already had a hand sweep, in SahajAtlasWeb#197 and the WordPress prose reset. Read
what those commits kept, not only what they cut.
