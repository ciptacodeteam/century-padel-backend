import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  console.log('🔄 Rolling back aborted transaction...')
  
  try {
    // Connect directly and rollback any aborted transaction
    // We need to use a raw connection to handle transaction state
    await db.$executeRawUnsafe(`ROLLBACK;`)
    console.log('✅ Transaction rolled back')
  } catch (e: any) {
    if (e.message?.includes('no transaction') || e.message?.includes('not in a transaction')) {
      console.log('✅ No active transaction to rollback')
    } else {
      console.log(`⚠️  Could not rollback: ${e.message}`)
      console.log('   This is okay if there was no transaction')
    }
  }
  
  // Now try to mark the migration as rolled back
  const migrationName = '20251114161611_add_club_join_request'
  console.log(`\n📝 Marking migration '${migrationName}' as rolled back...`)
  
  try {
    const result = await db.$executeRawUnsafe(
      `UPDATE "_prisma_migrations" 
      SET rolled_back_at = NOW() 
      WHERE migration_name = '${migrationName}' AND finished_at IS NULL`
    )
    console.log('✅ Migration marked as rolled back')
  } catch (e: any) {
    console.error(`❌ Error: ${e.message}`)
    console.log('\nYou may need to manually run:')
    console.log(`UPDATE "_prisma_migrations" SET rolled_back_at = NOW() WHERE migration_name = '${migrationName}' AND finished_at IS NULL;`)
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


