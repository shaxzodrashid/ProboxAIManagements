import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { JwtService } from "@nestjs/jwt";
import { AuthorizationController } from "../src/authorization/authorization.controller";
import { AuthorizationService } from "../src/authorization/authorization.service";
import { AccountsController } from "../src/accounts/accounts.controller";
import { AccountsService } from "../src/accounts/accounts.service";
import { DepartmentsController } from "../src/departments/departments.controller";
import { DepartmentsService } from "../src/departments/departments.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { TelegramService } from "../src/telegram/telegram.service";
import { TelegramBotService } from "../src/telegram/telegram-bot.service";

describe("admin/department operation OpenAPI", () => {
  let app: INestApplication;
  let doc: any;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        AuthorizationController,
        AccountsController,
        DepartmentsController,
      ],
      providers: [
        AuthorizationService,
        AccountsService,
        DepartmentsService,
        PrismaService,
        JwtService,
        TelegramService,
        TelegramBotService,
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
  it("preserves 201 ban/default/archive and separates home provisioning results", () => {
    expect(schema("/users/{id}/ban", "post", "201").$ref).toContain(
      "UserResponseDto",
    );
    for (const action of ["default", "archive"]) {
      expect(
        schema(`/departments/{id}/${action}`, "post", "201").$ref,
      ).toContain("DepartmentResponseDto");
      expect(
        doc.paths[`/departments/{id}/${action}`].post.responses,
      ).not.toHaveProperty("200");
    }
    expect(schema("/departments", "post", "201").$ref).toContain(
      "DepartmentHomeProvisioningResponseDto",
    );
    expect(schema("/departments/{id}", "patch", "200").$ref).toContain(
      "DepartmentHomeProvisioningResponseDto",
    );
    const s = doc.components.schemas;
    expect(s.DepartmentResponseDto.properties).not.toHaveProperty(
      "homeCreated",
    );
    expect(s.DepartmentResponseDto.properties.isDefault.type).toBe("boolean");
    expect(
      s.DepartmentHomeProvisioningResponseDto.properties.homeCreated.type,
    ).toBe("boolean");
    for (const field of ["createdAt", "updatedAt"])
      expect(s.DepartmentResponseDto.properties[field]).toMatchObject({
        type: "string",
        format: "date-time",
      });
  });
  it("documents role timestamps, scalar deletion and assignment summaries", () => {
    const s = doc.components.schemas;
    for (const dto of [
      "RoleResponseDto",
      "PermissionResponseDto",
      "DeletedRoleResponseDto",
    ]) {
      for (const field of ["createdAt", "updatedAt"])
        expect(s[dto].properties[field]).toMatchObject({
          type: "string",
          format: "date-time",
        });
      expect(s[dto].required).toEqual(
        expect.arrayContaining(["createdAt", "updatedAt"]),
      );
    }
    expect(s.RoleResponseDto.properties.description).toMatchObject({
      type: "string",
      nullable: true,
    });
    expect(s.DeletedRoleResponseDto.properties).not.toHaveProperty(
      "permissions",
    );
    expect(s.DeletedRoleResponseDto.properties).not.toHaveProperty("userCount");
    expect(schema("/authorization/roles/{id}", "delete", "200").$ref).toContain(
      "DeletedRoleResponseDto",
    );
    expect(schema("/authorization/roles/{id}", "patch", "200").$ref).toContain(
      "RoleResponseDto",
    );
    expect(
      schema("/authorization/roles/{id}/permissions", "put", "200").$ref,
    ).toContain("RoleResponseDto");
    expect(
      schema("/authorization/users/{userId}/roles", "put", "200").$ref,
    ).toContain("UserRolesResponseDto");
  });
  it("publishes contextual errors without making domain fields mandatory for validation", () => {
    const s = doc.components.schemas.ApiErrorResponseDto;
    expect(s.required).not.toContain("code");
    expect(s.properties).toHaveProperty("action");
    expect(s.properties).toHaveProperty("field");
    for (const status of ["400", "401", "403", "404", "409", "500", "503"])
      expect(doc.paths["/departments"].post.responses).toHaveProperty(status);
    expect(
      doc.paths["/authorization/roles"].post.responses["503"].description,
    ).toContain("Authentication infrastructure is unavailable");
  });
});
