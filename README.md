# Rezervační systém firemních vozidel

Interní webová aplikace pro rezervaci firemních aut. Zaměstnanec vidí, kdo má vůz právě teď a kdy bude volný, rezervuje si ho na konkrétní čas a systém hlídá, aby nevznikaly kolize. Admin schvaluje registrace, spravuje vozový park a pravidla používání.

Celý produkt — od datového modelu po nasazení — vznikl jako jednorázový projekt pro firmu o zhruba deseti lidech. Uživatelské rozhraní je česky.

## Stack

| Vrstva | Technologie |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS v4 |
| Backend | Node.js, Express 5 |
| Databáze | PostgreSQL, Prisma ORM |
| Autentizace | JWT (Bearer), bcrypt |
| E-maily | Resend |

## Co umí

**Rezervace**
- Více vozidel, přepínání kartami s živým stavem („volná do 16:00" / „má ji Novák, vrátí 14:30")
- Detektor kolizí na úrovni API — dvě rezervace se nemohou překrýt; při konfliktu vrátí nejbližší volný termín
- Kalendář ve třech podobách: měsíční mřížka, hodinový týdenní pohled s bloky, a na mobilu pás dnů s agendou
- Vícedenní rezervace se v kalendáři kreslí jako propojené denní segmenty
- Historie posledních tří měsíců je vidět, ale jen ke čtení
- Probíhající rezervaci lze prodloužit (mění se konec, začátek je zamčený)

**Provoz**
- Registrace vyžaduje schválení adminem; e-mailové notifikace ve všech krocích (přijetí žádosti, schválení, potvrzení rezervace, úprava, zrušení)
- Pravidla používání vozidla s verzováním — admin je edituje z UI, publikace nové verze vyžádá opětovné potvrzení od všech uživatelů a potvrzení se ukládá s časem jako doklad
- Admin správa vozidel: přidání, úprava, vyřazení z provozu i hromadné zrušení budoucích rezervací (s e-mailem vlastníkům)
- Aktualizace bez refreshe — polling s pauzou při otevřeném formuláři a na skryté záložce
- Bezpečnostní hlavičky včetně Content-Security-Policy (hodnocení A+ na securityheaders.com)

## Vzhled

Vlastní vizuální systém postavený na dvou barvách — azurové `#00A8D6` a tmavě navy `#0C1B2A` — a dvou písmech: Space Grotesk pro text a IBM Plex Mono pro časy, SPZ a štítky. Všechny tokeny žijí v jednom `@theme` bloku v Tailwindu, takže změna barvy je změna jednoho řádku.

Mobil není samostatná větev renderu. Stránka má jedno DOM a do mobilní podoby se přelévá čistě přes CSS — z dropdownu se stane bottom sheet, z měsíční mřížky pás dnů s agendou, akční lišta se změní ve fixní tlačítko u spodní hrany. Žádné `if (isMobile)`, tedy ani riziko, že se komponenta při změně šířky přemountuje a ztratí stav.

## Architektura

```
client/                  React SPA
  src/pages/             Dashboard (kalendář, kniha, modaly), admin stránky, auth
  src/components/        Sdílené komponenty (modal pravidel, auth, wordmark)
  src/context/           AuthContext — token a uživatel v localStorage
  src/api/axios.js       Instance s Bearer interceptorem

server/                  Express API
  controllers/           auth, bookings, vehicles, rules, admin
  routes/                Rate limity a guardy (authenticate, requireAdmin)
  middleware/auth.js     Ověření JWT
  services/              E-mailové šablony
  prisma/                Schéma a migrace
  smoke-test.js          Zhruba padesát API kontrol proti lokální databázi
```

Několik rozhodnutí, která stojí za zmínku:

- **Autorizace se čte z databáze, ne z tokenu.** JWT platí dny, takže stav jako „potvrdil aktuální verzi pravidel" by v něm zastaral. Kontroly proto sahají do DB.
- **Verze pravidel jsou append-only.** Staré znění se nikdy nemaže — bez něj by časové razítko potvrzení nemělo důkazní hodnotu.
- **Klient filtruje rezervace podle vozidla sám.** Jeden dotaz místo dvou; server vrací celou flotilu, protože stavy karet stejně potřebují všechna auta.
- **Odpovědi, které dorazí pozdě, se zahazují.** Přepnutí vozidla nebo otevření formuláře zvedne čítač epochy a starší doběhnutí svůj výsledek neuloží.

## Lokální spuštění

Potřeba: Node.js 20.19+, PostgreSQL.

```bash
# databáze
createdb fortool_local

# backend
cd server
cp .env.example .env          # vyplň DATABASE_URL, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm install
npx prisma migrate deploy
npx prisma db seed            # založí admin účet z proměnných v .env
npm run dev                   # http://localhost:3001

# frontend
cd ../client
npm install
npm run dev                   # http://localhost:5173, /api se proxuje na backend
```

E-maily se bez `RESEND_API_KEY` neodesílají — aplikace jen zaloguje varování a běží dál.

```bash
cd server && npm run smoke    # API smoke test (jen proti lokální databázi)
```

## Licence

MIT — viz [LICENSE](LICENSE).
