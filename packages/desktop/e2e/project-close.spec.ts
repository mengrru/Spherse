import { expect, test } from "@playwright/test";
import { closeApp } from "./helpers/electron";
import type { Page } from "@playwright/test";
import {
  createChatProject,
  launchChatApp,
  getServerPort,
  createSessionViaApi,
  navigateToSession,
  navigateToProjectRoot,
  openProjectInApp,
  createStreamingSequence,
  type MockEvent,
} from "./helpers/chat";

interface SocketTracking {
  opened: number;
  closed: number;
}

async function routeStreamingWithTracking(
  page: Page,
  port: number,
  events: MockEvent[],
): Promise<SocketTracking> {
  const tracking: SocketTracking = { opened: 0, closed: 0 };
  await page.routeWebSocket(`ws://localhost:${port}/ws/projects/**/chat/**`, (ws) => {
    tracking.opened += 1;
    ws.onClose(() => {
      tracking.closed += 1;
    });
    let seq = -1;
    const nextSeq = () => {
      seq += 1;
      return seq;
    };
    const send = (event: MockEvent) => ws.send(JSON.stringify(event));
    send({ type: "run_status", active: false });
    ws.onMessage((message) => {
      const parsed = JSON.parse(message as string);
      if (parsed.type === "ping") {
        send({ type: "pong" });
      } else if (parsed.type === "message") {
        send({
          type: "message_settled",
          seq: nextSeq(),
          message: { role: "user", content: String(parsed.content), timestamp: Date.now() },
          ...(parsed.intentId !== undefined ? { intentId: parsed.intentId } : {}),
        });
        send({ type: "run_status", active: true });
        for (const event of events) {
          if (event.type === "message_start" || event.type === "message_update" || event.type === "message_end") {
            const role = (event.message as { role?: string } | undefined)?.role;
            if (role !== "assistant") continue;
          }
          if (event.type === "message_end") {
            const settleSeq = nextSeq();
            send({ ...event, seq: settleSeq });
            send({ type: "message_settled", seq: settleSeq, message: event.message });
            continue;
          }
          send(event);
        }
      } else if (parsed.type === "abort") {
        send({ type: "agent_end", messages: [] });
        send({ type: "run_status", active: false });
      }
    });
  });
  return tracking;
}

async function goOnboarding(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = "#/";
  });
}

async function closeProjectViaActivityBar(page: Page): Promise<void> {
  const avatar = page.locator("[data-project-avatar]").first();
  await expect(avatar).toBeVisible();
  await avatar.click({ button: "right" });
  await page.getByRole("menuitem", { name: "关闭项目", exact: true }).click();
}

test("closing a streaming project disconnects its chat runtime", async () => {
  const project = await createChatProject();
  const { app, page } = await launchChatApp(project);

  try {
    const port = await getServerPort(page);
    const sessionId = await createSessionViaApi(page, project.projectId, "assistant-1");

    const eventsBeforeEnd = createStreamingSequence().filter((e) => e.type !== "agent_end");
    const sockets = await routeStreamingWithTracking(page, port, eventsBeforeEnd);

    await navigateToSession(page, project.projectId, sessionId);
    await page.waitForSelector("[data-chat-composer]");

    const textarea = page.locator("[data-chat-composer] textarea");
    await textarea.fill("test message");
    await textarea.press("Enter");

    await page.waitForSelector("[data-chat-composer] button svg.lucide-square", { timeout: 5000 });

    await goOnboarding(page);
    await closeProjectViaActivityBar(page);

    await expect(page.getByText("搭建属于你自己的世界")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("[data-project-avatar]")).toHaveCount(0);

    await expect.poll(() => sockets.closed, { timeout: 5000 }).toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(2000);
    expect(sockets.opened).toBe(1);
  } finally {
    await closeApp(app);
  }
});

test("reopening a closed project after restart starts clean", async () => {
  const project = await createChatProject();
  const { app, page } = await launchChatApp(project);

  try {
    const sessionId = await createSessionViaApi(page, project.projectId, "assistant-1");
    await navigateToSession(page, project.projectId, sessionId);
    await page.waitForSelector("[data-chat-composer]");

    await goOnboarding(page);
    await closeProjectViaActivityBar(page);
    await expect(page.getByText("搭建属于你自己的世界")).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForSelector("text=搭建属于你自己的世界", { timeout: 30_000 });
    await expect(page.locator("[data-project-avatar]")).toHaveCount(0);

    const lastRoute = await page.evaluate(
      (id: string) => localStorage.getItem(`spherse:last-route:${id}`),
      project.projectId,
    );
    expect(lastRoute).toBeNull();

    await openProjectInApp(page, project);
    await navigateToProjectRoot(page, project.projectId);

    await expect(page.getByText("项目不存在")).toHaveCount(0);
    await expect(page.locator("[data-chat-composer]")).toHaveCount(0);
    await expect(page.getByText("Spherse", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  } finally {
    await closeApp(app);
  }
});
