#!/bin/zsh
# Pin the demo to one astro / @astrojs/mdx pair and reinstall. Restore with scripts/compat/restore.sh.
# Usage: scripts/compat/switch.sh <astroVersion> <mdxVersion>   e.g. 7.3.2 8.0.1
set -eu
ROOT=${0:a:h}/../..
cd $ROOT
node -e '
const fs = require("fs");
const [astro, mdx] = process.argv.slice(1);
const demo = JSON.parse(fs.readFileSync("demo/package.json", "utf8"));
demo.dependencies.astro = astro; demo.dependencies["@astrojs/mdx"] = mdx;
fs.writeFileSync("demo/package.json", JSON.stringify(demo, null, 2) + "\n");
' "$1" "$2"
pnpm install --no-frozen-lockfile 2>&1 | grep -vE "^\s*$|Progress|resolved|reused|downloaded|added" | tail -15
node -e 'console.log("demo astro:", require("./demo/node_modules/astro/package.json").version, "| pkg astro:", require("./packages/astro-lee/node_modules/astro/package.json").version, "| mdx:", require("./demo/node_modules/@astrojs/mdx/package.json").version)'
