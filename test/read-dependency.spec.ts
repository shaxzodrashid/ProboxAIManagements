import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { readDependency } from "../src/prisma/read-dependency";

describe("read-only availability boundary", () => {
  const unavailable = [
    "P1000",
    "P1001",
    "P1002",
    "P1003",
    "P1008",
    "P1010",
    "P1011",
    "P1017",
    "P2024",
    "P2037",
  ];
  it.each(unavailable)(
    "sanitizes infrastructure code%s and never retries",
    async (code) => {
      const operation = jest
        .fn()
        .mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError(
            "private connection details",
            { code, clientVersion: "fixture", meta: { host: "private" } },
          ),
        );
      const error = await readDependency("readFixture", operation).catch(
        (value) => value,
      );
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(error.getResponse()).toEqual({
        statusCode: 503,
        error: "Service Unavailable",
        message: "Requested data is temporarily unavailable",
        code: "READ_DEPENDENCY_UNAVAILABLE",
        action: "readFixture",
      });
      expect(operation).toHaveBeenCalledTimes(1);
    },
  );
  it("sanitizes client initialization failure including synchronous throws", async () => {
    const error = new Prisma.PrismaClientInitializationError(
      "private connection",
      "fixture",
    );
    await expect(
      readDependency("readFixture", () => {
        throw error;
      }),
    ).rejects.toMatchObject({ status: 503 });
  });
  it.each(["P2002", "P2003", "P2025", "P2028", "P2034", "P2021"])(
    "preserves non-availability Prisma code%s",
    async (code) => {
      const error = new Prisma.PrismaClientKnownRequestError("fixture", {
        code,
        clientVersion: "fixture",
      });
      await expect(
        readDependency("readFixture", () => Promise.reject(error)),
      ).rejects.toBe(error);
    },
  );
  it.each([
    new BadRequestException(),
    new ForbiddenException(),
    new NotFoundException(),
    new ConflictException(),
    new ServiceUnavailableException("already classified"),
    new TypeError("programming defect"),
    new Error("unknown"),
  ])("preserves existing failure identity%s", async (error) => {
    await expect(
      readDependency("readFixture", () => Promise.reject(error)),
    ).rejects.toBe(error);
  });
  it("preserves actual empty/null reads rather than inventing data", async () => {
    expect(await readDependency("readFixture", () => null)).toBeNull();
    expect(
      await readDependency("readFixture", () => Promise.resolve([])),
    ).toEqual([]);
  });
});
