import { randomBytes } from "node:crypto";
import { InlineKeyboard } from "grammy";
import { AuthenticatedUser } from "../auth/auth.types";
import {
  ModelCatalogService,
  ResolvedModelSelection,
} from "../sessions/model-catalog.service";
import { TelegramService } from "./telegram.service";

export type SavedModelSettings = {
  providerId: string;
  model: string | null;
  reasoningEffort: string | null;
};
type Entry = {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
};
type Draft = {
  userId: string;
  workspaceId: string;
  chatId: bigint;
  telegramUserId?: bigint;
  messageId: number;
  nonce: string;
  revision: number;
  expiresAt: number;
  page: number;
  detail: boolean;
  base: SavedModelSettings;
  selection: ResolvedModelSelection | null;
  entries: Entry[];
};
const PAGE_SIZE = 8;
const TTL_MS = 10 * 60_000;
const pattern =
  /^mp:([A-Za-z0-9_-]{8}):([0-9a-z]{1,6}):(m|e|p|b|ok|x)(?::([0-9a-z]{1,4}))?$/;

/** Ephemeral UI drafts only. Lost/restarted/stale panels cannot save settings. */
export class TelegramModelPanel {
  private readonly drafts = new Map<string, Draft>();
  constructor(
    private readonly catalog: ModelCatalogService,
    private readonly telegram: TelegramService,
    private readonly save: (
      actor: AuthenticatedUser,
      chatId: bigint,
      base: SavedModelSettings,
      selection: ResolvedModelSelection,
      telegramUserId?: bigint,
    ) => Promise<number>,
    private readonly now = () => Date.now(),
  ) {}

  feedback(
    actor: AuthenticatedUser,
    chatId: bigint,
    messageId: number,
    data: string,
    telegramUserId?: bigint,
  ) {
    return this.match(actor, chatId, messageId, data, telegramUserId)
      ? "Updating model settings…"
      : "These buttons are old or closed. Use the latest panel or /model.";
  }

  async open(
    actor: AuthenticatedUser,
    chatId: bigint,
    base: SavedModelSettings,
    messageId?: number,
    telegramUserId?: bigint,
  ) {
    for (const [key, value] of this.drafts)
      if (value.expiresAt <= this.now()) this.drafts.delete(key);
    const current = this.drafts.get(actor.id);
    if (
      current &&
      current.workspaceId === actor.workspaceId &&
      current.chatId === chatId &&
      current.telegramUserId === telegramUserId &&
      (messageId === undefined || messageId === current.messageId)
    ) {
      const rendered = this.render(current);
      await this.telegram.editMessage(
        chatId,
        current.messageId,
        rendered.text,
        rendered.keyboard,
      );
      return;
    }
    let selection: ResolvedModelSelection | null = null;
    try {
      selection = this.catalog.resolve(
        base.providerId,
        base.model ?? undefined,
        base.reasoningEffort ?? undefined,
      );
    } catch {
      /* Invalid legacy configuration must be selected again, not silently saved. */
    }
    const entries = this.catalog.list().flatMap((p) =>
      p.models.map((m) => ({
        providerId: p.id,
        providerName: p.displayName,
        modelId: m.id,
        modelName: m.displayName,
      })),
    );
    const draft: Draft = {
      userId: actor.id,
      workspaceId: actor.workspaceId,
      chatId,
      ...(telegramUserId === undefined ? {} : { telegramUserId }),
      messageId: messageId ?? 0,
      nonce: randomBytes(6).toString("base64url"),
      revision: 0,
      expiresAt: this.now() + TTL_MS,
      page: 0,
      detail: false,
      base: {
        providerId: base.providerId,
        model: base.model,
        reasoningEffort: base.reasoningEffort,
      },
      selection,
      entries,
    };
    const rendered = this.render(draft);
    if (messageId !== undefined)
      await this.telegram.editMessage(
        chatId,
        messageId,
        rendered.text,
        rendered.keyboard,
      );
    else
      draft.messageId = (
        await this.telegram.sendMessage(
          chatId,
          rendered.text,
          rendered.keyboard,
        )
      ).message_id;
    this.drafts.set(actor.id, draft);
  }

  async cancel(actor: AuthenticatedUser, chatId: bigint) {
    const draft = this.drafts.get(actor.id);
    if (
      !draft ||
      draft.workspaceId !== actor.workspaceId ||
      draft.chatId !== chatId
    )
      return false;
    this.drafts.delete(actor.id);
    await this.closed(
      draft,
      "Model changes cancelled. Saved settings, selected project and session are unchanged.",
    );
    return true;
  }

  async handle(
    actor: AuthenticatedUser,
    chatId: bigint,
    messageId: number,
    data: string,
    telegramUserId?: bigint,
  ) {
    const matched = this.match(actor, chatId, messageId, data, telegramUserId);
    if (!matched) return;
    const { draft, parts } = matched,
      action = parts[3],
      arg = parts[4];
    if (["b", "ok", "x"].includes(action!) && arg !== undefined) return;
    if (action === "x") {
      await this.cancel(actor, chatId);
      return;
    }
    if (action === "ok") {
      if (!draft.selection) return;
      let selection: ResolvedModelSelection;
      try {
        selection = this.catalog.resolve(
          draft.selection.providerId,
          draft.selection.effectiveModel,
          draft.selection.effectiveReasoningEffort,
        );
      } catch {
        this.drafts.delete(actor.id);
        await this.closed(
          draft,
          "The configured catalog changed. Nothing was saved. Open Models and choose again.",
        );
        return;
      }
      // Close before I/O: duplicate callbacks cannot retry an uncertain save.
      this.drafts.delete(actor.id);
      let count: number;
      try {
        count = await this.save(
          actor,
          chatId,
          draft.base,
          selection,
          draft.telegramUserId,
        );
      } catch {
        await this.closed(
          draft,
          "The save result could not be confirmed. Open Models to read current settings. No task was started.",
        );
        return;
      }
      await this.closed(
        draft,
        count === 1
          ? `Saved for new sessions: ${this.label(draft, selection)}.\nSelected project and session are unchanged. No task was started.`
          : "Settings or access changed while this panel was open. Nothing was overwritten. Open Models to read current settings.",
      );
      return;
    }
    const next = { ...draft, revision: draft.revision + 1 };
    if (action === "b") next.detail = false;
    else if (action === "p") {
      if (arg === undefined) return;
      const page = parseInt(arg, 36),
        max = Math.max(0, Math.ceil(draft.entries.length / PAGE_SIZE) - 1);
      if (!Number.isSafeInteger(page) || page > max) return;
      next.page = page;
      next.detail = false;
    } else if (action === "m") {
      if (arg === undefined) return;
      const index = parseInt(arg, 36),
        entry = draft.entries[index];
      if (!entry || Math.floor(index / PAGE_SIZE) !== draft.page) return;
      try {
        const unchanged =
          draft.selection?.providerId === entry.providerId &&
          draft.selection.effectiveModel === entry.modelId;
        next.selection = this.catalog.resolve(
          entry.providerId,
          entry.modelId,
          unchanged ? draft.selection!.effectiveReasoningEffort : undefined,
        );
      } catch {
        return;
      }
      next.detail = true;
    } else if (action === "e") {
      if (!draft.detail || !draft.selection || arg === undefined) return;
      const model = this.catalog
        .list(draft.selection.providerId)[0]
        ?.models.find((m) => m.id === draft.selection!.effectiveModel);
      const effort = model?.supportedReasoningEfforts[parseInt(arg, 36)];
      if (!effort) return;
      next.selection = this.catalog.resolve(
        draft.selection.providerId,
        draft.selection.effectiveModel,
        effort,
      );
    } else return;
    const rendered = this.render(next);
    // Keep old buttons valid if an edit fails; never post another navigation message.
    await this.telegram.editMessage(
      chatId,
      messageId,
      rendered.text,
      rendered.keyboard,
    );
    this.drafts.set(actor.id, next);
  }

  private match(
    actor: AuthenticatedUser,
    chatId: bigint,
    messageId: number,
    data: string,
    telegramUserId?: bigint,
  ) {
    const parts = data.match(pattern),
      draft = this.drafts.get(actor.id);
    if (
      !parts ||
      !draft ||
      draft.workspaceId !== actor.workspaceId ||
      draft.chatId !== chatId ||
      draft.telegramUserId !== telegramUserId ||
      draft.messageId !== messageId ||
      draft.expiresAt <= this.now() ||
      parts[1] !== draft.nonce ||
      parseInt(parts[2]!, 36) !== draft.revision
    )
      return null;
    return { draft, parts };
  }
  private label(draft: Draft, selection: ResolvedModelSelection) {
    const entry = draft.entries.find(
      (e) =>
        e.providerId === selection.providerId &&
        e.modelId === selection.effectiveModel,
    );
    return `${entry?.modelName ?? selection.effectiveModel} · ${entry?.providerName ?? selection.providerId} · ${selection.effectiveReasoningEffort}`;
  }
  private render(draft: Draft) {
    const keyboard = new InlineKeyboard();
    const callback = (action: string, arg?: number) =>
      `mp:${draft.nonce}:${draft.revision.toString(36)}:${action}${arg === undefined ? "" : ":" + arg.toString(36)}`;
    let body: string;
    if (draft.detail && draft.selection) {
      const model = this.catalog
        .list(draft.selection.providerId)[0]
        ?.models.find((m) => m.id === draft.selection!.effectiveModel);
      if (!model) throw new Error("Configured model changed");
      body = `Choose reasoning effort (model default: ${model.defaultReasoningEffort}).`;
      model.supportedReasoningEfforts.forEach((effort, index) => {
        keyboard.text(
          `${effort === draft.selection!.effectiveReasoningEffort ? "✓ " : ""}${effort}`,
          callback("e", index),
        );
        if (index % 3 === 2) keyboard.row();
      });
      keyboard.row().text("Back to models", callback("b")).row();
    } else {
      const pages = Math.max(1, Math.ceil(draft.entries.length / PAGE_SIZE));
      body = `Choose a model directly · page ${draft.page + 1}/${pages}.`;
      draft.entries
        .slice(draft.page * PAGE_SIZE, (draft.page + 1) * PAGE_SIZE)
        .forEach((entry, index) => {
          const selected =
            draft.selection?.providerId === entry.providerId &&
            draft.selection.effectiveModel === entry.modelId;
          keyboard
            .text(
              `${selected ? "✓ " : ""}${entry.modelName} · ${entry.providerName}`.slice(
                0,
                60,
              ),
              callback("m", draft.page * PAGE_SIZE + index),
            )
            .row();
        });
      if (draft.page > 0)
        keyboard.text("Previous", callback("p", draft.page - 1));
      if (draft.page + 1 < pages)
        keyboard.text("Next", callback("p", draft.page + 1));
      keyboard.row();
    }
    if (draft.selection) keyboard.text("Confirm", callback("ok"));
    keyboard.text("Cancel", callback("x"));
    const saved = `${draft.base.model ?? "provider default"} · ${draft.base.providerId} · ${draft.base.reasoningEffort ?? "model default"}`;
    const text = `Model & reasoning\nSaved: ${saved}\nDraft: ${draft.selection ? this.label(draft, draft.selection) : "Choose a supported model"}\n\n${body}\nConfirm saves only these settings for new sessions. Until then, messages use saved settings. Running work is unchanged.\nConfigured catalog only; provider access is not verified here. Panel expires in 10 minutes.`;
    return { text, keyboard };
  }
  private closed(draft: Draft, text: string) {
    return this.telegram.editMessage(
      draft.chatId,
      draft.messageId,
      text,
      new InlineKeyboard().text("Models", "models").text("Menu", "home"),
    );
  }
}
