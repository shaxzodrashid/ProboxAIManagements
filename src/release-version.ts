/** Public release metadata only; route compatibility remains /api/v1. */
export const backendReleaseVersion: string = (
  require("../package.json") as { version: string }
).version;
