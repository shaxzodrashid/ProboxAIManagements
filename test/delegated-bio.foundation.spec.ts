import { randomUUID } from "node:crypto";
import {
  applyBioOwnerPermissionChange,
  AtomicBioRepositoryPort,
  BioActor,
  BioDelegationState,
  DelegatedBioFoundation,
  TrustedBioIdentityPort,
} from "../src/accounts/delegated-bio.foundation";

/** Simulation only: opaque proofs and serialized copy-on-write transactions.
 * Neither this fixture nor its credentials are production adapters.
 */
function fixture() {
  const ownerId = randomUUID(),
    workspaceId = randomUUID();
  let state: BioDelegationState = {
    ownerId,
    workspaceId,
    ownerOpen: true,
    ownerPermissionKeys: ["tasks.read", "sessions.read"],
    bio: "Existing employee bio",
    revision: 0,
    aiBadge: false,
    assistants: [],
    approvals: [],
    history: [],
  };
  const proofs = new Map<string, BioActor>([
    ["employee-proof", { kind: "EMPLOYEE", id: ownerId, workspaceId }],
  ]);
  const contexts = new WeakSet<object>();
  let tail = Promise.resolve();
  let failCommit = false;
  const repository: AtomicBioRepositoryPort = {
    async transaction<T>(
      subject: string,
      operation: Parameters<AtomicBioRepositoryPort["transaction"]>[1],
    ): Promise<T> {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        if (subject !== state.ownerId) throw new Error("Unknown fixture owner");
        const draft = structuredClone(state),
          context = {};
        contexts.add(context);
        const result = await operation({
          state: draft,
          verificationContext: context,
        });
        contexts.delete(context);
        if (failCommit) throw new Error("Injected atomic commit failure");
        state = draft;
        return result as T;
      } finally {
        release();
      }
    },
  };
  const identity: TrustedBioIdentityPort = {
    async employeeSubject(proof) {
      const actor = typeof proof === "string" ? proofs.get(proof) : undefined;
      return actor
        ? actor.kind === "EMPLOYEE"
          ? actor.id
          : actor.ownerId
        : null;
    },
    async verify(proof, transaction) {
      if (!contexts.has(transaction.verificationContext as object)) return null;
      return typeof proof === "string" ? (proofs.get(proof) ?? null) : null;
    },
  };
  const domain = new DelegatedBioFoundation(identity, repository);
  const employee = "employee-proof";
  const snapshot = () => structuredClone(state);
  const update = (action: (draft: BioDelegationState) => void) =>
    repository.transaction(ownerId, async ({ state: draft }) => action(draft));
  async function assistant(content = true, privacy = false) {
    const row = await domain.createAssistant(employee, {
      profileContent: content,
      profilePrivacy: privacy,
    });
    const proof = "agent-proof-" + randomUUID();
    proofs.set(proof, { kind: "AGENT", id: row.id, ownerId, workspaceId });
    return { ...row, proof };
  }
  const approve = (
    agentId: string,
    bio: string | null = "Approved bio",
    expectedRevision = state.revision,
  ) =>
    domain.approve(employee, {
      agentId,
      bio,
      expectedRevision,
      approvalId: randomUUID(),
    });
  const human = (
    bio: string | null = "Human overwrite",
    expectedRevision = state.revision,
  ) =>
    domain.humanWrite(employee, {
      bio,
      expectedRevision,
      requestId: randomUUID(),
    });
  return {
    domain,
    employee,
    assistant,
    approve,
    human,
    snapshot,
    update,
    proofs,
    identity,
    repository,
    ownerId,
    workspaceId,
    failCommit: (value: boolean) => {
      failCommit = value;
    },
  };
}

describe("inactive delegated bio domain foundation", () => {
  it.each(["both", "identity", "repository"])(
    "fails closed without %s activation ports",
    async (missing) => {
      const f = fixture();
      const domain = new DelegatedBioFoundation(
        missing === "identity" || missing === "both" ? undefined : f.identity,
        missing === "repository" || missing === "both"
          ? undefined
          : f.repository,
      );
      await expect(
        domain.execute(
          { trusted: true, agentId: randomUUID() },
          { approvalId: randomUUID(), requestId: randomUUID() },
        ),
      ).rejects.toMatchObject({
        status: 503,
        response: { code: "DELEGATED_BIO_NOT_ACTIVATED" },
      });
      expect(f.snapshot().history).toEqual([]);
    },
  );
  it("requires trusted employee identity even for approval, human writes and reads", async () => {
    const f = fixture(),
      agent = await f.assistant();
    const forged = {
      kind: "EMPLOYEE",
      id: f.ownerId,
      workspaceId: f.workspaceId,
      trusted: true,
    };
    await expect(
      f.domain.approve(forged, {
        agentId: agent.id,
        approvalId: randomUUID(),
        expectedRevision: 0,
        bio: "Forged",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      f.domain.humanWrite(forged, {
        requestId: randomUUID(),
        expectedRevision: 0,
        bio: "Forged",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(f.domain.read(agent.proof)).rejects.toMatchObject({
      status: 403,
    });
    expect(f.snapshot().bio).toBe("Existing employee bio");
  });
  it("snapshots all owner keys, preserves effective union and permanently removes losses before regain", async () => {
    const f = fixture(),
      agent = await f.assistant();
    expect(agent.permissionKeys).toEqual(["sessions.read", "tasks.read"]);
    await f.update((state) =>
      applyBioOwnerPermissionChange(state, [
        "tasks.read",
        "sessions.read",
        "projects.read",
      ]),
    );
    expect(f.snapshot().assistants[0]!.permissionKeys).toEqual(
      agent.permissionKeys,
    );
    // Removing one role while another retains the same key is not effective loss.
    await f.update((state) =>
      applyBioOwnerPermissionChange(state, ["tasks.read", "sessions.read"]),
    );
    expect(f.snapshot().assistants[0]!.permissionKeys).toContain("tasks.read");
    await f.update((state) =>
      applyBioOwnerPermissionChange(state, ["sessions.read"]),
    );
    await f.update((state) =>
      applyBioOwnerPermissionChange(state, ["tasks.read", "sessions.read"]),
    );
    expect(f.snapshot().assistants[0]!.permissionKeys).toEqual([
      "sessions.read",
    ]);
    await f.domain.setAssistantAccess(f.employee, {
      agentId: agent.id,
      enabled: true,
      permissionKeys: ["tasks.read"],
      profileContent: true,
      profilePrivacy: false,
    });
    expect(f.snapshot().assistants[0]!.permissionKeys).toEqual(["tasks.read"]);
    await expect(
      f.domain.setAssistantAccess(f.employee, {
        agentId: agent.id,
        enabled: true,
        permissionKeys: ["authorization.manage"],
        profileContent: true,
        profilePrivacy: false,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      f.domain.createAssistant(agent.proof, {
        profileContent: true,
        profilePrivacy: true,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("records exact manual approval, writes atomically and clears the badge on human overwrite without erasing history", async () => {
    const f = fixture(),
      agent = await f.assistant();
    const approval = await f.approve(agent.id),
      before = f.snapshot();
    expect(before.bio).toBe("Existing employee bio");
    expect(before.aiBadge).toBe(false);
    expect(before.approvals[0]).toMatchObject({
      approvedBy: f.ownerId,
      bio: "Approved bio",
      revision: 0,
    });
    const input = { approvalId: approval.approvalId, requestId: randomUUID() };
    const saved = await f.domain.execute(agent.proof, input);
    expect(saved).toMatchObject({
      bio: "Approved bio",
      revision: 1,
      aiBadge: true,
      actor: { kind: "AGENT", id: agent.id, ownerId: f.ownerId },
    });
    const human = await f.human();
    expect(human).toMatchObject({ aiBadge: false, revision: 2 });
    expect(await f.domain.execute(agent.proof, input)).toEqual(saved);
    const current = await f.domain.read(f.employee);
    expect(current).toMatchObject({
      bio: "Human overwrite",
      revision: 2,
      aiBadge: false,
    });
    expect(current.history.map((row) => row.outcome.actor.kind)).toEqual([
      "AGENT",
      "EMPLOYEE",
    ]);
    expect(current.history[0]).toMatchObject({
      before: "Existing employee bio",
      after: "Approved bio",
      approvalId: approval.approvalId,
    });
    current.history[0]!.outcome.bio = "Mutated returned copy";
    expect((await f.domain.read(f.employee)).history[0]!.after).toBe(
      "Approved bio",
    );
  });
  it("does not borrow employee identity, another assistant's approval or privacy-only capability", async () => {
    const f = fixture(),
      agent = await f.assistant(),
      second = await f.assistant(),
      privacy = await f.assistant(false, true);
    const approval = await f.approve(agent.id),
      input = { approvalId: approval.approvalId, requestId: randomUUID() };
    for (const proof of [
      f.employee,
      second.proof,
      privacy.proof,
      { agentId: agent.id, ownerId: f.ownerId, trusted: true },
    ])
      await expect(f.domain.execute(proof, input)).rejects.toMatchObject({
        status: 403,
      });
    await expect(
      f.domain.approve(agent.proof, {
        approvalId: randomUUID(),
        agentId: agent.id,
        expectedRevision: 0,
        bio: "Self-approved",
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.snapshot().history).toEqual([]);
  });
  it.each(["audiences", "contacts", "ownerId", "agentId", "bio", "trusted"])(
    "rejects forged %s on delegated execution",
    async (key) => {
      const f = fixture(),
        agent = await f.assistant(),
        approval = await f.approve(agent.id);
      await expect(
        f.domain.execute(agent.proof, {
          approvalId: approval.approvalId,
          requestId: randomUUID(),
          [key]: "Forged",
        } as any),
      ).rejects.toMatchObject({ status: 400 });
      expect(f.snapshot().approvals[0]!.usedBy).toBeNull();
      expect(f.snapshot().revision).toBe(0);
    },
  );
  it("binds approval to exact revision and content and requires a new approval after intervening human changes", async () => {
    const f = fixture(),
      agent = await f.assistant(),
      approvalId = randomUUID();
    const input = {
      approvalId,
      agentId: agent.id,
      expectedRevision: 0,
      bio: "Exact replacement",
    };
    expect(await f.domain.approve(f.employee, input)).toEqual(
      await f.domain.approve(f.employee, input),
    );
    await expect(
      f.domain.approve(f.employee, { ...input, bio: "Different" }),
    ).rejects.toMatchObject({ status: 409 });
    await f.human();
    await expect(
      f.domain.execute(agent.proof, { approvalId, requestId: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    const fresh = await f.approve(agent.id, "New manually approved value");
    expect(
      (
        await f.domain.execute(agent.proof, {
          approvalId: fresh.approvalId,
          requestId: randomUUID(),
        })
      ).bio,
    ).toBe("New manually approved value");
  });
  it("converges concurrent duplicate execution and conflicts with a second distinct execution", async () => {
    const f = fixture(),
      agent = await f.assistant(),
      approval = await f.approve(agent.id);
    const input = { approvalId: approval.approvalId, requestId: randomUUID() };
    const results = await Promise.all(
      Array.from({ length: 6 }, () => f.domain.execute(agent.proof, input)),
    );
    expect(
      results.every(
        (row) => JSON.stringify(row) === JSON.stringify(results[0]),
      ),
    ).toBe(true);
    await expect(
      f.domain.execute(agent.proof, { ...input, requestId: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.snapshot().history).toHaveLength(1);
  });
  it("permits only one human/agent or competing-agent replacement at a revision", async () => {
    for (const humanRace of [true, false]) {
      const f = fixture(),
        agent = await f.assistant(),
        second = await f.assistant();
      const one = await f.approve(agent.id, "One"),
        two = await f.approve(second.id, "Two");
      const outcomes = await Promise.allSettled([
        f.domain.execute(agent.proof, {
          approvalId: one.approvalId,
          requestId: randomUUID(),
        }),
        humanRace
          ? f.human("Human", 0)
          : f.domain.execute(second.proof, {
              approvalId: two.approvalId,
              requestId: randomUUID(),
            }),
      ]);
      expect(outcomes.filter((row) => row.status === "fulfilled")).toHaveLength(
        1,
      );
      expect(f.snapshot().history).toHaveLength(1);
      expect(f.snapshot().revision).toBe(1);
    }
  });
  it.each(["link", "content", "owner", "credential", "workspace"])(
    "rechecks current %s authority even for saved replay",
    async (loss) => {
      const f = fixture(),
        agent = await f.assistant(),
        approval = await f.approve(agent.id);
      const input = {
        approvalId: approval.approvalId,
        requestId: randomUUID(),
      };
      await f.domain.execute(agent.proof, input);
      await f.update((state) => {
        if (loss === "link") state.assistants[0]!.enabled = false;
        if (loss === "content") state.assistants[0]!.profileContent = false;
        if (loss === "owner") state.ownerOpen = false;
      });
      if (loss === "credential") f.proofs.delete(agent.proof);
      if (loss === "workspace")
        f.proofs.set(agent.proof, {
          kind: "AGENT",
          id: agent.id,
          ownerId: f.ownerId,
          workspaceId: randomUUID(),
        });
      await expect(f.domain.execute(agent.proof, input)).rejects.toMatchObject({
        status: 403,
      });
      expect(f.snapshot().history).toHaveLength(1);
    },
  );
  it("rolls approval use, revision, content, badge and audit back together on simulated persistence failure", async () => {
    const f = fixture(),
      agent = await f.assistant(),
      approval = await f.approve(agent.id);
    const before = f.snapshot(),
      input = { approvalId: approval.approvalId, requestId: randomUUID() };
    f.failCommit(true);
    await expect(f.domain.execute(agent.proof, input)).rejects.toThrow(
      "Injected atomic commit failure",
    );
    expect(f.snapshot()).toEqual(before);
    f.failCommit(false);
    expect((await f.domain.execute(agent.proof, input)).revision).toBe(1);
  });
  it("reconciles an uncertain committed outcome and rejects request-ID reuse across actors or approvals", async () => {
    const f = fixture(),
      agent = await f.assistant(),
      approval = await f.approve(agent.id);
    const input = { approvalId: approval.approvalId, requestId: randomUUID() };
    await f.domain.execute(agent.proof, input); // Simulate dropping the acknowledgment.
    expect((await f.domain.execute(agent.proof, input)).revision).toBe(1);
    await expect(
      f.domain.humanWrite(f.employee, {
        requestId: input.requestId,
        expectedRevision: 0,
        bio: "Approved bio",
      }),
    ).rejects.toMatchObject({ status: 409 });
    const next = await f.approve(agent.id);
    await expect(
      f.domain.execute(agent.proof, { ...input, approvalId: next.approvalId }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it.each([null, "", "b".repeat(1000), "🚀".repeat(1000)])(
    "retains existing bio clear/empty/maximum text semantics: %#",
    async (bio) => {
      const f = fixture(),
        agent = await f.assistant(),
        approval = await f.approve(agent.id, bio);
      expect(
        (
          await f.domain.execute(agent.proof, {
            approvalId: approval.approvalId,
            requestId: randomUUID(),
          })
        ).bio,
      ).toBe(bio);
    },
  );
  it("rejects oversized text and stale or forged human requests without state change", async () => {
    const f = fixture(),
      agent = await f.assistant(),
      before = f.snapshot();
    await expect(f.approve(agent.id, "b".repeat(1001))).rejects.toMatchObject({
      status: 400,
    });
    await expect(f.approve(agent.id, "✈️".repeat(1000))).rejects.toMatchObject({
      status: 400,
    });
    await expect(f.human("Stale", 1)).rejects.toMatchObject({ status: 409 });
    await expect(
      f.domain.humanWrite(f.employee, {
        requestId: randomUUID(),
        expectedRevision: 0,
        bio: "Value",
        audiences: [],
      } as any),
    ).rejects.toMatchObject({ status: 400 });
    expect(f.snapshot()).toEqual(before);
  });
  it("reverifies proof within the transaction and rejects stale permission state until the loss hook commits", async () => {
    const f = fixture(),
      agent = await f.assistant(),
      approval = await f.approve(agent.id);
    await f.update((state) => {
      state.ownerPermissionKeys = ["sessions.read"];
    });
    await expect(
      f.domain.execute(agent.proof, {
        approvalId: approval.approvalId,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 403 });
    await f.update((state) =>
      applyBioOwnerPermissionChange(state, ["sessions.read"]),
    );
    const identify = f.identity.employeeSubject.bind(f.identity);
    jest
      .spyOn(f.identity, "employeeSubject")
      .mockImplementation(async (proof) => {
        const subject = await identify(proof);
        f.proofs.delete(agent.proof);
        return subject;
      });
    await expect(
      f.domain.execute(agent.proof, {
        approvalId: approval.approvalId,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.snapshot().history).toEqual([]);
  });
  it("allowlists actual actor fields and rejects an unrelated linked identity", async () => {
    const f = fixture(),
      agent = await f.assistant(),
      approval = await f.approve(agent.id);
    const proofActor = f.proofs.get(agent.proof)!;
    const enrichedActor = {
      ...proofActor,
      credential: "PRIVATE ADAPTER FIELD",
    };
    f.proofs.set(agent.proof, enrichedActor);
    const outcome = await f.domain.execute(agent.proof, {
      approvalId: approval.approvalId,
      requestId: randomUUID(),
    });
    expect(outcome.actor).not.toHaveProperty("credential");
    f.proofs.set(agent.proof, {
      kind: "AGENT",
      id: randomUUID(),
      ownerId: f.ownerId,
      workspaceId: f.workspaceId,
    });
    await expect(
      f.domain.execute(agent.proof, {
        approvalId: approval.approvalId,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("replays human writes without clearing a later agent badge or rewriting history", async () => {
    const f = fixture(),
      agent = await f.assistant();
    const input = {
      requestId: randomUUID(),
      expectedRevision: 0,
      bio: "Human",
    };
    const saved = await f.domain.humanWrite(f.employee, input),
      approval = await f.approve(agent.id);
    await f.domain.execute(agent.proof, {
      approvalId: approval.approvalId,
      requestId: randomUUID(),
    });
    expect(await f.domain.humanWrite(f.employee, input)).toEqual(saved);
    expect(f.snapshot()).toMatchObject({
      revision: 2,
      bio: "Approved bio",
      aiBadge: true,
    });
  });
});
