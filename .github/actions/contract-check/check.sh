#!/usr/bin/env bash
# The contract check's one step. See action.yml beside it.
set -euo pipefail

infra=$(jq -r '.ci.infraLabel' "$CONFIG")
paths=${INPUT_PATHS:-$(jq -r --arg r "$REPO_NAME" '(.contractSync.consumers[$r].paths // []) | join(" ")' "$CONFIG")}
command=${INPUT_COMMAND:-$(jq -r --arg r "$REPO_NAME" '.contractSync.consumers[$r].command // ""' "$CONFIG")}
# A caller opted in, so a missing entry is a broken config, never a pass.
if [ -z "$paths" ] || [ -z "$command" ]; then
  echo "::error title=Contract check::$REPO_NAME has no contractSync entry in sydevs/claude-workflow loop-config.json, and no paths and command were passed."
  exit 1
fi
if [ -z "${BASE_SHA:-}" ]; then
  echo "Not a pull request or merge group: nothing to compare."
  exit 0
fi

git fetch -q --depth=1 origin "$BASE_SHA"
# The paths are a space-separated list, split on purpose.
# shellcheck disable=SC2086
touched=$(git diff --name-only "$BASE_SHA" HEAD -- $paths)
if [ -z "$touched" ]; then
  echo "No copied contract changed ($paths): nothing to check."
  exit 0
fi
echo "Changed copies: $touched"

# raw.githubusercontent.com serves a branch up to about five minutes stale
# after a merge, so a sync pushed right after its producer merged can read as
# drift. A mismatch is re-checked twice before it fails.
for attempt in 1 2 3; do
  if ! bash -c "$command"; then
    echo "::error title=$infra::\`$command\` failed, so the source could not be read. This is not the change: re-run the job."
    exit 1
  fi
  # Status, not diff: it also sees a copy the PR deleted and the command wrote back.
  # shellcheck disable=SC2086
  if [ -z "$(git status --porcelain -- $paths)" ]; then
    echo "The changed copies match what \`$command\` writes."
    exit 0
  fi
  if [ "$attempt" -lt 3 ]; then
    echo "Differs from the source; checking again in ${RECHECK_SECONDS:-150} s, in case the source is still cached."
    sleep "${RECHECK_SECONDS:-150}"
  fi
done

# shellcheck disable=SC2086
git --no-pager diff --stat -- $paths
# shellcheck disable=SC2086
git --no-pager diff -- $paths | head -n 200
for f in $touched; do
  echo "::error file=$f,title=Contract check::This PR changes a copied contract to something its source does not produce. Run \`$command\` and commit the result. A change to the contract itself lands in its source first."
done
exit 1
