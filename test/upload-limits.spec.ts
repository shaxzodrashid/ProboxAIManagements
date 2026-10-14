import { ProjectsService } from "../src/projects/projects.service";
import { ConfigurationTemplatesService } from "../src/configuration-templates/configuration-templates.service";

describe("effective configured upload boundaries", () => {
  const keys = [
    "PROBOXAI_PROJECT_UPLOAD_MAX_BYTES",
    "PROBOXAI_TEMPLATE_FILE_MAX_BYTES",
    "PROBOXAI_TEMPLATE_TOTAL_MAX_BYTES",
  ];
  const prior = keys.map((key) => process.env[key]);
  afterAll(() =>
    keys.forEach((key, index) => {
      if (prior[index] === undefined) delete process.env[key];
      else process.env[key] = prior[index];
    }),
  );
  it.each([
    undefined,
    "",
    "0",
    "-1",
    "1.5",
    "NaN",
    "Infinity",
    "9007199254740992",
  ])("falls back safely for invalid configuration %s", (value) => {
    keys.forEach((key) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    expect(ProjectsService.maxUploadBytes()).toBe(100 * 1024 * 1024);
    expect(ConfigurationTemplatesService.maxFileBytes()).toBe(
      100 * 1024 * 1024,
    );
    expect(ConfigurationTemplatesService.maxVersionBytes()).toBe(
      1024 * 1024 * 1024,
    );
  });
  it.each(["1", "1073741824", "1073741825", "9007199254740991"])(
    "caps positive safe integer configuration %s",
    (value) => {
      keys.forEach((key) => {
        process.env[key] = value;
      });
      for (const actual of [
        ProjectsService.maxUploadBytes(),
        ConfigurationTemplatesService.maxFileBytes(),
        ConfigurationTemplatesService.maxVersionBytes(),
      ])
        expect(actual).toBe(Math.min(Number(value), 1024 * 1024 * 1024));
    },
  );
  it("keeps project, template-file and template-total values distinct", () => {
    keys.forEach((key, index) => {
      process.env[key] = String(index + 7);
    });
    expect(ProjectsService.maxUploadBytes()).toBe(7);
    expect(ConfigurationTemplatesService.maxFileBytes()).toBe(8);
    expect(ConfigurationTemplatesService.maxVersionBytes()).toBe(9);
  });
});
