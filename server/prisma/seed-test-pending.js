// ⚠️ DEV ONLY — fiktivní testovací účty pro lokální vývoj.
// Skript odmítne běžet proti jiné než lokální DB (kontrola hostu níž).
//
// Zakládá 2 uživatele ve stavu PENDING pro testování admin stránky
// /admin/registrace. Jména i adresy jsou vymyšlené, heslo je veřejné —
// nikdy nespouštět proti ostrému provozu.
//
// Použití: node prisma/seed-test-pending.js
const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')
const prisma = new PrismaClient()

const TEST_USERS = [
  { email: 'test1@fortool.cz', firstName: 'Karel',  lastName: 'Dvořák' },
  { email: 'test2@fortool.cz', firstName: 'Lucie',  lastName: 'Svobodová' },
]

async function main() {
  // Pojistka proti omylu: skript odmítne běžet mimo localhost
  const dbHost = new URL(process.env.DATABASE_URL).hostname
  if (dbHost !== 'localhost' && dbHost !== '127.0.0.1') {
    throw new Error(`DATABASE_URL míří na "${dbHost}" — tenhle testovací seed běží jen proti localhost.`)
  }

  const hash = await bcrypt.hash('Test1234', 12) // stejně jako registrace (bcrypt, 12 rounds)

  for (const u of TEST_USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { status: 'PENDING' }, // při opakovaném spuštění vrátí usera do PENDING
      create: { ...u, password: hash, isAdmin: false, status: 'PENDING' },
    })
    console.log(`✓ ${u.email} (${u.firstName} ${u.lastName}) — PENDING`)
  }
  console.log(`Hotovo: ${TEST_USERS.length} testovací uživatelé, heslo "Test1234".`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
