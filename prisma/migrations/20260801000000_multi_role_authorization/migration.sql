-- Replace the single User.role enum with workspace-scoped RBAC.
-- The migration creates and populates the new graph before dropping the legacy
-- column, so every existing user retains equivalent access atomically.

CREATE TABLE "Permission" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Permission_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId", "permissionKey")
);

CREATE TABLE "UserRoleAssignment" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserRoleAssignment_pkey" PRIMARY KEY ("userId", "roleId")
);

CREATE UNIQUE INDEX "Role_workspaceId_key_key" ON "Role"("workspaceId", "key");
CREATE UNIQUE INDEX "Role_id_workspaceId_key" ON "Role"("id", "workspaceId");
CREATE INDEX "Role_workspaceId_name_idx" ON "Role"("workspaceId", "name");
CREATE UNIQUE INDEX "User_id_workspaceId_key" ON "User"("id", "workspaceId");
CREATE INDEX "Permission_category_name_idx" ON "Permission"("category", "name");
CREATE INDEX "RolePermission_permissionKey_idx" ON "RolePermission"("permissionKey");
CREATE INDEX "UserRoleAssignment_roleId_idx" ON "UserRoleAssignment"("roleId");
CREATE INDEX "UserRoleAssignment_workspaceId_roleId_idx" ON "UserRoleAssignment"("workspaceId", "roleId");
CREATE INDEX "UserRoleAssignment_assignedById_idx" ON "UserRoleAssignment"("assignedById");

ALTER TABLE "Role" ADD CONSTRAINT "Role_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionKey_fkey"
    FOREIGN KEY ("permissionKey") REFERENCES "Permission"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_userId_workspaceId_fkey"
    FOREIGN KEY ("userId", "workspaceId") REFERENCES "User"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_roleId_workspaceId_fkey"
    FOREIGN KEY ("roleId", "workspaceId") REFERENCES "Role"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_assignedById_fkey"
    FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "Permission" ("key", "name", "description", "category", "updatedAt") VALUES
('authorization.read', 'View authorization', 'List roles, effective permissions, and the permission catalog.', 'Authorization', CURRENT_TIMESTAMP),
('authorization.manage', 'Manage authorization', 'Create, update, delete, and assign roles and role permissions.', 'Authorization', CURRENT_TIMESTAMP),
('users.read', 'View users', 'List users in the current workspace.', 'Users', CURRENT_TIMESTAMP),
('users.manage', 'Manage users', 'Create, ban, and soft-delete users in the current workspace.', 'Users', CURRENT_TIMESTAMP),
('departments.read', 'View departments', 'View active workspace departments.', 'Departments', CURRENT_TIMESTAMP),
('departments.manage', 'Manage departments', 'Create, update, archive, and view archived departments.', 'Departments', CURRENT_TIMESTAMP),
('configuration-templates.read', 'View configuration templates', 'View published configuration templates.', 'Configuration templates', CURRENT_TIMESTAMP),
('configuration-templates.manage', 'Manage configuration templates', 'Create, edit, publish, archive, and view draft configuration templates.', 'Configuration templates', CURRENT_TIMESTAMP),
('projects.read', 'View accessible projects', 'View projects allowed by membership or workspace read access.', 'Projects', CURRENT_TIMESTAMP),
('projects.read-all', 'View all projects', 'Bypass project membership and workspace-read restrictions for project reads.', 'Projects', CURRENT_TIMESTAMP),
('projects.create', 'Create projects', 'Create projects and their backing directories.', 'Projects', CURRENT_TIMESTAMP),
('projects.update', 'Update projects', 'Update projects when resource-level membership permits it.', 'Projects', CURRENT_TIMESTAMP),
('projects.manage-all', 'Manage all projects', 'Bypass project membership restrictions for sensitive project operations.', 'Projects', CURRENT_TIMESTAMP),
('projects.members.manage', 'Manage project members', 'Add and remove project members when resource-level access permits it.', 'Projects', CURRENT_TIMESTAMP),
('projects.files.read', 'Read project files', 'List and download files from accessible projects.', 'Projects', CURRENT_TIMESTAMP),
('projects.files.write', 'Write project files', 'Create folders and upload, move, or rename project files.', 'Projects', CURRENT_TIMESTAMP),
('projects.files.delete', 'Delete project files', 'Protect, trash, confirm, and restore project files.', 'Projects', CURRENT_TIMESTAMP),
('projects.delete', 'Delete projects', 'Request and complete the protected project-deletion workflow.', 'Projects', CURRENT_TIMESTAMP),
('projects.initializations.read', 'View project initializations', 'View initialization attempts, logs, and events for accessible projects.', 'Projects', CURRENT_TIMESTAMP),
('projects.initializations.manage', 'Manage project initializations', 'Cancel or retry project initialization for writable projects.', 'Projects', CURRENT_TIMESTAMP),
('tasks.read', 'View assigned tasks', 'View tasks assigned to the current user.', 'Tasks', CURRENT_TIMESTAMP),
('tasks.read-all', 'View all tasks', 'View every task in the current workspace.', 'Tasks', CURRENT_TIMESTAMP),
('tasks.create', 'Create tasks', 'Create tasks assigned to the current user.', 'Tasks', CURRENT_TIMESTAMP),
('sessions.read', 'View managed sessions', 'View and stream managed sessions allowed by resource ownership.', 'Sessions', CURRENT_TIMESTAMP),
('sessions.create', 'Create managed sessions', 'Start managed coding sessions for assigned tasks.', 'Sessions', CURRENT_TIMESTAMP),
('sessions.manage', 'Manage managed sessions', 'Start follow-up turns and interrupt managed sessions.', 'Sessions', CURRENT_TIMESTAMP),
('settings.manage', 'Manage workspace settings', 'Manage backward-compatible workspace settings endpoints.', 'Settings', CURRENT_TIMESTAMP);

WITH system_roles("key", "name", "description") AS (
    VALUES
        ('ADMIN', 'Administrator', 'Built-in role with every ProboxAI permission.'),
        ('MANAGER', 'Manager', 'Built-in role for project, task, and managed-session work.'),
        ('MEMBER', 'Member', 'Built-in role for resource-scoped project collaboration.')
)
INSERT INTO "Role" ("id", "workspaceId", "key", "name", "description", "isSystem", "updatedAt")
SELECT
    substr(md5(w."id" || ':' || sr."key"), 1, 8) || '-' ||
    substr(md5(w."id" || ':' || sr."key"), 9, 4) || '-' ||
    '4' || substr(md5(w."id" || ':' || sr."key"), 14, 3) || '-' ||
    '8' || substr(md5(w."id" || ':' || sr."key"), 18, 3) || '-' ||
    substr(md5(w."id" || ':' || sr."key"), 21, 12),
    w."id", sr."key", sr."name", sr."description", true, CURRENT_TIMESTAMP
FROM "Workspace" w CROSS JOIN system_roles sr;

-- Administrators retain full access.
INSERT INTO "RolePermission" ("roleId", "permissionKey")
SELECT r."id", p."key"
FROM "Role" r CROSS JOIN "Permission" p
WHERE r."key" = 'ADMIN' AND r."isSystem" = true;

-- Managers retain the former manager routes plus resource-scoped collaboration.
WITH manager_permissions("key") AS (
    VALUES
        ('departments.read'), ('configuration-templates.read'),
        ('projects.read'), ('projects.create'), ('projects.update'),
        ('projects.members.manage'), ('projects.files.read'),
        ('projects.files.write'), ('projects.files.delete'), ('projects.delete'),
        ('projects.initializations.read'), ('projects.initializations.manage'),
        ('tasks.read'), ('tasks.create'), ('sessions.read'),
        ('sessions.create'), ('sessions.manage')
)
INSERT INTO "RolePermission" ("roleId", "permissionKey")
SELECT r."id", mp."key"
FROM "Role" r CROSS JOIN manager_permissions mp
WHERE r."key" = 'MANAGER' AND r."isSystem" = true;

-- Members retain access only where project membership/public visibility and
-- existing task/session ownership checks also permit the operation.
WITH member_permissions("key") AS (
    VALUES
        ('projects.read'), ('projects.update'), ('projects.members.manage'),
        ('projects.files.read'), ('projects.files.write'),
        ('projects.files.delete'), ('projects.delete'),
        ('projects.initializations.read'), ('projects.initializations.manage'),
        ('tasks.read'), ('sessions.read')
)
INSERT INTO "RolePermission" ("roleId", "permissionKey")
SELECT r."id", mp."key"
FROM "Role" r CROSS JOIN member_permissions mp
WHERE r."key" = 'MEMBER' AND r."isSystem" = true;

-- Copy every legacy enum value to the matching system role before removal.
INSERT INTO "UserRoleAssignment" ("userId", "roleId", "workspaceId")
SELECT u."id", r."id", u."workspaceId"
FROM "User" u
JOIN "Role" r
  ON r."workspaceId" = u."workspaceId"
 AND r."key" = u."role"::text
 AND r."isSystem" = true;

ALTER TABLE "User" DROP COLUMN "role";
DROP TYPE "UserRole";
