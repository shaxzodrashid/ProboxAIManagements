export const publicIdentitySelect = {
  id: true,
  fullName: true,
  firstName: true,
  lastName: true,
  username: true,
} as const;

export function publicIdentity(user: {
  id: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
}) {
  return {
    id: user.id,
    displayName:
      [user.firstName, user.lastName].filter(Boolean).join(" ") ||
      user.fullName,
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
  };
}
