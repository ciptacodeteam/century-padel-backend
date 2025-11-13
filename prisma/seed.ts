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
      leaderId: users[0].id,
    },
    {
      name: 'Weekend Warriors Badminton',
      description: 'Casual badminton club for weekend players. All skill levels welcome!',
      rules: '1. Have fun!\n2. Be on time for bookings\n3. Share equipment\n4. Clean up after play',
      visibility: 'PUBLIC' as const,
      leaderId: users[1].id,
    },
    {
      name: 'Pro Squash Academy',
      description: 'Professional squash training and competitive play. Advanced players only.',
      rules: '1. Minimum skill level required\n2. Monthly membership fee\n3. Attend weekly training\n4. Respect coaches',
      visibility: 'PRIVATE' as const,
      leaderId: users[2].id,
    },
    {
      name: 'Community Sports Hub',
      description: 'A diverse sports community welcoming all ages and skill levels. We play tennis, badminton, and table tennis.',
      rules: '1. Open to all\n2. Respect diversity\n3. Follow booking rules\n4. Maintain equipment',
      visibility: 'PUBLIC' as const,
      leaderId: users[3].id,
    },
    {
      name: 'Morning Fitness Tennis',
      description: 'Early morning tennis club focused on fitness and health. Join us for 6 AM sessions!',
      rules: '1. Arrive by 5:55 AM\n2. Warm up properly\n3. Bring water\n4. 3-strike absence policy',
      visibility: 'PUBLIC' as const,
      leaderId: users[0].id,
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
    console.info(`✅ Created club: ${club.name} (Leader: ${clubData.leaderId})`)
  }

  return createdClubs
}

async function seedClubMembers(clubs: Club[], users: User[]) {
  console.info('👥 Seeding club members...')

  // Add some members to clubs
  const memberships = [
    // Elite Tennis Club members
    { clubId: clubs[0].id, userId: users[1].id },
    { clubId: clubs[0].id, userId: users[2].id },
    
    // Weekend Warriors Badminton members
    { clubId: clubs[1].id, userId: users[0].id },
    { clubId: clubs[1].id, userId: users[3].id },
    
    // Pro Squash Academy members
    { clubId: clubs[2].id, userId: users[0].id },
    
    // Community Sports Hub members
    { clubId: clubs[3].id, userId: users[0].id },
    { clubId: clubs[3].id, userId: users[1].id },
    { clubId: clubs[3].id, userId: users[2].id },
    
    // Morning Fitness Tennis members
    { clubId: clubs[4].id, userId: users[2].id },
    { clubId: clubs[4].id, userId: users[3].id },
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
}

async function main() {
  console.info('🌱 Seeding database')

  const users = await seedUsers()
  const clubs = await seedClubs(users)
  await seedClubMembers(clubs, users)

  console.info('\n📊 Seeding Summary:')
  console.info(`   Users created: ${users.length}`)
  console.info(`   Clubs created: ${clubs.length}`)
  console.info('\n🔑 Test Credentials:')
  console.info('   Email: john.smith@example.com')
  console.info('   Email: sarah.johnson@example.com')
  console.info('   Email: michael.chen@example.com')
  console.info('   Email: emma.williams@example.com')
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
