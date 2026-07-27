import { AuthOtpPurpose } from "@prisma/client";
import { AuthLocale } from "../src/auth/auth.dto";
import { otpMessage } from "../src/telegram/telegram.service";

describe("localized Telegram OTP messages", () => {
  it.each([AuthLocale.UZ, AuthLocale.RU, AuthLocale.EN])(
    "hides the %s registration code under a Telegram spoiler and states one minute",
    (locale) => {
      const message = otpMessage(locale, AuthOtpPurpose.REGISTRATION, "123456");
      expect(message).toContain("<tg-spoiler>123456</tg-spoiler>");
      expect(message).toMatch(/1/);
      expect(message).not.toMatch(/5 minutes|5 минут|5 daqiqa/);
    },
  );

  it("uses reset-specific copy", () => {
    expect(
      otpMessage(AuthLocale.EN, AuthOtpPurpose.PASSWORD_RESET, "123456"),
    ).toContain("resetting your ProboxAI password");
  });
});
