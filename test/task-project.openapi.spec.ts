import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { ProjectStatus, SessionStatus, TaskStatus } from "@prisma/client";
import { TasksController } from "../src/tasks/tasks.controller";
import { TasksService } from "../src/tasks/tasks.service";
import { ProjectsController } from "../src/projects/projects.controller";
import { ProjectsService } from "../src/projects/projects.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { JwtService } from "@nestjs/jwt";

describe("operation-specific task and project OpenAPI", () => {
  let app: INestApplication;
  let doc: any;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [TasksController, ProjectsController],
      providers: [
        { provide: TasksService, useValue: {} },
        { provide: ProjectsService, useValue: {} },
        { provide: PrismaService, useValue: {} },
        { provide: JwtService, useValue: {} },
      ],
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
  it("distinguishes task creation from list and publishes the exact summary", () => {
    expect(schema("/tasks/{id}", "get", "200").$ref).toContain(
      "TaskDetailResponseDto",
    );
    expect(doc.paths["/tasks/{id}"].get.responses).toEqual(
      expect.objectContaining({
        "400": expect.anything(),
        "401": expect.anything(),
        "403": expect.anything(),
        "404": expect.anything(),
        "503": expect.anything(),
      }),
    );
    expect(schema("/tasks", "post", "201").$ref).toContain("TaskResponseDto");
    expect(schema("/tasks", "get", "200").items.$ref).toContain(
      "TaskListItemResponseDto",
    );
    const s = doc.components.schemas;
    expect(s.TaskDetailResponseDto).toEqual(s.TaskListItemResponseDto);
    expect(s.TaskResponseDto.properties).not.toHaveProperty("manager");
    expect(s.TaskResponseDto.properties).not.toHaveProperty("sessions");
    expect(s.TaskResponseDto.properties.criteria).toMatchObject({
      type: "string",
      nullable: true,
    });
    expect(s.TaskResponseDto.properties.status.enum).toEqual(
      Object.values(TaskStatus),
    );
    expect(s.TaskListItemResponseDto.required).toEqual(
      expect.arrayContaining(["manager", "sessions"]),
    );
    expect(s.TaskListItemResponseDto.properties.sessions).toMatchObject({
      type: "array",
      maxItems: 1,
    });
    expect(Object.keys(s.LatestSessionDto.properties).sort()).toEqual([
      "createdAt",
      "id",
      "status",
    ]);
    expect(s.LatestSessionDto.properties.status.enum).toEqual(
      Object.values(SessionStatus),
    );
  });
  it("publishes every lifecycle and distinguishes project relational omissions", () => {
    const s = doc.components.schemas;
    expect(schema("/projects", "post", "201").$ref).toContain(
      "ProjectCreatedResponseDto",
    );
    expect(schema("/projects", "get", "200").items.$ref).toContain(
      "ProjectListItemResponseDto",
    );
    expect(schema("/projects/{id}", "get", "200").$ref).toContain(
      "ProjectResponseDto",
    );
    expect(schema("/projects/{id}", "put", "200").$ref).toContain(
      "ProjectScalarResponseDto",
    );
    expect(s.ProjectScalarResponseDto.properties.status.enum).toEqual(
      Object.values(ProjectStatus),
    );
    expect(s.ProjectScalarResponseDto.properties.description).toMatchObject({
      type: "string",
      nullable: true,
    });
    expect(
      s.ProjectScalarResponseDto.properties.appliedTemplateVersionId,
    ).toMatchObject({ type: "string", nullable: true });
    expect(s.ProjectScalarResponseDto.properties).not.toHaveProperty("members");
    expect(s.ProjectListItemResponseDto.properties).not.toHaveProperty(
      "members",
    );
    expect(s.ProjectResponseDto.required).not.toContain("members");
    expect(s.ProjectResponseDto.required).toContain("initializations");
    for (const name of ["ProjectListItemResponseDto", "ProjectResponseDto"]) {
      expect(s[name].properties.isMember.type).toBe("boolean");
      expect(s[name].required).toContain("isMember");
    }
    expect(s.ProjectScalarResponseDto.properties).not.toHaveProperty(
      "isMember",
    );
    expect(s.ProjectCreatedResponseDto.properties).not.toHaveProperty(
      "isMember",
    );
    expect(s.ProjectCreatedResponseDto.required).toContain("members");
    expect(s.ProjectCreatedResponseDto.required).not.toContain(
      "initializations",
    );
    expect(s.ProjectResponseDto.properties.initializations).toMatchObject({
      type: "array",
      maxItems: 1,
    });
    expect(
      Object.keys(s.ProjectInitializationSummaryResponseDto.properties).sort(),
    ).toEqual(
      [
        "id",
        "projectId",
        "templateVersionId",
        "attempt",
        "status",
        "lastSequence",
        "startedAt",
        "endedAt",
        "createdAt",
        "updatedAt",
      ].sort(),
    );
  });
  it("describes add-member 201 with nested identity and remove-member 200 with scalars", () => {
    expect(schema("/projects/{id}/members", "post", "201").$ref).toContain(
      "ProjectMemberResponseDto",
    );
    expect(
      schema("/projects/{id}/members/{userId}", "delete", "200").$ref,
    ).toContain("ProjectMembershipScalarResponseDto");
    expect(doc.components.schemas.ProjectMemberResponseDto.required).toContain(
      "user",
    );
    expect(
      doc.components.schemas.ProjectMembershipScalarResponseDto.properties,
    ).not.toHaveProperty("user");
  });
});
