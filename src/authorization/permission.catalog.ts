export const Permissions = {
  AUTHORIZATION_READ: "authorization.read",
  AUTHORIZATION_MANAGE: "authorization.manage",
  USERS_READ: "users.read",
  USERS_MANAGE: "users.manage",
  DEPARTMENTS_READ: "departments.read",
  DEPARTMENTS_MANAGE: "departments.manage",
  TEMPLATES_READ: "configuration-templates.read",
  TEMPLATES_MANAGE: "configuration-templates.manage",
  PROJECTS_READ: "projects.read",
  PROJECTS_READ_ALL: "projects.read-all",
  PROJECTS_CREATE: "projects.create",
  PROJECTS_UPDATE: "projects.update",
  PROJECTS_MANAGE_ALL: "projects.manage-all",
  PROJECT_MEMBERS_MANAGE: "projects.members.manage",
  PROJECT_FILES_READ: "projects.files.read",
  PROJECT_FILES_WRITE: "projects.files.write",
  PROJECT_FILES_DELETE: "projects.files.delete",
  PROJECTS_DELETE: "projects.delete",
  PROJECT_INITIALIZATIONS_READ: "projects.initializations.read",
  PROJECT_INITIALIZATIONS_MANAGE: "projects.initializations.manage",
  TASKS_READ: "tasks.read",
  TASKS_READ_ALL: "tasks.read-all",
  TASKS_CREATE: "tasks.create",
  SESSIONS_READ: "sessions.read",
  SESSIONS_CREATE: "sessions.create",
  SESSIONS_MANAGE: "sessions.manage",
  SETTINGS_MANAGE: "settings.manage",
} as const;

export type PermissionKey = (typeof Permissions)[keyof typeof Permissions];

export const PermissionDefinitions: ReadonlyArray<{
  key: PermissionKey;
  name: string;
  description: string;
  category: string;
}> = [
  permission(
    Permissions.AUTHORIZATION_READ,
    "View authorization",
    "List roles, effective permissions, and the permission catalog.",
    "Authorization",
  ),
  permission(
    Permissions.AUTHORIZATION_MANAGE,
    "Manage authorization",
    "Create, update, delete, and assign roles and role permissions.",
    "Authorization",
  ),
  permission(
    Permissions.USERS_READ,
    "View users",
    "List users in the current workspace.",
    "Users",
  ),
  permission(
    Permissions.USERS_MANAGE,
    "Manage users",
    "Create, ban, and soft-delete users in the current workspace.",
    "Users",
  ),
  permission(
    Permissions.DEPARTMENTS_READ,
    "View departments",
    "View active workspace departments.",
    "Departments",
  ),
  permission(
    Permissions.DEPARTMENTS_MANAGE,
    "Manage departments",
    "Create, update, archive, and view archived departments.",
    "Departments",
  ),
  permission(
    Permissions.TEMPLATES_READ,
    "View configuration templates",
    "View published configuration templates.",
    "Configuration templates",
  ),
  permission(
    Permissions.TEMPLATES_MANAGE,
    "Manage configuration templates",
    "Create, edit, publish, archive, and view draft configuration templates.",
    "Configuration templates",
  ),
  permission(
    Permissions.PROJECTS_READ,
    "View accessible projects",
    "View projects allowed by membership or workspace read access.",
    "Projects",
  ),
  permission(
    Permissions.PROJECTS_READ_ALL,
    "View all projects",
    "Bypass project membership and workspace-read restrictions for project reads.",
    "Projects",
  ),
  permission(
    Permissions.PROJECTS_CREATE,
    "Create projects",
    "Create projects and their backing directories.",
    "Projects",
  ),
  permission(
    Permissions.PROJECTS_UPDATE,
    "Update projects",
    "Update projects when resource-level membership permits it.",
    "Projects",
  ),
  permission(
    Permissions.PROJECTS_MANAGE_ALL,
    "Manage all projects",
    "Bypass project membership restrictions for sensitive project operations.",
    "Projects",
  ),
  permission(
    Permissions.PROJECT_MEMBERS_MANAGE,
    "Manage project members",
    "Add and remove project members when resource-level access permits it.",
    "Projects",
  ),
  permission(
    Permissions.PROJECT_FILES_READ,
    "Read project files",
    "List and download files from accessible projects.",
    "Projects",
  ),
  permission(
    Permissions.PROJECT_FILES_WRITE,
    "Write project files",
    "Create folders and upload, move, or rename project files.",
    "Projects",
  ),
  permission(
    Permissions.PROJECT_FILES_DELETE,
    "Delete project files",
    "Protect, trash, confirm, and restore project files.",
    "Projects",
  ),
  permission(
    Permissions.PROJECTS_DELETE,
    "Delete projects",
    "Request and complete the protected project-deletion workflow.",
    "Projects",
  ),
  permission(
    Permissions.PROJECT_INITIALIZATIONS_READ,
    "View project initializations",
    "View initialization attempts, logs, and events for accessible projects.",
    "Projects",
  ),
  permission(
    Permissions.PROJECT_INITIALIZATIONS_MANAGE,
    "Manage project initializations",
    "Cancel or retry project initialization for writable projects.",
    "Projects",
  ),
  permission(
    Permissions.TASKS_READ,
    "View assigned tasks",
    "View tasks assigned to the current user.",
    "Tasks",
  ),
  permission(
    Permissions.TASKS_READ_ALL,
    "View all tasks",
    "View every task in the current workspace.",
    "Tasks",
  ),
  permission(
    Permissions.TASKS_CREATE,
    "Create tasks",
    "Create tasks assigned to the current user.",
    "Tasks",
  ),
  permission(
    Permissions.SESSIONS_READ,
    "View managed sessions",
    "View and stream managed sessions allowed by resource ownership.",
    "Sessions",
  ),
  permission(
    Permissions.SESSIONS_CREATE,
    "Create managed sessions",
    "Start managed coding sessions for assigned tasks.",
    "Sessions",
  ),
  permission(
    Permissions.SESSIONS_MANAGE,
    "Manage managed sessions",
    "Start follow-up turns and interrupt managed sessions.",
    "Sessions",
  ),
  permission(
    Permissions.SETTINGS_MANAGE,
    "Manage workspace settings",
    "Manage backward-compatible workspace settings endpoints.",
    "Settings",
  ),
];

export const SystemRoleKeys = {
  ADMIN: "ADMIN",
  MANAGER: "MANAGER",
  MEMBER: "MEMBER",
} as const;

const memberPermissions: PermissionKey[] = [
  Permissions.PROJECTS_READ,
  Permissions.PROJECTS_UPDATE,
  Permissions.PROJECT_MEMBERS_MANAGE,
  Permissions.PROJECT_FILES_READ,
  Permissions.PROJECT_FILES_WRITE,
  Permissions.PROJECT_FILES_DELETE,
  Permissions.PROJECTS_DELETE,
  Permissions.PROJECT_INITIALIZATIONS_READ,
  Permissions.PROJECT_INITIALIZATIONS_MANAGE,
  Permissions.TASKS_READ,
  Permissions.SESSIONS_READ,
];

export const SystemRoleDefinitions = [
  {
    key: SystemRoleKeys.ADMIN,
    name: "Administrator",
    description: "Built-in role with every ProboxAI permission.",
    permissions: PermissionDefinitions.map(({ key }) => key),
  },
  {
    key: SystemRoleKeys.MANAGER,
    name: "Manager",
    description: "Built-in role for project, task, and managed-session work.",
    permissions: [
      ...memberPermissions,
      Permissions.DEPARTMENTS_READ,
      Permissions.TEMPLATES_READ,
      Permissions.PROJECTS_CREATE,
      Permissions.TASKS_CREATE,
      Permissions.SESSIONS_CREATE,
      Permissions.SESSIONS_MANAGE,
    ],
  },
  {
    key: SystemRoleKeys.MEMBER,
    name: "Member",
    description: "Built-in role for resource-scoped project collaboration.",
    permissions: memberPermissions,
  },
] as const;

export function hasPermission(
  user: { permissions: readonly string[] },
  permissionKey: PermissionKey,
) {
  return user.permissions.includes(permissionKey);
}

function permission(
  key: PermissionKey,
  name: string,
  description: string,
  category: string,
) {
  return { key, name, description, category };
}
