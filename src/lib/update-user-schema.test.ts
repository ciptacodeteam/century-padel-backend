import { describe, expect, it } from 'vitest'
import { updateUserSchema } from './validation'

describe('updateUserSchema', () => {
  it('accepts a blank email on customer edit', () => {
    const parsed = updateUserSchema.safeParse({
      name: 'Jane Doe',
      email: '',
      phone: '81234567890',
    })

    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.email).toBe('')
  })
})
