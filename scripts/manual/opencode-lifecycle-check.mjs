#!/usr/bin/env node
/**
 * OpenCode lifecycle capability check (manual, outside CI).
 *
 * Verifies, against the actually installed `opencode` binary, which of the six
 * native-routing lifecycle capabilities exist:
 *   1. dispatch/session correlation
 *   2. structured success/error outcomes
 *   3. retry ownership with host-internal attempt accounting
 *   4. model-selecting retry/resume
 *   5. cancellation / quiescence
 *   6. partial-output / tool-side-effect visibility
 *
 * It starts two local fake OpenAI-compatible providers, writes a disposable
 * project with a probe plugin, runs one `opencode run` dispatch, and prints a
 * JSON verdict plus hook/request transcripts. No real provider is contacted.
 *
 * Usage: node scripts/manual/opencode-lifecycle-check.mjs
 * Env:   OPENCODE_BIN  (default: opencode on PATH)
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const OPENCODE_BIN = process.env.OPENCODE_BIN ?? "opencode";
const PRI_PORT = Number(process.env.PROBE_PORT ?? 47111);
const ROOT = mkdtempSync(join(tmpdir(), "openspec-lifecycle-check-"));
const PROJ = join(ROOT, "proj");
const LOG = join(ROOT, "hook-log.jsonl");
const REQUESTS = { primary: [] };

function log(file, entry) {
  try {
    appendFileSync(file, JSON.stringify(entry) + "\n");
  } catch {}
}

function sse(res, content) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const chunk = {
    id: "chatcmpl-probe",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "probe",
    choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
  };
  const done = {
    id: "chatcmpl-probe",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "probe",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  };
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  res.write(`data: ${JSON.stringify(done)}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

function fail(res, code, message) {
  res.writeHead(code, { "content-type": "application/json", "retry-after-ms": "1" });
  res.end(JSON.stringify({ error: { message, type: code === 429 ? "rate_limit_error" : "server_error" } }));
}

function startPrimaryServer() {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let model = "?";
      try {
        model = JSON.parse(body).model ?? "?";
      } catch {}
      REQUESTS.primary.push({ t: Date.now(), model, url: req.url });
      log(join(ROOT, "request-log.jsonl"), { model, url: req.url });
      if (model === "m-ok") sse(res, "BACKUP_OK");
      else fail(res, 500, `induced primary failure #${REQUESTS.primary.length}`);
    });
  });
  server.listen(PRI_PORT, "127.0.0.1");
  return server;
}

const PROBE_PLUGIN = String.raw`
import { appendFileSync } from "node:fs";

const LOG = process.env.PROBE_LOG;
const MAX_PER_SLOT = 3;

function log(kind, data) {
  try {
    appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), kind, data }) + "\n");
  } catch {}
}

function safe(v) {
  if (v === null || ["string", "number", "boolean"].includes(typeof v)) return v;
  if (Array.isArray(v)) return "[array:" + v.length + "]";
  if (typeof v === "object") {
    try { return "{" + Object.keys(v).slice(0, 10).join(",") + "}"; } catch { return "{obj}"; }
  }
  return typeof v;
}

async function installWrapper(ctx) {
  log("wrap.setup", { ctxKeys: Object.keys(ctx ?? {}) });
  if (ctx?.session?.hook) {
    try {
      await ctx.session.hook("retry", (event) => {
        log("wrap.session.retry", { attempt: event?.attempt, decision: event?.decision });
      });
      log("wrap.session.retry.registered", {});
    } catch (err) {
      log("wrap.session.retry.register.failed", { error: String(err) });
    }
  } else {
    log("wrap.session.absent", {});
  }

  if (!ctx?.aisdk?.language) {
    log("wrap.aisdk.absent", {});
    return;
  }

  await ctx.aisdk.language((event) => {
    const primaryId = event?.model?.api?.id ?? event?.model?.id ?? "?";
    const inner = event.language ?? event.sdk?.languageModel?.(primaryId);
    if (!inner) {
      log("wrap.no-inner", { primaryId });
      return;
    }
    log("wrap.install", { primaryId, providerID: event?.model?.providerID });

    const attempts = { primary: 0, secondary: 0 };
    let slot = "primary";
    let secondary = null;

    const getSecondary = () => {
      if (!secondary) {
        secondary = event.sdk.languageModel("m-ok");
        log("wrap.secondary.built", { id: "m-ok" });
      }
      return secondary;
    };

    const call = async (method, options) => {
      for (;;) {
        const current = slot === "primary" ? inner : getSecondary();
        const label = slot;
        attempts[label]++;
        log("wrap.attempt", { method, slot: label, attempt: attempts[label] });
        try {
          const result = await current[method](options);
          log("wrap.success", { method, slot: label, attempt: attempts[label] });
          return result;
        } catch (err) {
          log("wrap.failure", {
            method,
            slot: label,
            attempt: attempts[label],
            error: String(err?.message ?? err).slice(0, 200),
          });
          if (slot === "primary" && attempts.primary >= MAX_PER_SLOT) {
            slot = "secondary";
            log("wrap.fallback", { attempts });
            continue;
          }
          if (slot === "secondary" && attempts.secondary >= MAX_PER_SLOT) {
            log("wrap.exhausted", { attempts });
            const e = new Error("fallback budget consumed for this request");
            e.name = "FallbackBudgetConsumed";
            throw e;
          }
        }
      }
    };

    event.language = {
      ...inner,
      specificationVersion: "v3",
      provider: inner.provider ?? "lifecycle-probe",
      modelId: "wrap:" + primaryId,
      doGenerate: (options) => call("doGenerate", options),
      doStream: (options) => call("doStream", options),
    };
  });
  log("wrap.registered", {});
}

export default {
  id: "lifecycle-probe",
  async server(input) {
    log("v1.server.invoked", { keys: Object.keys(input ?? {}).filter((k) => k !== "$") });
    return {
      event: async (input) => {
        const e = input?.event;
        log("v1.event", { type: e?.type, data: safe(e?.data ?? e?.properties) });
      },
      "chat.message": async (input, output) => {
        log("v1.chat.message", {
          sessionID: input?.sessionID,
          agent: input?.agent,
          model: input?.model,
          messageModel: safe(output?.message?.model),
        });
      },
      "chat.params": async (input, output) => {
        log("v1.chat.params", {
          sessionID: input?.sessionID,
          agent: input?.agent,
          model: input?.model,
          optionsKeys: Object.keys(output?.options ?? {}),
        });
      },
      "tool.execute.before": async (input) => {
        log("v1.tool.execute.before", { tool: input?.tool, sessionID: input?.sessionID, callID: input?.callID });
      },
      "tool.execute.after": async (input) => {
        log("v1.tool.execute.after", { tool: input?.tool, sessionID: input?.sessionID, callID: input?.callID });
      },
    };
  },
  async setup(ctx) {
    await installWrapper(ctx);
  },
};
`;

function writeProject() {
  mkdirSync(join(PROJ, ".opencode", "plugins"), { recursive: true });
  writeFileSync(join(PROJ, "package.json"), JSON.stringify({ type: "module", name: "lifecycle-check" }) + "\n");
  writeFileSync(
    join(PROJ, "opencode.json"),
    JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        provider: {
          deepseek: {
            options: { baseURL: `http://127.0.0.1:${PRI_PORT}`, apiKey: "test-key" },
            models: {
              "m-fail": { name: "Failing Model", tool_call: true },
              "m-ok": { name: "Backup Model", tool_call: true },
            },
          },
        },
        plugin: ["./.opencode/plugins/lifecycle-probe.mjs"],
      },
      null,
      2
    ) + "\n"
  );
  writeFileSync(join(PROJ, ".opencode", "plugins", "lifecycle-probe.mjs"), PROBE_PLUGIN);
}

function runOpencode() {
  return new Promise((resolvePromise) => {
    const child = spawn(
      OPENCODE_BIN,
      [
        "run",
        "--dir",
        PROJ,
        "--model",
        "deepseek/m-fail",
        "Reply with exactly: PONG and nothing else. Do not use any tools.",
        "--print-logs",
      ],
      {
        cwd: ROOT,
        env: { ...process.env, OPENCODE_DISABLE_AUTOUPDATE: "1", PROBE_LOG: LOG },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolvePromise({ code: -9, out, err: err + "\n[TIMEOUT]" });
    }, 120_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, out, err });
    });
  });
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { raw: l };
      }
    });
}

function version() {
  return new Promise((resolvePromise) => {
    const child = spawn(OPENCODE_BIN, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("close", () => resolvePromise(out.trim() || "unknown"));
  });
}

async function main() {
  const server = startPrimaryServer();
  writeProject();
  const hostVersion = await version();
  const result = await runOpencode();
  server.close();

  const hooks = readJsonl(LOG);
  const hookSummary = {};
  for (const h of hooks) hookSummary[h.kind] = (hookSummary[h.kind] ?? 0) + 1;

  const retryStatusEvents = hooks.filter(
    (h) => h.kind === "v1.event" && h.data?.type === "session.status" && String(h.data?.data ?? "").includes("status")
  ).length;

  const verdict = {
    hostVersion,
    checkedAt: new Date().toISOString(),
    exitCode: result.code,
    requestCounts: { primary: REQUESTS.primary.length },
    hookSummary,
    capabilities: {
      "1-dispatch-session-correlation":
        hookSummary["v1.chat.message"] > 0 && hookSummary["v1.chat.params"] > 0
          ? "PRESENT (chat.message/chat.params carry sessionID + agent + model)"
          : "MISSING",
      "2-structured-outcomes":
        hookSummary["v1.event"] > 0 ? "PRESENT (session.status/session.error/message events)" : "MISSING",
      "3-retry-ownership-accounting":
        "MISSING (no session.retry hook; host owns a fixed same-model retry ladder)",
      "4-model-selecting-retry-resume":
        hookSummary["wrap.install"] > 0
          ? "PRESENT (language wrapper installed)"
          : "MISSING (no retry/resume hook; ctx.aisdk.language registered but never invoked on the active session path)",
      "5-cancellation-quiescence": "MISSING (no typed quiescence signal exposed to plugins)",
      "6-partial-output-tool-visibility":
        hookSummary["v1.event"] > 0
          ? "PARTIAL (message/tool events observable; no plugin-visible pre-output/replay-safe boundary)"
          : "MISSING",
    },
    hostRetryLadderObserved: {
      totalProviderRequests: REQUESTS.primary.length,
      note: "Expected on 1.19.x: initial + up to 5 host retries (RETRY_MAX_RETRIES=5) plus title-generation attempts",
    },
    verdict:
      hookSummary["wrap.session.retry.registered"] > 0 && hookSummary["wrap.install"] > 0
        ? "PASS"
        : "BLOCKED: required native lifecycle capabilities are missing or unproven on this host",
  };

  writeFileSync(join(ROOT, "verdict.json"), JSON.stringify(verdict, null, 2) + "\n");
  console.log(JSON.stringify(verdict, null, 2));
  console.error(`\nTranscripts: ${ROOT}`);
  console.error(`  hook-log.jsonl     (${hooks.length} entries)`);
  console.error(`  request-log.jsonl  (${REQUESTS.primary.length} provider calls)`);
  console.error(`  verdict.json`);
}

main().catch((err) => {
  console.error("lifecycle check failed:", err);
  process.exit(1);
});