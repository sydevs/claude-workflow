# The ladder

> Adapted from the `ponytail` skill in [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail)
> at `96608e0`, MIT — see `ladder.LICENSE`. Ported, not installed.
> (why: docs/why.md#the-ladder-is-ported-not-installed)

The smallest change that fully solves the ticket wins. Read this before you write code.

## Before you write

Read the ticket and the code it touches. List every place the change must reach — callers, tests,
fixtures, config, exports — and what it could break: data it would destroy or expose, callers that
stop working. That is the scope. Extra features are not.

## Take the first rung that holds

For each file, function, hook, type, constant or dependency you are about to add:

1. **Does it need to exist?** Skip options and flexibility the ticket did not ask for, and name
   each one in the PR body in one line.
2. **Is it already in this repo?** A helper, component, service or pattern: use it the way the
   surrounding code does.
3. **Does the platform do it?** The framework, the browser, the standard library. A house
   component beats a native widget.
4. **Does an installed package do it?** Use it. Never add a dependency for a few lines.
5. **Can it be one line a reader gets at a glance?** One line.
6. **Otherwise, the minimum code that works.**

- Be lazy about the solution, never about the change: finish every caller, test and fixture it
  breaks.
- No wrapper, option, config, type conversion or "for later" code nobody asked for. Keep values in
  the form the platform gives them, and the structure the codebase already has.
- **A bug fix:** grep every caller of the function you touch, then fix the root cause once, in the
  shared code.
- Code you move or merge keeps its validation and error handling.
- Between options of equal size, take the one that is correct on edge cases.
- A known limit you accept gets `shortcut: <the limit>, <when to upgrade>` beside it.

**Never remove** validation at a trust boundary, error handling that prevents data loss, security,
accessibility, or anything the ticket or the reviewer asked for. **Never add** machinery nobody
asked for against a harm nobody has measured: a rate limit, cache, dedupe window, retry or
redaction. Name the exposure in the PR body, and leave that call to the reviewer.
(why: docs/why.md#the-builder-keeps-the-floor-the-critic-keeps-the-profile)
