#!/usr/bin/env bash
set -euo pipefail

# Pre-bundle the Netlify functions into self-contained ESM.
#
# Why: Netlify's own bundler leaves this pnpm-workspace's dependencies (dotenv,
# hono, @supabase/supabase-js, zod) external because it can't resolve the
# symlinked node_modules, so the deployed function crashes with "Cannot find
# package". We bundle everything ourselves with esbuild (proven self-contained)
# and let Netlify deploy the result as-is (node_bundler = "none").
#
# The banner provides __dirname / __filename / require for any bundled CJS deps.
# (esbuild is fetched via npx so it needs no entry in the workspace lockfile.)

BANNER='import{createRequire as _cr}from"module";import{fileURLToPath as _f}from"url";import{dirname as _d}from"path";const require=_cr(import.meta.url);const __filename=_f(import.meta.url);const __dirname=_d(__filename);'

mkdir -p netlify/functions
for fn in api sync; do
  npx -y esbuild@0.25.0 "netlify/functions-src/${fn}.mts" \
    --bundle --format=esm --platform=node --target=node22 \
    --outfile="netlify/functions/${fn}.mjs" \
    --banner:js="$BANNER"
done

echo "✓ functions bundled → netlify/functions/"
