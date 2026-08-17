const prisma = require('../lib/prisma');
const { sendBookingsBulkCancelled } = require('../services/emailService');

// GET /api/vehicles — aktivní auta, veřejné
// Každé auto nese computed pole availableNow (má právě teď běžící rezervaci?)
async function getVehicles(req, res) {
  try {
    const now = new Date();
    const [vehicles, running] = await Promise.all([
      prisma.vehicle.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
      prisma.booking.findMany({
        where: { dateFrom: { lte: now }, dateTo: { gt: now } },
        select: { vehicleId: true },
      }),
    ]);
    const busy = new Set(running.map(b => b.vehicleId));
    return res.json(vehicles.map(v => ({ ...v, availableNow: !busy.has(v.id) })));
  } catch (err) {
    console.error('getVehicles error:', err);
    return res.status(500).json({ message: 'Chyba serveru při načítání vozidel.' });
  }
}

// GET /api/vehicles/admin — admin only: VŠECHNA auta (i vyřazená)
// + počet budoucích rezervací (podklad pro guard vyřazení v UI)
async function getVehiclesAdmin(req, res) {
  try {
    const now = new Date();
    const [vehicles, future, total] = await Promise.all([
      prisma.vehicle.findMany({
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
      prisma.booking.groupBy({
        by: ['vehicleId'],
        where: { dateTo: { gte: now } },
        _count: { _all: true },
      }),
      // totalBookings (i minulé) — UI podle něj ukazuje Smazat jen tam, kde DELETE projde
      prisma.booking.groupBy({
        by: ['vehicleId'],
        _count: { _all: true },
      }),
    ]);
    const futureCounts = new Map(future.map(f => [f.vehicleId, f._count._all]));
    const totalCounts  = new Map(total.map(t => [t.vehicleId, t._count._all]));
    return res.json(vehicles.map(v => ({
      ...v,
      futureBookings: futureCounts.get(v.id) ?? 0,
      totalBookings:  totalCounts.get(v.id) ?? 0,
    })));
  } catch (err) {
    console.error('getVehiclesAdmin error:', err);
    return res.status(500).json({ message: 'Chyba serveru při načítání vozidel.' });
  }
}

// Case-insensitive kontrola duplicitní SPZ („1A2 3456" == „1a2 3456");
// excludeId u PUT ignoruje shodu auta se sebou samým
async function plateTaken(plate, excludeId = null) {
  const found = await prisma.vehicle.findFirst({
    where: {
      plate: { equals: plate, mode: 'insensitive' },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  return !!found;
}

// GET /api/vehicles/:id/bookings/future — admin only: NEZAČATÉ rezervace auta
// (dateFrom > now) pro potvrzovací dialog hromadného zrušení. Právě běžící
// rezervace se záměrně nevrací — nejde ji hromadně zrušit (člověk je s autem venku).
async function getFutureBookings(req, res) {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ message: 'Neplatné ID vozidla.' });

  try {
    const vehicle = await prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle) return res.status(404).json({ message: 'Vozidlo nenalezeno.' });

    const bookings = await prisma.booking.findMany({
      where: { vehicleId: id, dateFrom: { gt: new Date() } },
      select: {
        id: true, dateFrom: true, dateTo: true, purpose: true,
        user: { select: { firstName: true, lastName: true } },
      },
      orderBy: { dateFrom: 'asc' },
    });
    return res.json(bookings);
  } catch (err) {
    console.error('getFutureBookings error:', err);
    return res.status(500).json({ message: 'Chyba serveru při načítání rezervací.' });
  }
}

// POST /api/vehicles/:id/bookings/cancel-future — admin only, { ids: [...] }.
// Zruší JEN rezervace z předaného seznamu (průnik s vehicleId a dateFrom > now)
// — rezervace vzniklé mezi zobrazením dialogu a potvrzením se nedotknou,
// běžící a minulé taky ne. Vlastníkům jde 1 souhrnný mail (fire-and-forget).
async function cancelFutureBookings(req, res) {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ message: 'Neplatné ID vozidla.' });

  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0 || ids.some(x => !Number.isInteger(x))) {
    return res.status(400).json({ message: 'Chybí seznam ID rezervací ke zrušení.' });
  }

  try {
    const vehicle = await prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle) return res.status(404).json({ message: 'Vozidlo nenalezeno.' });

    const where = { id: { in: ids }, vehicleId: id, dateFrom: { gt: new Date() } };
    // Vzor z deleteBooking hromadně: vlastníci se čtou PŘED smazáním; obě
    // operace v transakci (stejné where) — buď se zruší celý průnik, nebo nic.
    const [toCancel, deleted] = await prisma.$transaction([
      prisma.booking.findMany({
        where,
        include: { user: { select: { email: true, firstName: true, lastName: true } } },
      }),
      prisma.booking.deleteMany({ where }),
    ]);

    // Auditní stopa (Railway logy): kdo, které auto, které rezervace
    console.log(
      `[Audit] Hromadné zrušení: ${req.user.email} zrušil ${deleted.count} rezervací ` +
      `vozidla "${vehicle.name}" (id ${id}): [${toCancel.map(b => b.id).join(', ')}]`
    );

    // 1 mail na vlastníka se seznamem jeho zrušených rezervací; až po commitu,
    // fire-and-forget — selhání mailu nesmí shodit request
    const byOwner = new Map();
    for (const b of toCancel) {
      if (!byOwner.has(b.user.email)) byOwner.set(b.user.email, { owner: b.user, bookings: [] });
      byOwner.get(b.user.email).bookings.push(b);
    }
    for (const { owner, bookings } of byOwner.values()) {
      sendBookingsBulkCancelled(owner.email, owner.firstName, vehicle, bookings).catch(err =>
        console.warn('[Email] sendBookingsBulkCancelled selhalo:', err.message)
      );
    }

    return res.json({ cancelled: deleted.count });
  } catch (err) {
    console.error('cancelFutureBookings error:', err);
    return res.status(500).json({ message: 'Chyba serveru při hromadném rušení rezervací.' });
  }
}

// GET /api/vehicles/:id — veřejné
async function getVehicle(req, res) {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ message: 'Neplatné ID vozidla.' });

  try {
    const vehicle = await prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle) return res.status(404).json({ message: 'Vozidlo nenalezeno.' });
    return res.json(vehicle);
  } catch (err) {
    console.error('getVehicle error:', err);
    return res.status(500).json({ message: 'Chyba serveru.' });
  }
}

// POST /api/vehicles — admin only
async function createVehicle(req, res) {
  const { name, plate, photoUrl, active, sortOrder } = req.body;
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ message: 'Název vozidla je povinný.' });
  }
  if (!plate || typeof plate !== 'string' || plate.trim().length === 0) {
    return res.status(400).json({ message: 'SPZ je povinná.' });
  }

  try {
    if (await plateTaken(plate.trim())) {
      return res.status(409).json({ message: 'Vozidlo s touto SPZ už existuje.' });
    }

    const vehicle = await prisma.vehicle.create({
      data: {
        name: name.trim(),
        plate: plate.trim(),
        photoUrl: photoUrl || null,
        active: active !== undefined ? Boolean(active) : true,
        sortOrder: sortOrder !== undefined ? parseInt(sortOrder, 10) : 0,
      },
    });
    return res.status(201).json(vehicle);
  } catch (err) {
    console.error('createVehicle error:', err);
    return res.status(500).json({ message: 'Chyba serveru při vytváření vozidla.' });
  }
}

// PUT /api/vehicles/:id — admin only
async function updateVehicle(req, res) {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ message: 'Neplatné ID vozidla.' });

  const { name, plate, photoUrl, active, sortOrder } = req.body;

  try {
    const existing = await prisma.vehicle.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: 'Vozidlo nenalezeno.' });

    const data = {};
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ message: 'Název vozidla nesmí být prázdný.' });
      }
      data.name = name.trim();
    }
    if (plate !== undefined) {
      if (typeof plate !== 'string' || plate.trim().length === 0) {
        return res.status(400).json({ message: 'SPZ nesmí být prázdná.' });
      }
      if (await plateTaken(plate.trim(), id)) {
        return res.status(409).json({ message: 'Vozidlo s touto SPZ už existuje.' });
      }
      data.plate = plate.trim();
    }
    if (photoUrl !== undefined) data.photoUrl = photoUrl || null;
    if (active !== undefined) data.active = Boolean(active);
    if (sortOrder !== undefined) data.sortOrder = parseInt(sortOrder, 10);

    // Vyřazení (active true→false) blokují budoucí rezervace — zůstaly by
    // platné, ale zmizely z UI (veřejný GET vyřazená auta skrývá).
    // Minulé rezervace ani obnovení (false→true) guard nemají.
    if (existing.active && data.active === false) {
      const futureCount = await prisma.booking.count({
        where: { vehicleId: id, dateTo: { gte: new Date() } },
      });
      if (futureCount > 0) {
        return res.status(409).json({
          message: `Nejprve zrušte ${futureCount} budoucích rezervací tohoto vozidla.`,
        });
      }
    }

    const updated = await prisma.vehicle.update({ where: { id }, data });
    return res.json(updated);
  } catch (err) {
    console.error('updateVehicle error:', err);
    return res.status(500).json({ message: 'Chyba serveru při úpravě vozidla.' });
  }
}

// DELETE /api/vehicles/:id — admin only, nelze smazat auto s rezervacemi
async function deleteVehicle(req, res) {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ message: 'Neplatné ID vozidla.' });

  try {
    const existing = await prisma.vehicle.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: 'Vozidlo nenalezeno.' });

    const bookingCount = await prisma.booking.count({ where: { vehicleId: id } });
    if (bookingCount > 0) {
      return res.status(409).json({
        message: `Vozidlo nelze smazat – má ${bookingCount} rezervaci/í. Nejprve smažte všechny rezervace tohoto vozidla.`,
      });
    }

    await prisma.vehicle.delete({ where: { id } });
    return res.status(204).send();
  } catch (err) {
    console.error('deleteVehicle error:', err);
    return res.status(500).json({ message: 'Chyba serveru při mazání vozidla.' });
  }
}

module.exports = {
  getVehicles,
  getVehiclesAdmin,
  getVehicle,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  getFutureBookings,
  cancelFutureBookings,
};
