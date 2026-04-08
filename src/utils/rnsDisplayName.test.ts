import { describe, expect, it } from 'vitest'
import { sanitizeRnsDisplayName } from './rnsDisplayName'

describe('sanitizeRnsDisplayName', () => {
  it('accepts typical .rsk names', () => {
    expect(sanitizeRnsDisplayName('foo.rsk')).toBe('foo.rsk')
    expect(sanitizeRnsDisplayName('foo.bar.rsk')).toBe('foo.bar.rsk')
    expect(sanitizeRnsDisplayName('FOO.RSK')).toBe('FOO.RSK')
  })

  it('rejects empty and oversize', () => {
    expect(sanitizeRnsDisplayName('')).toBeNull()
    expect(sanitizeRnsDisplayName('   ')).toBeNull()
    expect(sanitizeRnsDisplayName('a'.repeat(129) + '.rsk')).toBeNull()
  })

  it('rejects HTML-like and quotes', () => {
    expect(sanitizeRnsDisplayName('x<img>.rsk')).toBeNull()
    expect(sanitizeRnsDisplayName('x"y.rsk')).toBeNull()
    expect(sanitizeRnsDisplayName("x'y.rsk")).toBeNull()
    expect(sanitizeRnsDisplayName('a&b.rsk')).toBeNull()
  })

  it('rejects control characters', () => {
    expect(sanitizeRnsDisplayName('foo\n.rsk')).toBeNull()
    expect(sanitizeRnsDisplayName('foo\x7fbar.rsk')).toBeNull()
  })

  it('rejects misleading non-.rsk and bad label shapes', () => {
    expect(sanitizeRnsDisplayName('vitalik.eth')).toBeNull()
    expect(sanitizeRnsDisplayName('-bad.rsk')).toBeNull()
    expect(sanitizeRnsDisplayName('bad..rsk')).toBeNull()
    expect(sanitizeRnsDisplayName('.rsk')).toBeNull()
  })
})
