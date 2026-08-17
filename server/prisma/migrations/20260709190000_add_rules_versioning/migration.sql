-- Verzování pravidel používání vozidla: text se stěhuje z kódu
-- (client/src/content/vehicleRules.js) do DB, potvrzení se váže na verzi.

-- CreateTable: append-only znění pravidel (id = číslo verze)
CREATE TABLE "RulesVersion" (
    "id" SERIAL NOT NULL,
    "sections" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,

    CONSTRAINT "RulesVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable: append-only historie potvrzení
CREATE TABLE "RulesAcceptance" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RulesAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RulesAcceptance_userId_version_key" ON "RulesAcceptance"("userId", "version");

-- AddForeignKey
ALTER TABLE "RulesVersion" ADD CONSTRAINT "RulesVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RulesAcceptance" ADD CONSTRAINT "RulesAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: verze potvrzená uživatelem (rychlá cache vedle rulesAcceptedAt)
ALTER TABLE "User" ADD COLUMN "rulesAcceptedVersion" INTEGER;

-- Seed verze 1 = dosavadní znění z client/src/content/vehicleRules.js
-- (bez explicitního id, ať zůstane sekvence v souladu)
INSERT INTO "RulesVersion" ("sections", "createdAt") VALUES ('[
  {
    "id": "vyzvednuti",
    "title": "Vyzvednutí a vrácení vozidla",
    "items": [
      "Vozidlo je vždy k vyzvednutí na svém parkovacím místě: Škoda Scala v ulici Štefánikova (kde je zrovna volno), dodávka MAN na stálém místě naproti firmě.",
      "Po ukončení jízdy musí být vozidlo vráceno na stejné místo, odkud bylo vyzvednuto.",
      "Klíče od vozidla jsou uloženy v trezoru na firmě ForTool-technologies, umístěném za hlavním vchodem do budovy.",
      "Zaměstnanci, kteří mají klíče od vchodu, si klíče od vozidla vyzvedávají a vrací sami.",
      "Ostatní zaměstnanci se domluví na vyzvednutí s HR oddělením."
    ]
  },
  {
    "id": "rezervace",
    "title": "Rezervace vozidla",
    "items": [
      "Před použitím vozidla je nutné jej předem zarezervovat prostřednictvím rezervačního systému.",
      "Rezervace musí obsahovat: jméno řidiče, datum a čas výpůjčky, předpokládanou dobu vrácení a účel cesty."
    ]
  },
  {
    "id": "ridic",
    "title": "Kdo může vozidlo řídit",
    "items": [
      "Vozidlo smí řídit pouze zaměstnanec s platným řidičským oprávněním příslušné skupiny.",
      "Vozidlo je určeno výhradně k pracovním/služebním účelům, není-li výslovně schváleno jinak."
    ]
  },
  {
    "id": "stav",
    "title": "Stav vozidla při převzetí",
    "items": [
      "Řidič je povinen před jízdou zkontrolovat stav vozidla (viditelná poškození, stav paliva, čistota interiéru).",
      "Jakékoli závady nebo poškození nahlásí ihned odpovědné osobě, ještě před zahájením jízdy."
    ]
  },
  {
    "id": "tankovani",
    "title": "Tankování a provoz",
    "items": [
      "Pokud stav pohonných hmot klesne pod 1/4 nádrže, je řidič povinen vozidlo dotankovat tak, aby jej mohl bez problémů převzít další uživatel.",
      "Tankuje se na firemní tankovací kartu; PIN ke kartě sdělí HR oddělení.",
      "Doklady o tankování (účtenky) se odevzdávají odpovědné osobě k evidenci."
    ]
  },
  {
    "id": "kniha-jizd",
    "title": "Kniha jízd",
    "items": [
      "Kniha jízd je vedena elektronicky.",
      "Uživatel vozidla je po nastartování povinen zaevidovat jízdu pomocí čipu, který je umístěn u klíčků od vozidla.",
      "Záznam slouží k evidenci nákladů a kontrole využití vozidla."
    ]
  },
  {
    "id": "nehody",
    "title": "Dopravní nehody a pokuty",
    "items": [
      "Při dopravní nehodě řidič postupuje dle standardního postupu (zavolá policii, pokud je to nutné, pořídí fotodokumentaci, kontaktuje odpovědnou osobu).",
      "Pokuty za dopravní přestupky způsobené řidičem hradí řidič, který vozidlo v danou dobu užíval."
    ]
  },
  {
    "id": "zakazy",
    "title": "Zákazy",
    "items": [
      "Ve vozidle je zakázáno kouřit.",
      "Je zakázáno používat vozidlo pod vlivem alkoholu nebo jiných návykových látek."
    ]
  },
  {
    "id": "odpovednost",
    "title": "Odpovědnost",
    "items": [
      "Řidič odpovídá za škody způsobené nedodržením těchto pravidel nebo nesprávným zacházením s vozidlem.",
      "Za běžné opotřebení vozidla řidič neodpovídá."
    ]
  }
]'::jsonb, NOW());

-- Backfill: kdo už potvrdil, potvrdil právě toto znění → verze 1.
-- Nemusí potvrzovat znovu (text se nemění, jen stěhuje do DB).
UPDATE "User" SET "rulesAcceptedVersion" = 1 WHERE "rulesAcceptedAt" IS NOT NULL;

INSERT INTO "RulesAcceptance" ("userId", "version", "acceptedAt")
SELECT "id", 1, "rulesAcceptedAt" FROM "User" WHERE "rulesAcceptedAt" IS NOT NULL;
