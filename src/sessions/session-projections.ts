import { ProboxAiSession, ProboxAiTurn } from "@prisma/client";

export function sessionResponse(s: ProboxAiSession) {
  return {
    id: s.id,
    workspaceId: s.workspaceId,
    taskId: s.taskId,
    projectId: s.selectedProjectId,
    creatorId: s.creatorId,
    status: s.status,
    recoveryReason: s.recoveryReason,
    stopConfirmation: s.stopConfirmation,
    interruptRequestedAt: s.interruptRequestedAt,
    interruptSignalAcceptedAt: s.interruptSignalAcceptedAt,
    runnerExitedAt: s.runnerExitedAt,
    cwd: s.cwd,
    sandbox: s.sandbox,
    model: s.model,
    providerId: s.providerId,
    requestedModel: s.requestedModel,
    effectiveModel: s.effectiveModel,
    requestedReasoningEffort: s.requestedReasoningEffort,
    effectiveReasoningEffort: s.effectiveReasoningEffort,
    codexThreadId: s.codexThreadId,
    processId: s.processId,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    lastSequence: s.lastSequence,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}
export function turnResponse(t: ProboxAiTurn) {
  return {
    id: t.id,
    sessionId: t.sessionId,
    requestId: t.requestId,
    codexTurnId: t.codexTurnId,
    prompt: t.prompt,
    status: t.status,
    inputTokens: t.inputTokens,
    cachedTokens: t.cachedTokens,
    outputTokens: t.outputTokens,
    reasoningTokens: t.reasoningTokens,
    startedAt: t.startedAt,
    executionStartedAt: t.executionStartedAt,
    endedAt: t.endedAt,
  };
}
export function acceptanceResponse(t: ProboxAiTurn) {
  return {
    accepted: true,
    requestId: t.requestId!,
    sessionId: t.sessionId,
    turnId: t.id,
    status: t.status,
    acceptedAt: t.startedAt,
    executionStartedAt: t.executionStartedAt,
    endedAt: t.endedAt,
  };
}
