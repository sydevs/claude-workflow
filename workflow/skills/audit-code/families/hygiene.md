# Hygiene — where to look

Saturday's rotation. Look where cost accrues quietly: code nobody reads twice, documents nobody
re-checks, and things we maintain that someone else already does.

- **Simplicity and abstraction reduction** — an indirection with one caller, a config option
  nobody sets, a wrapper that only renames. File a ticket that names what to collapse.
- **Code comments** — follow [`../comment-sweep.md`](../comment-sweep.md). Pick the area by
  comment density, or a directory a recent PR's review flagged.
- **Dead code and unused dependencies** — exports with no importer, routes and components with no
  caller, dependencies no source file imports. Proof that permits a ticketless PR: no static
  import, no string or dynamic reference (`grep` the name across the repo), not a public entry
  point or a framework-discovered file (routes, collections, migrations, config), not consumed by
  another repo (search all five), and the lean gate passes after removal. Short of all of that,
  file a ticket.
- **Docs vs reality** — every command, path, script, environment variable and default a
  `README`, `CLAUDE.md`, `AGENTS.md` or `docs/` page states is checked against the code. Commands
  resolve against `package.json`:

  ```bash
  grep -ohE 'pnpm [a-z:-]+' CLAUDE.md AGENTS.md docs/*.md 2>/dev/null | sort -u   # vs package.json scripts
  ```

  Wrong doc, right code → a doc-fix PR. Cross-repo contracts are `audit-contracts`' job, not this.
- **Build vs buy** — custom code a maintained package, a Payload plugin or a platform feature
  (Cloudflare, Railway, Sentry) already provides. File a ticket naming the replacement, what it
  removes, and what it costs: migration, bundle size, lock-in. Check the repo has not already
  argued it.
- **Best practice research** — compare one area against current upstream guidance for its
  framework version (Payload, Vike, React, Tailwind). File only a gap with a concrete cost.
