import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { JwtService } from "@nestjs/jwt";
import { ProjectsController } from "../src/projects/projects.controller";
import { ProjectsService } from "../src/projects/projects.service";
import { ConfigurationTemplatesController } from "../src/configuration-templates/configuration-templates.controller";
import { ConfigurationTemplatesService } from "../src/configuration-templates/configuration-templates.service";
import { PrismaService } from "../src/prisma/prisma.service";
import {
  ProjectFileTrashStatus,
  ConfigurationTemplateStatus,
  ConfigurationTemplateVersionStatus,
} from "@prisma/client";

describe("file/template operation-specific OpenAPI", () => {
  let app: INestApplication;
  let doc: any;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ProjectsController, ConfigurationTemplatesController],
      providers: [
        ProjectsService,
        ConfigurationTemplatesService,
        PrismaService,
        JwtService,
      ].map((provide) => ({ provide, useValue: {} })),
    }).compile();
    app = module.createNestApplication();
    doc = SwaggerModule.createDocument(app, new DocumentBuilder().build());
  });
  afterAll(async () => {
    await app.close();
  });
  const schema = (route: string, method: string, status: string) =>
    doc.paths[route][method].responses[status].content["application/json"]
      .schema;
  it("publishes the exact deletion union, confirmed deletion, Trash and restoration", () => {
    const s = doc.components.schemas;
    expect(schema("/projects/{id}/files/delete", "post", "201").oneOf).toEqual([
      {
        $ref: "#/components/schemas/ProjectFileDeletionConfirmationResponseDto",
      },
      { $ref: "#/components/schemas/ProjectFileTrashedResponseDto" },
    ]);
    expect(
      s.ProjectFileDeletionConfirmationResponseDto.properties
        .confirmationRequired,
    ).toMatchObject({ type: "boolean", enum: [true] });
    expect(s.ProjectFileTrashedResponseDto.properties.trashed).toMatchObject({
      type: "boolean",
      enum: [true],
    });
    expect(
      schema(
        "/projects/{id}/files/delete-confirmations/{confirmationId}/confirm",
        "post",
        "201",
      ).$ref,
    ).toContain("ProjectFileTrashedResponseDto");
    expect(schema("/projects/{id}/trash", "get", "200").items.$ref).toContain(
      "ProjectTrashItemResponseDto",
    );
    expect(
      schema("/projects/{id}/trash/{trashId}/restore", "post", "201").$ref,
    ).toContain("ProjectTrashRestoredResponseDto");
    for (const field of ["restoredAt", "purgedAt"])
      expect(s.ProjectTrashItemResponseDto.properties[field]).toMatchObject({
        type: "string",
        format: "date-time",
        nullable: true,
      });
    expect(s.ProjectTrashItemResponseDto.required).toEqual(
      expect.arrayContaining([
        "restoredAt",
        "purgedAt",
        "isDirectory",
        "originalPath",
        "expiresAt",
      ]),
    );
    expect(s.ProjectTrashItemResponseDto.properties.status.enum).toEqual(
      Object.values(ProjectFileTrashStatus),
    );
    for (const privateField of [
      "trashPath",
      "leaseOwner",
      "leaseExpiresAt",
      "lastError",
    ])
      expect(s.ProjectTrashItemResponseDto.properties).not.toHaveProperty(
        privateField,
      );
  });
  it("requires operation identity and explicitly describes scoped journal readback", () => {
    const s = doc.components.schemas;
    expect(
      schema("/projects/{id}/trash/{trashId}", "get", "200").$ref,
    ).toContain("ProjectTrashOutcomeResponseDto");
    expect(
      schema("/projects/{id}/trash/{trashId}/restore", "post", "503").$ref,
    ).toContain("ApiErrorResponseDto");
    for (const field of [
      "recoveryToken",
      "sourceIdentity",
      "contentHash",
      "trashPath",
    ])
      expect(s.ProjectTrashOutcomeResponseDto.properties).not.toHaveProperty(
        field,
      );
    expect(s.ProjectTrashExecutionResponseDto.properties.state.enum).toContain(
      "UNKNOWN",
    );
    expect(s.DeleteProjectFileDto.required).toContain("operationId");
    expect(
      schema("/projects/{id}/file-operations/{operationId}", "get", "200").$ref,
    ).toContain("ProjectFileOperationResponseDto");
    expect(
      schema(
        "/projects/{id}/file-operations/{operationId}/reconcile",
        "post",
        "201",
      ).$ref,
    ).toContain("ProjectFileOperationResponseDto");
    expect(s.ProjectFileOperationResponseDto.properties.state.enum).toEqual([
      "AWAITING_CONFIRMATION",
      "PREPARED",
      "COMPLETED",
      "FAILED",
      "NEEDS_REPAIR",
    ]);
    for (const field of [
      "contentHash",
      "sourceIdentity",
      "trashPath",
      "actorId",
    ])
      expect(s.ProjectFileOperationResponseDto.properties).not.toHaveProperty(
        field,
      );
  });
  it("publishes distinct metadata and multipart size failures", () => {
    expect(
      schema("/projects/{id}/files/upload-configuration", "get", "200").$ref,
    ).toContain("ProjectUploadConfigurationResponseDto");
    expect(
      schema("/configuration-templates/upload-configuration", "get", "200")
        .$ref,
    ).toContain("TemplateUploadConfigurationResponseDto");
    const s = doc.components.schemas;
    expect(
      Object.keys(s.ProjectUploadConfigurationResponseDto.properties).sort(),
    ).toEqual(["maxUploadBytes", "requestMode"]);
    expect(
      Object.keys(s.TemplateUploadConfigurationResponseDto.properties).sort(),
    ).toEqual(["maxFileBytes", "maxVersionBytes", "requestMode"]);
    expect(
      s.TemplateUploadConfigurationResponseDto.properties.requestMode.enum,
    ).toEqual(["single-file"]);
    for (const route of [
      "/projects/{id}/files/upload",
      "/configuration-templates/versions/{versionId}/files",
    ])
      expect(doc.paths[route].post.responses).toHaveProperty("413");
  });
  it("types list, full history, scalar writes, manifest writes and files precisely", () => {
    const s = doc.components.schemas;
    expect(
      schema("/configuration-templates", "get", "200").items.$ref,
    ).toContain("ConfigurationTemplateListResponseDto");
    expect(
      s.ConfigurationTemplateListResponseDto.properties.versions.maxItems,
    ).toBe(2);
    expect(
      s.ConfigurationTemplateListResponseDto.properties.versions.items.$ref,
    ).toContain("TemplateVersionScalarResponseDto");
    expect(
      schema("/configuration-templates/{id}", "get", "200").$ref,
    ).toContain("ConfigurationTemplateDetailResponseDto");
    expect(
      s.ConfigurationTemplateDetailResponseDto.properties.versions.items.$ref,
    ).toContain("TemplateManifestResponseDto");
    expect(s.TemplateScalarResponseDto.properties.status.enum).toEqual(
      Object.values(ConfigurationTemplateStatus),
    );
    expect(s.TemplateVersionScalarResponseDto.properties.status.enum).toEqual(
      Object.values(ConfigurationTemplateVersionStatus),
    );
    expect(
      s.TemplateVersionScalarResponseDto.properties.publishedAt,
    ).toMatchObject({ type: "string", format: "date-time", nullable: true });
    expect(s.TemplateFileResponseDto.properties).not.toHaveProperty(
      "objectKey",
    );
    expect(
      Object.keys(s.TemplateDepartmentResponseDto.properties).sort(),
    ).toEqual(["id", "name", "slug"]);
    for (const [route, method, status, type] of [
      [
        "/configuration-templates",
        "post",
        "201",
        "ConfigurationTemplateCreatedResponseDto",
      ],
      [
        "/configuration-templates/{id}",
        "patch",
        "200",
        "TemplateScalarResponseDto",
      ],
      [
        "/configuration-templates/{id}/archive",
        "post",
        "201",
        "TemplateScalarResponseDto",
      ],
      [
        "/configuration-templates/{id}/drafts",
        "post",
        "201",
        "TemplateManifestResponseDto",
      ],
      [
        "/configuration-templates/versions/{versionId}/manifest",
        "put",
        "200",
        "TemplateManifestResponseDto",
      ],
      [
        "/configuration-templates/versions/{versionId}/publish",
        "post",
        "201",
        "TemplateManifestResponseDto",
      ],
      [
        "/configuration-templates/versions/{versionId}/files",
        "post",
        "201",
        "TemplateFileMutationResponseDto",
      ],
      [
        "/configuration-templates/versions/{versionId}/files/{fileId}",
        "patch",
        "200",
        "TemplateFileMutationResponseDto",
      ],
      [
        "/configuration-templates/versions/{versionId}/files/{fileId}",
        "delete",
        "200",
        "TemplateFileRemovedResponseDto",
      ],
    ] as const)
      expect(schema(route, method, status).$ref).toContain(type);
    expect(s.TemplateManifestResponseDto.required).toEqual(
      expect.arrayContaining(["files", "folders", "commandStages"]),
    );
    expect(s.TemplateCommandResponseDto.properties.arguments).toMatchObject({
      type: "array",
      nullable: true,
      items: { type: "string" },
    });
    expect(s.ApiIssueResponseDto.properties).toHaveProperty("location");
    expect(
      doc.paths["/configuration-templates/versions/{versionId}/publish"].post
        .responses,
    ).toHaveProperty("503");
  });
});
