/** Ordinary project reads never expose worker paths, lease metadata or raw errors. */
export const projectInitializationSummarySelect = {
  id: true,
  projectId: true,
  templateVersionId: true,
  attempt: true,
  status: true,
  lastSequence: true,
  startedAt: true,
  endedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;
