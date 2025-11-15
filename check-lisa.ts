import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  // Find Lisa
  const lisa = await db.user.findUnique({
    where: { email: 'lisa.anderson@example.com' }
  })
  
  if (!lisa) {
    console.log('❌ Lisa not found')
    return
  }
  
  console.log('👤 Lisa Anderson:', lisa.id)
  
  // Check if Lisa is a club member
  const membership = await db.clubMember.findFirst({
    where: { userId: lisa.id },
    include: { club: true }
  })
  
  console.log('\n📋 Club Membership:')
  if (membership) {
    console.log('✅ Member of:', membership.club.name)
    console.log('   Status:', membership.isActive ? 'ACTIVE' : 'INACTIVE')
    console.log('   Joined:', membership.joinedAt)
  } else {
    console.log('❌ Not a member of any club')
  }
  
  // Check join requests
  const requests = await db.clubJoinRequest.findMany({
    where: { userId: lisa.id },
    include: { club: true }
  })
  
  console.log('\n📨 Join Requests:')
  if (requests.length > 0) {
    requests.forEach(req => {
      console.log(`   Club: ${req.club.name}`)
      console.log(`   Status: ${req.status}`)
      console.log(`   Created: ${req.createdAt}`)
    })
  } else {
    console.log('   No requests found')
  }
  
  // Check if Lisa leads a club
  const ledClub = await db.club.findFirst({
    where: { leaderId: lisa.id }
  })
  
  console.log('\n👑 Leader of:')
  if (ledClub) {
    console.log('✅', ledClub.name)
  } else {
    console.log('❌ Not a leader of any club')
  }
}

main()
  .then(async () => await db.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await db.$disconnect()
    process.exit(1)
  })
