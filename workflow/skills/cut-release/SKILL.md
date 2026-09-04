---
name: cut-release
description: Cut a release where merged work has accumulated unreleased — tag, changelog, and GitHub Release. Friday's survey. SahajAtlasWordpress ships a versioned artifact; claude-workflow ships a version-keyed plugin cache.
disable-model-invocation: true
allowed-tools: Bash(*), Read, Edit, Write, Grep, Glob
---

# Cut Release

Friday's survey. Most of this workspace deploys continuously and has nothing to release. The
exception is the one that matters most to end users.

## Who actually releases

| Repo | Releases? |
| --- | --- |
| **SahajAtlasWordpress** | **Yes** — a GitHub Releases zip is the only way 13 volunteer-run sites get the plugin, and the Plugin Update Checker reads Releases. |
| SahajCloud | No — Railway deploys on merge. |
| WeMeditateWeb | No — Cloudflare Workers deploys on merge. |
| SahajAtlasWeb | No — Cloudflare Pages deploys on merge. But `CHANGELOG.md` is a published contract; see `survey-contracts`. |
| **claude-workflow** | **No tag, but yes a version.** No artifact and no GitHub Release — but `workflow/.claude-plugin/plugin.json`'s `version` is the cache key every installed copy is stored under, so an unchanged version means installed sessions never see the merge. |

`v0.1.0` of the WordPress plugin shipped on 2026-08-27, so the install path documented in its
README now works. Its README status line still says "complete, not yet tagged" — stale, and worth
correcting whenever that file is next touched.

### claude-workflow — bump the manifest, do not tag

This repo has no releases and wants none. What it has is a **cache key**: an installed plugin lives
in `~/.claude/plugins/cache/sydevs/workflow/<version>/`, pinned to the commit `main` pointed at when
it was installed. While `version` is unchanged, a merge reaches the cloud routines and nothing else.
`0.1.0` stood for 53 commits and a maintainer ran the repo's first commit for eight days.
(why: docs/why.md#an-installed-plugin-does-not-track-main)

So:

- **Any PR that changes `workflow/skills/**`, `workflow/hooks/**` or `workflow/lib/**` bumps
  `version` in the same PR** — new skill or new capability → minor; wording and fixes → patch. It is
  one line in the manifest, not a release ceremony, and it belongs with the change that needs it
  rather than in a Friday sweep.
- **Never tag this repo, and never cut a GitHub Release for it.** The version is a cache key, not an
  artifact. The rest of this skill — tags, changelog, release assets — applies to SahajAtlasWordpress
  only.
- On Friday, if `main` has moved over `workflow/` since the last `version` change, that is a finding:
  say so in the journal and open the one-line bump.

## Finding the last release — carefully

`git describe --tags` returns the most recent tag of **any** kind, which is not the same question.
WeMeditateWeb's only tag is `pre-dependency-update`, a checkpoint marker; treating it as a release
boundary reports 39 commits of "unreleased work" in a repo that does not do releases at all.

Match semver explicitly, and only in a repo from the table above:

```bash
git fetch --tags origin
git tag -l 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname | head -1
```

No semver tag in a repo that *should* release → that is the first release. No semver tag in a repo
that should not → nothing to do, and not a finding.

## When to cut

Only when **all** hold:

- Merged commits exist since the last **semver** tag that change shipped behaviour. Ignore CI-only,
  chore-only and docs-only churn — two `chore:` commits are not a release.
- CI is green on `main`.
- No open PR is about to land in the same area — releasing mid-sequence means an immediate follow-up.

Nothing to cut is the normal Friday answer. Say so in the journal and stop.

## Cutting

1. **Version.** Semver against the last tag: breaking → major; new capability → minor; fixes only →
   patch. Pre-1.0, a breaking change is still a minor.
2. **Changelog** from the merge log, grouped Added / Changed / Fixed / Removed. Write for the
   audience — for the WordPress plugin that is **one non-technical volunteer per site**, so "the
   atlas page now keeps your site header" beats "fixed containing-block establishment".
3. **Version bump** where the artifact declares one: the plugin header in `sahaj-atlas.php`,
   `readme.txt` (`Stable tag`), and `package.json`. All must agree — WordPress reads the header,
   the Update Checker reads the tag.
4. **Ship it** through `/workflow:finalize-pr` — the bump and changelog are a normal reviewed PR.
   Tag only after it merges:
   ```bash
   git tag -a v<version> -m "v<version>" && git push origin v<version>
   ```
   `release.yml` builds the zip. **Verify the release asset exists afterwards** — the whole point is
   the zip, and a tag with no asset looks successful while delivering nothing.

## Hard rules

- **Never** tag a commit that is not on `main` with green CI.
- **Never** tag before the version-bump PR merges — the tag must point at the bumped commit.
- **Never** hand-edit a published changelog entry; correct it in a new entry.
- **Always** confirm the Release asset built. Check, do not assume.
