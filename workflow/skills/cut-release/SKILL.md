---
name: cut-release
description: Cut a release where merged work has accumulated unreleased — tag, changelog, and GitHub Release. Friday's survey. Only SahajAtlasWordpress ships versioned artifacts today.
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

**`v0.1.0` of the WordPress plugin has never been tagged.** Both phases are implemented and tested,
and the README's install instructions point at a Releases zip that does not exist — so the
documented install path currently cannot be followed at all. That is the first release to cut.

## When to cut

Only when **all** hold:

- Merged commits exist since the last tag that change shipped behaviour (ignore CI-only and
  docs-only churn).
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
