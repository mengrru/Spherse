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

  it("串行在 publish-oss 之后执行，避免 changelog 先于 latest.json 更新（版本不一致窗口）", () => {
    expect(publishChangelog.needs).toBe("publish-oss");
    const condition: string = publishChangelog.if;
    expect(condition).toContain("always()");
    expect(condition).toContain("needs.publish-oss.result == 'success'");
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

describe("build-and-release.yml: stable publication", () => {
  const publishOss = release.jobs["publish-oss"];
  const publishIndex = publishOss.steps.findIndex((s: any) => s.run === "node scripts/publish-release.mjs");

  it("waits for the entire build matrix, with only dispatch allowed to skip builds", () => {
    expect(publishOss.needs).toBe("build");
    expect(publishOss.if.replace(/\s+/g, " ").trim()).toBe(
      "always() && (needs.build.result == 'success' || github.event_name == 'workflow_dispatch')",
    );
    expect(release.jobs.build.strategy["fail-fast"]).toBe(false);
    expect(release.jobs.build.steps.some((s: any) => s.run?.includes("release/*.AppImage release/*.deb"))).toBe(true);
    expect(release.jobs.build["continue-on-error"]).toBeUndefined();
    for (const step of release.jobs.build.steps) expect(step["continue-on-error"]).toBeUndefined();
  });

  it("serializes tag and dispatch publication with the maximum bounded pending queue", () => {
    expect(publishOss.concurrency).toEqual({ group: "oss-stable-publication", "cancel-in-progress": false, queue: "max" });
  });

  it("requires explicit default-off historical artifact compatibility for old release dispatches", () => {
    const inputs = release.on.workflow_dispatch.inputs;
    expect(inputs.historical_assets.type).toBe("boolean");
    expect(inputs.historical_assets.default).toBe(false);
    expect(inputs.historical_assets.description).toContain("ONLY for old releases");
    expect(inputs.tag.description).toContain("historical_assets=true");
    expect(publishOss.env.HISTORICAL_ASSETS).toBe("${{ inputs.historical_assets == true }}");
  });

  it("downloads DMG, EXE, AppImage and DEB before running the fail-closed publisher", () => {
    const downloadIndex = publishOss.steps.findIndex((s: any) => s.run?.includes("gh release download"));
    expect(downloadIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(downloadIndex);
    for (const extension of ["dmg", "exe", "AppImage", "deb"]) {
      expect(publishOss.steps[downloadIndex].run).toContain(`--pattern '*.${extension}'`);
    }
    expect(publishOss.env.RELEASE_TAG).toBe("${{ github.event_name == 'workflow_dispatch' && inputs.tag || github.ref_name }}");
    expect(publishOss.steps[publishIndex].env.OSS_PUBLIC_BASE_URL).toBe("${{ vars.OSS_PUBLIC_BASE_URL }}");
    expect(publishOss.steps.some((s: any) => s.uses === "actions/setup-node@v7")).toBe(true);
    for (const step of publishOss.steps) {
      expect(step["continue-on-error"]).toBeUndefined();
      expect(step.if).toBeUndefined();
    }
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
