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
  it("存在 deploy-web job，且排在 publish-oss 与 publish-changelog 之后", () => {
    expect(deployWeb).toBeDefined();
    expect(deployWeb.needs).toEqual(["publish-oss", "publish-changelog"]);
    // 链路锚点：两个前置 job 必须仍然存在，否则 needs 悬空
    expect(release.jobs["publish-oss"]).toBeDefined();
    expect(release.jobs["publish-changelog"]).toBeDefined();
  });

  it("仅在 tag push 且 publish-oss / publish-changelog 均成功时触发（workflow_dispatch 重发布不重刷 Pages）", () => {
    const condition: string = deployWeb.if;
    expect(condition).toContain("github.event_name == 'push'");
    expect(condition).toContain("needs.publish-oss.result == 'success'");
    expect(condition).toContain("needs.publish-changelog.result == 'success'");
  });

  it("持有 actions: write 权限（GITHUB_TOKEN 级联 workflow_dispatch 的前提）", () => {
    const permissions = deployWeb.permissions;
    expect(permissions?.actions).toBe("write");
    // 只读 job 不需要 contents: write
    expect(permissions?.contents).toBe("read");
  });

  it("用 gh CLI 触发 deploy-pages.yml，ref 指向发版 tag 且 include_web=true", () => {
    const step = deployWeb.steps.find((s: any) => String(s.run ?? "").includes("gh workflow run"));
    expect(step).toBeDefined();

    const run: string = step.run.replace(/\\\n/g, " ").replace(/\n/g, " ");
    expect(run).toContain("deploy-pages.yml");
    expect(run).toContain('--ref "${GITHUB_REF_NAME}"');
    expect(run).toContain("-f include_web=true");

    expect(step.env?.GH_TOKEN).toBe("${{ secrets.GITHUB_TOKEN }}");
  });
});

describe("build-and-release.yml: publish-changelog job", () => {
  const publishChangelog = release.jobs["publish-changelog"];

  it("依赖 create-release，与其失败路径解耦（tag push 与 dispatch 重发布都执行）", () => {
    expect(publishChangelog.needs).toBe("create-release");
    const condition: string = publishChangelog.if;
    expect(condition).toContain("always()");
    expect(condition).toContain("needs.create-release.result != 'failure'");
  });

  it("用 scripts/build-changelog.mjs 生成 changelog 并上传到 spherse/changelog.json", () => {
    const generate = publishChangelog.steps.find(
      (s: any) => String(s.run ?? "").includes("scripts/build-changelog.mjs"),
    );
    expect(generate).toBeDefined();
    expect(generate.env?.GH_TOKEN).toBe("${{ secrets.GITHUB_TOKEN }}");

    const upload = publishChangelog.steps.find(
      (s: any) =>
        String(s.uses ?? "").startsWith("peaceiris") === false &&
        String(s.run ?? "").includes("ossutil cp") &&
        String(s.run ?? "").includes("spherse/changelog.json"),
    );
    expect(upload).toBeDefined();
    expect(upload.env?.OSS_BUCKET).toBe("${{ secrets.OSS_BUCKET }}");
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

describe("deploy-pages.yml: web 仅随发版部署", () => {
  const triggers = pages.on ?? pages["on"] ?? pages.true;

  it("main push 路径触发不含 packages/web（web 变更不触发 Pages 部署）", () => {
    const paths: string[] = triggers.push.branches && Array.isArray(triggers.push.paths)
      ? triggers.push.paths
      : [];
    expect(paths).not.toContain("packages/web/**");
  });

  it("include_web input 默认 false（手动 dispatch 默认只部署 landing）", () => {
    const input = triggers.workflow_dispatch?.inputs?.include_web;
    expect(input?.type).toBe("boolean");
    expect(String(input?.default)).toBe("false");
  });

  it("web 构建/版本同步步骤以 include_web 为条件", () => {
    const conditionalSteps = pages.jobs.deploy.steps.filter((s: any) =>
      s.if?.includes("inputs.include_web"),
    );
    expect(conditionalSteps.length).toBeGreaterThanOrEqual(2);
  });

  it("landing-only 部署保留已部署文件（keep_files: true），发版部署全量替换", () => {
    const deploy = pages.jobs.deploy.steps.find((s: any) => s.uses?.startsWith("peaceiris/actions-gh-pages"));
    const keep = String(deploy.with?.keep_files).trim();
    // push（无 input 上下文）→ true；dispatch include_web=true → false
    expect(keep).toBe("${{ github.event_name != 'workflow_dispatch' || !inputs.include_web }}");
  });
});
