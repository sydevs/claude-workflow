#!/usr/bin/env bash
# Writes full=true|false and narrow=true|false to $GITHUB_OUTPUT. Every
# failure path is full=true, narrow=false: the whole lane.
set -uo pipefail

full=true
narrow=false
out() { printf 'full=%s\nnarrow=%s\n' "$full" "$narrow" >> "${GITHUB_OUTPUT:-/dev/stdout}"; }
trap out EXIT

head=$(git rev-parse --verify --quiet HEAD) || { echo "::warning::No checkout, so running the full lane."; exit 0; }

# The base comes off the event, as `contract-check` and this repo's `ci.yml`
# read it. Never off the checkout: `actions/checkout` defaults to depth 1,
# where the merge commit is grafted and has no parent to read.
[ -n "${BASE_SHA:-}" ] || { echo "Not a pull request or merge group, so running the full lane."; exit 0; }
# An empty regex matches every line, so `light: ''` would read as all-light.
[ -n "${LIGHT:-}" ] || { echo "::warning::\`light\` is empty, so running the full lane."; exit 0; }
git cat-file -e "$BASE_SHA^{commit}" 2>/dev/null || git fetch --quiet --no-tags --depth=1 origin "$BASE_SHA" || true
git cat-file -e "$BASE_SHA^{commit}" 2>/dev/null || { echo "::warning::Could not read the base commit, so running the full lane."; exit 0; }

# Two dots, not three: `ci.yml` can use a merge base because it checks out
# at depth 0, and here there is no common ancestor to find. A base that has
# moved on since the event therefore adds its own files, which is a full lane.
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
elif [ -n "${NARROW:-}" ]; then
  # Same status rule as above: 1 is "selected nothing", 2 a bad regex.
  wide=$(echo "$heavy" | grep -vE -- "$NARROW")
  status=$?
  if [ "$status" -gt 1 ]; then
    echo "::warning::\`narrow\` is not a valid extended regex, so running the full lane."
  elif [ -z "$wide" ]; then
    narrow=true
    echo "::notice title=Narrow lane::Every changed file matches /$LIGHT/ or /$NARROW/, so only the targeted tests run."
  else
    echo "Needs the full lane for:"
    echo "$wide" | sed 's/^/  /'
  fi
else
  echo "Needs the full lane for:"
  echo "$heavy" | sed 's/^/  /'
fi
