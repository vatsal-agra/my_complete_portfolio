import { runGithubPull } from '../github.js'

const start = Date.now()
const summary = await runGithubPull()
const dur = ((Date.now() - start) / 1000).toFixed(1)

console.log(`scanned ${summary.scanned} project(s) in ${dur}s`)
for (const r of summary.results) {
  if (r.error) {
    console.log(`  ! ${r.slug} (${r.repo}): ${r.error}`)
    continue
  }
  const parts = [
    r.commits_added ? `${r.commits_added} commit(s)` : null,
    r.releases_added ? `${r.releases_added} release(s)` : null,
    r.goal_set ? 'goal set' : null,
    r.stack_added ? `stack=${r.stack_added}` : null,
    r.live_check ? `live=${r.live_check.up}${r.live_check.changed ? ' (changed)' : ''}` : null,
  ].filter(Boolean)
  console.log(`  ok ${r.slug} (${r.repo}): ${parts.length ? parts.join(', ') : 'no changes'}`)
}
