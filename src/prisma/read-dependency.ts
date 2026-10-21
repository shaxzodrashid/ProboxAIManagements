import { operationError } from "../openapi/operation-errors";
import { isPrismaAvailabilityFailure } from "./dependency-errors";

/** Read-only boundary. Never use this to classify a mutation's commit outcome. */
export async function readDependency<T>(
  action: string,
  read: () => PromiseLike<T> | T,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (isPrismaAvailabilityFailure(error))
      throw operationError(
        503,
        "READ_DEPENDENCY_UNAVAILABLE",
        "Requested data is temporarily unavailable",
        action,
      );
    throw error;
  }
}
