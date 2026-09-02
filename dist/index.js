// src/index.ts
import { homedir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { join as join3 } from "node:path";

// src/config/store.ts
import { join } from "node:path";
import { access, readFile, writeFile, mkdir } from "node:fs/promises";

// src/config/schema.ts
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
var UxPreferencesSchema = Type.Object({
  richText: Type.Optional(Type.Boolean()),
  streamPreviews: Type.Optional(Type.Boolean()),
  richTables: Type.Optional(Type.Boolean())
}, { additionalProperties: false });
var DEFAULT_UX = {
  richText: true,
  streamPreviews: true,
  richTables: true
};
var PigramConfigSchema = Type.Object({
  botToken: Type.String({ minLength: 1 }),
  ux: Type.Optional(UxPreferencesSchema)
}, { additionalProperties: false });
function validateConfig(input) {
  if (!Value.Check(PigramConfigSchema, input)) {
    const errors = [...Value.Errors(PigramConfigSchema, input)].map((err) => `${err.path}: ${err.message}`);
    return { ok: false, errors };
  }
  const config = {
    ...input,
    ux: input.ux ? { ...DEFAULT_UX, ...input.ux } : { ...DEFAULT_UX }
  };
  return { ok: true, config };
}

// src/config/store.ts
async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
function getProjectPaths(cwd) {
  const configPath = join(cwd, ".pi", "pigram.json");
  const tempDir = join(cwd, ".pi", "tmp", "pigram");
  const statePath = join(tempDir, "state.json");
  return { scope: "project", configPath, statePath, tempDir };
}
function getGlobalPaths(homeDir) {
  const configPath = join(homeDir, ".pi", "agent", "pigram.json");
  const tempDir = join(homeDir, ".pi", "agent", "tmp", "pigram");
  const statePath = join(tempDir, "state.json");
  return { scope: "global", configPath, statePath, tempDir };
}
async function resolveScope(opts) {
  const projectPaths = getProjectPaths(opts.cwd);
  const globalPaths = getGlobalPaths(opts.homeDir);
  if (opts.scope === "project")
    return projectPaths;
  if (opts.scope === "global")
    return globalPaths;
  if (await pathExists(projectPaths.configPath))
    return projectPaths;
  if (await pathExists(globalPaths.configPath))
    return globalPaths;
  return projectPaths;
}
async function readConfig(paths) {
  if (!await pathExists(paths.configPath)) {
    return null;
  }
  const content = await readFile(paths.configPath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`Failed to parse config at ${paths.configPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const result = validateConfig(parsed);
  if (!result.ok) {
    throw new Error(`Invalid config at ${paths.configPath}: ${result.errors.join(", ")}`);
  }
  return result.config;
}
async function writeConfig(paths, config) {
  const dir = join(paths.configPath, "..");
  await mkdir(dir, { recursive: true });
  await writeFile(paths.configPath, JSON.stringify(config, null, 2) + `
`, "utf8");
}
async function readState(paths) {
  if (!await pathExists(paths.statePath)) {
    return { lastUpdateId: 0 };
  }
  const content = await readFile(paths.statePath, "utf8");
  const state = JSON.parse(content);
  return state;
}
async function writeState(paths, state) {
  await mkdir(paths.tempDir, { recursive: true });
  await writeFile(paths.statePath, JSON.stringify(state, null, 2) + `
`, "utf8");
}
var PIGRAM_GITIGNORE_COMMENT = "# pigram local secrets/cache";
var PIGRAM_GITIGNORE_CONFIG_ENTRY = ".pi/pigram.json";
var PIGRAM_GITIGNORE_TEMP_ENTRY = ".pi/tmp/";
var PIGRAM_GITIGNORE_BLOCK = `${PIGRAM_GITIGNORE_COMMENT}
${PIGRAM_GITIGNORE_CONFIG_ENTRY}
${PIGRAM_GITIGNORE_TEMP_ENTRY}
`;
async function ensureProjectGitignore(cwd) {
  await mkdir(cwd, { recursive: true });
  const gitignorePath = join(cwd, ".gitignore");
  let existing = "";
  try {
    existing = await readFile(gitignorePath, "utf8");
  } catch {}
  const hasConfigEntry = existing.includes(`${PIGRAM_GITIGNORE_CONFIG_ENTRY}
`) || existing.endsWith(PIGRAM_GITIGNORE_CONFIG_ENTRY);
  const hasTempEntry = existing.includes(`${PIGRAM_GITIGNORE_TEMP_ENTRY}
`) || existing.endsWith(PIGRAM_GITIGNORE_TEMP_ENTRY);
  if (hasConfigEntry && hasTempEntry)
    return;
  const prefix = existing.length > 0 && !existing.endsWith(`
`) ? `${existing}
` : existing;
  await writeFile(gitignorePath, prefix + PIGRAM_GITIGNORE_BLOCK, "utf8");
}

// src/config/lock.ts
import { writeFile as writeFile2, readFile as readFile2, unlink, mkdir as mkdir2 } from "node:fs/promises";
import { dirname } from "node:path";
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function tryAcquireLock(lockPath, tokenHash) {
  const now = new Date().toISOString();
  const payload = {
    pid: process.pid,
    tokenHash,
    startedAt: now,
    heartbeat: now
  };
  await mkdir2(dirname(lockPath), { recursive: true });
  try {
    await writeFile2(lockPath, JSON.stringify(payload), { flag: "wx" });
    return { acquired: true };
  } catch (err) {
    if (!(err instanceof Error) || err.code !== "EEXIST") {
      throw err;
    }
    let existing;
    try {
      existing = JSON.parse(await readFile2(lockPath, "utf8"));
    } catch {
      await writeFile2(lockPath, JSON.stringify(payload));
      const verify2 = JSON.parse(await readFile2(lockPath, "utf8"));
      return verify2.pid === process.pid ? { acquired: true } : { acquired: false, holderPid: verify2.pid, holderSince: verify2.startedAt };
    }
    if (existing.pid === process.pid) {
      return { acquired: true };
    }
    if (existing.tokenHash !== tokenHash) {
      await writeFile2(lockPath, JSON.stringify(payload));
      const verify2 = JSON.parse(await readFile2(lockPath, "utf8"));
      return verify2.pid === process.pid ? { acquired: true } : { acquired: false, holderPid: verify2.pid, holderSince: verify2.startedAt };
    }
    if (isPidAlive(existing.pid)) {
      return { acquired: false, holderPid: existing.pid, holderSince: existing.startedAt };
    }
    await writeFile2(lockPath, JSON.stringify(payload));
    const verify = JSON.parse(await readFile2(lockPath, "utf8"));
    return verify.pid === process.pid ? { acquired: true } : { acquired: false, holderPid: verify.pid, holderSince: verify.startedAt };
  }
}
async function releaseLock(lockPath) {
  await unlink(lockPath).catch(() => {});
}
async function touchHeartbeat(lockPath) {
  try {
    const existing = JSON.parse(await readFile2(lockPath, "utf8"));
    if (existing.pid === process.pid) {
      existing.heartbeat = new Date().toISOString();
      await writeFile2(lockPath, JSON.stringify(existing));
    }
  } catch {}
}
function startHeartbeat(lockPath, intervalMs = 1e4) {
  const timer = setInterval(() => {
    touchHeartbeat(lockPath);
  }, intervalMs);
  if (typeof timer === "object" && "unref" in timer) {
    timer.unref();
  }
  return () => clearInterval(timer);
}

// src/config/migrate.ts
import { join as join2 } from "node:path";
import { access as access2, readFile as readFile3 } from "node:fs/promises";
async function pathExists2(path) {
  try {
    await access2(path);
    return true;
  } catch {
    return false;
  }
}
function getLegacyPath(opts) {
  if (opts.scope === "project") {
    return join2(opts.cwd, ".pi", "telegram.json");
  } else {
    return join2(opts.homeDir, ".pi", "agent", "telegram.json");
  }
}
async function migrateLegacyConfig(opts) {
  const paths = await resolveScope({
    cwd: opts.cwd,
    homeDir: opts.homeDir,
    scope: opts.scope
  });
  if (await pathExists2(paths.configPath)) {
    return { status: "skipped-existing" };
  }
  const legacyPath = getLegacyPath(opts);
  if (!await pathExists2(legacyPath)) {
    return { status: "no-legacy" };
  }
  let legacyContent;
  try {
    legacyContent = await readFile3(legacyPath, "utf8");
  } catch (err) {
    return {
      status: "error",
      message: `Failed to read legacy config: ${err instanceof Error ? err.message : String(err)}`
    };
  }
  let legacy;
  try {
    legacy = JSON.parse(legacyContent);
  } catch (err) {
    return {
      status: "error",
      message: `Failed to parse legacy config: ${err instanceof Error ? err.message : String(err)}`
    };
  }
  if (!legacy.botToken || legacy.botToken.trim().length === 0) {
    return {
      status: "error",
      message: "Legacy config missing required botToken field"
    };
  }
  const newConfig = {
    botToken: legacy.botToken,
    ux: {
      richText: legacy.richText ?? true,
      streamPreviews: legacy.streamPreviews ?? true
    }
  };
  const newState = {
    lastUpdateId: legacy.lastUpdateId ?? 0
  };
  if (legacy.allowedUserId !== undefined) {
    newState.pairedUserId = legacy.allowedUserId;
  }
  if (legacy.botId !== undefined) {
    newState.botId = legacy.botId;
  }
  if (legacy.botUsername !== undefined) {
    newState.botUsername = legacy.botUsername;
  }
  try {
    await writeConfig(paths, newConfig);
    await writeState(paths, newState);
  } catch (err) {
    return {
      status: "error",
      message: `Failed to write new config/state: ${err instanceof Error ? err.message : String(err)}`
    };
  }
  return {
    status: "migrated",
    configPath: paths.configPath,
    statePath: paths.statePath
  };
}

// src/telegram/transport.ts
import { readFile as readFile4, mkdir as mkdir3, writeFile as writeFile3 } from "node:fs/promises";
import { dirname as dirname2 } from "node:path";

// src/telegram/errors.ts
class TelegramRateLimitError extends Error {
  retryAfterSeconds;
  constructor(retryAfterSeconds, message) {
    super(message ?? `Telegram 429: retry after ${retryAfterSeconds}s`);
    this.name = "TelegramRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
function getRetryAfterSeconds(err) {
  if (err instanceof TelegramRateLimitError) {
    return err.retryAfterSeconds;
  }
  if (err instanceof Error) {
    const msg = err.message;
    const match = msg.match(/retry[_ ]?(?:after)?[:\s]+(\d+)/i);
    if (match) {
      const seconds = Number(match[1]);
      if (Number.isFinite(seconds) && seconds > 0)
        return seconds;
    }
  }
  return;
}

// src/telegram/transport.ts
function createHttpTransport(opts) {
  const { botToken, fetchImpl = globalThis.fetch } = opts;
  async function callTelegram(method, body, options) {
    const fetchOptions = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    };
    if (options?.signal) {
      fetchOptions.signal = options.signal;
    }
    const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/${method}`, fetchOptions);
    if (response.status === 429) {
      let retryAfter = 1;
      try {
        const data2 = await response.json();
        if (data2.parameters?.retry_after !== undefined) {
          retryAfter = data2.parameters.retry_after;
        }
      } catch {}
      throw new TelegramRateLimitError(retryAfter);
    }
    const data = await response.json();
    if (!data.ok || data.result === undefined) {
      throw new Error(data.description ?? `Telegram API ${method} failed`);
    }
    return data.result;
  }
  async function callTelegramMultipart(method, fields, fileField, filePath, fileName) {
    const form = new FormData;
    for (const [key, value] of Object.entries(fields)) {
      form.set(key, value);
    }
    const buffer = await readFile4(filePath);
    form.set(fileField, new Blob([buffer]), fileName);
    const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: "POST",
      body: form
    });
    const data = await response.json();
    if (!data.ok || data.result === undefined) {
      throw new Error(data.description ?? `Telegram API ${method} failed`);
    }
    return data.result;
  }
  return {
    async getMe() {
      return callTelegram("getMe", {});
    },
    async getUpdates(opts2, signal) {
      const body = {};
      if (opts2.offset !== undefined)
        body.offset = opts2.offset;
      if (opts2.timeout !== undefined)
        body.timeout = opts2.timeout;
      const callOptions = signal ? { signal } : undefined;
      return callTelegram("getUpdates", body, callOptions);
    },
    async sendMessage(opts2) {
      const body = {
        chat_id: opts2.chatId,
        text: opts2.text
      };
      if (opts2.parseMode !== undefined)
        body.parse_mode = opts2.parseMode;
      if (opts2.replyMarkup !== undefined)
        body.reply_markup = opts2.replyMarkup;
      return callTelegram("sendMessage", body);
    },
    async editMessageText(opts2) {
      const body = {
        chat_id: opts2.chatId,
        message_id: opts2.messageId,
        text: opts2.text
      };
      if (opts2.parseMode !== undefined)
        body.parse_mode = opts2.parseMode;
      if (opts2.replyMarkup !== undefined)
        body.reply_markup = opts2.replyMarkup;
      await callTelegram("editMessageText", body);
    },
    async sendRichMessage(opts2) {
      return callTelegram("sendRichMessage", {
        chat_id: opts2.chatId,
        rich_message: { markdown: opts2.markdown }
      });
    },
    async editMessageRich(opts2) {
      await callTelegram("editMessageText", {
        chat_id: opts2.chatId,
        message_id: opts2.messageId,
        rich_message: { markdown: opts2.markdown }
      });
    },
    async sendChatAction(opts2) {
      const body = {
        chat_id: opts2.chatId,
        action: opts2.action
      };
      await callTelegram("sendChatAction", body);
    },
    async answerCallbackQuery(opts2) {
      const body = {
        callback_query_id: opts2.callbackQueryId
      };
      if (opts2.text !== undefined)
        body.text = opts2.text;
      await callTelegram("answerCallbackQuery", body);
    },
    async sendDocument(opts2) {
      const fields = {
        chat_id: opts2.chatId.toString()
      };
      if (opts2.caption !== undefined)
        fields.caption = opts2.caption;
      return callTelegramMultipart("sendDocument", fields, "document", opts2.filePath, opts2.fileName);
    },
    async sendPhoto(opts2) {
      const fields = {
        chat_id: opts2.chatId.toString()
      };
      if (opts2.caption !== undefined)
        fields.caption = opts2.caption;
      return callTelegramMultipart("sendPhoto", fields, "photo", opts2.filePath, opts2.fileName);
    },
    async downloadFile(opts2) {
      const file = await callTelegram("getFile", {
        file_id: opts2.fileId
      });
      if (!file.file_path) {
        throw new Error("Telegram getFile returned no file_path");
      }
      const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
      const response = await fetchImpl(downloadUrl);
      if (!response.ok) {
        throw new Error(`Failed to download Telegram file: ${response.status}`);
      }
      await mkdir3(dirname2(opts2.destPath), { recursive: true });
      const arrayBuffer = await response.arrayBuffer();
      await writeFile3(opts2.destPath, Buffer.from(arrayBuffer));
      return opts2.destPath;
    }
  };
}

// src/log.ts
var LEVEL_ORDER = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100
};
function resolveLevel() {
  const raw = (process.env.PIGRAM_LOG ?? "warn").toLowerCase();
  if (raw in LEVEL_ORDER)
    return raw;
  return "warn";
}
var currentLevel = resolveLevel();
var sink = (line) => process.stderr.write(line);
function emit(level, msg, fields) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel])
    return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields
  });
  try {
    sink(`${line}
`);
  } catch {}
}
var log = {
  debug: (msg, fields) => emit("debug", msg, fields),
  info: (msg, fields) => emit("info", msg, fields),
  warn: (msg, fields) => emit("warn", msg, fields),
  error: (msg, fields) => emit("error", msg, fields)
};

// src/telegram/poller.ts
class TelegramPoller {
  transport;
  handler;
  getCursor;
  setCursor;
  pollTimeoutSeconds;
  onError;
  errorDelayMs;
  conflictDelayMs;
  maxErrorBackoffMs;
  consecutiveErrors = 0;
  constructor(deps) {
    this.transport = deps.transport;
    this.handler = deps.handler;
    this.getCursor = deps.getCursor;
    this.setCursor = deps.setCursor;
    this.pollTimeoutSeconds = deps.pollTimeoutSeconds ?? 30;
    this.onError = deps.onError;
    this.errorDelayMs = deps.errorDelayMs ?? 0;
    this.conflictDelayMs = deps.conflictDelayMs ?? 3000;
    this.maxErrorBackoffMs = deps.maxErrorBackoffMs ?? 30000;
  }
  async start(signal) {
    log.info("poller.start", { pollTimeout: this.pollTimeoutSeconds });
    while (!signal.aborted) {
      try {
        const offset = this.getCursor() + 1;
        const updates = await this.transport.getUpdates({
          offset,
          timeout: this.pollTimeoutSeconds
        }, signal);
        if (this.consecutiveErrors > 0) {
          log.info("poller.recovered", { after: this.consecutiveErrors });
        }
        this.consecutiveErrors = 0;
        for (const update of updates) {
          if (signal.aborted) {
            return;
          }
          await this.setCursor(update.update_id);
          await this.handler(update);
        }
      } catch (err) {
        if (signal.aborted) {
          return;
        }
        if (this.onError) {
          try {
            this.onError(err);
          } catch {}
        }
        const isConflict = this.isConflictError(err);
        const retryAfter = getRetryAfterSeconds(err);
        this.consecutiveErrors += 1;
        let delay;
        if (isConflict) {
          delay = this.conflictDelayMs;
        } else {
          delay = this.errorDelayMs * 2 ** (this.consecutiveErrors - 1);
          if (delay > this.maxErrorBackoffMs)
            delay = this.maxErrorBackoffMs;
        }
        if (retryAfter !== undefined) {
          const retryMs = retryAfter * 1000;
          if (retryMs > delay)
            delay = retryMs;
        }
        log.warn("poller.error", {
          error: err instanceof Error ? err.message : String(err),
          isConflict,
          retryAfter,
          consecutive: this.consecutiveErrors,
          delayMs: delay
        });
        if (delay > 0) {
          await this.sleep(delay, signal);
        }
      }
    }
    log.debug("poller.exit");
  }
  isConflictError(err) {
    if (!(err instanceof Error))
      return false;
    const msg = err.message.toLowerCase();
    return msg.includes("conflict") && msg.includes("getupdates");
  }
  sleep(ms, signal) {
    if (signal?.aborted)
      return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

// src/telegram/dialog.ts
class DialogManager {
  transport;
  chatId;
  idGen;
  timeoutMs;
  pendingSelects = new Map;
  pendingTextInput;
  idCounter = 0;
  constructor(deps) {
    this.transport = deps.transport;
    this.chatId = deps.chatId;
    this.idGen = deps.idGen ?? (() => `dialog_${++this.idCounter}`);
    if (deps.timeoutMs !== undefined) {
      this.timeoutMs = deps.timeoutMs;
    }
  }
  select(prompt, options) {
    const dialogId = this.idGen();
    const inline_keyboard = options.map((opt, index) => [
      {
        text: opt.label,
        callback_data: `${dialogId}:${index}`
      }
    ]);
    const messageIdPromise = this.transport.sendMessage({
      chatId: this.chatId,
      text: prompt,
      replyMarkup: { inline_keyboard }
    }).then((result) => result.message_id);
    const promise = new Promise((resolve, reject) => {
      const pending = {
        type: "select",
        messageIdPromise,
        prompt,
        options,
        resolve,
        reject
      };
      if (this.timeoutMs !== undefined) {
        const timeoutMs = this.timeoutMs;
        pending.timeoutHandle = setTimeout(() => {
          this.pendingSelects.delete(dialogId);
          reject(new Error("Dialog timed out"));
        }, timeoutMs);
      }
      this.pendingSelects.set(dialogId, pending);
      messageIdPromise.catch((error) => {
        this.pendingSelects.delete(dialogId);
        if (pending.timeoutHandle !== undefined) {
          clearTimeout(pending.timeoutHandle);
        }
        reject(error);
      });
    });
    return promise;
  }
  confirm(prompt) {
    const dialogId = this.idGen();
    const options = [
      { label: "Yes", value: "true" },
      { label: "No", value: "false" }
    ];
    const inline_keyboard = options.map((opt, index) => [
      {
        text: opt.label,
        callback_data: `${dialogId}:${index}`
      }
    ]);
    const messageIdPromise = this.transport.sendMessage({
      chatId: this.chatId,
      text: prompt,
      replyMarkup: { inline_keyboard }
    }).then((result) => result.message_id);
    const promise = new Promise((resolve, reject) => {
      const pending = {
        type: "confirm",
        messageIdPromise,
        prompt,
        options,
        resolve: (value) => resolve(value === "true"),
        reject
      };
      if (this.timeoutMs !== undefined) {
        const timeoutMs = this.timeoutMs;
        pending.timeoutHandle = setTimeout(() => {
          this.pendingSelects.delete(dialogId);
          reject(new Error("Dialog timed out"));
        }, timeoutMs);
      }
      this.pendingSelects.set(dialogId, pending);
      messageIdPromise.catch((error) => {
        this.pendingSelects.delete(dialogId);
        if (pending.timeoutHandle !== undefined) {
          clearTimeout(pending.timeoutHandle);
        }
        reject(error);
      });
    });
    return promise;
  }
  textInput(prompt) {
    const promise = new Promise((resolve, reject) => {
      const pending = {
        type: "textInput",
        resolve,
        reject
      };
      if (this.timeoutMs !== undefined) {
        const timeoutMs = this.timeoutMs;
        pending.timeoutHandle = setTimeout(() => {
          delete this.pendingTextInput;
          reject(new Error("Dialog timed out"));
        }, timeoutMs);
      }
      this.pendingTextInput = pending;
      this.transport.sendMessage({
        chatId: this.chatId,
        text: prompt
      }).catch((error) => {
        delete this.pendingTextInput;
        if (pending.timeoutHandle !== undefined) {
          clearTimeout(pending.timeoutHandle);
        }
        reject(error);
      });
    });
    return promise;
  }
  async handleCallbackQuery(query) {
    if (!query.data) {
      return false;
    }
    const parts = query.data.split(":");
    if (parts.length !== 2) {
      return false;
    }
    const dialogId = parts[0];
    const indexStr = parts[1];
    if (dialogId === undefined || indexStr === undefined) {
      return false;
    }
    const index = parseInt(indexStr, 10);
    if (isNaN(index)) {
      return false;
    }
    const pending = this.pendingSelects.get(dialogId);
    if (!pending) {
      return false;
    }
    const chosen = pending.options[index];
    if (!chosen) {
      return false;
    }
    if (pending.timeoutHandle !== undefined) {
      clearTimeout(pending.timeoutHandle);
    }
    this.pendingSelects.delete(dialogId);
    await this.transport.answerCallbackQuery({
      callbackQueryId: query.id
    });
    const messageId = await pending.messageIdPromise;
    await this.transport.editMessageText({
      chatId: this.chatId,
      messageId,
      text: `${pending.prompt}
✓ ${chosen.label}`,
      replyMarkup: { inline_keyboard: [] }
    });
    pending.resolve(chosen.value);
    return true;
  }
  handleText(text) {
    if (!this.pendingTextInput) {
      return false;
    }
    const pending = this.pendingTextInput;
    if (pending.timeoutHandle !== undefined) {
      clearTimeout(pending.timeoutHandle);
    }
    delete this.pendingTextInput;
    pending.resolve(text);
    return true;
  }
}

// src/telegram/typing.ts
var DEFAULT_INTERVAL_MS = 4000;

class TypingIndicator {
  chatId;
  deps;
  intervalMs;
  timerId;
  running = false;
  constructor(chatId, deps, intervalMs = DEFAULT_INTERVAL_MS) {
    this.chatId = chatId;
    this.deps = deps;
    this.intervalMs = intervalMs;
  }
  start() {
    if (this.running)
      return;
    this.running = true;
    this.fire();
    this.timerId = this.deps.setInterval(() => this.fire(), this.intervalMs);
  }
  stop() {
    if (!this.running)
      return;
    this.running = false;
    if (this.timerId !== undefined) {
      this.deps.clearInterval(this.timerId);
      this.timerId = undefined;
    }
  }
  fire() {
    this.deps.sendChatAction({ chatId: this.chatId, action: "typing" }).catch(() => {
      return;
    });
  }
}

// src/telegram/markdown.ts
import { marked } from "marked";
function escapeTelegramHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function stripBold(text) {
  return text.replace(/<\/?b>/g, "");
}
function stripTags(html) {
  return html.replace(/<[^>]+>/g, "");
}
function decodeTelegramHtml(text) {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}
function isWideCodePoint(cp) {
  return cp >= 4352 && cp <= 4447 || cp >= 9001 && cp <= 9002 || cp >= 11904 && cp <= 12350 || cp >= 12353 && cp <= 13311 || cp >= 13312 && cp <= 19903 || cp >= 19968 && cp <= 40959 || cp >= 40960 && cp <= 42191 || cp >= 44032 && cp <= 55203 || cp >= 63744 && cp <= 64255 || cp >= 65072 && cp <= 65103 || cp >= 65280 && cp <= 65376 || cp >= 65504 && cp <= 65510 || cp >= 9728 && cp <= 10175 || cp >= 126976 && cp <= 129791;
}
function displayWidth(text) {
  let width = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === 8205)
      continue;
    if (cp >= 65024 && cp <= 65039)
      continue;
    if (cp >= 768 && cp <= 879)
      continue;
    width += isWideCodePoint(cp) ? 2 : 1;
  }
  return width;
}
function padCell(cell, target) {
  const pad = target - displayWidth(decodeTelegramHtml(cell));
  return pad > 0 ? cell + " ".repeat(pad) : cell;
}
function renderQuoteContent(token, parser) {
  return (token.tokens ?? []).map((t) => {
    if (t.type === "blockquote")
      return renderQuoteContent(t, parser);
    if (t.type === "space")
      return "";
    if (t.tokens)
      return parser.parseInline(t.tokens);
    return typeof t.text === "string" ? escapeTelegramHtml(t.text) : "";
  }).filter((s) => s.length > 0).join(`
`);
}
function renderList(token, parser, depth) {
  const indent = "  ".repeat(depth);
  const lines = [];
  let ordinal = typeof token.start === "number" && token.start > 0 ? token.start : 1;
  for (const item of token.items) {
    let marker;
    if (item.task) {
      marker = item.checked ? "☑ " : "☐ ";
    } else if (token.ordered) {
      marker = `${ordinal++}. `;
    } else {
      marker = "• ";
    }
    const inlineParts = [];
    const nestedBlocks = [];
    for (const child of item.tokens ?? []) {
      if (child.type === "list") {
        nestedBlocks.push(renderList(child, parser, depth + 1));
      } else if (child.type === "blockquote") {
        nestedBlocks.push(renderQuoteContent(child, parser));
      } else if (child.type === "space") {} else if (child.tokens) {
        inlineParts.push(parser.parseInline(child.tokens));
      } else if (typeof child.text === "string") {
        inlineParts.push(escapeTelegramHtml(child.text));
      }
    }
    const continuation = `
${indent}${" ".repeat(marker.length)}`;
    const head = inlineParts.join(continuation).replace(/\s*\n\s*/g, continuation);
    lines.push(`${indent}${marker}${head}`);
    for (const block of nestedBlocks)
      lines.push(block);
  }
  return lines.join(`
`);
}
function sanitizeRawHtml(markdown) {
  const stashed = [];
  const stash = (s) => {
    stashed.push(s);
    return `\x00${stashed.length - 1}\x00`;
  };
  let text = markdown.replace(/```[^\n]*\n?([\s\S]*?)```/g, (m) => stash(m));
  text = text.replace(/`([^`]+)`/g, (m) => stash(m));
  text = text.replace(/<br\s*\/?>/gi, `
`);
  text = text.replace(/<\/br>/gi, "");
  text = text.replace(/<code>([\s\S]*?)<\/code>/gi, (_, inner) => `\`${inner}\``);
  text = text.replace(/<strong>([\s\S]*?)<\/strong>/gi, (_, inner) => `**${inner}**`);
  text = text.replace(/<b>([\s\S]*?)<\/b>/gi, (_, inner) => `**${inner}**`);
  text = text.replace(/<em>([\s\S]*?)<\/em>/gi, (_, inner) => `*${inner}*`);
  text = text.replace(/<i>([\s\S]*?)<\/i>/gi, (_, inner) => `*${inner}*`);
  text = text.replace(/<\/?[a-zA-Z][^>]*>/g, "");
  text = text.replace(/\u0000(\d+)\u0000/g, (_, i) => stashed[Number(i)]);
  return text;
}
function markdownToTelegramHtml(markdown) {
  const sanitized = sanitizeRawHtml(markdown);
  const renderer = {
    text(token) {
      return token.tokens ? this.parser.parseInline(token.tokens) : escapeTelegramHtml(token.text);
    },
    html(token) {
      return escapeTelegramHtml(token.text);
    },
    strong(token) {
      const content = this.parser.parseInline(token.tokens);
      return `<b>${content}</b>`;
    },
    em(token) {
      const content = this.parser.parseInline(token.tokens);
      return `<i>${content}</i>`;
    },
    link(token) {
      const content = this.parser.parseInline(token.tokens);
      return `<a href="${token.href}">${content}</a>`;
    },
    paragraph(token) {
      return this.parser.parseInline(token.tokens) + `

`;
    },
    heading(token) {
      const content = stripBold(this.parser.parseInline(token.tokens));
      return `<b>${content}</b>

`;
    },
    hr() {
      return `──────────

`;
    },
    br() {
      return `
`;
    },
    list(token) {
      return renderList(token, this.parser, 0) + `

`;
    },
    table(token) {
      const toText = (cell) => stripTags(this.parser.parseInline(cell.tokens)).replace(/\s+/g, " ").trim();
      const header = token.header.map(toText);
      const rows = token.rows.map((row) => row.map(toText));
      const columnCount = header.length;
      const widths = header.map((cell, col) => {
        let max = displayWidth(decodeTelegramHtml(cell));
        for (const row of rows) {
          const value = row[col] ?? "";
          max = Math.max(max, displayWidth(decodeTelegramHtml(value)));
        }
        return max;
      });
      const renderRow = (cells) => cells.map((cell, col) => col < columnCount - 1 ? padCell(cell, widths[col]) : cell).join("  ");
      const divider = widths.map((w) => "─".repeat(Math.max(1, w))).join("──");
      const lines = [renderRow(header), divider, ...rows.map((row) => renderRow(row))];
      return `<pre>${lines.join(`
`)}</pre>

`;
    }
  };
  marked.use({ renderer });
  const html = marked.parse(sanitized);
  return html.replace(/\n{3,}/g, `

`).trim();
}
function chunkTelegramHtml(html, maxLength = 4096) {
  if (html.length <= maxLength) {
    return [html];
  }
  const chunks = [];
  const tagStack = [];
  let currentChunk = "";
  let i = 0;
  const closingLen = () => tagStack.reduce((s, t) => s + t.name.length + 3, 0);
  const flush = () => {
    for (let j = tagStack.length - 1;j >= 0; j--) {
      currentChunk += `</${tagStack[j].name}>`;
    }
    chunks.push(currentChunk);
    currentChunk = tagStack.map((t) => t.fullTag).join("");
  };
  while (i < html.length) {
    if (html[i] === "<") {
      const tagEnd = html.indexOf(">", i);
      if (tagEnd === -1)
        break;
      const tag = html.slice(i, tagEnd + 1);
      const tagLen = tagEnd - i + 1;
      let closingDelta = 0;
      if (tag.startsWith("</")) {
        const name = tag.slice(2, -1).trim();
        closingDelta = -(name.length + 3);
      } else if (!tag.endsWith("/>") && !tag.startsWith("<!")) {
        const sp = tag.indexOf(" ");
        const gt = tag.indexOf(">");
        const name = tag.slice(1, sp > 0 && sp < gt ? sp : gt).trim();
        closingDelta = name.length + 3;
      }
      if (currentChunk.length > 0 && currentChunk.length + tagLen + closingLen() + closingDelta > maxLength) {
        flush();
      }
      currentChunk += tag;
      if (tag.startsWith("</")) {
        const tagName = tag.slice(2, -1).trim();
        for (let j = tagStack.length - 1;j >= 0; j--) {
          if (tagStack[j].name === tagName) {
            tagStack.splice(j, 1);
            break;
          }
        }
      } else if (!tag.endsWith("/>") && !tag.startsWith("<!")) {
        const spaceIndex = tag.indexOf(" ");
        const closeIndex = tag.indexOf(">");
        const tagName = tag.slice(1, spaceIndex > 0 && spaceIndex < closeIndex ? spaceIndex : closeIndex).trim();
        tagStack.push({ name: tagName, fullTag: tag });
      }
      i = tagEnd + 1;
    } else {
      currentChunk += html[i];
      i++;
      if (currentChunk.length + closingLen() >= maxLength) {
        flush();
      }
    }
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  return chunks;
}
function chunkPlainText(text, maxLength = 4096) {
  if (text.length <= maxLength) {
    return [text];
  }
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf(`

`, maxLength);
    if (splitAt <= 0) {
      splitAt = remaining.lastIndexOf(`
`, maxLength);
    }
    if (splitAt <= 0) {
      splitAt = maxLength;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n+/, "");
  }
  if (remaining.length > 0) {
    chunks.push(remaining);
  }
  return chunks;
}

// src/domain/pairing.ts
function decidePairing(state, incomingUserId) {
  if (state.pairedUserId === null) {
    return { kind: "pair", userId: incomingUserId };
  }
  if (incomingUserId === state.pairedUserId) {
    return { kind: "accept", userId: incomingUserId };
  }
  return { kind: "reject", userId: incomingUserId };
}
function applyPairing(state, decision) {
  if (decision.kind === "pair") {
    return { pairedUserId: decision.userId };
  }
  return { pairedUserId: state.pairedUserId };
}

// src/domain/commands.ts
var BARE_STOP_WORDS = new Set(["stop", "wait", "cancel", "abort"]);
var COMMAND_SPECS = [
  {
    name: "new",
    botFatherDescription: "start a fresh pi session, optionally with a name",
    helpUsage: "/new [name] - start a fresh pi session"
  },
  {
    name: "status",
    botFatherDescription: "show session, directory, model, usage, cost, and context",
    helpUsage: "/status - show session, directory, model, usage, cost, and context"
  },
  {
    name: "model",
    botFatherDescription: "switch model, optionally including provider and thinking level",
    helpUsage: "/model [provider/]model-id [thinking-level] - switch model, optionally including provider"
  },
  {
    name: "thinking",
    botFatherDescription: "change thinking level",
    helpUsage: "/thinking &lt;level&gt; - change thinking level"
  },
  {
    name: "compact",
    botFatherDescription: "compact context",
    helpUsage: "/compact - compact context"
  },
  {
    name: "resend",
    botFatherDescription: "resend the latest assistant reply from this session",
    helpUsage: "/resend - resend the latest assistant reply from this session"
  },
  {
    name: "stop",
    botFatherDescription: "abort active turn (or send: stop, wait, cancel, abort)",
    helpUsage: "/stop - abort active turn (or send: stop, wait, cancel, abort)"
  },
  {
    name: "help",
    botFatherDescription: "show help",
    helpUsage: "/help - show help"
  },
  {
    name: "git",
    botFatherDescription: "run safe git shortcuts in current cwd",
    helpUsage: "/git &lt;status|log|nb&gt; - run safe git shortcuts in current cwd"
  }
];
var UNKNOWN_COMMAND_MESSAGE = "invalid command, type /help if you need help";
function parseGitCommand(tokens) {
  const subcommand = tokens[1];
  if (!subcommand) {
    return { ok: false, message: "usage: /git <status|log|nb>" };
  }
  switch (subcommand) {
    case "status":
      return { ok: true, kind: "status" };
    case "log":
      return { ok: true, kind: "log" };
    case "nb": {
      const branchName = tokens[2];
      if (!branchName) {
        return { ok: false, message: "usage: /git nb <branch-name>" };
      }
      if (tokens[3]) {
        return { ok: false, message: "usage: /git nb <branch-name>" };
      }
      if (branchName.startsWith("-")) {
        return { ok: false, message: "branch name cannot start with a dash" };
      }
      return { ok: true, kind: "nb", branchName };
    }
    default:
      return { ok: false, message: "usage: /git <status|log|nb>" };
  }
}
function parseCommand(text) {
  const trimmed = text.trim();
  if (BARE_STOP_WORDS.has(trimmed.toLowerCase())) {
    return { kind: "stop" };
  }
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const tokens = trimmed.split(/\s+/);
  const command = tokens[0].split("@", 1)[0];
  switch (command) {
    case "/new": {
      const name = tokens[1];
      return name ? { kind: "new", name } : { kind: "new" };
    }
    case "/status":
      return { kind: "status" };
    case "/model": {
      const model = tokens[1];
      if (!model) {
        return { kind: "unknown" };
      }
      const thinking = tokens[2];
      return thinking ? { kind: "model", model, thinking } : { kind: "model", model };
    }
    case "/thinking": {
      const level = tokens[1];
      if (!level) {
        return { kind: "unknown" };
      }
      return { kind: "thinking", level };
    }
    case "/compact":
      return { kind: "compact" };
    case "/resend":
      return { kind: "resend" };
    case "/stop":
      return { kind: "stop" };
    case "/help":
      return { kind: "help" };
    case "/start":
      return { kind: "start" };
    case "/git": {
      const git = parseGitCommand(tokens);
      return { kind: "git", git };
    }
    default:
      return { kind: "unknown" };
  }
}
function formatBotFatherCommands() {
  return COMMAND_SPECS.map((spec) => `${spec.name} - ${spec.botFatherDescription}`).join(`
`);
}
function formatHelpReply(opts) {
  let result = `Send me a message and I will forward it to pi.

Commands:
`;
  result += COMMAND_SPECS.map((spec) => spec.helpUsage).join(`
`);
  if (opts.includeBotFatherCommands) {
    result += `

Copy this into BotFather /setcommands:

`;
    result += "<pre>" + formatBotFatherCommands() + "</pre>";
  }
  return result;
}

// src/domain/prompt.ts
var TELEGRAM_PREFIX = "[telegram] ";
function mapInboundMessage(msg) {
  const imagePaths = msg.imagePaths ?? [];
  const documentPaths = msg.documentPaths ?? [];
  let text;
  if (msg.text !== undefined) {
    text = TELEGRAM_PREFIX + msg.text;
  } else {
    const totalFiles = imagePaths.length + documentPaths.length;
    if (totalFiles > 0) {
      text = `${TELEGRAM_PREFIX}(sent ${totalFiles} file(s))`;
    } else {
      text = TELEGRAM_PREFIX;
    }
  }
  return {
    text,
    imagePaths,
    documentPaths
  };
}

class FollowUpQueue {
  queue = [];
  enqueue(msg) {
    this.queue.push(msg);
  }
  dequeue() {
    return this.queue.shift();
  }
  get size() {
    return this.queue.length;
  }
  clear() {
    this.queue = [];
  }
}

// src/domain/git.ts
var MAX_MESSAGE_LENGTH = 4096;
var TRUNCATION_NOTE = `

[output truncated]`;
function getGitExecSpec(command) {
  if (command.kind === "status") {
    return { title: "git status", steps: [{ args: ["status", "--short", "--branch"] }] };
  }
  if (command.kind === "log") {
    return { title: "git log", steps: [{ args: ["log", "--oneline", "--decorate", "-20"] }] };
  }
  const branchName = command.branchName ?? "";
  return {
    title: `git nb ${branchName}`,
    steps: [
      { args: ["check-ref-format", "--branch", branchName], failureTitle: "invalid branch name" },
      { args: ["switch", "-c", branchName] }
    ]
  };
}
function formatGitReply(input) {
  const output = input.stdout || input.stderr;
  const body = output.length > 0 ? output : "(no output)";
  const reply = `${input.title}

${body}`;
  if (reply.length > MAX_MESSAGE_LENGTH) {
    return reply.slice(0, MAX_MESSAGE_LENGTH - TRUNCATION_NOTE.length) + TRUNCATION_NOTE;
  }
  return reply;
}
async function runGitSpec(spec, runner, cwd) {
  let result;
  for (const step of spec.steps) {
    result = await runner(step.args, cwd);
    if (result.exitCode !== 0) {
      const title = step.failureTitle ?? `${spec.title} failed`;
      return formatGitReply({ title, stdout: result.stdout, stderr: result.stderr });
    }
  }
  return formatGitReply({ title: spec.title, stdout: result.stdout, stderr: result.stderr });
}

// src/domain/status.ts
function formatTokens(count) {
  if (count < 1000)
    return count.toString();
  if (count < 1e4)
    return `${(count / 1000).toFixed(1)}k`;
  if (count < 1e6)
    return `${Math.round(count / 1000)}k`;
  if (count < 1e7)
    return `${(count / 1e6).toFixed(1)}M`;
  return `${Math.round(count / 1e6)}M`;
}
function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function code(text) {
  return `<code>${escapeHtml(text)}</code>`;
}
function formatMode(mode) {
  return mode === "global" ? "Global (Machine)" : "Local (Project)";
}
function formatContextLine(context) {
  if (!context)
    return "- Context: unknown";
  const tokens = context.tokens !== null ? formatTokens(context.tokens) : "?";
  const window = formatTokens(context.contextWindow);
  const percent = context.percent !== null ? ` (${Math.round(context.percent)}%)` : "";
  return `- Context: ${tokens} / ${window}${percent}`;
}
function formatSessionStatus(view) {
  const lines = [
    "\uD83D\uDCCA <b>Pigram Session Status</b>",
    "—",
    "\uD83E\uDDE0 <b>AI Model</b>",
    `- Provider: ${escapeHtml(view.provider ?? "unknown")}`,
    `- Model: ${escapeHtml(view.model ?? "unknown")}`,
    `- Thinking: ${escapeHtml(view.thinking)}`,
    "",
    "\uD83D\uDDA5 <b>Pi State</b>",
    `- Session Name: ${escapeHtml(view.sessionName ?? "unnamed")}`,
    formatContextLine(view.context),
    `- Usage: ↑${formatTokens(view.usage?.input ?? 0)} | ↓${formatTokens(view.usage?.output ?? 0)}`,
    `- Status: ${view.busy ? "Busy" : "Idle"}${view.lockHolderPid !== undefined ? ` (locked by PID ${view.lockHolderPid})` : ""}`,
    `- Queued: ${view.queued}`,
    `- Root Directory: ${view.rootDirectory ? code(view.rootDirectory) : "unknown"}`,
    "",
    "⚙️ <b>Pigram Config</b>",
    `- Mode: ${formatMode(view.mode)}`,
    `- Loaded Config: ${code(view.configPath)}`
  ];
  return lines.join(`
`);
}
function formatFooterStatus(view) {
  const handle = view.botUsername ? `@${view.botUsername}` : "Telegram";
  return `\uD83D\uDCF1 ${handle} · ${formatMode(view.mode)} · ${view.configPath}`;
}

// src/domain/notify.ts
var NOTIFY_USAGE_MESSAGE = "usage: /pigram-notify [on|off] — no arg arms one delivery of the next reply";
function parseNotifyArgs(raw) {
  const arg = raw.trim().toLowerCase();
  if (arg === "")
    return { ok: true, mode: "once" };
  if (arg === "on")
    return { ok: true, mode: "sticky" };
  if (arg === "off")
    return { ok: true, mode: "off" };
  return { ok: false, message: NOTIFY_USAGE_MESSAGE };
}
function consumePendingNotify(pending, outcome) {
  if (!pending)
    return {};
  let deliver;
  if (outcome.text) {
    deliver = { kind: "text", chatId: pending.chatId, markdown: outcome.text };
  } else if (outcome.errorMessage) {
    deliver = { kind: "error", chatId: pending.chatId, line: `⚠️ ${outcome.errorMessage}` };
  }
  if (!deliver) {
    return { pending };
  }
  return pending.mode === "once" ? { deliver } : { deliver, pending };
}

// src/domain/reconnect.ts
var RECONNECT_REQUEST_ENTRY_TYPE = "pigram-reconnect-request";
var RECONNECT_CONSUMED_ENTRY_TYPE = "pigram-reconnect-consumed";
function findPendingReconnectRequest(entries) {
  const consumed = new Set;
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== RECONNECT_CONSUMED_ENTRY_TYPE)
      continue;
    const data = entry.data;
    if (!data || typeof data !== "object")
      continue;
    const requestId = data.requestId;
    if (typeof requestId === "string" && requestId.length > 0)
      consumed.add(requestId);
  }
  for (let index = entries.length - 1;index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || entry.type !== "custom" || entry.customType !== RECONNECT_REQUEST_ENTRY_TYPE)
      continue;
    const data = entry.data;
    if (!data || typeof data !== "object")
      continue;
    const request = data;
    if (typeof request.requestId !== "string" || request.requestId.length === 0)
      continue;
    if (typeof request.chatId !== "number")
      continue;
    if (consumed.has(request.requestId))
      continue;
    return request;
  }
  return;
}
function formatNewSessionConfirmation(request) {
  if (!request.sessionName)
    return "\uD83C\uDD95 Started a fresh pi session";
  if (!request.truncated)
    return `\uD83C\uDD95 Started a fresh pi session: ${request.sessionName}`;
  return `\uD83C\uDD95 Started a fresh pi session: ${request.sessionName} (name truncated)`;
}

// src/pi/session-binding.ts
import { readFile as readFile5 } from "node:fs/promises";
import { extname } from "node:path";

// src/pi/session.ts
function sumAssistantUsage(entries) {
  let input = 0;
  let output = 0;
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message?.role !== "assistant")
      continue;
    input += entry.message.usage?.input ?? 0;
    output += entry.message.usage?.output ?? 0;
  }
  return { input, output };
}

// src/domain/model.ts
function resolveModelTarget(options) {
  const { registry, currentProvider, specifier } = options;
  const notFound = (s) => ({
    ok: false,
    message: `model not found: ${s}`
  });
  const slashIndex = specifier.indexOf("/");
  if (slashIndex === -1) {
    const model2 = registry.find(currentProvider, specifier);
    return model2 ? { ok: true, model: model2 } : notFound(specifier);
  }
  const providerByLower = new Map;
  for (const m of registry.getAll()) {
    providerByLower.set(m.provider.toLowerCase(), m.provider);
  }
  const maybeProvider = specifier.slice(0, slashIndex);
  const canonicalProvider = providerByLower.get(maybeProvider.toLowerCase());
  if (canonicalProvider) {
    const modelId = specifier.slice(slashIndex + 1);
    const model2 = registry.find(canonicalProvider, modelId);
    return model2 ? { ok: true, model: model2 } : { ok: false, message: `model not found: ${specifier} (provider: ${canonicalProvider})` };
  }
  const model = registry.find(currentProvider, specifier);
  return model ? { ok: true, model } : notFound(specifier);
}

// src/pi/session-binding.ts
var MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif"
};
function mimeFromPath(path) {
  return MIME_BY_EXT[extname(path).toLowerCase()] ?? "image/jpeg";
}
async function toImageContent(path) {
  const bytes = await readFile5(path);
  return {
    type: "image",
    data: bytes.toString("base64"),
    mimeType: mimeFromPath(path)
  };
}
function bindPiSession(pi, getCtx) {
  function requireCtx() {
    const ctx = getCtx();
    if (!ctx)
      throw new Error("No active pi session context");
    return ctx;
  }
  return {
    getStatus() {
      const ctx = getCtx();
      const model = ctx?.model;
      const status = {
        thinkingLevel: pi.getThinkingLevel(),
        busy: ctx ? !ctx.isIdle() : false
      };
      if (model?.id)
        status.modelId = model.id;
      if (model?.provider)
        status.provider = model.provider;
      if (ctx) {
        const sessionName = ctx.sessionManager.getSessionName();
        if (sessionName)
          status.sessionName = sessionName;
        if (ctx.cwd)
          status.cwd = ctx.cwd;
        const contextUsage = ctx.getContextUsage();
        if (contextUsage)
          status.contextUsage = contextUsage;
        status.usage = sumAssistantUsage(ctx.sessionManager.getEntries());
      }
      return status;
    },
    async setModel(modelId) {
      const ctx = requireCtx();
      const resolution = resolveModelTarget({
        registry: ctx.modelRegistry,
        currentProvider: ctx.model?.provider ?? "",
        specifier: modelId
      });
      if (!resolution.ok)
        throw new Error(`Unknown model: ${modelId}`);
      const ok = await pi.setModel(resolution.model);
      if (!ok)
        throw new Error(`No API key available for model: ${modelId}`);
    },
    setThinkingLevel(level) {
      pi.setThinkingLevel(level);
    },
    async compact() {
      const ctx = requireCtx();
      if (!ctx.isIdle()) {
        throw new Error("Cannot compact while pi is busy — send /stop first.");
      }
      ctx.compact();
    },
    async abort() {
      getCtx()?.abort();
    },
    async sendPrompt(text, imagePaths) {
      const deliverAs = "followUp";
      if (imagePaths && imagePaths.length > 0) {
        const images = await Promise.all(imagePaths.map(toImageContent));
        const content = [{ type: "text", text }, ...images];
        log.info("sendPrompt", { hasImages: true, deliverAs });
        await pi.sendUserMessage(content, { deliverAs });
      } else {
        log.info("sendPrompt", { hasImages: false, deliverAs });
        await pi.sendUserMessage(text, { deliverAs });
      }
    }
  };
}

// src/pi/attach.ts
import { basename } from "node:path";
import { stat } from "node:fs/promises";
import { Type as Type2 } from "@sinclair/typebox";
var MAX_ATTACHMENTS_PER_TURN = 10;

class AttachmentQueue {
  queue = [];
  add(path) {
    if (this.queue.length >= MAX_ATTACHMENTS_PER_TURN) {
      throw new Error("Attachment limit reached (10)");
    }
    const attachment = {
      path,
      fileName: basename(path)
    };
    this.queue.push(attachment);
    return attachment;
  }
  addMany(paths) {
    if (this.queue.length + paths.length > MAX_ATTACHMENTS_PER_TURN) {
      throw new Error("Attachment limit reached (10)");
    }
    const added = [];
    for (const path of paths) {
      added.push(this.add(path));
    }
    return added;
  }
  drain() {
    const drained = [...this.queue];
    this.queue = [];
    return drained;
  }
  get size() {
    return this.queue.length;
  }
  clear() {
    this.queue = [];
  }
}
async function flushAttachments(queue, sender, chatId) {
  const attachments = queue.drain();
  for (const attachment of attachments) {
    await sender.sendDocument({
      chatId,
      filePath: attachment.path,
      fileName: attachment.fileName
    });
  }
  return attachments.length;
}
function buildAttachToolParams() {
  return Type2.Object({
    paths: Type2.Array(Type2.String(), {
      minItems: 1,
      maxItems: MAX_ATTACHMENTS_PER_TURN
    })
  });
}
async function executeAttach(params, queue, statFile = stat) {
  const added = [];
  for (const path of params.paths) {
    const stats = await statFile(path);
    if (!stats.isFile()) {
      throw new Error(`Not a file: ${path}`);
    }
    queue.add(path);
    added.push(path);
  }
  return { added };
}

// src/pi/assistant-text.ts
function getAgentMessageText(message) {
  const content = Array.isArray(message.content) ? message.content : [];
  const joined = content.filter((block) => typeof block === "object" && block !== null && ("type" in block)).filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text).join("");
  return stripReasoningTags(joined);
}
function stripReasoningTags(text) {
  let out = text.replace(/<(thinking|think)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  out = out.replace(/<(thinking|think)\b[^>]*>[\s\S]*$/gi, "");
  return out.replace(/\n{3,}/g, `

`).trim();
}
function extractAssistantText(messages) {
  for (let i = messages.length - 1;i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "assistant")
      continue;
    const outcome = {};
    const text = getAgentMessageText(message);
    if (text)
      outcome.text = text;
    if (typeof message.stopReason === "string")
      outcome.stopReason = message.stopReason;
    if (typeof message.errorMessage === "string")
      outcome.errorMessage = message.errorMessage;
    return outcome;
  }
  return {};
}
function resolveReplyToStore(messages, hasActiveTurn) {
  const outcome = extractAssistantText(messages);
  if (outcome.stopReason === "aborted") {
    return { shouldDeliver: false };
  }
  if (outcome.stopReason === "error") {
    return { shouldDeliver: hasActiveTurn, ...outcome.errorMessage ? { errorMessage: outcome.errorMessage } : {} };
  }
  if (outcome.text) {
    return { text: outcome.text, shouldDeliver: hasActiveTurn };
  }
  return { shouldDeliver: false };
}

// src/telegram/rich.ts
var TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$/;
function containsGfmTable(markdown) {
  if (!markdown.includes("|") || !markdown.includes("-"))
    return false;
  const lines = markdown.split(`
`);
  let inFence = false;
  for (let i = 0;i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence)
      continue;
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEPARATOR_RE.test(lines[i + 1])) {
      return true;
    }
  }
  return false;
}
function isPermanentRichError(error) {
  if (!(error instanceof Error))
    return false;
  const message = error.message.toLowerCase();
  return message.includes("bad request") || message.includes("not found") || message.includes("unauthorized") || message.includes("forbidden") || message.includes("unsupported");
}

// src/telegram/preview.ts
var DEFAULT_THROTTLE_MS = 750;
var PREVIEW_MAX = 4000;
function realTimer() {
  let handle;
  return {
    set(fn, ms) {
      if (handle)
        clearTimeout(handle);
      handle = setTimeout(fn, ms);
    },
    clear() {
      if (handle) {
        clearTimeout(handle);
        handle = undefined;
      }
    }
  };
}
function clip(text, max = PREVIEW_MAX) {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}
function htmlToPlain(html) {
  return html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

class PreviewSession {
  chatId;
  transport;
  throttleMs;
  now;
  timer;
  richTables;
  messageId;
  pending;
  lastSent;
  lastFlushAt = Number.NEGATIVE_INFINITY;
  finalized = false;
  richDisabled = false;
  constructor(chatId, deps) {
    this.chatId = chatId;
    this.transport = deps.transport;
    this.throttleMs = deps.throttleMs ?? DEFAULT_THROTTLE_MS;
    this.now = deps.now ?? Date.now;
    this.timer = deps.timer ?? realTimer();
    this.richTables = deps.richTables ?? true;
  }
  async update(rawPartial) {
    if (this.finalized)
      return;
    const text = clip(stripReasoningTags(rawPartial));
    if (!text || text === this.lastSent)
      return;
    this.pending = text;
    const elapsed = this.now() - this.lastFlushAt;
    if (elapsed >= this.throttleMs) {
      await this.flush();
    } else {
      this.timer.set(() => void this.flush(), this.throttleMs - elapsed);
    }
  }
  async flush() {
    if (this.finalized)
      return;
    const text = this.pending;
    if (text === undefined || text === this.lastSent)
      return;
    this.lastSent = text;
    this.lastFlushAt = this.now();
    try {
      if (this.messageId === undefined) {
        const result = await this.transport.sendMessage({ chatId: this.chatId, text });
        this.messageId = result.message_id;
      } else {
        await this.transport.editMessageText({ chatId: this.chatId, messageId: this.messageId, text });
      }
    } catch {}
  }
  async finalize(markdown) {
    this.finalized = true;
    this.timer.clear();
    const stripped = stripReasoningTags(markdown);
    if (!stripped)
      return;
    if (this.richTables && !this.richDisabled && containsGfmTable(stripped)) {
      const delivered = await this.tryRichFinalize(stripped);
      if (delivered)
        return;
    }
    const chunks = chunkTelegramHtml(markdownToTelegramHtml(stripped));
    if (chunks.length === 0)
      return;
    if (this.messageId !== undefined) {
      await this.editRich(this.messageId, chunks[0]);
      for (let i = 1;i < chunks.length; i++) {
        await this.sendRich(chunks[i]);
      }
    } else {
      for (const chunk of chunks) {
        await this.sendRich(chunk);
      }
    }
  }
  async tryRichFinalize(markdown) {
    try {
      if (this.messageId !== undefined && this.transport.editMessageRich) {
        await this.transport.editMessageRich({ chatId: this.chatId, messageId: this.messageId, markdown });
        return true;
      }
      if (this.transport.sendRichMessage) {
        await this.transport.sendRichMessage({ chatId: this.chatId, markdown });
        return true;
      }
      return false;
    } catch (error) {
      if (isPermanentRichError(error))
        this.richDisabled = true;
      return false;
    }
  }
  async editRich(messageId, html) {
    try {
      await this.transport.editMessageText({ chatId: this.chatId, messageId, text: html, parseMode: "HTML" });
    } catch {
      try {
        await this.transport.editMessageText({ chatId: this.chatId, messageId, text: clip(htmlToPlain(html)) });
      } catch {}
    }
  }
  async sendRich(html) {
    try {
      await this.transport.sendMessage({ chatId: this.chatId, text: html, parseMode: "HTML" });
    } catch {
      try {
        await this.transport.sendMessage({ chatId: this.chatId, text: clip(htmlToPlain(html)) });
      } catch {}
    }
  }
}

// src/index.ts
var PIGRAM_VERSION = "0.1.0";
var POLL_ERROR_BACKOFF_MS = 1000;
var POLL_TIMEOUT_SECONDS = 30;
var POLL_CONFLICT_BACKOFF_MS = 3000;
var POLL_MAX_BACKOFF_MS = 60000;
var THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];
function asThinkingLevel(value) {
  return THINKING_LEVELS.includes(value) ? value : undefined;
}
function pigram(pi) {
  let paths;
  let config;
  let pairing = { pairedUserId: null };
  let transport;
  let dialog;
  let abortController;
  let pollingActive = false;
  let pollingPromise;
  let activeChatId;
  let activeTurn;
  let lastReplyMarkdown;
  let pendingNotify;
  const followUps = new FollowUpQueue;
  const attachments = new AttachmentQueue;
  let stopHeartbeat;
  let lockHolderPid;
  let lockHolderSince;
  let latestCtx;
  let latestCommandCtx;
  const session = bindPiSession(pi, () => latestCtx);
  async function loadConfig(cwd, scope) {
    paths = await resolveScope({ cwd, homeDir: homedir(), ...scope ? { scope } : {} });
    const migrateScope = paths.scope;
    await migrateLegacyConfig({ cwd, homeDir: homedir(), scope: migrateScope }).catch(() => {
      return;
    });
    config = await readConfig(paths) ?? undefined;
    const state = await readState(paths);
    pairing = { pairedUserId: state.pairedUserId ?? null };
  }
  async function persistPairing() {
    if (!paths)
      return;
    const state = await readState(paths);
    if (pairing.pairedUserId === null) {
      delete state.pairedUserId;
    } else {
      state.pairedUserId = pairing.pairedUserId;
    }
    await writeState(paths, state);
  }
  async function persistCursor(updateId) {
    if (!paths)
      return;
    const state = await readState(paths);
    state.lastUpdateId = updateId;
    await writeState(paths, state);
  }
  function getCursor() {
    return cursorCache;
  }
  let cursorCache = 0;
  async function sendPlain(chatId, text) {
    if (!transport)
      return;
    await transport.sendMessage({ chatId, text });
  }
  async function sendHtml(chatId, html) {
    if (!transport)
      return;
    for (const chunk of chunkTelegramHtml(html)) {
      try {
        await transport.sendMessage({ chatId, text: chunk, parseMode: "HTML" });
      } catch {
        await transport.sendMessage({ chatId, text: chunk });
      }
    }
  }
  async function sendMarkdown(chatId, markdown) {
    if (!transport)
      return;
    const richText = config?.ux?.richText ?? DEFAULT_UX.richText;
    if (!richText) {
      for (const chunk of chunkPlainText(markdown)) {
        await sendPlain(chatId, chunk);
      }
      return;
    }
    await sendHtml(chatId, markdownToTelegramHtml(markdown));
  }
  function runGit(args, cwd) {
    return new Promise((resolve) => {
      execFile("git", args, { cwd }, (error, stdout, stderr) => {
        resolve({
          exitCode: error ? error.code ?? 1 : 0,
          stdout: typeof stdout === "string" ? stdout : "",
          stderr: typeof stderr === "string" ? stderr : ""
        });
      });
    });
  }
  async function handleCommand(chatId, text) {
    const parsed = parseCommand(text);
    if (parsed === null)
      return false;
    switch (parsed.kind) {
      case "start":
      case "help": {
        await sendHtml(chatId, formatHelpReply({ includeBotFatherCommands: true }));
        return true;
      }
      case "status": {
        const s = session.getStatus();
        if (!paths) {
          await sendPlain(chatId, "⚠️ Pigram config not loaded yet.");
          return true;
        }
        const view = {
          thinking: s.thinkingLevel,
          busy: s.busy,
          queued: followUps.size,
          mode: paths.scope,
          configPath: paths.configPath
        };
        if (lockHolderPid !== undefined) {
          view.lockHolderPid = lockHolderPid;
          view.lockHolderSince = lockHolderSince;
        }
        if (s.provider)
          view.provider = s.provider;
        if (s.modelId)
          view.model = s.modelId;
        if (s.sessionName)
          view.sessionName = s.sessionName;
        if (s.contextUsage)
          view.context = s.contextUsage;
        if (s.usage)
          view.usage = s.usage;
        if (s.cwd)
          view.rootDirectory = s.cwd;
        await sendHtml(chatId, formatSessionStatus(view));
        return true;
      }
      case "model": {
        try {
          await session.setModel(parsed.model);
          if (parsed.thinking) {
            const level = asThinkingLevel(parsed.thinking);
            if (level)
              session.setThinkingLevel(level);
          }
          const s = session.getStatus();
          await sendPlain(chatId, `✅ Active model: ${s.provider ? `${s.provider}/` : ""}${s.modelId ?? parsed.model} · thinking: ${s.thinkingLevel}`);
        } catch (err) {
          await sendPlain(chatId, `⚠️ ${err instanceof Error ? err.message : String(err)}`);
        }
        return true;
      }
      case "thinking": {
        const level = asThinkingLevel(parsed.level);
        if (!level) {
          await sendPlain(chatId, `⚠️ Invalid thinking level: ${parsed.level}`);
          return true;
        }
        session.setThinkingLevel(level);
        await sendPlain(chatId, `\uD83E\uDDE0 Thinking: ${session.getStatus().thinkingLevel}`);
        return true;
      }
      case "compact": {
        await session.compact();
        await sendPlain(chatId, "\uD83D\uDDDC️ Compaction triggered");
        return true;
      }
      case "stop": {
        if (!session.getStatus().busy) {
          await sendPlain(chatId, "Nothing to stop, Pi is idle.");
          return true;
        }
        await session.abort();
        await sendPlain(chatId, "\uD83D\uDED1 Aborted");
        return true;
      }
      case "new": {
        if (activeTurn) {
          await session.abort();
          activeTurn.stopTyping?.();
          activeTurn = undefined;
        }
        followUps.clear();
        lastReplyMarkdown = undefined;
        pendingNotify = undefined;
        await performNewSession(chatId, parsed.name);
        return true;
      }
      case "resend": {
        if (!lastReplyMarkdown) {
          await sendPlain(chatId, "ℹ️ Nothing to resend yet — no assistant reply in this session.");
          return true;
        }
        await sendMarkdown(chatId, lastReplyMarkdown);
        return true;
      }
      case "git": {
        if (!parsed.git.ok) {
          await sendPlain(chatId, parsed.git.message);
          return true;
        }
        if (parsed.git.kind === "nb" && session.getStatus().busy) {
          await sendPlain(chatId, "git nb failed: pi is busy; send /stop first");
          return true;
        }
        const gitCwd = session.getStatus().cwd ?? process.cwd();
        const spec = getGitExecSpec(parsed.git);
        const reply = await runGitSpec(spec, runGit, gitCwd);
        await sendPlain(chatId, reply);
        return true;
      }
      case "unknown":
      default: {
        await sendPlain(chatId, UNKNOWN_COMMAND_MESSAGE);
        return true;
      }
    }
  }
  async function routeMessage(chatId, userId, msg) {
    const decision = decidePairing(pairing, userId);
    if (decision.kind === "reject") {
      await sendPlain(chatId, "\uD83D\uDD12 This bot is paired with another user.");
      return;
    }
    if (decision.kind === "pair") {
      pairing = applyPairing(pairing, decision);
      await persistPairing();
      await sendPlain(chatId, "\uD83D\uDD17 Telegram bridge paired with this account.");
    }
    activeChatId = chatId;
    if (dialog?.handleText(msg.text ?? ""))
      return;
    if (msg.text && await handleCommand(chatId, msg.text))
      return;
    if (activeTurn) {
      log.info("routeMessage.enqueue", { chatId, queueSize: followUps.size + 1, text: msg.text?.slice(0, 60) });
      followUps.enqueue(msg);
      return;
    }
    log.info("routeMessage.deliver", { chatId, text: msg.text?.slice(0, 60) });
    await deliverPrompt(chatId, msg);
  }
  async function deliverPrompt(chatId, msg) {
    log.info("deliverPrompt", { chatId, text: msg.text?.slice(0, 60) });
    const streamPreviews = config?.ux?.streamPreviews ?? DEFAULT_UX.streamPreviews;
    const richText = config?.ux?.richText ?? DEFAULT_UX.richText;
    const preview = streamPreviews && richText && transport ? new PreviewSession(chatId, {
      transport,
      richTables: config?.ux?.richTables ?? DEFAULT_UX.richTables
    }) : undefined;
    const t = transport;
    const typing = t ? new TypingIndicator(chatId, {
      sendChatAction: (o) => t.sendChatAction(o),
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis)
    }) : undefined;
    typing?.start();
    activeTurn = { chatId, ...preview ? { preview } : {}, stopTyping: () => typing?.stop() };
    const mapped = mapInboundMessage(msg);
    await session.sendPrompt(mapped.text, mapped.imagePaths);
  }
  async function onUpdate(update) {
    cursorCache = update.update_id;
    if (update.callback_query && dialog) {
      await dialog.handleCallbackQuery(update.callback_query);
      return;
    }
    const message = update.message;
    if (!message || !message.from)
      return;
    const inbound = {};
    if (message.text !== undefined)
      inbound.text = message.text;
    await routeMessage(message.chat.id, message.from.id, inbound);
  }
  async function startPolling() {
    if (!config?.botToken)
      return;
    if (pollingActive || pollingPromise) {
      log.info("startPolling.forceRestart", { pollingActive });
      stopPolling();
      await pollingPromise?.catch(() => {
        return;
      });
      pollingPromise = undefined;
    }
    log.info("startPolling", { scope: paths?.scope });
    const transportProbe = createHttpTransport({ botToken: config.botToken });
    const me = await transportProbe.getMe();
    let lockPath;
    if (paths) {
      lockPath = join3(paths.tempDir, "lock.json");
      const tokenHash = createHash("sha256").update(config.botToken).digest("hex");
      const lockResult = await tryAcquireLock(lockPath, tokenHash);
      if (!lockResult.acquired) {
        lockHolderPid = lockResult.holderPid;
        lockHolderSince = lockResult.holderSince;
        log.warn("startPolling.lockHeld", { pid: lockResult.holderPid });
        latestCtx?.ui.setStatus("pigram", `held by PID ${lockResult.holderPid} (since ${lockResult.holderSince})`);
        return;
      }
      lockHolderPid = undefined;
      lockHolderSince = undefined;
      stopHeartbeat = startHeartbeat(lockPath);
    }
    try {
      transport = createHttpTransport({ botToken: config.botToken });
      if (paths && lockPath) {
        const state = await readState(paths);
        state.botId = me.id;
        if (me.username)
          state.botUsername = me.username;
        cursorCache = state.lastUpdateId;
        await writeState(paths, state);
      }
      abortController = new AbortController;
      const myController = abortController;
      pollingActive = true;
      if (paths) {
        latestCtx?.ui.setStatus("pigram", formatFooterStatus({
          ...me.username ? { botUsername: me.username } : {},
          mode: paths.scope,
          configPath: paths.configPath
        }));
      }
      const poller = new TelegramPoller({
        transport,
        handler: onUpdate,
        getCursor,
        setCursor: persistCursor,
        pollTimeoutSeconds: POLL_TIMEOUT_SECONDS,
        errorDelayMs: POLL_ERROR_BACKOFF_MS,
        conflictDelayMs: POLL_CONFLICT_BACKOFF_MS,
        maxErrorBackoffMs: POLL_MAX_BACKOFF_MS,
        onError: (err) => {
          latestCtx?.ui.setStatus("pigram", `error: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
      pollingPromise = poller.start(myController.signal).finally(() => {
        if (abortController === myController) {
          pollingActive = false;
        }
        log.info("poller.loopEnded", { wasOurs: abortController === myController });
      });
    } catch (err) {
      log.error("startPolling.failed", { error: err instanceof Error ? err.message : String(err) });
      await stopPolling();
      throw err;
    }
  }
  function stopPolling() {
    log.info("stopPolling", { pollingActive });
    stopHeartbeat?.();
    stopHeartbeat = undefined;
    if (paths) {
      const lockPath = join3(paths.tempDir, "lock.json");
      releaseLock(lockPath);
    }
    abortController?.abort();
    abortController = undefined;
    pollingActive = false;
    latestCtx?.ui.setStatus("pigram", undefined);
    const p = pollingPromise?.catch(() => {
      return;
    });
    pollingPromise = undefined;
    return p ?? Promise.resolve();
  }
  async function performNewSession(chatId, name) {
    const cmdCtx = latestCommandCtx;
    if (!cmdCtx) {
      await sendPlain(chatId, "⚠️ Can't start a new session from Telegram in this run. Run /pigram-connect in the pi terminal once, then /new will work. (You can also start a fresh session directly in the terminal.)");
      return;
    }
    if (activeTurn) {
      await sendPlain(chatId, "⚠️ pi is busy; send /stop first, then /new.");
      return;
    }
    const request = {
      requestId: randomUUID(),
      chatId,
      ...name ? { sessionName: name } : {}
    };
    try {
      const parentSession = cmdCtx.sessionManager.getSessionFile();
      const result = await cmdCtx.newSession({
        ...parentSession ? { parentSession } : {},
        setup: async (sessionManager) => {
          if (request.sessionName)
            sessionManager.appendSessionInfo(request.sessionName);
          sessionManager.appendCustomEntry(RECONNECT_REQUEST_ENTRY_TYPE, request);
        },
        withSession: async (nextCtx) => {
          latestCommandCtx = nextCtx;
          latestCtx = nextCtx;
        }
      });
      if (result.cancelled) {
        await sendPlain(chatId, "New session cancelled");
      }
    } catch (err) {
      await sendPlain(chatId, `⚠️ Couldn't start a new session: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  async function runSetup(ctx, scope) {
    latestCtx = ctx;
    latestCommandCtx = ctx;
    await loadConfig(ctx.cwd, scope);
    if (!paths)
      return;
    const token = (config?.botToken ?? await ctx.ui.input("Telegram bot token", "123456:ABCDEF..."))?.trim();
    if (!token) {
      ctx.ui.notify("Setup cancelled: no token provided", "warning");
      return;
    }
    const probe = createHttpTransport({ botToken: token });
    let username = "unknown";
    try {
      const me = await probe.getMe();
      username = me.username ?? "unknown";
    } catch (err) {
      ctx.ui.notify(`Invalid bot token: ${err instanceof Error ? err.message : String(err)}`, "error");
      return;
    }
    config = { botToken: token, ux: { ...DEFAULT_UX } };
    await writeConfig(paths, config);
    if (paths.scope === "project") {
      await ensureProjectGitignore(ctx.cwd);
    }
    ctx.ui.notify(`Pigram connected: @${username}`, "info");
    ctx.ui.notify(`Config stored at ${paths.configPath}`, "info");
    ctx.ui.notify("Send /start to your bot in Telegram to pair this account.", "info");
    ctx.ui.notify(`BotFather /setcommands block:
${formatBotFatherCommands()}`, "info");
    await startPolling();
  }
  pi.registerCommand("pigram-setup", {
    description: "Configure the Pigram Telegram bridge (one-step setup)",
    handler: async (args, ctx) => {
      const scope = parseScopeArg(args);
      await runSetup(ctx, scope);
    }
  });
  pi.registerCommand("pigram-connect", {
    description: "Start the Pigram bridge in this pi session",
    handler: async (args, ctx) => {
      latestCtx = ctx;
      latestCommandCtx = ctx;
      const scope = parseScopeArg(args);
      await loadConfig(ctx.cwd, scope);
      if (!config?.botToken) {
        await runSetup(ctx, scope);
        return;
      }
      await startPolling();
      ctx.ui.notify("Pigram bridge connected", "info");
    }
  });
  pi.registerCommand("pigram-disconnect", {
    description: "Stop the Pigram bridge in this pi session",
    handler: async (_args, ctx) => {
      latestCtx = ctx;
      latestCommandCtx = ctx;
      await stopPolling();
      ctx.ui.notify("Pigram bridge disconnected", "info");
    }
  });
  pi.registerCommand("pigram-status", {
    description: "Show Pigram bridge status",
    handler: async (_args, ctx) => {
      latestCtx = ctx;
      latestCommandCtx = ctx;
      const lines = [
        `config: ${paths?.configPath ?? "not loaded"}`,
        `scope: ${paths?.scope ?? "n/a"}`,
        `paired user: ${pairing.pairedUserId ?? "not paired"}`,
        `notify: ${pendingNotify === undefined ? "off" : pendingNotify.mode === "once" ? "armed (next reply → Telegram)" : "on (sticky)"}`,
        `polling: ${pollingActive ? "running" : lockHolderPid !== undefined ? `blocked (PID ${lockHolderPid} holds this bot)` : "stopped"}`
      ];
      ctx.ui.notify(lines.join(" | "), "info");
    }
  });
  pi.registerCommand("pigram-notify", {
    description: "Deliver the next agent turn's reply to Telegram (use when working from the laptop)",
    handler: async (args, ctx) => {
      latestCtx = ctx;
      latestCommandCtx = ctx;
      const parsed = parseNotifyArgs(args);
      if (!parsed.ok) {
        ctx.ui.notify(parsed.message, "warning");
        return;
      }
      if (parsed.mode === "off") {
        pendingNotify = undefined;
        ctx.ui.notify("Pigram notify: off", "info");
        return;
      }
      const chatId = activeChatId ?? pairing.pairedUserId ?? undefined;
      if (chatId === undefined) {
        ctx.ui.notify("No Telegram chat known yet. Pair first: send /start to your bot in Telegram once.", "warning");
        return;
      }
      pendingNotify = { mode: parsed.mode, chatId };
      ctx.ui.notify(parsed.mode === "once" ? "Pigram notify armed: next reply will be sent to Telegram." : "Pigram notify ON: replies are delivered to Telegram until /pigram-notify off.", "info");
    }
  });
  pi.registerTool({
    name: "telegram_attach",
    label: "Telegram Attach",
    description: "Queue one or more local files to be sent with the next Telegram reply.",
    promptSnippet: "Queue local files to be sent with the next Telegram reply.",
    promptGuidelines: [
      "When replying to a [telegram] message and the user asked for a file or generated artifact, call telegram_attach with the local path instead of only mentioning it in text.",
      "Create or write the file BEFORE calling telegram_attach. The tool reads the file immediately and fails with ENOENT if the path does not yet exist.",
      "Pass paths relative to the current working directory (or absolute paths). Do not attach a file you have only described but not yet written."
    ],
    parameters: buildAttachToolParams(),
    async execute(_toolCallId, params) {
      const result = await executeAttach(params, attachments);
      if (transport && activeChatId !== undefined) {
        await flushAttachments(attachments, transport, activeChatId);
      }
      return {
        content: [{ type: "text", text: `Queued ${result.added.length} Telegram attachment(s).` }],
        details: { paths: result.added }
      };
    }
  });
  pi.on("session_start", async (_event, ctx) => {
    latestCtx = ctx;
    await loadConfig(ctx.cwd).catch(() => {
      return;
    });
    if (config?.botToken) {
      await startPolling().catch(() => {
        return;
      });
      if (transport && activeChatId !== undefined) {
        dialog = new DialogManager({ transport, chatId: activeChatId });
      }
    }
    const request = findPendingReconnectRequest(ctx.sessionManager.getEntries());
    if (request) {
      try {
        if (transport) {
          await sendPlain(request.chatId, formatNewSessionConfirmation(request));
        }
        pi.appendEntry(RECONNECT_CONSUMED_ENTRY_TYPE, {
          requestId: request.requestId
        });
      } catch (err) {
        ctx.ui.setStatus("pigram", `reconnect after /new failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });
  pi.on("session_shutdown", async () => {
    await stopPolling();
    activeTurn = undefined;
    followUps.clear();
    lastReplyMarkdown = undefined;
    pendingNotify = undefined;
  });
  pi.on("message_update", async (event) => {
    const turn = activeTurn;
    if (!turn?.preview)
      return;
    const message = event.message;
    if (message?.role !== "assistant")
      return;
    const partial = getAgentMessageText(message);
    if (!partial)
      return;
    await turn.preview.update(partial);
  });
  pi.on("agent_end", async (event) => {
    const turn = activeTurn;
    const resolved = resolveReplyToStore(event.messages, !!turn);
    if (resolved.text)
      lastReplyMarkdown = resolved.text;
    const consumed = consumePendingNotify(pendingNotify, {
      ...resolved.text ? { text: resolved.text } : {},
      ...resolved.errorMessage ? { errorMessage: resolved.errorMessage } : {}
    });
    pendingNotify = consumed.pending;
    if (!turn && consumed.deliver) {
      if (consumed.deliver.kind === "text") {
        await sendMarkdown(consumed.deliver.chatId, consumed.deliver.markdown);
      } else {
        await sendPlain(consumed.deliver.chatId, consumed.deliver.line);
      }
    }
    if (!turn)
      return;
    turn.stopTyping?.();
    activeTurn = undefined;
    if (resolved.shouldDeliver && resolved.errorMessage) {
      await sendPlain(turn.chatId, `⚠️ ${resolved.errorMessage ?? "pi failed while processing the request."}`);
    } else if (resolved.shouldDeliver && resolved.text) {
      if (turn.preview) {
        await turn.preview.finalize(resolved.text);
      } else {
        await sendMarkdown(turn.chatId, resolved.text);
      }
    }
    if (transport) {
      await flushAttachments(attachments, transport, turn.chatId).catch(() => {
        return;
      });
    }
    const next = followUps.dequeue();
    if (next) {
      log.info("agent_end.drainFollowUp", { chatId: turn.chatId, remaining: followUps.size });
      try {
        await deliverPrompt(turn.chatId, next);
      } catch (err) {
        log.error("agent_end.drainFailed", { error: err instanceof Error ? err.message : String(err) });
        await sendPlain(turn.chatId, `⚠️ Failed to deliver queued message: ${err instanceof Error ? err.message : String(err)}`).catch(() => {
          return;
        });
      }
    }
  });
}
function parseScopeArg(args) {
  const token = args.trim().toLowerCase();
  if (token === "local" || token === "project")
    return "project";
  if (token === "global")
    return "global";
  return;
}
export {
  PIGRAM_VERSION,
  pigram as default
};
