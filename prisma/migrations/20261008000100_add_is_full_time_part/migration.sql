-- フルタイムパート（半日有給を取れるパート）。既定は false
ALTER TABLE "User" ADD COLUMN "isFullTimePart" BOOLEAN NOT NULL DEFAULT false;
