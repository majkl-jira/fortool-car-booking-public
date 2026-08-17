const prisma = require('../lib/prisma');

const MAX_SECTIONS = 30;
const MAX_ITEMS    = 30;

// Aktuální verze = řádek s nejvyšším id (append-only tabulka)
async function currentVersion() {
  return prisma.rulesVersion.findFirst({ orderBy: { id: 'desc' } });
}

// GET /api/rules — přihlášený uživatel: aktuální znění pravidel
async function getRules(req, res) {
  try {
    const current = await currentVersion();
    if (!current) return res.status(404).json({ message: 'Pravidla zatím nebyla publikována.' });
    return res.json({ version: current.id, sections: current.sections, createdAt: current.createdAt });
  } catch (err) {
    console.error('getRules error:', err);
    return res.status(500).json({ message: 'Chyba serveru při načítání pravidel.' });
  }
}

// Validace tvaru [{ id, title, items: [...] }] — žádná prázdná sekce ani odrážka
function validateSections(sections) {
  if (!Array.isArray(sections) || sections.length === 0) {
    return 'Pravidla musí mít alespoň jednu sekci.';
  }
  if (sections.length > MAX_SECTIONS) {
    return `Pravidla mohou mít nejvýše ${MAX_SECTIONS} sekcí.`;
  }
  for (const [i, s] of sections.entries()) {
    if (!s || typeof s !== 'object') return `Sekce ${i + 1} má neplatný formát.`;
    if (typeof s.title !== 'string' || s.title.trim().length === 0) {
      return `Sekce ${i + 1}: nadpis nesmí být prázdný.`;
    }
    if (!Array.isArray(s.items) || s.items.length === 0) {
      return `Sekce „${s.title.trim()}“ musí mít alespoň jednu odrážku.`;
    }
    if (s.items.length > MAX_ITEMS) {
      return `Sekce „${s.title.trim()}“ může mít nejvýše ${MAX_ITEMS} odrážek.`;
    }
    if (s.items.some(it => typeof it !== 'string' || it.trim().length === 0)) {
      return `Sekce „${s.title.trim()}“ obsahuje prázdnou odrážku.`;
    }
  }
  return null;
}

// POST /api/rules — admin: publikace nové verze (nikdy nepřepisuje starou)
async function publishRules(req, res) {
  const { sections } = req.body;

  const error = validateSections(sections);
  if (error) return res.status(400).json({ message: error });

  const clean = sections.map((s, i) => ({
    id: (typeof s.id === 'string' && s.id.trim()) ? s.id.trim() : `sekce-${i + 1}`,
    title: s.title.trim(),
    items: s.items.map(it => it.trim()),
  }));

  try {
    const created = await prisma.rulesVersion.create({
      data: { sections: clean, createdById: req.user.id },
    });
    console.log(`[Audit] Pravidla: ${req.user.email} publikoval verzi ${created.id} (${clean.length} sekcí)`);
    return res.status(201).json({ version: created.id, sections: created.sections, createdAt: created.createdAt });
  } catch (err) {
    console.error('publishRules error:', err);
    return res.status(500).json({ message: 'Chyba serveru při publikaci pravidel.' });
  }
}

module.exports = { getRules, publishRules, currentVersion };
