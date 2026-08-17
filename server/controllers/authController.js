const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const {
  sendPasswordResetEmail,
  sendAdminNewRegistration,
  sendRegistrationReceived,
  sendPasswordChanged,
} = require('../services/emailService');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, isAdmin: user.isAdmin },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function safeUser(user) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    isAdmin: user.isAdmin,
    rulesAcceptedAt: user.rulesAcceptedAt,
    rulesAcceptedVersion: user.rulesAcceptedVersion,
  };
}

// E-maily se ukládají znormalizované (registrace, ř. níže), takže KAŽDÉ
// vyhledání uživatele podle e-mailu musí normalizovat stejně — unique index
// v Postgresu je case-sensitive a „Jan.Novak@…" by jinak účet nenašel.
function normalizeEmail(raw) {
  return (raw ?? '').trim().toLowerCase();
}

function getAdminEmails() {
  const raw = process.env.ADMIN_EMAIL || '';
  return raw.split(',').map(e => e.trim()).filter(Boolean);
}

async function register(req, res) {
  const firstName = (req.body.firstName ?? '').trim();
  const lastName  = (req.body.lastName  ?? '').trim();
  const email     = normalizeEmail(req.body.email);
  const { password } = req.body;

  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({ message: 'Všechna pole jsou povinná.' });
  }
  if (firstName.length > 50 || lastName.length > 50) {
    return res.status(400).json({ message: 'Jméno a příjmení mohou mít maximálně 50 znaků.' });
  }
  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ message: 'Neplatný formát emailu.' });
  }
  const allowedDomain = (process.env.ALLOWED_EMAIL_DOMAIN || '').trim().toLowerCase();
  if (allowedDomain && !email.endsWith(`@${allowedDomain}`)) {
    return res.status(400).json({ message: `Registrace je povolena pouze s firemním e-mailem (@${allowedDomain}).` });
  }
  if (password.length < 8) {
    return res.status(400).json({ message: 'Heslo musí mít alespoň 8 znaků.' });
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ message: 'Účet s tímto emailem již existuje.' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const newUser = await prisma.user.create({
      data: {
        firstName,
        lastName,
        email,
        password: hashedPassword,
        status: 'PENDING',
      },
    });

    const adminEmails = getAdminEmails();
    if (adminEmails.length > 0) {
      sendAdminNewRegistration(adminEmails, newUser).catch(err =>
        console.warn('[Email] sendAdminNewRegistration selhalo:', err.message)
      );
    }

    sendRegistrationReceived(newUser.email, newUser.firstName).catch(err =>
      console.warn('[Email] sendRegistrationReceived selhalo:', err.message)
    );

    return res.status(201).json({
      message: 'Registrace byla odeslána ke schválení administrátorem. Po schválení vás budeme informovat e-mailem.',
    });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ message: 'Chyba serveru při registraci.' });
  }
}

async function login(req, res) {
  const email = normalizeEmail(req.body.email);
  const { password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email a heslo jsou povinné.' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ message: 'Nesprávný email nebo heslo.' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ message: 'Nesprávný email nebo heslo.' });
    }

    // Status check after password verification (anti-enumeration)
    if (user.status === 'PENDING') {
      return res.status(400).json({ message: 'Účet čeká na schválení administrátorem.' });
    }
    if (user.status === 'REJECTED') {
      return res.status(400).json({ message: 'Registrace byla zamítnuta.' });
    }

    const token = signToken(user);
    return res.json({ token, user: safeUser(user) });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ message: 'Chyba serveru při přihlášení.' });
  }
}

async function forgotPassword(req, res) {
  // Vždy vrátí stejnou zprávu – neodhaluje existenci emailu
  const successMsg = {
    message: 'Pokud účet existuje, obdržíte email s kódem pro reset hesla.',
  };

  const email = normalizeEmail(req.body.email);
  if (!email || !EMAIL_REGEX.test(email)) {
    return res.json(successMsg);
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.json(successMsg);
    }

    const code = generateCode();
    const expiry = new Date(Date.now() + 60 * 60 * 1000);

    await prisma.user.update({
      where: { email },
      data: { resetToken: code, resetTokenExp: expiry },
    });

    sendPasswordResetEmail(email, user.firstName, code).catch((err) =>
      console.warn('[Email] sendPasswordResetEmail selhalo:', err.message)
    );

    return res.json(successMsg);
  } catch (err) {
    console.error('forgotPassword error:', err);
    return res.json(successMsg); // záměrně stejná zpráva i při chybě
  }
}

async function resetPassword(req, res) {
  const email = normalizeEmail(req.body.email);
  const { code, newPassword } = req.body;
  if (!email || !code || !newPassword) {
    return res.status(400).json({ message: 'Všechna pole jsou povinná.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ message: 'Heslo musí mít alespoň 8 znaků.' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.resetToken !== code) {
      return res.status(400).json({ message: 'Neplatný nebo expirovaný kód.' });
    }
    if (!user.resetTokenExp || user.resetTokenExp < new Date()) {
      return res.status(400).json({ message: 'Kód pro reset hesla vypršel.' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { email },
      data: { password: hashedPassword, resetToken: null, resetTokenExp: null },
    });

    sendPasswordChanged(user.email, user.firstName).catch(err =>
      console.warn('[Email] sendPasswordChanged selhalo:', err.message)
    );

    return res.json({ message: 'Heslo bylo úspěšně změněno.' });
  } catch (err) {
    console.error('resetPassword error:', err);
    return res.status(500).json({ message: 'Chyba serveru při resetování hesla.' });
  }
}

async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Všechna pole jsou povinná.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ message: 'Heslo musí mít alespoň 8 znaků.' });
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ message: 'Uživatel nenalezen.' });

    const currentValid = await bcrypt.compare(currentPassword, user.password);
    if (!currentValid) {
      return res.status(400).json({ message: 'Současné heslo není správné.' });
    }
    const sameAsOld = await bcrypt.compare(newPassword, user.password);
    if (sameAsOld) {
      return res.status(400).json({ message: 'Nové heslo musí být odlišné od současného.' });
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: req.user.id }, data: { password: hashed } });

    sendPasswordChanged(user.email, user.firstName).catch(err =>
      console.warn('[Email] sendPasswordChanged selhalo:', err.message)
    );

    return res.json({ message: 'Heslo bylo změněno.' });
  } catch (err) {
    console.error('changePassword error:', err);
    return res.status(500).json({ message: 'Chyba serveru při změně hesla.' });
  }
}

async function acceptRules(req, res) {
  const version = parseInt(req.body?.version, 10);
  if (isNaN(version)) {
    return res.status(400).json({ message: 'Chybí verze potvrzovaných pravidel.' });
  }

  try {
    const known = await prisma.rulesVersion.findUnique({ where: { id: version } });
    if (!known) return res.status(400).json({ message: 'Neznámá verze pravidel.' });

    // Historie je append-only a idempotentní PER VERZI (unique [userId, version]):
    // opakované potvrzení téže verze původní důkazní čas nepřepíše.
    await prisma.rulesAcceptance.upsert({
      where: { userId_version: { userId: req.user.id, version } },
      update: {},
      create: { userId: req.user.id, version },
    });

    const acceptance = await prisma.rulesAcceptance.findUnique({
      where: { userId_version: { userId: req.user.id, version } },
    });

    // Cache u uživatele drží NEJVYŠŠÍ potvrzenou verzi — potvrzení starší
    // verze (mezitím vyšla novější) nesmí cache snížit, gate má trvat dál.
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { rulesAcceptedVersion: true },
    });
    if (!user) return res.status(404).json({ message: 'Uživatel nenalezen.' });

    if ((user.rulesAcceptedVersion ?? 0) < version) {
      await prisma.user.update({
        where: { id: req.user.id },
        data: { rulesAcceptedAt: acceptance.acceptedAt, rulesAcceptedVersion: version },
      });
    }

    const fresh = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { rulesAcceptedAt: true, rulesAcceptedVersion: true },
    });
    return res.json({
      rulesAcceptedAt: fresh.rulesAcceptedAt,
      rulesAcceptedVersion: fresh.rulesAcceptedVersion,
    });
  } catch (err) {
    console.error('acceptRules error:', err);
    return res.status(500).json({ message: 'Chyba serveru při potvrzení pravidel.' });
  }
}

module.exports = { register, login, forgotPassword, resetPassword, changePassword, acceptRules };
