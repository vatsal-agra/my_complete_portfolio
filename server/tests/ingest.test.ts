import { describe, it, expect } from 'vitest'
import { IngestBody } from '../src/types.js'
import { slugify } from '../src/lib/slug.js'

describe('IngestBody validation', () => {
  it('accepts a minimal progress event', () => {
    const r = IngestBody.safeParse({ project: 'mockmate', type: 'progress', summary: 'Shipped onboarding' })
    expect(r.success).toBe(true)
  })

  it('rejects an unknown event type', () => {
    const r = IngestBody.safeParse({ project: 'x', type: 'nope', summary: 'x' })
    expect(r.success).toBe(false)
  })

  it('requires project', () => {
    const r = IngestBody.safeParse({ type: 'progress', summary: 'x' })
    expect(r.success).toBe(false)
  })

  it('requires summary', () => {
    const r = IngestBody.safeParse({ project: 'x', type: 'progress' })
    expect(r.success).toBe(false)
  })

  it('rejects spend without an amount', () => {
    const r = IngestBody.safeParse({ project: 'x', type: 'spend', summary: 'x', payload: { currency: 'USD' } })
    expect(r.success).toBe(false)
  })

  it('accepts a valid spend payload', () => {
    const r = IngestBody.safeParse({
      project: 'x', type: 'spend', summary: 'x',
      payload: { amount: 1.23, currency: 'USD', vendor: 'RunPod' },
    })
    expect(r.success).toBe(true)
  })

  it('rejects metric without a name', () => {
    const r = IngestBody.safeParse({ project: 'x', type: 'metric', summary: 'x', payload: { value: 1 } })
    expect(r.success).toBe(false)
  })

  it('accepts a metric with name + value', () => {
    const r = IngestBody.safeParse({
      project: 'x', type: 'metric', summary: 'x',
      payload: { name: 'signups', value: 230, unit: 'users' },
    })
    expect(r.success).toBe(true)
  })

  it('defaults source to "manual"', () => {
    const r = IngestBody.safeParse({ project: 'x', type: 'progress', summary: 'x' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.source).toBe('manual')
  })

  it('accepts non-manual sources', () => {
    const r = IngestBody.safeParse({ project: 'x', type: 'progress', summary: 'x', source: 'claude_session' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.source).toBe('claude_session')
  })
})

describe('slugify', () => {
  it('lowercases', () => { expect(slugify('MockMate')).toBe('mockmate') })
  it('replaces spaces with hyphens', () => { expect(slugify('algo viz')).toBe('algo-viz') })
  it('strips punctuation', () => { expect(slugify('foo!@#bar')).toBe('foobar') })
  it('collapses repeats', () => { expect(slugify('a   b__c')).toBe('a-b-c') })
  it('falls back to "project" on empty', () => { expect(slugify('---')).toBe('project') })
})
