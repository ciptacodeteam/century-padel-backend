import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  console.log('🧹 Cleaning up old database objects...')
  
  try {
    // Drop old tournament_registrations table if exists
    await db.$executeRawUnsafe(`DROP TABLE IF EXISTS tournament_registrations CASCADE;`)
    console.log('✅ Dropped tournament_registrations table')
    
    // Drop old enum type if exists
    await db.$executeRawUnsafe(`DROP TYPE IF EXISTS "BookingStatus_old" CASCADE;`)
    console.log('✅ Dropped BookingStatus_old enum type')
    
    console.log('🎉 Cleanup complete!')
  } catch (error) {
    console.error('Error during cleanup:', error)
    throw error
  }
}

main()
  .then(async () => {
    await db.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await db.$disconnect()
    process.exit(1)
  })
