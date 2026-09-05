---
name: cut-release
description: Cut a release where merged work has accumulated unreleased — tag, changelog, and GitHub Release. Friday's survey. SahajAtlasWordpress ships a versioned artifact. claude-workflow ships a version-keyed plugin cache.
disable-model-invocation: true
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob
---

# Cut Release

Friday's survey. Most of this workspace deploys continuously and has nothing to release. The
exception is the repo that matters most to end users.

## Who actually releases

| Repo | Releases? |
| --- | --- |
| **SahajAtlasWordpress** | **Yes** — a GitHub Releases zip is the only way 13 volunteer-run sites get the plugin. The Plugin Update Checker reads Releases. |
| SahajCloud | No — Railway deploys on merge. |
| WeMeditateWeb | No — Cloudflare Workers deploys on merge. |
| SahajAtlasWeb | No — Cloudflare Pages deploys on merge. But `CHANGELOG.md` is a published contract: see `survey-contracts`. |
| **claude-workflow** | **No tag, but yes a version** — see below. |

`v0.1.0` of the WordPress plugin shipped on 2026-08-27, so the install path in its README now
works. Its README status line still says "complete, not yet tagged" — stale. Correct it whenever
that file is next touched.

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
3. **Version bump** everywhere the artifact declares one — the plugin header in
   `sahaj-atlas.php`, `readme.txt` (`Stable tag`), and `package.json`. All must agree: WordPress
   reads the header, the Update Checker reads the tag.
4. **Ship it** through `/workflow:finalize-pr`. Tag only after it merges:
   ```bash
   git tag -a v<version> -m "v<version>" && git push origin v<version>
   ```
   `release.yml` builds the zip. **Confirm the release asset exists afterward** — a tag with no
   asset looks successful and delivers nothing.

## Hard rules

- **Never** tag a commit that is not on `main` with green CI.
- **Never** tag before the version-bump PR merges — the tag must point at the bumped commit.
- **Never** hand-edit a published changelog entry. Correct it in a new entry.
- **Always** confirm the release asset built.
