import { expect, test } from "@playwright/test";
import { closeApp } from "./helpers/electron";
import {
  createRpcProject,
  launchRpcApp,
  openRpcSession,
  sendMessage,
  startStubLlm,
} from "./helpers/rpc-real";

test("boot queries flow over rpc", async () => {
  const stub = await startStubLlm();
  const project = await createRpcProject();
  const { app, page, frames, restRequests } = await launchRpcApp(project, stub);
  try {
    await openRpcSession(page, project.projectId, "assistant-1");
    await expect
      .poll(() => frames.received.filter((x) => x.includes('"type":"result"')).length)
      .toBeGreaterThan(3);
    expect(restRequests.filter((x) => !x.includes("/upload") && !x.includes("/attachments")).length).toBe(0);
  } finally {
    await closeApp(app);
    await stub.close();
  }
});

test("chat send streams events and renders", async () => {
  const stub = await startStubLlm();
  const project = await createRpcProject();
  stub.enqueue({ kind: "text", parts: ["Hello ", "rpc ", "world!"] });
  const { app, page, frames } = await launchRpcApp(project, stub);
  try {
    await openRpcSession(page, project.projectId, "assistant-1");
    await sendMessage(page, "hi");
    await expect(page.getByText("Hello rpc world!", { exact: true })).toBeVisible({
      timeout: 15000,
    });
    expect(frames.sent.some((x) => x.includes('"method":"chat.send"'))).toBe(true);
    const eventFrames = frames.received.filter((x) => x.includes('"type":"event"'));
    expect(eventFrames.length).toBeGreaterThan(0);
    expect(eventFrames.some((x) => x.includes('"seq"'))).toBe(true);
  } finally {
    await closeApp(app);
    await stub.close();
  }
});

test("reload replays history exactly once", async () => {
  const stub = await startStubLlm();
  const project = await createRpcProject();
  stub.enqueue({ kind: "text", parts: ["persisted ", "turn."] });
  const { app, page, frames } = await launchRpcApp(project, stub);
  try {
    await openRpcSession(page, project.projectId, "assistant-1");
    await sendMessage(page, "hi");
    await expect(page.getByText("persisted turn.", { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await page.reload();
    await page.waitForSelector("[data-chat-composer]");
    await expect(page.getByText("persisted turn.", { exact: true })).toHaveCount(1, {
      timeout: 15000,
    });
    const subs = frames.sent.filter((x) => x.includes('"type":"sub"'));
    expect(subs.length).toBeGreaterThan(0);
  } finally {
    await closeApp(app);
    await stub.close();
  }
});

test("abort stops a slow stream and composer recovers", async () => {
  const stub = await startStubLlm();
  const project = await createRpcProject();
  stub.enqueue({ kind: "text", parts: ["a", "b", "c", "d", "e", "f", "g", "h"], partDelayMs: 900 });
  const { app, page } = await launchRpcApp(project, stub);
  try {
    await openRpcSession(page, project.projectId, "assistant-1");
    await sendMessage(page, "hi");
    await page.waitForSelector("[data-chat-composer] button svg.lucide-square", {
      timeout: 10000,
    });
    await page.locator("[data-chat-composer] button svg.lucide-square").click();
    await page.waitForSelector("[data-chat-composer] button svg.lucide-send", {
      timeout: 10000,
    });
    await expect(page.locator("[data-chat-composer] button svg.lucide-square")).toHaveCount(0);
  } finally {
    await closeApp(app);
    await stub.close();
  }
});

test("run_command approval round-trips through control requests", async () => {
  const stub = await startStubLlm();
  const project = await createRpcProject();
  stub.enqueue({
    kind: "tool",
    name: "run_command",
    argsJson: JSON.stringify({ command: "echo rpc-e2e-approval-ok" }),
  });
  stub.enqueue({ kind: "text", parts: ["command ", "done."] });
  const { app, page, frames } = await launchRpcApp(project, stub);
  try {
    await openRpcSession(page, project.projectId, "assistant-1");
    await sendMessage(page, "run echo");
    const approveButton = page.getByRole("button", { name: /批准|Approve/ }).first();
    await expect(approveButton).toBeVisible({ timeout: 15000 });
    await approveButton.click();
    await expect(page.getByText("command done.", { exact: true })).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByText("rpc-e2e-approval-ok").first()).toBeVisible({ timeout: 10000 });
    expect(frames.sent.some((x) => x.includes('"method":"chat.resolveControlRequest"'))).toBe(true);
  } finally {
    await closeApp(app);
    await stub.close();
  }
});

test("heartbeat keeps the rpc connection alive", async () => {
  test.setTimeout(70000);
  const stub = await startStubLlm();
  const project = await createRpcProject();
  stub.enqueue({ kind: "text", parts: ["idle"] });
  const { app, page, frames } = await launchRpcApp(project, stub);
  try {
    await openRpcSession(page, project.projectId, "assistant-1");
    await expect
      .poll(
        () =>
          frames.sent.filter((x) => x.includes('"type":"ping"')).length +
          frames.received.filter((x) => x.includes('"type":"pong"')).length,
        { timeout: 45000, intervals: [2000] },
      )
      .toBeGreaterThan(0);
  } finally {
    await closeApp(app);
    await stub.close();
  }
});
