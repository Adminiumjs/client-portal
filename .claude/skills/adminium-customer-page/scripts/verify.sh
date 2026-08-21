#!/usr/bin/env bash
# The skill's verification step.
#
# Runs the REPO'S OWN build and test scripts rather than a command of its own,
# so CI, a developer's terminal and this skill cannot disagree about what
# "green" means. A page that has not built is not a page.
set -uo pipefail

repo="${1:-$PWD}"
cd "$repo" || { echo "cannot cd to $repo"; exit 1; }

[ -f package.json ] || { echo "no package.json in $repo — is this the app repo?"; exit 1; }

fail=0
run() {
  echo
  echo "── $1 ─────────────────────────────────────────────"
  shift
  if "$@"; then echo "  ok"; else echo "  FAILED"; fail=1; fi
}

run "build (types + bundle)" npm run build
run "tests" npm test

echo
if [ "$fail" -eq 0 ]; then
  echo "All green. Now open the page in the dev server and read it — a build is not a look."
else
  echo "Something is red. Do not report this page as done."
fi
exit "$fail"
