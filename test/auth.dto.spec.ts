import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  AuthLocale,
  RegisterDto,
  RequestOtpDto,
  UsernameDto,
} from "../src/auth/auth.dto";

describe("authentication DTO validation", () => {
  it("accepts only the explicit UZ, RU, and EN locale enum", async () => {
    const valid = plainToInstance(RequestOtpDto, {
      phoneNumber: "+998901234567",
      locale: AuthLocale.UZ,
    });
    const invalid = plainToInstance(RequestOtpDto, {
      phoneNumber: "+998901234567",
      locale: "uz",
    });
    await expect(validate(valid)).resolves.toHaveLength(0);
    await expect(validate(invalid)).resolves.not.toHaveLength(0);
  });

  it("normalizes valid usernames and rejects invalid shapes", async () => {
    const valid = plainToInstance(UsernameDto, { username: "  Ada.Lovelace " });
    const invalid = plainToInstance(UsernameDto, { username: "42 invalid" });
    await expect(validate(valid)).resolves.toHaveLength(0);
    expect(valid.username).toBe("ada.lovelace");
    await expect(validate(invalid)).resolves.not.toHaveLength(0);
  });

  it("requires a 12-character password with all four character classes", async () => {
    const strong = plainToInstance(RegisterDto, {
      username: "ada.lovelace",
      password: "Secure-Platform-42!",
      passwordConfirmation: "Secure-Platform-42!",
    });
    const weak = plainToInstance(RegisterDto, {
      username: "ada.lovelace",
      password: "alllowercasepassword",
      passwordConfirmation: "alllowercasepassword",
    });
    await expect(validate(strong)).resolves.toHaveLength(0);
    await expect(validate(weak)).resolves.not.toHaveLength(0);
  });
});
