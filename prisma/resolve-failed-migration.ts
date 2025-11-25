import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const migrationName = '20251114161611_add_club_join_request'

  console.log(`🔍 Checking migration status for: ${migrationName}`)

  try {
    // Check if migration exists and its status
    const migration = await db.$queryRawUnsafe<
      Array<{
        id: string
        checksum: string
        finished_at: Date | null
        migration_name: string
        logs: string | null
        rolled_back_at: Date | null
        started_at: Date
        applied_steps_count: number
      }>
    >(
      `SELECT * FROM "_prisma_migrations" WHERE migration_name = '${migrationName}'`,
    )

    if (migration.length === 0) {
      console.log(
        '✅ Migration not found in database. It can be applied fresh.',
      )
      return
    }

    const mig = migration[0]
    console.log('📊 Migration status:')
    console.log(`   Started at: ${mig.started_at}`)
    console.log(`   Finished at: ${mig.finished_at || 'NOT FINISHED (FAILED)'}`)
    console.log(`   Rolled back at: ${mig.rolled_back_at || 'NOT ROLLED BACK'}`)
    console.log(`   Applied steps: ${mig.applied_steps_count}`)

    // Check for partial migration state
    console.log('\n🔍 Checking for partial migration state...')

    // Check if enum was partially altered
    const enumTypes = await db.$queryRaw<Array<{ typname: string }>>`
      SELECT typname FROM pg_type WHERE typname LIKE 'BookingStatus%'
    `
    console.log(
      `   Enum types found: ${enumTypes.map((e) => e.typname).join(', ')}`,
    )

    // Check if tables were dropped
    const tournamentTables = await db.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename IN ('tournament_registrations', 'tournament_registration_members')
    `
    console.log(
      `   Tournament tables still exist: ${tournamentTables.map((t) => t.tablename).join(', ') || 'NONE'}`,
    )

    // Check if new tables exist
    const newTables = await db.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename IN ('club_join_requests', 'password_reset_tokens')
    `
    console.log(
      `   New tables exist: ${newTables.map((t) => t.tablename).join(', ') || 'NONE'}`,
    )

    // Check for DRAFT status records
    const draftBookings = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint as count FROM bookings WHERE status = 'DRAFT'
    `
    const draftClassBookings = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint as count FROM class_bookings WHERE status = 'DRAFT'
    `
    console.log(`   DRAFT bookings: ${draftBookings[0]?.count || 0}`)
    console.log(`   DRAFT class_bookings: ${draftClassBookings[0]?.count || 0}`)

    if (!mig.finished_at && !mig.rolled_back_at) {
      console.log('\n⚠️  Migration is marked as failed. Resolving...')

      // First, rollback any aborted transactions
      console.log('   Rolling back any aborted transactions...')
      try {
        await db.$executeRawUnsafe(`ROLLBACK;`)
      } catch {
        // Ignore if no transaction exists
        console.log('   (No active transaction to rollback)')
      }

      // Clean up partial state if needed
      if (enumTypes.some((e) => e.typname === 'BookingStatus_old')) {
        console.log('   Cleaning up BookingStatus_old enum...')
        try {
          await db.$executeRawUnsafe(
            `DROP TYPE IF EXISTS "BookingStatus_old" CASCADE;`,
          )
          console.log('   ✅ Cleaned up BookingStatus_old enum')
        } catch (e) {
          console.log(`   ⚠️  Could not drop BookingStatus_old: ${e}`)
        }
      }

      // Check for BookingStatus_new that wasn't renamed
      if (enumTypes.some((e) => e.typname === 'BookingStatus_new')) {
        console.log(
          '   Found BookingStatus_new enum (partial migration state)...',
        )
        // Try to complete the enum rename
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
      console.log('   Marking migration as rolled back...')
      try {
        await db.$executeRawUnsafe(
          `UPDATE "_prisma_migrations" 
          SET rolled_back_at = NOW() 
          WHERE migration_name = '${migrationName}' AND finished_at IS NULL`,
        )
        console.log(
          '✅ Migration marked as rolled back. You can now re-run migrations.',
        )
      } catch (e) {
        console.error(`❌ Error marking migration as rolled back: ${e}`)
        console.log(
          '   You may need to manually update the _prisma_migrations table',
        )
      }
    } else if (mig.rolled_back_at) {
      console.log(
        '\n✅ Migration is already marked as rolled back. You can re-run migrations.',
      )
    } else {
      console.log('\n✅ Migration appears to be completed. No action needed.')
    }

    // Warn about DRAFT records
    if (
      (draftBookings[0]?.count || 0n) > 0n ||
      (draftClassBookings[0]?.count || 0n) > 0n
    ) {
      console.log('\n⚠️  WARNING: Found records with DRAFT status!')
      console.log('   You must update these before re-running the migration:')
      console.log(
        "   UPDATE bookings SET status = 'HOLD' WHERE status = 'DRAFT';",
      )
      console.log(
        "   UPDATE class_bookings SET status = 'HOLD' WHERE status = 'DRAFT';",
      )
    }
  } catch (error) {
    console.error('❌ Error resolving migration:', error)
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
