import { audienceAllows } from "../src/accounts/profile-audience";
import { validBirthDate } from "../src/accounts/profile-birthday";
import { ProfilePrivacyService } from "../src/accounts/profile-privacy.service";
import { Prisma } from "@prisma/client";
import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
describe("audience evaluator", () => {
  const viewer = { id: "B", workspaceId: "W" };
  const policy = (mode: string) => ({
    mode,
    accountRecipients: [{ accountId: "B" }],
    workspaceRecipients: [{ workspaceId: "W" }],
  });
  it("fails closed for missing/unknown/private modes, including owners", () => {
    for (const p of [undefined, policy("NO_ONE"), policy("future")])
      expect(audienceAllows(p, viewer, true)).toBe(false);
  });
  it("Everyone includes anonymous viewers; other grants require identity", () => {
    expect(audienceAllows(policy("EVERYONE"), null, false)).toBe(true);
    for (const mode of ["CONTACTS", "CUSTOM"])
      expect(audienceAllows(policy(mode), null, true)).toBe(false);
  });
  it("Contacts is owner directed and Custom is a union", () => {
    expect(audienceAllows(policy("CONTACTS"), viewer, false)).toBe(false);
    expect(audienceAllows(policy("CONTACTS"), viewer, true)).toBe(true);
    expect(
      audienceAllows(
        policy("CUSTOM"),
        { ...viewer, workspaceId: "other" },
        false,
      ),
    ).toBe(true);
    expect(
      audienceAllows(policy("CUSTOM"), { ...viewer, id: "other" }, false),
    ).toBe(true);
    expect(
      audienceAllows(
        policy("CUSTOM"),
        { id: "other", workspaceId: "other" },
        true,
      ),
    ).toBe(false);
  });
});
describe("calendar birthday validation without age assumptions", () => {
  it.each([
    "2000-02-29",
    "0001-01-01",
    "0099-12-31",
    "9999-12-31",
    "2030-10-11",
  ])("accepts %s", (value) => expect(validBirthDate(value)).toBe(true));
  it.each([
    "1900-02-29",
    "2025-02-29",
    "2026-04-31",
    "0000-01-01",
    "2026-1-01",
    "2026-01-01T00:00:00Z",
    "",
    1,
    null,
  ])("rejects %s", (value) => expect(validBirthDate(value)).toBe(false));
});

describe("privacy transaction failure handling", () => {
  it("never returns a permissive projection on a database read failure", async () => {
    const service = new ProfilePrivacyService(
      {
        $transaction: jest
          .fn()
          .mockRejectedValue(new Error("private connection details")),
      } as any,
      {} as any,
    );
    await expect(service.project("owner", "viewer")).rejects.toThrow(
      ServiceUnavailableException,
    );
    await expect(service.project("owner")).rejects.not.toThrow(
      "private connection details",
    );
  });
  it("maps a serialization conflict to reread guidance without automatic replay", async () => {
    const transaction = jest.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("private query", {
        code: "P2034",
        clientVersion: "test",
      }),
    );
    const service = new ProfilePrivacyService(
      {
        $transaction: transaction,
      } as any,
      {} as any,
    );
    await expect(
      service.removeContact("workspace", "owner", "viewer"),
    ).rejects.toThrow(ConflictException);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });
});
