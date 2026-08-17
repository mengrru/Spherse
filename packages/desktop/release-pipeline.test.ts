import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

/**
 * Release pipeline 结构测试。
 *
 * 发版流水线（build-and-release.yml）必须在发布完成后联动触发 web 版部署
 * （deploy-pages.yml，GitHub Pages：landing + web）。
 * 这条链路最容易出现的回归是「静默失败」：
 * - 少了 `actions: write` 权限 → gh workflow run 直接 403，发版照常"成功"；
 * - dispatch 目标 deploy-pages.yml 丢了 workflow_dispatch 触发器 → 无法被触发；
 * - 条件写错 → 重发布（workflow_dispatch）意外重刷 Pages，或 tag 发版漏触发。
 * 以上全部用 YAML 结构断言锁死。
 */

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function loadWorkflow(name: string): Record<string, any> {
  return yaml.load(readFileSync(`${repoRoot}/.github/workflows/${name}`, "utf8")) as Record<
    string,
    any
  >;
}

const release = loadWorkflow("build-and-release.yml");
const pages = loadWorkflow("deploy-pages.yml");
const deployWeb = release.jobs["deploy-web"];

describe("build-and-release.yml: deploy-web job", () => {
  it("存在 deploy-web job，且排在 publish-oss 之后", () => {
    expect(deployWeb).toBeDefined();
    expect(deployWeb.needs).toBe("publish-oss");
    // 链路锚点：publish-oss 必须仍然存在，否则 needs 悬空
    expect(release.jobs["publish-oss"]).toBeDefined();
  });

  it("仅在 tag push 且 publish-oss 成功时触发（workflow_dispatch 重发布不重刷 Pages）", () => {
    const condition: string = deployWeb.if;
    expect(condition).toContain("github.event_name == 'push'");
    expect(condition).toContain("needs.publish-oss.result == 'success'");
  });

  it("持有 actions: write 权限（GITHUB_TOKEN 级联 workflow_dispatch 的前提）", () => {
    const permissions = deployWeb.permissions;
    expect(permissions?.actions).toBe("write");
    // 只读 job 不需要 contents: write
    expect(permissions?.contents).toBe("read");
  });

  it("用 gh CLI 触发 deploy-pages.yml，且 ref 指向发版 tag", () => {
    const step = deployWeb.steps.find((s: any) => String(s.run ?? "").includes("gh workflow run"));
    expect(step).toBeDefined();

    const run: string = step.run.replace(/\\\n/g, " ").replace(/\n/g, " ");
    expect(run).toContain("deploy-pages.yml");
    expect(run).toContain('--ref "${GITHUB_REF_NAME}"');

    expect(step.env?.GH_TOKEN).toBe("${{ secrets.GITHUB_TOKEN }}");
  });
});

describe("deploy-pages.yml: dispatch 目标可达", () => {
  it("声明了 workflow_dispatch 触发器，可被发版流水线触发", () => {
    // js-yaml v4 遵循 YAML 1.2 core schema，`on` 保持字符串 key
    const triggers = pages.on ?? pages["on"] ?? pages.true;
    expect(triggers).toBeDefined();
    expect(triggers.workflow_dispatch).toBeDefined();
  });
});
