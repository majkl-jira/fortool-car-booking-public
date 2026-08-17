const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')
const prisma = new PrismaClient()

async function main() {
  const rawAdminEmail = process.env.ADMIN_EMAIL
  if (!rawAdminEmail) throw new Error('ADMIN_EMAIL není nastaveno – seed nelze spustit.')

  const adminEmail = rawAdminEmail.split(',')[0].trim()

  const adminPassword = process.env.ADMIN_PASSWORD
  if (!adminPassword) throw new Error('ADMIN_PASSWORD není nastaveno – seed nelze spustit.')

  const firstName = process.env.ADMIN_FIRST_NAME || 'Admin'
  const lastName  = process.env.ADMIN_LAST_NAME  || 'ForTool'

  const hash = await bcrypt.hash(adminPassword, 12)

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      password: hash,
      firstName,
      lastName,
      isAdmin: true,
      status: 'APPROVED',
    },
  })

  console.log(`Seed dokončen: admin účet ${adminEmail} vytvořen (nebo již existuje).`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
