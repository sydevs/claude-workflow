# Change outline

> Adapted from `visual-pr` in [humanlayer/skills](https://github.com/humanlayer/skills), MIT —
> see `change-outline.LICENSE`. Ported, not installed.
> (why: docs/why.md#show-the-shape-not-the-file-list)

The outline is the reviewer's map of the diff. It shows the **shape** of the change, so the
reviewer knows what to expect before they open a file. Build it from the full
`origin/main...HEAD` diff, never the last commit.

## Pick the views

Use every view that explains this change, and no others.

| View | Use when |
| --- | --- |
| Contract | An outside caller sees the change. Examples: an endpoint, collection fields or save-time validation, migration tables, the embed or URL contract |
| Types | A key type or data structure changed |
| Flow | The order of calls across functions changed: a call tree, control flow, or data flow |
| Behaviour | The decisions inside one function changed |
| Components | A React tree, its hooks, or its state changed |
| Files | A responsibility moved, split, or got a new file |

- **Lead with the view that explains the main change.** A contract leads only when it is the
  main change. Otherwise it comes second.
- **Never draw the same code in two views.** When a change is both Flow and Behaviour, use one
  Flow view. Nest the decisions under the call that makes them.
- **Title each view `### <View>` or `### <View> — <subject>`.** A view may appear twice when two
  unrelated shapes of that kind changed.
- **Never use a `##` heading inside the outline.** The dispatcher reads the body's `##` headings.
- Put one sentence above each block. Say what changed and why it matters.

## Draw each view

- **Use `diff` for a change to an existing shape.** Keep the unchanged lines that locate it.
- **Nest a wholly new shape under its nearest unchanged parent**, with the parent as context. A
  new shape with no parent gets a plain block (`ts`, `json`, `sql`, or untagged pseudocode) with
  no diff markers.
- **Elide an unchanged run of a tree with one `…` line** at its depth. Keep the ancestors that
  locate the change.
- **Use the real names:** functions, fields, components, file paths. Put the file path on the
  line that owns it.
- **Write pseudocode, not code.** The reviewer reads the real code in the diff.
- **Paraphrase a prose contract,** such as `docs/embedding.md`, one rule per `diff` line, and
  name its section.
- **Start every `diff` line with a space, `+` or `-`.** Never start content with `---`, `+++` or
  `@@`.
- Use `mermaid` only for a sequence across processes or repos that a tree cannot show. GitHub
  renders it in place.

A Flow view, with the decisions nested under the call that makes them:

```diff
 deliverContact(submission)                     src/jobs/DeliverSubmissions/deliverContact.ts
-  recipientFor(form)                           # select { recipient }
+  formDelivery(submission)
+    findByID forms, select { recipient, fields }, in the submission's locale
+    buildFormAnswers(form.fields, submissionData)
+      no `name` (static block) → skip
+      checkbox → "Yes" / "No"                  # an unticked box is an answer
   sendUserMessage({ to, answers, details })
```

A Files view shows responsibilities, not edits:

```diff
 src/hooks/
-├── use-frame.ts             # useFrame(): publishes the frame from a callback ref
+├── use-published-node.ts    # usePublishedNode(publish): the frame or the theme root
 └── use-theme.ts             # still owns the theme-root singleton
```

## Size

**The outline has no length limit.** Never shorten a view to shorten the body. Never fold a
view into `<details>`. Cut a view only when it explains nothing the reviewer needs. A large PR
earns a large outline.

## Avoid

- A file-by-file changelog with diff markers on it. List responsibilities, not edits.
- Tests, `AGENTS.md` and `docs/` edits, and `CHANGELOG.md` entries. `## Test results` covers
  tests. Show a doc only when it is the contract.
- A view that repeats the diff line for line. It explains nothing the diff does not.
- A view of a shape that did not change.
- A view the diff contradicts. A wrong outline misleads more than none. Re-derive every view on
  each refresh.
