// Missing and future unknown modes are private. Contacts are OWNER -> viewer.
export function audienceAllows(
  policy:
    | {
        mode: string;
        accountRecipients: { accountId: string }[];
        workspaceRecipients: { workspaceId: string }[];
      }
    | undefined,
  viewer: { id: string; workspaceId: string } | null,
  ownerHasViewerContact: boolean,
): boolean {
  if (!policy) return false;
  switch (policy.mode) {
    case "EVERYONE":
      return true;
    case "CONTACTS":
      return !!viewer && ownerHasViewerContact;
    case "CUSTOM":
      return (
        !!viewer &&
        (policy.accountRecipients.some((r) => r.accountId === viewer.id) ||
          policy.workspaceRecipients.some(
            (r) => r.workspaceId === viewer.workspaceId,
          ))
      );
    default:
      return false;
  }
}
