import { randomUUID } from "node:crypto";
import { isUUID, maxLength } from "class-validator";
import { operationError } from "../openapi/operation-errors";

/** Inactive domain model. No controller, provider, credential or production adapter. */
export type BioActor =
  | { kind: "EMPLOYEE"; id: string; workspaceId: string }
  | { kind: "AGENT"; id: string; ownerId: string; workspaceId: string };
export type BioAssistant = {
  id: string;
  enabled: boolean;
  permissionKeys: string[];
  profileContent: boolean;
  profilePrivacy: boolean;
};
type Approval = {
  id: string;
  agentId: string;
  revision: number;
  bio: string | null;
  usedBy: string | null;
  approvedBy: string;
  approvedAt: string;
};
export type BioOutcome = {
  requestId: string;
  revision: number;
  bio: string | null;
  aiBadge: boolean;
  actor: BioActor;
};
export type BioDelegationState = {
  ownerId: string;
  workspaceId: string;
  ownerOpen: boolean;
  ownerPermissionKeys: string[];
  bio: string | null;
  revision: number;
  aiBadge: boolean;
  assistants: BioAssistant[];
  approvals: Approval[];
  history: Array<{
    before: string | null;
    after: string | null;
    approvalId: string | null;
    occurredAt: string;
    outcome: BioOutcome;
  }>;
};

export interface BioTransaction {
  state: BioDelegationState;
  /** Adapter-specific transaction, never a caller-supplied trust flag. */
  verificationContext: unknown;
}
export interface TrustedBioIdentityPort {
  /** Resolve the employee subject from authenticated proof, never request IDs. */
  employeeSubject(proof: unknown): Promise<string | null>;
  /** Reverify the actual principal inside the same current transaction. */
  verify(proof: unknown, transaction: BioTransaction): Promise<BioActor | null>;
}
export interface AtomicBioRepositoryPort {
  /** Fresh owner/link/grants; serialize writers, commit all or nothing. */
  transaction<T>(
    employeeId: string,
    action: (transaction: BioTransaction) => Promise<T>,
  ): Promise<T>;
}

const reject = (status: number, code: string, message: string) =>
  operationError(status, code, message, "delegatedBio");
const denied = () =>
  reject(403, "DELEGATED_BIO_DENIED", "Bio operation is not authorized");
const conflict = () =>
  reject(
    409,
    "DELEGATED_BIO_CONFLICT",
    "Bio changed; obtain a current approval",
  );
function fields(value: object, allowed: string[]) {
  if (!value || Object.keys(value).some((key) => !allowed.includes(key)))
    throw reject(
      400,
      "DELEGATED_BIO_INPUT",
      "Unsupported bio operation fields",
    );
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !isUUID(value, "4"))
    throw reject(400, "DELEGATED_BIO_INPUT", "A UUIDv4 identity is required");
  return value.toLowerCase();
}
function bioValue(value: unknown): asserts value is string | null {
  // Existing DTO limit plus PostgreSQL varchar(1000) storage boundary.
  if (
    value !== null &&
    (typeof value !== "string" ||
      !maxLength(value, 1000) ||
      Array.from(value).length > 1000)
  )
    throw reject(
      400,
      "DELEGATED_BIO_INPUT",
      "Bio must be null or text up to 1000 characters",
    );
}
function revision(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw reject(
      400,
      "DELEGATED_BIO_INPUT",
      "A nonnegative bio revision is required",
    );
}
function unique(keys: string[]) {
  return [...new Set(keys)].sort();
}

/** Trusted permission writers must persist this transition at loss, not at regain.
 * Calling it only during agent requests cannot remember an intervening loss.
 * This is modeled behavior until ALL real writers participate at activation.
 */
export function applyBioOwnerPermissionChange(
  state: BioDelegationState,
  effectiveKeys: readonly string[],
) {
  const effective = new Set(effectiveKeys);
  state.ownerPermissionKeys = unique([...effective]);
  for (const assistant of state.assistants)
    assistant.permissionKeys = assistant.permissionKeys.filter((key) =>
      effective.has(key),
    );
}

/** Not registered in Nest. Supplying trusted adapters requires a future activation
 * change reviewed together with real human writers and permission-loss hooks.
 */
export class DelegatedBioFoundation {
  constructor(
    private readonly identity?: TrustedBioIdentityPort,
    private readonly repository?: AtomicBioRepositoryPort,
  ) {}

  private async run<T>(
    proof: unknown,
    action: (state: BioDelegationState, actor: BioActor) => T,
  ) {
    if (!this.identity || !this.repository)
      throw reject(
        503,
        "DELEGATED_BIO_NOT_ACTIVATED",
        "Delegated bio execution is not activated",
      );
    const identity = this.identity;
    const ownerId = await identity.employeeSubject(proof);
    if (!ownerId) throw denied();
    return this.repository.transaction(ownerId, async (transaction) => {
      const verified = await identity.verify(proof, transaction);
      const actor: BioActor | null =
        verified?.kind === "EMPLOYEE"
          ? {
              kind: "EMPLOYEE",
              id: verified.id,
              workspaceId: verified.workspaceId,
            }
          : verified?.kind === "AGENT"
            ? {
                kind: "AGENT",
                id: verified.id,
                ownerId: verified.ownerId,
                workspaceId: verified.workspaceId,
              }
            : null;
      const state = transaction.state;
      if (
        !actor ||
        !state.ownerOpen ||
        state.ownerId !== ownerId ||
        actor.workspaceId !== state.workspaceId ||
        (actor.kind === "EMPLOYEE"
          ? actor.id !== ownerId
          : actor.ownerId !== ownerId)
      )
        throw denied();
      return structuredClone(action(state, actor));
    });
  }
  private employee(actor: BioActor) {
    if (actor.kind !== "EMPLOYEE") throw denied();
  }
  private assistant(state: BioDelegationState, id: string) {
    const assistant = state.assistants.find((row) => row.id === id);
    if (
      !assistant ||
      !assistant.enabled ||
      assistant.permissionKeys.some(
        (key) => !state.ownerPermissionKeys.includes(key),
      )
    )
      throw denied();
    return assistant;
  }

  /** Domain creation only; does not provision a principal or credential. */
  createAssistant(
    proof: unknown,
    scopes: { profileContent: boolean; profilePrivacy: boolean },
  ) {
    return this.run(proof, (state, actor) => {
      this.employee(actor);
      fields(scopes, ["profileContent", "profilePrivacy"]);
      if (
        typeof scopes.profileContent !== "boolean" ||
        typeof scopes.profilePrivacy !== "boolean"
      )
        throw denied();
      const assistant: BioAssistant = {
        id: randomUUID(),
        enabled: true,
        permissionKeys: unique(state.ownerPermissionKeys),
        ...scopes,
      };
      state.assistants.push(assistant);
      return assistant;
    });
  }

  setAssistantAccess(
    proof: unknown,
    input: {
      agentId: string;
      enabled: boolean;
      permissionKeys: string[];
      profileContent: boolean;
      profilePrivacy: boolean;
    },
  ) {
    return this.run(proof, (state, actor) => {
      this.employee(actor);
      fields(input, [
        "agentId",
        "enabled",
        "permissionKeys",
        "profileContent",
        "profilePrivacy",
      ]);
      const assistant = state.assistants.find(
        (row) => row.id === uuid(input.agentId),
      );
      if (
        !assistant ||
        typeof input.enabled !== "boolean" ||
        typeof input.profileContent !== "boolean" ||
        typeof input.profilePrivacy !== "boolean" ||
        !Array.isArray(input.permissionKeys) ||
        input.permissionKeys.some(
          (key) =>
            typeof key !== "string" || !state.ownerPermissionKeys.includes(key),
        )
      )
        throw denied();
      Object.assign(assistant, {
        enabled: input.enabled,
        permissionKeys: unique(input.permissionKeys),
        profileContent: input.profileContent,
        profilePrivacy: input.profilePrivacy,
      });
      return assistant;
    });
  }

  approve(
    proof: unknown,
    input: {
      approvalId: string;
      agentId: string;
      expectedRevision: number;
      bio: string | null;
    },
  ) {
    return this.run(proof, (state, actor) => {
      this.employee(actor);
      fields(input, ["approvalId", "agentId", "expectedRevision", "bio"]);
      const id = uuid(input.approvalId),
        agentId = uuid(input.agentId);
      revision(input.expectedRevision);
      bioValue(input.bio);
      const assistant = this.assistant(state, agentId);
      if (!assistant.profileContent) throw denied();
      const prior = state.approvals.find((row) => row.id === id);
      if (prior) {
        if (
          prior.agentId !== agentId ||
          prior.revision !== input.expectedRevision ||
          prior.bio !== input.bio
        )
          throw conflict();
        return { approvalId: id, revision: prior.revision };
      }
      if (state.revision !== input.expectedRevision) throw conflict();
      state.approvals.push({
        id,
        agentId,
        revision: state.revision,
        bio: input.bio,
        usedBy: null,
        approvedBy: actor.id,
        approvedAt: new Date().toISOString(),
      });
      return { approvalId: id, revision: state.revision };
    });
  }

  execute(proof: unknown, input: { approvalId: string; requestId: string }) {
    return this.run(proof, (state, actor) => {
      if (actor.kind !== "AGENT") throw denied();
      fields(input, ["approvalId", "requestId"]);
      const assistant = this.assistant(state, actor.id);
      if (!assistant.profileContent) throw denied();
      // Bio self-edit needs no workspace permission key in the existing API.
      // Content scope + exact owner instruction/approval still remain mandatory.
      const approvalId = uuid(input.approvalId),
        requestId = uuid(input.requestId);
      const approval = state.approvals.find(
        (row) => row.id === approvalId && row.agentId === actor.id,
      );
      if (!approval) throw denied();
      const prior = state.history.find(
        (row) => row.outcome.requestId === requestId,
      );
      if (prior) {
        if (
          prior.outcome.actor.kind !== "AGENT" ||
          prior.outcome.actor.id !== actor.id ||
          prior.approvalId !== approvalId
        )
          throw conflict();
        return prior.outcome;
      }
      if (approval.usedBy || approval.revision !== state.revision)
        throw conflict();
      approval.usedBy = requestId;
      return this.write(state, actor, requestId, approval.bio, approvalId);
    });
  }

  humanWrite(
    proof: unknown,
    input: { requestId: string; expectedRevision: number; bio: string | null },
  ) {
    return this.run(proof, (state, actor) => {
      this.employee(actor);
      fields(input, ["requestId", "expectedRevision", "bio"]);
      const requestId = uuid(input.requestId);
      revision(input.expectedRevision);
      bioValue(input.bio);
      const prior = state.history.find(
        (row) => row.outcome.requestId === requestId,
      );
      if (prior) {
        if (
          prior.outcome.actor.kind !== "EMPLOYEE" ||
          prior.outcome.actor.id !== actor.id ||
          prior.outcome.bio !== input.bio ||
          prior.outcome.revision !== input.expectedRevision + 1
        )
          throw conflict();
        return prior.outcome;
      }
      if (state.revision !== input.expectedRevision) throw conflict();
      return this.write(state, actor, requestId, input.bio, null);
    });
  }

  private write(
    state: BioDelegationState,
    actor: BioActor,
    requestId: string,
    bio: string | null,
    approvalId: string | null,
  ) {
    if (
      !Number.isSafeInteger(state.revision) ||
      state.revision >= Number.MAX_SAFE_INTEGER
    )
      throw conflict();
    const before = state.bio;
    state.bio = bio;
    state.revision += 1;
    state.aiBadge = actor.kind === "AGENT";
    const outcome = {
      requestId,
      revision: state.revision,
      bio,
      aiBadge: state.aiBadge,
      actor,
    };
    state.history.push({
      before,
      after: bio,
      approvalId,
      occurredAt: new Date().toISOString(),
      outcome,
    });
    return outcome;
  }

  read(proof: unknown) {
    return this.run(proof, (state, actor) => {
      this.employee(actor);
      // Detailed old values and actual agent identity are employee-owner-only
      // within this inactive model; no public history projection is introduced.
      return {
        bio: state.bio,
        revision: state.revision,
        aiBadge: state.aiBadge,
        history: state.history,
      };
    });
  }
}
