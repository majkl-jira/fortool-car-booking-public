// ⚠️ DEV-ONLY: API smoke test proti LOKÁLNÍMU backendu (fortool_local).
// NIKDY nespouštět proti produkci — vytváří a maže uživatele, vozidla
// a rezervace. Pojistky níž to mají znemožnit, ale spoléhat se na ně nemá smysl.
//
// Spuštění:  npm run smoke      (backend musí běžet na :3001)
//
// Co ověřuje (~49 kontrol v 5 blocích):
//   A. Autentizace  – login, špatné heslo, neznámý e-mail, validace registrace,
//                     že se nevrací hash hesla
//   B. Guardy       – 401 bez tokenu, 403 na admin endpointy jako běžný uživatel
//   C. Pravidla     – aktuální verze, idempotence potvrzení, potvrzení starší
//                     verze nesmí snížit cache
//   D. Rezervace    – gate pravidel, konflikt detektor, validace dat, cizí
//                     úprava/smazání, tříměsíční okno historie
//   E. Vozidla      – duplicitní SPZ, vyřazení/smazání s rezervacemi,
//                     hromadné zrušení jen budoucích
//
// Bezpečnost:
//  - odmítne běžet proti jiné DB než localhost (stejná pojistka jako
//    prisma/seed-test-pending.js) a proti jinému API než localhost
//  - všechny mutace dělá na vlastních testovacích účtech a vlastním vozidle
//  - rezervace zakládá 2 roky dopředu → nemůže kolidovat s reálnými daty
//  - booking mutace dělá ADMIN účet → notifikace na ADMIN_EMAIL se neodesílají
//    (controller je posílá jen když aktér není admin); potvrzovací maily míří
//    na @example.com, tedy nikam
//  - na konci po sobě všechno uklidí (i když test spadne uprostřed)
require('dotenv').config({ quiet: true });

// Pojistka proti omylu: skript odmítne běžet mimo localhost
const dbUrl = new URL(process.env.DATABASE_URL);
if (dbUrl.hostname !== 'localhost' && dbUrl.hostname !== '127.0.0.1') {
  throw new Error(`DATABASE_URL míří na "${dbUrl.hostname}" — smoke test běží jen proti localhost.`);
}
if (dbUrl.pathname.replace('/', '') !== 'fortool_local') {
  throw new Error(`DATABASE_URL míří na DB "${dbUrl.pathname.replace('/', '')}" — očekávána lokální fortool_local.`);
}

const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const API = 'http://localhost:3001/api';
const PW = 'SmokeTest123';
const ADMIN_EMAIL = 'smoke-admin@example.com';
const USER_EMAIL = 'smoke-user@example.com';
const PLATE = 'SMOKE 001';

const results = [];
let created = { userIds: [], vehicleIds: [], bookingIds: [] };

function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? '  ✓' : '  ✗ SELHALO'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* 204 */ }
  return { status: res.status, json };
}

const future = (dayOffset, hour, len = 2) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 2);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  const to = new Date(d); to.setHours(hour + len);
  return { dateFrom: d.toISOString(), dateTo: to.toISOString() };
};

async function setup() {
  const hash = await bcrypt.hash(PW, 12);
  const cur = await prisma.rulesVersion.findFirst({ orderBy: { id: 'desc' } });

  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { status: 'APPROVED', isAdmin: true, password: hash },
    create: { email: ADMIN_EMAIL, password: hash, firstName: 'Smoke', lastName: 'Admin', isAdmin: true, status: 'APPROVED' },
  });
  // admin má potvrzenou aktuální verzi pravidel → smí rezervovat
  await prisma.rulesAcceptance.upsert({
    where: { userId_version: { userId: admin.id, version: cur.id } },
    update: {}, create: { userId: admin.id, version: cur.id },
  });
  await prisma.user.update({ where: { id: admin.id }, data: { rulesAcceptedVersion: cur.id, rulesAcceptedAt: new Date() } });

  // běžný uživatel BEZ potvrzených pravidel → testuje gate
  const user = await prisma.user.upsert({
    where: { email: USER_EMAIL },
    update: { status: 'APPROVED', isAdmin: false, password: hash, rulesAcceptedVersion: null, rulesAcceptedAt: null },
    create: { email: USER_EMAIL, password: hash, firstName: 'Smoke', lastName: 'User', isAdmin: false, status: 'APPROVED' },
  });

  const vehicle = await prisma.vehicle.create({
    data: { name: 'SMOKE TEST VOZIDLO', plate: PLATE, active: true, sortOrder: 999 },
  });

  created.userIds = [admin.id, user.id];
  created.vehicleIds = [vehicle.id];
  return { admin, user, vehicle, rulesVersion: cur.id };
}

async function teardown() {
  await prisma.booking.deleteMany({ where: { OR: [
    { vehicleId: { in: created.vehicleIds } },
    { userId: { in: created.userIds } },
  ] } });
  await prisma.rulesAcceptance.deleteMany({ where: { userId: { in: created.userIds } } });
  await prisma.vehicle.deleteMany({ where: { id: { in: created.vehicleIds } } });
  await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
}

async function main() {
  const ctx = await setup();
  console.log(`\nSetup: admin=${ctx.admin.id}, user=${ctx.user.id}, vozidlo=${ctx.vehicle.id}, pravidla v${ctx.rulesVersion}\n`);

  // ── A. AUTENTIZACE ─────────────────────────────────────────────────────────
  console.log('A. Autentizace');
  const loginA = await api('POST', '/auth/login', { body: { email: ADMIN_EMAIL, password: PW } });
  check('login správné heslo → 200 + token', loginA.status === 200 && !!loginA.json.token, `status ${loginA.status}`);
  check('login vrací rulesAcceptedVersion', loginA.json?.user?.rulesAcceptedVersion === ctx.rulesVersion);
  check('login nevrací hash hesla', loginA.json?.user && !('password' in loginA.json.user));
  const tAdmin = loginA.json.token;

  const loginU = await api('POST', '/auth/login', { body: { email: USER_EMAIL, password: PW } });
  const tUser = loginU.json?.token;
  check('login běžného uživatele → 200', loginU.status === 200 && !!tUser);

  const badPw = await api('POST', '/auth/login', { body: { email: ADMIN_EMAIL, password: 'Spatne123' } });
  check('login špatné heslo → 401', badPw.status === 401, `status ${badPw.status}`);
  const noUser = await api('POST', '/auth/login', { body: { email: 'neexistuje@example.com', password: PW } });
  check('login neznámý email → 401 (bez prozrazení)', noUser.status === 401, `status ${noUser.status}`);
  const dupReg = await api('POST', '/auth/register', { body: { firstName: 'X', lastName: 'Y', email: ADMIN_EMAIL, password: PW } });
  check('registrace na existující email → 409', dupReg.status === 409, `status ${dupReg.status}`);
  const shortPw = await api('POST', '/auth/register', { body: { firstName: 'X', lastName: 'Y', email: 'novy@example.com', password: 'krat' } });
  check('registrace krátké heslo → 400', shortPw.status === 400, `status ${shortPw.status}`);
  const badMail = await api('POST', '/auth/register', { body: { firstName: 'X', lastName: 'Y', email: 'neplatny', password: PW } });
  check('registrace neplatný email → 400', badMail.status === 400, `status ${badMail.status}`);

  // ── B. GUARDY ──────────────────────────────────────────────────────────────
  console.log('\nB. Autorizační guardy');
  check('GET /bookings bez tokenu → 401', (await api('GET', '/bookings')).status === 401);
  check('GET /bookings s nesmyslným tokenem → 401', (await api('GET', '/bookings', { token: 'xxx.yyy.zzz' })).status === 401);
  check('GET /bookings/mine bez tokenu → 401', (await api('GET', '/bookings/mine')).status === 401);
  check('GET /rules bez tokenu → 401', (await api('GET', '/rules')).status === 401);
  check('GET /vehicles/admin jako uživatel → 403', (await api('GET', '/vehicles/admin', { token: tUser })).status === 403);
  check('POST /vehicles jako uživatel → 403', (await api('POST', '/vehicles', { token: tUser, body: { name: 'X', plate: 'X 1' } })).status === 403);
  check('POST /rules jako uživatel → 403', (await api('POST', '/rules', { token: tUser, body: { sections: [{ title: 'A', items: ['b'] }] } })).status === 403);
  check('GET /admin/registrations/pending jako uživatel → 403', (await api('GET', '/admin/registrations/pending', { token: tUser })).status === 403);
  check('GET /vehicles bez tokenu → 200 (veřejné)', (await api('GET', '/vehicles')).status === 200);

  // ── C. PRAVIDLA A VERZOVÁNÍ ────────────────────────────────────────────────
  console.log('\nC. Pravidla a verzování');
  const rules = await api('GET', '/rules', { token: tUser });
  check('GET /rules → aktuální verze + sekce', rules.status === 200 && rules.json.version === ctx.rulesVersion && Array.isArray(rules.json.sections), `v${rules.json?.version}, ${rules.json?.sections?.length} sekcí`);
  check('accept-rules bez verze → 400', (await api('POST', '/auth/accept-rules', { token: tUser, body: {} })).status === 400);
  check('accept-rules neznámá verze → 400', (await api('POST', '/auth/accept-rules', { token: tUser, body: { version: 99999 } })).status === 400);
  const acc1 = await api('POST', '/auth/accept-rules', { token: tUser, body: { version: ctx.rulesVersion } });
  check('accept-rules aktuální verze → 200', acc1.status === 200 && acc1.json.rulesAcceptedVersion === ctx.rulesVersion);
  await new Promise(r => setTimeout(r, 1100));
  const acc2 = await api('POST', '/auth/accept-rules', { token: tUser, body: { version: ctx.rulesVersion } });
  check('opakované potvrzení nepřepíše čas (idempotence)', acc1.json.rulesAcceptedAt === acc2.json.rulesAcceptedAt);
  if (ctx.rulesVersion > 1) {
    const accOld = await api('POST', '/auth/accept-rules', { token: tUser, body: { version: 1 } });
    check('potvrzení starší verze nesníží cache', accOld.json.rulesAcceptedVersion === ctx.rulesVersion, `cache v${accOld.json?.rulesAcceptedVersion}`);
  }
  const badRules = await api('POST', '/rules', { token: tAdmin, body: { sections: [{ title: '  ', items: ['x'] }] } });
  check('publikace pravidel s prázdným nadpisem → 400', badRules.status === 400);
  const emptyRules = await api('POST', '/rules', { token: tAdmin, body: { sections: [] } });
  check('publikace bez sekcí → 400', emptyRules.status === 400);

  // ── D. REZERVACE ───────────────────────────────────────────────────────────
  console.log('\nD. Rezervace');
  const vid = ctx.vehicle.id;
  const slot = future(1, 8);

  // uživatel bez potvrzených pravidel — dočasně mu je zrušíme
  await prisma.user.update({ where: { id: ctx.user.id }, data: { rulesAcceptedVersion: null } });
  const gated = await api('POST', '/bookings', { token: tUser, body: { ...slot, purpose: 'gate test', vehicleId: vid } });
  check('rezervace bez potvrzených pravidel → 403', gated.status === 403, gated.json?.message);
  await prisma.user.update({ where: { id: ctx.user.id }, data: { rulesAcceptedVersion: ctx.rulesVersion } });

  const b1 = await api('POST', '/bookings', { token: tAdmin, body: { ...slot, purpose: 'smoke A', vehicleId: vid } });
  check('vytvoření rezervace → 201', b1.status === 201, `status ${b1.status}`);
  if (b1.json?.id) created.bookingIds.push(b1.json.id);

  const overlap = await api('POST', '/bookings', { token: tAdmin, body: { ...future(1, 9), purpose: 'kolize', vehicleId: vid } });
  check('překryv na stejném vozidle → 409 + nextAvailable', overlap.status === 409 && !!overlap.json.nextAvailable, `status ${overlap.status}`);

  const otherVehicle = (await prisma.vehicle.findFirst({ where: { id: { not: vid }, active: true } }));
  if (otherVehicle) {
    const noClash = await api('POST', '/bookings', { token: tAdmin, body: { ...future(1, 9), purpose: 'jine auto', vehicleId: otherVehicle.id } });
    check('stejný čas na JINÉM vozidle → 201 (žádná falešná kolize)', noClash.status === 201, `status ${noClash.status}`);
    if (noClash.json?.id) created.bookingIds.push(noClash.json.id);
  }

  const past = await api('POST', '/bookings', { token: tAdmin, body: { dateFrom: '2020-01-01T08:00:00.000Z', dateTo: '2020-01-01T10:00:00.000Z', purpose: 'minulost', vehicleId: vid } });
  check('rezervace v minulosti → 400', past.status === 400);
  const rev = await api('POST', '/bookings', { token: tAdmin, body: { dateFrom: future(3, 10).dateFrom, dateTo: future(3, 8).dateFrom, purpose: 'obraceny', vehicleId: vid } });
  check('konec před začátkem → 400', rev.status === 400);
  const longPurpose = await api('POST', '/bookings', { token: tAdmin, body: { ...future(4, 8), purpose: 'x'.repeat(201), vehicleId: vid } });
  check('účel > 200 znaků → 400', longPurpose.status === 400);
  const noVeh = await api('POST', '/bookings', { token: tAdmin, body: { ...future(5, 8), purpose: 'bez auta' } });
  check('chybějící vehicleId → 400', noVeh.status === 400);
  const ghostVeh = await api('POST', '/bookings', { token: tAdmin, body: { ...future(5, 8), purpose: 'duch', vehicleId: 999999 } });
  check('neexistující vozidlo → 404', ghostVeh.status === 404);

  if (b1.json?.id) {
    const foreignEdit = await api('PUT', `/bookings/${b1.json.id}`, { token: tUser, body: { ...future(6, 8), purpose: 'cizi uprava' } });
    check('úprava cizí rezervace běžným uživatelem → 403', foreignEdit.status === 403, `status ${foreignEdit.status}`);
    const foreignDel = await api('DELETE', `/bookings/${b1.json.id}`, { token: tUser });
    check('smazání cizí rezervace běžným uživatelem → 403', foreignDel.status === 403, `status ${foreignDel.status}`);
    const ownEdit = await api('PUT', `/bookings/${b1.json.id}`, { token: tAdmin, body: { ...future(7, 8), purpose: 'smoke A upraveno' } });
    check('úprava vlastní rezervace → 200', ownEdit.status === 200, `status ${ownEdit.status}`);
  }

  // historie: 3měsíční okno
  const oldB = await prisma.booking.create({ data: { userId: ctx.admin.id, vehicleId: vid, dateFrom: new Date(Date.now() - 40 * 864e5), dateTo: new Date(Date.now() - 40 * 864e5 + 72e5), purpose: 'stara 40 dni' } });
  const ancientB = await prisma.booking.create({ data: { userId: ctx.admin.id, vehicleId: vid, dateFrom: new Date(Date.now() - 200 * 864e5), dateTo: new Date(Date.now() - 200 * 864e5 + 72e5), purpose: 'prastara 200 dni' } });
  created.bookingIds.push(oldB.id, ancientB.id);
  const list = await api('GET', '/bookings', { token: tAdmin });
  const ids = (list.json || []).map(b => b.id);
  check('GET /bookings vrací rezervaci starou 40 dní (okno 3 měsíce)', ids.includes(oldB.id));
  check('GET /bookings NEvrací rezervaci starou 200 dní', !ids.includes(ancientB.id));
  check('GET /bookings nevrací e-maily uživatelů', !JSON.stringify(list.json || []).includes('@example.com'));

  // ── E. SPRÁVA VOZIDEL ──────────────────────────────────────────────────────
  console.log('\nE. Správa vozidel');
  const dupPlate = await api('POST', '/vehicles', { token: tAdmin, body: { name: 'Duplicita', plate: PLATE.toLowerCase() } });
  check('duplicitní SPZ (jiná velikost písmen) → 409', dupPlate.status === 409, `status ${dupPlate.status}`);
  const deact = await api('PUT', `/vehicles/${vid}`, { token: tAdmin, body: { active: false } });
  check('vyřazení vozidla s budoucí rezervací → 409', deact.status === 409, deact.json?.message);
  const delV = await api('DELETE', `/vehicles/${vid}`, { token: tAdmin });
  check('smazání vozidla s rezervacemi → 409', delV.status === 409, `status ${delV.status}`);

  const futureList = await api('GET', `/vehicles/${vid}/bookings/future`, { token: tAdmin });
  const fIds = (futureList.json || []).map(b => b.id);
  check('GET future rezervace vozidla → jen budoucí', futureList.status === 200 && !fIds.includes(oldB.id) && !fIds.includes(ancientB.id), `${fIds.length} položek`);
  const cancelForeign = await api('POST', `/vehicles/${vid}/bookings/cancel-future`, { token: tAdmin, body: { ids: [oldB.id, ancientB.id] } });
  check('hromadné zrušení NEsmaže minulé rezervace', cancelForeign.json?.cancelled === 0, `cancelled=${cancelForeign.json?.cancelled}`);
  const stillThere = await prisma.booking.findUnique({ where: { id: oldB.id } });
  check('minulá rezervace po pokusu o hromadné zrušení stále existuje', !!stillThere);
  const cancelReal = await api('POST', `/vehicles/${vid}/bookings/cancel-future`, { token: tAdmin, body: { ids: fIds } });
  check('hromadné zrušení budoucích → cancelled = počet', cancelReal.json?.cancelled === fIds.length, `cancelled=${cancelReal.json?.cancelled}/${fIds.length}`);
  const admList = await api('GET', '/vehicles/admin', { token: tAdmin });
  const me = (admList.json || []).find(v => v.id === vid);
  check('admin výpis vozidel nese futureBookings i totalBookings', me && typeof me.futureBookings === 'number' && typeof me.totalBookings === 'number', me ? `future=${me.futureBookings} total=${me.totalBookings}` : 'vozidlo nenalezeno');

  // ── SOUHRN ─────────────────────────────────────────────────────────────────
  const failed = results.filter(r => !r.ok);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`VÝSLEDEK: ${results.length - failed.length}/${results.length} prošlo`);
  if (failed.length) {
    console.log(`\nSELHALO (${failed.length}):`);
    failed.forEach(f => console.log(`  ✗ ${f.name}${f.detail ? ' — ' + f.detail : ''}`));
  }
  console.log('='.repeat(60));
  return failed.length;
}

main()
  .then(async n => { await teardown(); await prisma.$disconnect(); console.log('\nÚklid hotov (testovací účty, vozidlo i rezervace smazány).'); process.exit(n ? 1 : 0); })
  .catch(async e => { console.error('CHYBA:', e); await teardown().catch(() => {}); await prisma.$disconnect(); process.exit(1); });
