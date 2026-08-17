-- Přidání sloupce pro jednorázové potvrzení pravidel použití vozidla.
-- Aditivní změna: nullable, bez backfillu — NULL = uživatel dosud nepotvrdil.
ALTER TABLE "User" ADD COLUMN "rulesAcceptedAt" TIMESTAMP(3);
