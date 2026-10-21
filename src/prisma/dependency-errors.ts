import { Prisma } from "@prisma/client";

// Prisma6 connection/configuration, timeout and connection-pool failures only.
// Constraints, query/schema defects and unknown errors are not availability signals.
const unavailableCodes = new Set([
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
]);

export function isPrismaAvailabilityFailure(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientInitializationError ||
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      unavailableCodes.has(error.code))
  );
}
