import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const migrationName = '20251114161611_add_club_join_request'
  
  console.log(`🔧 Force rolling back failed migration: ${migrationName}`)
  
  try {
    // First, ensure we're not in a transaction by using a new connection
    // and explicitly ending any aborted transactions
    console.log('   Ensuring clean database connection...')
    
    // Use $executeRawUnsafe with explicit transaction handling
    try {
      // This will fail if we're in a transaction, but that's okay
      await db.$executeRawUnsafe('COMMIT;')
    } catch (e) {
      // Ignore - we might not be in a transaction
    }
    
    try {
      // Rollback any aborted transaction
      await db.$executeRawUnsafe('ROLLBACK;')
    } catch (e) {
      // Ignore - might not be in a transaction
    }
    
    // Now check migration status
    const migration = await db.$queryRawUnsafe<Array<{
      id: string
      checksum: string
      finished_at: Date | null
      migration_name: string
      logs: string | null
      rolled_back_at: Date | null
      started_at: Date
      applied_steps_count: number
    }>>(
      `SELECT * FROM "_prisma_migrations" WHERE migration_name = '${migrationName}'`
    )

    if (migration.length === 0) {
      console.log('✅ Migration not found. It can be applied fresh.')
      return
    }

    const mig = migration[0]
    console.log(`📊 Migration status:`)
    console.log(`   Started: ${mig.started_at}`)
    console.log(`   Finished: ${mig.finished_at || 'NOT FINISHED (FAILED)'}`)
    console.log(`   Rolled back: ${mig.rolled_back_at || 'NOT ROLLED BACK'}`)

    // If already rolled back, we're good
    if (mig.rolled_back_at) {
      console.log('✅ Migration is already marked as rolled back.')
      return
    }

    // Check for DRAFT status records that need to be updated
    console.log('\n🔍 Checking for DRAFT status records...')
    const draftBookings = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint as count FROM bookings WHERE status = 'DRAFT'
    `
    const draftClassBookings = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint as count FROM class_bookings WHERE status = 'DRAFT'
    `
    
    const draftCount = Number(draftBookings[0]?.count || 0n) + Number(draftClassBookings[0]?.count || 0n)
    
    if (draftCount > 0) {
      console.log(`⚠️  Found ${draftCount} records with DRAFT status`)
      console.log('   Updating DRAFT records to HOLD...')
      
      try {
        await db.$executeRawUnsafe(`
          UPDATE bookings SET status = 'HOLD' WHERE status = 'DRAFT';
        `)
        await db.$executeRawUnsafe(`
          UPDATE class_bookings SET status = 'HOLD' WHERE status = 'DRAFT';
        `)
        console.log('   ✅ Updated DRAFT records')
      } catch (e) {
        console.log(`   ⚠️  Could not update DRAFT records: ${e}`)
        console.log('   You may need to update them manually')
      }
    }

    // Clean up any partial migration state
    console.log('\n🧹 Cleaning up partial migration state...')
    
    // Check for enum types
    const enumTypes = await db.$queryRaw<Array<{ typname: string }>>`
      SELECT typname FROM pg_type WHERE typname LIKE 'BookingStatus%'
    `
    
    // Clean up BookingStatus_old if it exists
    if (enumTypes.some(e => e.typname === 'BookingStatus_old')) {
      console.log('   Removing BookingStatus_old enum...')
      try {
        await db.$executeRawUnsafe(`DROP TYPE IF EXISTS "BookingStatus_old" CASCADE;`)
        console.log('   ✅ Removed BookingStatus_old')
      } catch (e) {
        console.log(`   ⚠️  Could not remove BookingStatus_old: ${e}`)
      }
    }

    // Fix BookingStatus_new if it exists
    if (enumTypes.some(e => e.typname === 'BookingStatus_new')) {
      console.log('   Fixing BookingStatus_new enum...')
      try {
        await db.$executeRawUnsafe(`
          DO $$ 
          BEGIN
            IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BookingStatus_new') THEN
              IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BookingStatus_old') THEN
                DROP TYPE "BookingStatus_old" CASCADE;
              END IF;
              ALTER TYPE "BookingStatus_new" RENAME TO "BookingStatus";
            END IF;
          END $$;
        `)
        console.log('   ✅ Fixed enum state')
      } catch (e) {
        console.log(`   ⚠️  Could not fix enum: ${e}`)
      }
    }

    // Mark migration as rolled back
    console.log('\n📝 Marking migration as rolled back...')
    try {
      await db.$executeRawUnsafe(
        `UPDATE "_prisma_migrations" 
        SET rolled_back_at = NOW() 
        WHERE migration_name = '${migrationName}' AND finished_at IS NULL`
      )
      console.log('✅ Migration marked as rolled back successfully!')
      console.log('   You can now re-run migrations.')
    } catch (e) {
      console.error(`❌ Error marking migration as rolled back: ${e}`)
      throw e
    }

  } catch (error) {
    console.error('❌ Error during rollback:', error)
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

