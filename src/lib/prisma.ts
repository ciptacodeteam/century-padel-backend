import { PrismaClient } from '@prisma/client'

const prismaClient = new PrismaClient({
  log: ['error', 'warn'],
  transactionOptions: {
    timeout: 1000 * 60 * 1, // 1 minute
  },
})

export const db = global.prisma || prismaClient

if (process.env.NODE_ENV !== 'production') global.prisma = db
