# Authorization API and migration contract

ProboxAI uses workspace-scoped role-based access control (RBAC). A user may
hold multiple roles. Effective permissions are the union of the permissions on
all assigned roles.

Authentication and authorization are intentionally separate:

- Access JWTs identify the user and workspace; they do not authorize requests.
- `JwtAuthGuard` reloads the current `OPEN` user, roles, and permissions from
  PostgreSQL on every request. Bans, deletions, role changes, and permission
  changes therefore take effect without waiting for JWT expiry.
- `PermissionsGuard` checks route permissions.
- Services retain resource checks such as workspace isolation, project
  membership, project ownership, task assignment, and public project read
  access. A route permission alone does not bypass those checks unless the
  caller also holds an explicit `*-all` permission.

## Data model

- `Permission`: global, code-defined permission catalog keyed by stable strings.
- `Role`: workspace-scoped role. `ADMIN`, `MANAGER`, and `MEMBER` are protected
  system roles; administrators may also create custom roles.
- `RolePermission`: many-to-many role-to-permission assignments.
- `UserRoleAssignment`: many-to-many user-to-role assignments, including the
  assigning user and assignment timestamp for auditability.

Composite foreign keys on `(userId, workspaceId)` and `(roleId, workspaceId)`
make cross-workspace assignments impossible at the database layer as well as
in the service.

Permission keys are intentionally catalog-backed. The management API assigns
known permissions to roles; it does not create arbitrary keys that application
guards would never enforce.

## Management API

All routes are under `/api/v1` and use an access bearer token.

| Method   | Path                                   | Required permission    | Purpose                                                  |
| -------- | -------------------------------------- | ---------------------- | -------------------------------------------------------- |
| `GET`    | `/authorization/me`                    | authenticated user     | Current roles and effective permissions                  |
| `GET`    | `/authorization/permissions`           | `authorization.read`   | List assignable permissions                              |
| `GET`    | `/authorization/roles`                 | `authorization.read`   | List workspace roles, permissions, and assignment counts |
| `POST`   | `/authorization/roles`                 | `authorization.manage` | Create a custom role                                     |
| `PATCH`  | `/authorization/roles/:id`             | `authorization.manage` | Update role display metadata                             |
| `PUT`    | `/authorization/roles/:id/permissions` | `authorization.manage` | Atomically replace role permissions                      |
| `DELETE` | `/authorization/roles/:id`             | `authorization.manage` | Delete an unassigned custom role                         |
| `PUT`    | `/authorization/users/:userId/roles`   | `authorization.manage` | Atomically replace a user's roles                        |

Role mutation is workspace-scoped. Built-in roles cannot be deleted and
assigned roles cannot be deleted. Callers may change their own role assignments
or a role currently assigned to them only when the resulting effective
permissions add nothing they do not already hold and still include
`authorization.manage`. This permits a sole administrator to add a less
privileged role while preventing self-escalation and accidental self-lockout.

`PUT /authorization/users/:userId/roles` replaces the complete role list. To
add a role without removing existing roles, clients must send both the existing
role IDs and the new role ID.

## User API compatibility

`POST /users` now accepts `roleIds: string[]` and requires at least one role.
During the compatibility window it also accepts the old scalar
`role: "ADMIN" | "MANAGER" | "MEMBER"`; clients must not send both fields.

User responses expose `roles: Array<{ id, key, name }>` and retain a deprecated
derived `role` property for older clients. The scalar value prefers `ADMIN`,
then `MANAGER`, then `MEMBER`, and is `null` when the user has only custom roles.
New clients must use `roles` and `/authorization/me`.

Project member responses add `roles` and retain the same deprecated derived
`role` compatibility field.

## Database migration

Migration `20260801000000_multi_role_authorization` executes in this order:

1. Create the permission, role, role-permission, and user-role tables.
2. Insert the permission catalog.
3. Create deterministic `ADMIN`, `MANAGER`, and `MEMBER` roles for every
   existing workspace.
4. Assign permissions matching existing route and resource behavior.
5. Copy each user's legacy enum value into `UserRoleAssignment`.
6. Drop `User.role`, then drop the PostgreSQL `UserRole` enum.

The migration is intentionally one-way because the old scalar column cannot
represent multiple roles. Back up the production database before deployment
and run `prisma migrate deploy` before starting application code generated from
the new schema. No VPS deployment is performed by this change.
