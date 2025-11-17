import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  console.log('🔧 Fixing BookingStatus enum migration issue...\n')

  try {
    // Step 1: Check if tournament_registrations table exists
    console.log('📋 Step 1: Checking for tournament_registrations table...')
    const tournamentTables = await db.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename IN ('tournament_registrations', 'tournament_registration_members')
    `
    
    if (tournamentTables.length > 0) {
      console.log(`   Found tables: ${tournamentTables.map(t => t.tablename).join(', ')}`)
      console.log('   Dropping tournament tables...')
      
      // Drop foreign key constraints first
      await db.$executeRawUnsafe(`
        DO $$ 
        BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tournament_registration_members') THEN
            IF EXISTS (
              SELECT 1 FROM information_schema.table_constraints 
              WHERE constraint_name = 'tournament_registration_members_tournamentRegistrationId_fkey' 
              AND table_name = 'tournament_registration_members'
            ) THEN
              ALTER TABLE "tournament_registration_members" DROP CONSTRAINT "tournament_registration_members_tournamentRegistrationId_fkey";
            END IF;
            IF EXISTS (
              SELECT 1 FROM information_schema.table_constraints 
              WHERE constraint_name = 'tournament_registration_members_userId_fkey' 
              AND table_name = 'tournament_registration_members'
            ) THEN
              ALTER TABLE "tournament_registration_members" DROP CONSTRAINT "tournament_registration_members_userId_fkey";
            END IF;
          END IF;
          
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tournament_registrations') THEN
            IF EXISTS (
              SELECT 1 FROM information_schema.table_constraints 
              WHERE constraint_name = 'tournament_registrations_clubId_fkey' 
              AND table_name = 'tournament_registrations'
            ) THEN
              ALTER TABLE "tournament_registrations" DROP CONSTRAINT "tournament_registrations_clubId_fkey";
            END IF;
            IF EXISTS (
              SELECT 1 FROM information_schema.table_constraints 
              WHERE constraint_name = 'tournament_registrations_tournamentId_fkey' 
              AND table_name = 'tournament_registrations'
            ) THEN
              ALTER TABLE "tournament_registrations" DROP CONSTRAINT "tournament_registrations_tournamentId_fkey";
            END IF;
          END IF;
        END $$;
      `)
      
      // Drop the tables
      await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "tournament_registration_members" CASCADE;`)
      await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "tournament_registrations" CASCADE;`)
      console.log('   ✅ Tournament tables dropped')
    } else {
      console.log('   ✅ No tournament tables found')
    }

    // Step 2: Check for and clean up enum types
    console.log('\n📋 Step 2: Checking enum types...')
    const enumTypes = await db.$queryRaw<Array<{ typname: string }>>`
      SELECT typname FROM pg_type WHERE typname LIKE 'BookingStatus%'
    `
    console.log(`   Found enum types: ${enumTypes.map(e => e.typname).join(', ') || 'NONE'}`)

    // Drop BookingStatus_old if it exists
    if (enumTypes.some(e => e.typname === 'BookingStatus_old')) {
      console.log('   Dropping BookingStatus_old enum...')
      try {
        await db.$executeRawUnsafe(`DROP TYPE IF EXISTS "BookingStatus_old" CASCADE;`)
        console.log('   ✅ BookingStatus_old dropped')
      } catch (e: any) {
        console.log(`   ⚠️  Could not drop BookingStatus_old: ${e.message}`)
        // Try to find what depends on it
        const dependencies = await db.$queryRaw<Array<{ 
          dependent_type: string
          dependent_name: string
        }>>`
          SELECT DISTINCT
            t.typname as dependent_type,
            c.relname as dependent_name
          FROM pg_depend d
          JOIN pg_type t ON d.refobjid = t.oid
          JOIN pg_class c ON d.objid = c.oid
          WHERE t.typname = 'BookingStatus_old'
        `
        if (dependencies.length > 0) {
          console.log(`   Dependencies found: ${dependencies.map(d => d.dependent_name).join(', ')}`)
          console.log('   Attempting to drop with CASCADE...')
          await db.$executeRawUnsafe(`DROP TYPE "BookingStatus_old" CASCADE;`)
          console.log('   ✅ BookingStatus_old dropped with CASCADE')
        }
      }
    }

    // Check for BookingStatus_new that wasn't renamed
    if (enumTypes.some(e => e.typname === 'BookingStatus_new')) {
      console.log('   Found BookingStatus_new enum (partial migration state)...')
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
      } catch (e: any) {
        console.log(`   ⚠️  Could not fix enum: ${e.message}`)
      }
    }

    // Step 3: Update any DRAFT records to HOLD
    console.log('\n📋 Step 3: Checking for DRAFT status records...')
    const draftBookings = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint as count FROM bookings WHERE status::text = 'DRAFT'
    `
    const draftClassBookings = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint as count FROM class_bookings WHERE status::text = 'DRAFT'
    `
    
    const bookingCount = Number(draftBookings[0]?.count || 0n)
    const classBookingCount = Number(draftClassBookings[0]?.count || 0n)
    
    if (bookingCount > 0) {
      console.log(`   Found ${bookingCount} bookings with DRAFT status, updating to HOLD...`)
      await db.$executeRawUnsafe(`UPDATE "bookings" SET "status" = 'HOLD' WHERE "status"::text = 'DRAFT';`)
      console.log('   ✅ Bookings updated')
    }
    
    if (classBookingCount > 0) {
      console.log(`   Found ${classBookingCount} class_bookings with DRAFT status, updating to HOLD...`)
      await db.$executeRawUnsafe(`UPDATE "class_bookings" SET "status" = 'HOLD' WHERE "status"::text = 'DRAFT';`)
      console.log('   ✅ Class bookings updated')
    }
    
    if (bookingCount === 0 && classBookingCount === 0) {
      console.log('   ✅ No DRAFT records found')
    }

    // Step 4: Verify current enum state
    console.log('\n📋 Step 4: Verifying enum state...')
    const currentEnum = await db.$queryRaw<Array<{ enumlabel: string }>>`
      SELECT e.enumlabel 
      FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'BookingStatus'
      ORDER BY e.enumsortorder
    `
    console.log(`   Current BookingStatus values: ${currentEnum.map(e => e.enumlabel).join(', ')}`)

    console.log('\n✅ Fix completed! You can now run: bun run db:push')
    console.log('   Or: docker compose -f docker-compose.prod.yml exec app bun run db:push')

  } catch (error) {
    console.error('❌ Error fixing migration:', error)
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

