import { discoverRepos } from '../github.js'

const start = Date.now()
const summary = await discoverRepos()
const dur = ((Date.now() - start) / 1000).toFixed(1)

console.log(`discovered ${summary.scanned} repo(s) for ${summary.username} in ${dur}s`)
console.log(`  ${summary.created.length} created, ${summary.skipped.length} skipped`)
console.log()

for (const c of summary.created) {
  console.log(`  + ${c.slug.padEnd(30)} ${c.repo}`)
}
if (summary.created.length > 0) {
  console.log()
  console.log('next step: `pnpm pull:github` to backfill commits/releases for these.')
}

if (summary.skipped.length > 0 && summary.skipped.length <= 12) {
  console.log()
  console.log('skipped:')
  for (const s of summary.skipped) console.log(`  - ${s.repo.padEnd(40)} (${s.reason})`)
}
