import { PrismaClient, User, Club } from '@prisma/client'
import { hashPassword } from '../src/lib/password'

const db = new PrismaClient()

async function seedUsers() {
  console.info('👥 Seeding users...')

  const hashedPassword = await hashPassword('Password123!')

  const users = [
    {
      name: 'John Smith',
      email: 'john.smith@example.com',
      phone: '+6281234567890',
      phoneVerified: true,
      password: hashedPassword,
    },
    {
      name: 'Sarah Johnson',
      email: 'sarah.johnson@example.com',
      phone: '+6281234567891',
      phoneVerified: true,
      password: hashedPassword,
    },
    {
      name: 'Michael Chen',
      email: 'michael.chen@example.com',
      phone: '+6281234567892',
      phoneVerified: true,
      password: hashedPassword,
    },
    {
      name: 'Emma Williams',
      email: 'emma.williams@example.com',
      phone: '+6281234567893',
      phoneVerified: true,
      password: hashedPassword,
    },
    {
      name: 'David Lee',
      email: 'david.lee@example.com',
      phone: '+6281234567894',
      phoneVerified: true,
      password: hashedPassword,
    },
    {
      name: 'Lisa Anderson',
      email: 'lisa.anderson@example.com',
      phone: '+6281234567895',
      phoneVerified: true,
      password: hashedPassword,
    },
  ]

  const createdUsers: User[] = []
  for (const userData of users) {
    const user = await db.user.upsert({
      where: { email: userData.email },
      update: {},
      create: userData,
    })
    createdUsers.push(user)
    console.info(`✅ Created user: ${user.name} (${user.email})`)
  }

  return createdUsers
}

async function seedClubs(users: User[]) {
  console.info('🏆 Seeding clubs...')

  const clubs = [
    {
      name: 'Elite Tennis Club',
      description: 'A premier tennis club for professionals and enthusiasts. Join us for competitive matches and training sessions.',
      rules: '1. Respect all members\n2. Book courts in advance\n3. Proper attire required\n4. No-show policy applies',
      visibility: 'PUBLIC' as const,
      leaderId: users[0].id, // John Smith leads
    },
    {
      name: 'VIP Badminton Circle',
      description: 'Exclusive badminton club for serious players. Invitation and approval required.',
      rules: '1. Professional conduct required\n2. Minimum skill level: Advanced\n3. Monthly fee applies\n4. Commitment to weekly games',
      visibility: 'PRIVATE' as const,
      leaderId: users[1].id, // Sarah Johnson leads
    },
    {
      name: 'Community Sports Hub',
      description: 'A diverse sports community welcoming all ages and skill levels. We play tennis, badminton, and table tennis.',
      rules: '1. Open to all\n2. Respect diversity\n3. Follow booking rules\n4. Maintain equipment',
      visibility: 'PUBLIC' as const,
      leaderId: users[2].id, // Michael Chen leads
    },
  ]

  const createdClubs: Club[] = []
  for (const clubData of clubs) {
    const club = await db.club.upsert({
      where: { name: clubData.name },
      update: {},
      create: clubData,
    })
    createdClubs.push(club)
    console.info(`✅ Created ${club.visibility} club: ${club.name} (Leader: ${users.find(u => u.id === clubData.leaderId)?.name})`)
  }

  return createdClubs
}

async function seedClubMembers(clubs: Club[], users: User[]) {
  console.info('👥 Seeding club members and join requests...')

  // ONE member per club rule enforced
  // Club 0: Elite Tennis Club (PUBLIC) - John leads, Emma is member
  // Club 1: VIP Badminton Circle (PRIVATE) - Sarah leads, has pending requests
  // Club 2: Community Sports Hub (PUBLIC) - Michael leads, David is member

  const memberships = [
    // Elite Tennis Club (PUBLIC) - Emma joined
    { clubId: clubs[0].id, userId: users[3].id }, // Emma Williams
    
    // Community Sports Hub (PUBLIC) - David joined
    { clubId: clubs[2].id, userId: users[4].id }, // David Lee
  ]

  for (const membership of memberships) {
    await db.clubMember.upsert({
      where: {
        clubId_userId: {
          clubId: membership.clubId,
          userId: membership.userId,
        },
      },
      update: {},
      create: membership,
    })
  }
  console.info(`✅ Created ${memberships.length} club memberships`)

  // Create join requests for PRIVATE club
  const joinRequests = [
    // Pending request for VIP Badminton Circle
    { clubId: clubs[1].id, userId: users[5].id, status: 'PENDING' }, // Lisa requesting to join
  ]

  for (const request of joinRequests) {
    await db.clubJoinRequest.upsert({
      where: {
        clubId_userId: {
          clubId: request.clubId,
          userId: request.userId,
        },
      },
      update: {},
      create: request,
    })
  }
  console.info(`✅ Created ${joinRequests.length} pending join requests`)
}

async function main() {
  console.info('🌱 Seeding database')

  const users = await seedUsers()
  const clubs = await seedClubs(users)
  await seedClubMembers(clubs, users)

  console.info('\n📊 Seeding Summary:')
  console.info(`   Users created: ${users.length}`)
  console.info(`   Clubs created: ${clubs.length}`)
  console.info('\n🏆 Club Structure:')
  console.info('   1. Elite Tennis Club (PUBLIC)')
  console.info('      Leader: John Smith')
  console.info('      Member: Emma Williams')
  console.info('\n   2. VIP Badminton Circle (PRIVATE)')
  console.info('      Leader: Sarah Johnson')
  console.info('      Pending Request: Lisa Anderson')
  console.info('\n   3. Community Sports Hub (PUBLIC)')
  console.info('      Leader: Michael Chen')
  console.info('      Member: David Lee')
  console.info('\n👥 Available Users (not in any club):')
  console.info('   - No club: None (all users are either leaders or members)')
  console.info('\n🔑 Test Credentials (all users):')
  console.info('   john.smith@example.com - Leader of Elite Tennis Club')
  console.info('   sarah.johnson@example.com - Leader of VIP Badminton Circle (PRIVATE)')
  console.info('   michael.chen@example.com - Leader of Community Sports Hub')
  console.info('   emma.williams@example.com - Member of Elite Tennis Club')
  console.info('   david.lee@example.com - Member of Community Sports Hub')
  console.info('   lisa.anderson@example.com - Has pending request for VIP Badminton Circle')
  console.info('   Password: Password123!')
  
  console.info('\n🌱 Database seeding complete')
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
