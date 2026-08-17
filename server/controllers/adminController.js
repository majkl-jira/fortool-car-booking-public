const prisma = require('../lib/prisma');
const { sendAccountApproved, sendAccountRejected } = require('../services/emailService');

async function getPendingRegistrations(req, res) {
  try {
    const users = await prisma.user.findMany({
      where: { status: 'PENDING' },
      select: { id: true, email: true, firstName: true, lastName: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return res.json(users);
  } catch (err) {
    console.error('getPendingRegistrations error:', err);
    return res.status(500).json({ message: 'Chyba serveru.' });
  }
}

async function getRejectedRegistrations(req, res) {
  try {
    const users = await prisma.user.findMany({
      where: { status: 'REJECTED' },
      select: { id: true, email: true, firstName: true, lastName: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(users);
  } catch (err) {
    console.error('getRejectedRegistrations error:', err);
    return res.status(500).json({ message: 'Chyba serveru.' });
  }
}

async function approveRegistration(req, res) {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ message: 'Neplatné ID.' });

  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ message: 'Uživatel nenalezen.' });
    if (user.status === 'APPROVED') {
      return res.status(409).json({ message: 'Uživatel je již schválený.' });
    }

    await prisma.user.update({ where: { id }, data: { status: 'APPROVED' } });

    sendAccountApproved(user.email, user.firstName).catch(err =>
      console.warn('[Email] sendAccountApproved selhalo:', err.message)
    );

    return res.json({ message: 'Registrace schválena.' });
  } catch (err) {
    console.error('approveRegistration error:', err);
    return res.status(500).json({ message: 'Chyba serveru.' });
  }
}

async function rejectRegistration(req, res) {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ message: 'Neplatné ID.' });

  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ message: 'Uživatel nenalezen.' });
    if (user.status !== 'PENDING') {
      return res.status(409).json({ message: 'Tato registrace už byla vyřízena.' });
    }

    await prisma.user.update({ where: { id }, data: { status: 'REJECTED' } });

    sendAccountRejected(user.email, user.firstName).catch(err =>
      console.warn('[Email] sendAccountRejected selhalo:', err.message)
    );

    return res.json({ message: 'Registrace zamítnuta.' });
  } catch (err) {
    console.error('rejectRegistration error:', err);
    return res.status(500).json({ message: 'Chyba serveru.' });
  }
}

module.exports = { getPendingRegistrations, getRejectedRegistrations, approveRegistration, rejectRegistration };
