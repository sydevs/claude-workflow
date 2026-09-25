---
name: cut-release
description: Cut a release where merged work has accumulated unreleased — the changelog and version-bump PR, whose merge publishes the GitHub Release. Friday's survey. SahajAtlasWordpress ships a versioned artifact. claude-workflow ships a version-keyed plugin cache.
disable-model-invocation: true
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob
---

# Cut Release

Friday's survey. Most of this workspace deploys continuously and has nothing to release. The
exception is the repo that matters most to end users.

## Who actually releases

| Repo | Releases? |
| --- | --- |
| **SahajAtlasWordpress** | **Yes** — a GitHub Releases zip is the only way 13 volunteer-run sites get the plugin. The Plugin Update Checker reads Releases. **Merging a version bump is the release:** its `release.yml` tags, builds and publishes. |
| SahajCloud | No — Railway deploys on merge. |
| WeMeditateWeb | No — Cloudflare Workers deploys on merge. |
| SahajAtlasWeb | No — Cloudflare Pages deploys on merge. But `CHANGELOG.md` is a published contract: see `survey-contracts`. |
| **claude-workflow** | **No tag, but yes a version** — see below. |

### claude-workflow — bump the manifest, never tag

This repo wants no releases. Instead it has a **cache key**: an installed plugin lives in
`~/.claude/plugins/cache/sydevs/workflow/<version>/`, pinned to the commit `main` pointed at on
install. While `version` in `workflow/.claude-plugin/plugin.json` stays unchanged, a merge reaches
only the cloud routines. `0.1.0` stood for 53 commits and cost a maintainer eight days of stale
skills. (why: docs/why.md#an-installed-plugin-does-not-track-main)

- **Bump `version` in the same PR** that changes `workflow/skills/**`, `workflow/hooks/**`, or
  `workflow/lib/**`. A new skill or capability bumps minor. Wording and fixes bump patch — one
  manifest line, with the change, not a Friday ceremony.
- **Never tag this repo or cut it a GitHub Release.** The version is a cache key, not an artifact.
  Tags, changelogs and release assets below apply to SahajAtlasWordpress only.
- On Friday, if `main` has moved over `workflow/` since the last `version` change, that is a
  finding: journal it and open the one-line bump.

## Finding the last release — carefully

`git describe --tags` returns the most recent tag of **any** kind — a different question.
WeMeditateWeb's only tag, `pre-dependency-update`, is a checkpoint marker. Treated as a release
boundary it reports 39 "unreleased" commits in a repo with no releases at all.

Match semver explicitly, only in a repo the table marks Yes:

```bash
git fetch --tags origin
git tag -l 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname | head -1
```

No semver tag in a repo that should release: this is the first release. No semver tag in a repo
that should not: nothing to do, and not a finding.

## Did the last bump publish?

Check before deciding to cut. Read the `Version:` header of `sahaj-atlas.php` on `main`. If it is
newer than the last semver tag, or `mcp__github__get_release_by_tag` for `v<header>` shows no
`sahaj-atlas-<header>.zip` asset, a bump merged and did not publish. A `Release` run still in
progress is not a failure yet.

- **Never** bump again over it. A second bump stacks another unreleased version on the first.
- File one Bug ticket in SahajAtlasWordpress through `/workflow:triage-issue`. Name the version,
  the failed `Release` run where the Actions tools show it, and the fix: make that run pass, then
  re-run it. It is a defect you tripped over, so no proposal ceiling applies.
- **Search first**, open and closed, for a ticket naming `v<header>`. Open: comment only when the
  evidence changed. Closed: reopen it with the new evidence. Never file a second.

That ticket is the whole Friday for this repo. Stop.

## When to cut

Only when **all** hold:

- Merged commits since the last semver tag change shipped behaviour — two `chore:` commits are
  not a release.
- CI is green on `main`.
- No open PR is about to land in the same area — a mid-sequence release forces an immediate
  follow-up.

"Nothing to cut" is the normal Friday answer. Say so and stop.

## Cutting

1. **Version.** Semver against the last tag: breaking → major, new capability → minor, fixes only
   → patch. Pre-1.0, a breaking change still bumps minor.
2. **Changelog** from the merge log, grouped Added / Changed / Fixed / Removed. Write for the
   reader: for the WordPress plugin that is one non-technical volunteer per site, so "the atlas
   page now keeps your site header" beats "fixed containing-block establishment".
3. **Version bump** everywhere the artifact declares one. **Find them, never trust a list:**
   ```bash
   grep -rn "<previous version>" . --exclude-dir={.git,vendor,node_modules}
   ```
   CI fails the PR on a miss among the four declarations its `package.sh` knows. Only this grep
   finds a fifth. Check `SAHAJ_ATLAS_VERSION` twice: it is the asset cache-buster.
   (why: docs/why.md#a-missed-version-declaration-passes-ci)
4. **Ship it** through `/workflow:finalize-pr`, and end there. **Merging it is the release:**
   `release.yml` tags the version, builds the zip, and publishes it. A human
   approves every PR in that repo, so open the PR body with "Merging this releases v<version> to
   every site." Next Friday's publish check confirms the asset.
   (why: docs/why.md#merging-a-version-bump-is-the-release)

## Hard rules

- **Never** push a tag or create a Release. `release.yml` owns both, and tags only a commit on
  `main` that the merge queue ran CI on. When its run fails, the ticket carries the command its
  error names — a hand-pushed tag is a maintainer's step, never a run's.
- **Never** change a version declaration outside the version-bump PR. Merging one releases it.
- **Never** hand-edit a published changelog entry. Correct it in a new entry.
- **Always** check that the last bump published before cutting another.
