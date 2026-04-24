-- CreateTable
CREATE TABLE "Setting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "closingDay" INTEGER NOT NULL DEFAULT 25,
    "break1Threshold" INTEGER NOT NULL DEFAULT 360,
    "break1Minutes" INTEGER NOT NULL DEFAULT 45,
    "break2Threshold" INTEGER NOT NULL DEFAULT 480,
    "break2Minutes" INTEGER NOT NULL DEFAULT 60,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);
