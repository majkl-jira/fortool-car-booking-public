const prisma = require('../lib/prisma');
const {
  sendBookingConfirmation,
  sendBookingCancellation,
  sendUserBookingUpdatedByAdmin,
  sendAdminBookingCreated,
  sendAdminBookingUpdated,
  sendAdminBookingCancelled,
} = require('../services/emailService');
const { currentVersion: currentRulesVersion } = require('./rulesController');

function getAdminEmails() {
  return (process.env.ADMIN_EMAIL || '').split(',').map(e => e.trim()).filter(Boolean);
}

const MAX_PURPOSE_LEN = 200;
// Strop délky rezervace. Bez něj projde konec třeba v roce 9999 a takový
// záznam zablokuje auto navždy (vše ostatní hlásí kolizi) — a hromadné
// zrušení ho nesmaže, protože jakmile začne, počítá se jako probíhající.
const MAX_BOOKING_DAYS = 30;

function parseDates(dateFrom, dateTo) {
  const from = new Date(dateFrom);
  const to = new Date(dateTo);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return { error: 'Neplatný formát data.' };
  }
  return { from, to };
}

// allowPastStart = úprava PRÁVĚ PROBÍHAJÍCÍ rezervace: začátek už proběhl
// (a je zamčený, viz updateBooking), mění se jen konec — ten ale musí být
// v budoucnosti, aby nešlo rezervaci zkrátit do minulosti.
function validateDates(from, to, { allowPastStart = false } = {}) {
  const now = new Date();
  if (!allowPastStart && from <= now) {
    return 'Datum začátku musí být v budoucnosti.';
  }
  if (to <= from) {
    return 'Datum konce musí být po datu začátku.';
  }
  if (allowPastStart && to <= now) {
    return 'Konec probíhající rezervace musí být v budoucnosti.';
  }
  if (to - from > MAX_BOOKING_DAYS * 24 * 60 * 60 * 1000) {
    return `Rezervace může být nejdéle ${MAX_BOOKING_DAYS} dní.`;
  }
  return null;
}

async function findConflict(from, to, vehicleId, excludeId = null) {
  return prisma.booking.findFirst({
    where: {
      AND: [
        { vehicleId },
        { dateFrom: { lt: to } },
        { dateTo: { gt: from } },
        ...(excludeId ? [{ id: { not: excludeId } }] : []),
      ],
    },
    orderBy: { dateTo: 'desc' },
    select: { dateTo: true },
  });
}

// Kolik historie vracet v GET /bookings. Okno, ne celá historie: seznam se
// tahá pollingem každých 10 s, takže payload musí zůstat malý a stabilní.
// Kalendář tak ukáže i nedávnou minulost; kniha si budoucí filtruje sama.
const HISTORY_MONTHS = 3;

// GET /api/bookings — pro přihlášené (route má `authenticate`), bez citlivých
// dat: budoucí rezervace + historie za poslední 3 měsíce.
// Volitelný filtr: ?vehicleId=1
async function getAllBookings(req, res) {
  try {
    const from = new Date();
    from.setMonth(from.getMonth() - HISTORY_MONTHS);
    const where = { dateTo: { gte: from } };
    if (req.query.vehicleId) {
      const vehicleId = parseInt(req.query.vehicleId, 10);
      if (!isNaN(vehicleId)) where.vehicleId = vehicleId;
    }

    const bookings = await prisma.booking.findMany({
      where,
      select: {
        id: true,
        vehicleId: true,
        dateFrom: true,
        dateTo: true,
        purpose: true,
        user: {
          select: { firstName: true, lastName: true },
        },
      },
      orderBy: { dateFrom: 'asc' },
    });
    return res.json(bookings);
  } catch (err) {
    console.error('getAllBookings error:', err);
    return res.status(500).json({ message: 'Chyba serveru při načítání rezervací.' });
  }
}

// GET /api/bookings/mine — rezervace přihlášeného uživatele
async function getMyBookings(req, res) {
  try {
    const bookings = await prisma.booking.findMany({
      where: { userId: req.user.id },
      include: {
        user: { select: { firstName: true, lastName: true } },
        vehicle: { select: { id: true, name: true, plate: true } },
      },
      orderBy: { dateFrom: 'asc' },
    });
    return res.json(bookings);
  } catch (err) {
    console.error('getMyBookings error:', err);
    return res.status(500).json({ message: 'Chyba serveru při načítání vašich rezervací.' });
  }
}

// POST /api/bookings
async function createBooking(req, res) {
  const { dateFrom, dateTo, purpose, vehicleId: rawVehicleId } = req.body;

  if (!dateFrom || !dateTo || !purpose || rawVehicleId === undefined) {
    return res.status(400).json({ message: 'Všechna pole jsou povinná (včetně vehicleId).' });
  }
  if (typeof purpose !== 'string' || purpose.trim().length === 0) {
    return res.status(400).json({ message: 'Účel rezervace nesmí být prázdný.' });
  }
  if (purpose.length > MAX_PURPOSE_LEN) {
    return res.status(400).json({ message: `Účel rezervace může mít maximálně ${MAX_PURPOSE_LEN} znaků.` });
  }

  const vehicleId = parseInt(rawVehicleId, 10);
  if (isNaN(vehicleId)) {
    return res.status(400).json({ message: 'Neplatné vehicleId.' });
  }

  const { from, to, error: parseError } = parseDates(dateFrom, dateTo);
  if (parseError) return res.status(400).json({ message: parseError });

  const dateError = validateDates(from, to);
  if (dateError) return res.status(400).json({ message: dateError });

  try {
    // Musí být potvrzena AKTUÁLNÍ verze pravidel. Čte se z DB, ne z JWT —
    // token vydaný před potvrzením (nebo před publikací nové verze) je stale.
    // Fail-closed: bez potvrzení se rezervace nevytvoří.
    const [requester, current] = await Promise.all([
      prisma.user.findUnique({
        where: { id: req.user.id },
        select: { rulesAcceptedVersion: true },
      }),
      currentRulesVersion(),
    ]);
    if (current && requester?.rulesAcceptedVersion !== current.id) {
      return res.status(403).json({
        message: requester?.rulesAcceptedVersion
          ? 'Pravidla používání vozidla byla aktualizována. Potvrďte prosím novou verzi.'
          : 'Nejprve potvrďte pravidla používání vozidla.',
      });
    }

    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle || !vehicle.active) {
      return res.status(404).json({ message: 'Vozidlo nenalezeno nebo není aktivní.' });
    }

    const conflict = await findConflict(from, to, vehicleId);
    if (conflict) {
      return res.status(409).json({
        message: 'Vozidlo je v tomto termínu již rezervováno.',
        nextAvailable: conflict.dateTo,
      });
    }

    const booking = await prisma.booking.create({
      data: {
        userId: req.user.id,
        vehicleId,
        dateFrom: from,
        dateTo: to,
        purpose: purpose.trim(),
      },
    });

    prisma.user.findUnique({ where: { id: req.user.id }, select: { email: true, firstName: true, lastName: true } })
      .then((user) => {
        if (!user) return;
        sendBookingConfirmation(user.email, user.firstName, booking).catch(err =>
          console.warn('[Email] sendBookingConfirmation selhalo:', err.message)
        );
        if (!req.user.isAdmin) {
          const adminEmails = getAdminEmails();
          if (adminEmails.length > 0) {
            sendAdminBookingCreated(adminEmails, booking, user).catch(err =>
              console.warn('[Email] sendAdminBookingCreated selhalo:', err.message)
            );
          }
        }
      })
      .catch(() => {});

    return res.status(201).json(booking);
  } catch (err) {
    console.error('createBooking error:', err);
    return res.status(500).json({ message: 'Chyba serveru při vytváření rezervace.' });
  }
}

// PUT /api/bookings/:id
async function updateBooking(req, res) {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ message: 'Neplatné ID rezervace.' });

  const { dateFrom, dateTo, purpose } = req.body;

  if (!dateFrom || !dateTo || !purpose) {
    return res.status(400).json({ message: 'Všechna pole jsou povinná.' });
  }
  if (typeof purpose !== 'string' || purpose.trim().length === 0) {
    return res.status(400).json({ message: 'Účel rezervace nesmí být prázdný.' });
  }
  if (purpose.length > MAX_PURPOSE_LEN) {
    return res.status(400).json({ message: `Účel rezervace může mít maximálně ${MAX_PURPOSE_LEN} znaků.` });
  }

  const { from, to, error: parseError } = parseDates(dateFrom, dateTo);
  if (parseError) return res.status(400).json({ message: parseError });

  try {
    const existing = await prisma.booking.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: 'Rezervace nenalezena.' });
    }
    if (existing.userId !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ message: 'Nemáte oprávnění upravit tuto rezervaci.' });
    }

    // Validace data až tady — závisí na tom, v jakém stavu rezervace je.
    // Probíhající jde prodloužit/zkrátit (mění se konec, začátek je zamčený),
    // minulá už ne, budoucí beze změny.
    const now = new Date();
    const isRunning = existing.dateFrom <= now && existing.dateTo > now;
    const isPast    = existing.dateTo <= now;

    if (isPast) {
      return res.status(400).json({ message: 'Minulou rezervaci už nelze upravit.' });
    }
    if (isRunning && from.getTime() !== existing.dateFrom.getTime()) {
      return res.status(400).json({ message: 'U probíhající rezervace nelze měnit začátek, jen konec.' });
    }

    const dateError = validateDates(from, to, { allowPastStart: isRunning });
    if (dateError) return res.status(400).json({ message: dateError });

    const conflict = await findConflict(from, to, existing.vehicleId, id);
    if (conflict) {
      return res.status(409).json({
        message: 'Vozidlo je v tomto termínu již rezervováno.',
        nextAvailable: conflict.dateTo,
      });
    }

    const updated = await prisma.booking.update({
      where: { id },
      data: { dateFrom: from, dateTo: to, purpose: purpose.trim() },
    });

    if (!req.user.isAdmin) {
      // Uživatel upravil svou rezervaci → notifikace adminům
      const adminEmails = getAdminEmails();
      if (adminEmails.length > 0) {
        Promise.all([
          prisma.user.findUnique({
            where: { id: existing.userId },
            select: { firstName: true, lastName: true },
          }),
          prisma.vehicle.findUnique({
            where: { id: existing.vehicleId },
            select: { name: true, plate: true },
          }),
        ])
          .then(([owner, vehicle]) => {
            if (!owner) return;
            sendAdminBookingUpdated(adminEmails, { original: existing, updated, user: owner, vehicle }).catch(err =>
              console.warn('[Email] sendAdminBookingUpdated selhalo:', err.message)
            );
          })
          .catch(() => {});
      }
    } else if (existing.userId !== req.user.id) {
      // Admin upravil cizí rezervaci → notifikace vlastníkovi
      Promise.all([
        prisma.user.findUnique({
          where: { id: existing.userId },
          select: { email: true, firstName: true },
        }),
        prisma.vehicle.findUnique({
          where: { id: existing.vehicleId },
          select: { name: true, plate: true },
        }),
      ])
        .then(([owner, vehicle]) => {
          if (!owner) return;
          sendUserBookingUpdatedByAdmin(owner.email, owner.firstName, { original: existing, updated, vehicle }).catch(err =>
            console.warn('[Email] sendUserBookingUpdatedByAdmin selhalo:', err.message)
          );
        })
        .catch(() => {});
    }
    // Admin upravil svou vlastní rezervaci → žádný mail

    return res.json(updated);
  } catch (err) {
    console.error('updateBooking error:', err);
    return res.status(500).json({ message: 'Chyba serveru při úpravě rezervace.' });
  }
}

// DELETE /api/bookings/:id
async function deleteBooking(req, res) {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ message: 'Neplatné ID rezervace.' });

  try {
    const existing = await prisma.booking.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: 'Rezervace nenalezena.' });
    }
    if (existing.userId !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ message: 'Nemáte oprávnění smazat tuto rezervaci.' });
    }

    // Načteme uživatele před smazáním (owner rezervace, ne nutně req.user)
    const bookingOwner = await prisma.user.findUnique({
      where: { id: existing.userId },
      select: { email: true, firstName: true, lastName: true, isAdmin: true },
    });

    await prisma.booking.delete({ where: { id } });

    if (bookingOwner) {
      sendBookingCancellation(bookingOwner.email, bookingOwner.firstName, existing).catch(err =>
        console.warn('[Email] sendBookingCancellation selhalo:', err.message)
      );
      if (!bookingOwner.isAdmin) {
        const adminEmails = getAdminEmails();
        if (adminEmails.length > 0) {
          sendAdminBookingCancelled(adminEmails, existing, bookingOwner).catch(err =>
            console.warn('[Email] sendAdminBookingCancelled selhalo:', err.message)
          );
        }
      }
    }

    return res.status(204).send();
  } catch (err) {
    console.error('deleteBooking error:', err);
    return res.status(500).json({ message: 'Chyba serveru při mazání rezervace.' });
  }
}

module.exports = { getAllBookings, getMyBookings, createBooking, updateBooking, deleteBooking };
