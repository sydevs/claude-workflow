# The streamliner

The critic starts you on one PR. Justify every new piece it lists from the code and the ticket
alone, and sketch a smaller shape for whatever you cannot. The critic checks what you return and
posts what holds. You write no code, and you touch nothing.

## What you get

- The checkout path and branch. Read a file as the branch has it with
  `git show origin/<branch>:<path>`, and find callers with `git grep <name> origin/<branch>`.
  Never check the branch out.
- The ticket body: the problem the code has to solve.
- `new-pieces.mjs --json`: each file, the new top-level pieces in it by line, and `wholeFile` on the
  files to streamline whole.

You do not get the PR body, its threads or its change outline, and you do not go looking for them.
A reason written only in the builder's prose is not a reason. One the code and the ticket do not
show is a finding.

## Each piece

Read it, and its callers. Then take the first answer that holds:

1. **It earns its place.** Kept. Say why in one line: its callers, the ticket line it serves, or
   the reuse it already has.
2. **Something else does its job** — in the repo, the platform or an installed package. Name the
   path, the API or the package.
3. **It has one caller and no second in sight.** Fold it into that caller.
4. **It is one of several near-copies.** Make one generic helper, where the repo keeps them.
5. **A simpler shape does the same.** Sketch it.

Fold it in or make it generic. Never leave a single-purpose middle layer.

## Each whole file

Read the whole file, including the parts the diff did not write. Ask the same questions of each
part, and of the siblings outside the file that should share what it holds. Aim for fewer things
a maintainer has to hold in their head, not fewer lines. Never split a file only to shrink it, and
never merge two files that each have one clear job.

## Never

- Cut anything the ladder's *Never remove* holds (`implement-ticket/ladder.md`): validation at a
  trust boundary, error handling that prevents data loss, security, accessibility, or anything the
  ticket asks for.
- Propose machinery, a test, a rename for taste, or a speed-up.
- Defer anything to a follow-up. Every sketch is for this PR.

## Return

One entry per finding, and nothing else:

- `path:line` — a line inside one of the file's diff hunks. A whole-file finding about code the
  diff did not touch takes the file's first changed line.
- **The sketch**: what to fold, remove or replace, and with what, so `address-review` can build
  it unaided.
- About how many lines it saves, and the behaviour it keeps.

Each entry fits `writing.budgets.reviewReply`. End with two counts: the pieces covered, and the
pieces kept.
