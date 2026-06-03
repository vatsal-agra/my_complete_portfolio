import { describe, it, expect } from 'vitest'
import {
  detectPackageJson,
  detectPython,
  dedupeStack,
  firstReadmeLine,
  clampGoal,
} from '../src/github.js'

describe('detectPackageJson', () => {
  it('maps known deps + devDeps to display names', () => {
    const pkg = JSON.stringify({
      dependencies: { react: '^18', hono: '^4', '@supabase/supabase-js': '^2' },
      devDependencies: { vite: '^5', tailwindcss: '^3' },
    })
    expect(detectPackageJson(pkg)).toEqual(
      expect.arrayContaining(['React', 'Hono', 'Supabase', 'Vite', 'Tailwind CSS']),
    )
  })

  it('ignores unknown deps and returns [] on bad json', () => {
    expect(detectPackageJson(JSON.stringify({ dependencies: { 'left-pad': '1' } }))).toEqual([])
    expect(detectPackageJson('not json')).toEqual([])
  })
})

describe('detectPython', () => {
  it('detects frameworks from a requirements file', () => {
    const reqs = 'fastapi==0.110\nuvicorn\ntorch>=2.0\npandas\n'
    expect(detectPython(reqs)).toEqual(
      expect.arrayContaining(['FastAPI', 'PyTorch', 'Pandas']),
    )
  })
})

describe('dedupeStack', () => {
  it('dedupes case-insensitively, keeps first form + order', () => {
    expect(dedupeStack(['TypeScript', 'typescript', 'React', '  ', 'react', 'Hono']))
      .toEqual(['TypeScript', 'React', 'Hono'])
  })
})

describe('firstReadmeLine', () => {
  it('skips the title heading, badges and HTML, returns first prose', () => {
    const md = [
      '<p align="center"><img src="logo.png"/></p>',
      '# MockMate',
      '',
      '![build](https://img.shields.io/badge/x)',
      '',
      'A mock-interview coach that **grades** your answers with [AI](https://x.com).',
      '',
      '## Install',
    ].join('\n')
    expect(firstReadmeLine(md)).toBe('A mock-interview coach that grades your answers with AI.')
  })

  it('captures a blockquote tagline', () => {
    expect(firstReadmeLine('# Thing\n\n> The fastest way to do the thing.\n')).toBe(
      'The fastest way to do the thing.',
    )
  })

  it('returns null when there is no prose', () => {
    expect(firstReadmeLine('# Title\n\n```\ncode only\n```\n')).toBeNull()
  })
})

describe('clampGoal', () => {
  it('collapses whitespace and leaves short goals intact', () => {
    expect(clampGoal('  a   tidy\n goal  ')).toBe('a tidy goal')
  })

  it('clamps long text at a sentence boundary past the floor', () => {
    const first = 'This first sentence is deliberately written to run well past the eighty character floor here.'
    const out = clampGoal(first + ' ' + 'x'.repeat(200))
    expect(out).toBe(first)
  })

  it('hard-cuts with an ellipsis when no late sentence break exists', () => {
    const out = clampGoal('x'.repeat(300))
    expect(out.length).toBeLessThanOrEqual(201)
    expect(out.endsWith('…')).toBe(true)
  })
})
