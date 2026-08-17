-- CreateTable
CREATE TABLE "Vehicle" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "photoUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- Vložení prvního vozidla (Škoda Scala)
INSERT INTO "Vehicle" ("name", "plate", "active", "sortOrder", "createdAt")
VALUES ('Škoda Scala', '0X0 0000', true, 0, NOW());

-- AlterTable (bezpečné i s existujícími rezervacemi)
ALTER TABLE "Booking" ADD COLUMN "vehicleId" INTEGER;
UPDATE "Booking" SET "vehicleId" = (SELECT MIN(id) FROM "Vehicle") WHERE "vehicleId" IS NULL;
ALTER TABLE "Booking" ALTER COLUMN "vehicleId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
