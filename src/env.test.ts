import { describe, expect, it } from 'vitest'
import { parseStorageStrategy } from './env'

describe('parseStorageStrategy', () => {
  it('defaults to local when the value is not set', () => {
    expect(parseStorageStrategy(undefined, undefined)).toBe('local')
  })

  it('accepts local without a Blob token', () => {
    expect(parseStorageStrategy('local', undefined)).toBe('local')
  })

  it('accepts blob when a Blob token is provided', () => {
    expect(parseStorageStrategy('blob', 'test-token')).toBe('blob')
  })

  it('rejects unsupported strategies', () => {
    expect(() => parseStorageStrategy('s3', undefined)).toThrow(
      'Invalid STORAGE_STRATEGY "s3". Expected "local" or "blob"',
    )
  })

  it('rejects blob without a Blob token', () => {
    expect(() => parseStorageStrategy('blob', undefined)).toThrow(
      'Missing env BLOB_READ_WRITE_TOKEN for STORAGE_STRATEGY "blob"',
    )
  })
})
