import { UserRole } from "@prisma/client";

export interface AuthenticatedUser {
  id: string;
  workspaceId: string;
  role: UserRole;
  type?: "access";
}
