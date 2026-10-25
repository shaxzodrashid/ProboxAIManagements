-- Session-bound verification only; no OTP login or registration/reset grant reuse.
ALTER TABLE "BrowserSession" ADD COLUMN "stepUpOtpHash" TEXT;
ALTER TABLE "BrowserSession" ADD COLUMN "stepUpOtpExpiresAt" TIMESTAMP(3);
ALTER TABLE "BrowserSession" ADD COLUMN "stepUpOtpAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BrowserSession" ADD COLUMN "stepUpOtpWindowAt" TIMESTAMP(3);
ALTER TABLE "BrowserSession" ADD COLUMN "stepUpOtpSentCount" INTEGER NOT NULL DEFAULT 0;
