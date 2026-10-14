import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateUserDto } from "../src/accounts/accounts.dto";

describe("structured creation DTO", () => {
  it.each([
    { firstName: "A" },
    { lastName: "de la Cruz" },
    { firstName: "Mary Jane", lastName: "de la Cruz" },
    { fullName: "Legacy Multi Word" },
  ])("accepts independent names or legacy fullName %j", async (names) => {
    const dto = plainToInstance(CreateUserDto, {
      ...names,
      phoneNumber: "+998901234567",
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });
  it.each([
    { firstName: null },
    { lastName: null },
    { firstName: " " },
    { lastName: 42 },
    { firstName: "x".repeat(121) },
    { fullName: null },
  ])("rejects invalid creation components %j", async (names) => {
    const dto = plainToInstance(CreateUserDto, {
      ...names,
      phoneNumber: "+998901234567",
    });
    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });
});
