#!/usr/bin/env bash
# Writes full=true|false to $GITHUB_OUTPUT. Every failure path is full=true.
set -uo pipefail

full=true
out() { echo "full=$full" >> "${GITHUB_OUTPUT:-/dev/stdout}"; }
trap out EXIT

head=$(git rev-parse --verify --quiet HEAD) || { echo "::warning::No checkout, so running the full lane."; exit 0; }

# The base comes off the event, as `contract-check` and this repo's `ci.yml`
# read it. Never off the checkout: `actions/checkout` defaults to depth 1,
# where the merge commit is grafted and has no parent to read.
[ -n "${BASE_SHA:-}" ] || { echo "Not a pull request or merge group, so running the full lane."; exit 0; }
git cat-file -e "$BASE_SHA^{commit}" 2>/dev/null || git fetch --quiet --no-tags --depth=1 origin "$BASE_SHA" || true
git cat-file -e "$BASE_SHA^{commit}" 2>/dev/null || { echo "::warning::Could not read the base commit, so running the full lane."; exit 0; }

files=$(git diff --name-only "$BASE_SHA" "$head") || { echo "::warning::Could not diff against the base, so running the full lane."; exit 0; }
[ -n "$files" ] || { echo "Empty diff, so running the full lane."; exit 0; }

echo "Changed files:"
echo "$files" | sed 's/^/  /'
# grep exits 1 when it selects nothing and 2 on a bad regex, and both leave
# `heavy` empty, so the status is read, not the output.
heavy=$(echo "$files" | grep -vE -- "$LIGHT")
[ $? -le 1 ] || { echo "::warning::\`light\` is not a valid extended regex, so running the full lane."; exit 0; }
if [ -z "$heavy" ]; then
  full=false
  echo "::notice title=Light lane::Every changed file matches /$LIGHT/, so the full CI lane is skipped."
else
  echo "Needs the full lane for:"
  echo "$heavy" | sed 's/^/  /'
fi
