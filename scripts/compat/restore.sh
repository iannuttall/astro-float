#!/bin/zsh
# Put the demo back on its committed astro / mdx versions.
set -eu
ROOT=${0:a:h}/../..
cd $ROOT
git checkout -- demo/package.json pnpm-lock.yaml
pnpm install 2>&1 | tail -2
