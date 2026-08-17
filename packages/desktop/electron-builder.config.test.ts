import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { load } from "js-yaml";

/**
 * 发版事故回归（v0.1.19：Windows 出三个包 + x64 上传 HTTP 404）。
 *
 * 根因：electron-builder.yml 的 win.target 显式声明了 `arch: [x64, arm64]`，
 * app-builder-lib 的 computeArchToTargetNamesMap 对 config 内声明的 arch 直接采用、
 * 无视 CLI 的 --x64/--arm64，于是 CI 两个 win matrix job 各自都打出双 arch 产物，
 * 且单次双 arch 的 NSIS 会额外产出一个无 arch 后缀的合并安装包（~225MB）。
 * 两个 job 的 release/*.exe 三件套同名，并发 gh release upload --clobber（先删后传）
 * 互踩，导致 404。
 *
 * 本测试锁定结构性不变量，防止回归：
 * 1. win.target 不得声明 arch（arch 由 CI matrix 的 CLI flag 控制）；
 * 2. win.artifactName 必须带 ${arch}（各 arch 产物命名唯一，天然可并存）；
 * 3. 每个 windows matrix job 的 build-args 恰好一个 arch flag 且与 target-arch 一致；
 * 4. 上传步骤只上传本 job arch 后缀的安装包，不做全量 glob。
 */

interface BuilderTargetSpec {
  target?: string;
  arch?: unknown;
}

interface BuilderConfig {
  win?: {
    artifactName?: string;
    target?: Array<string | BuilderTargetSpec>;
  };
}

interface MatrixEntry {
  os?: string;
  "build-args"?: string;
  "target-arch"?: string;
}

interface WorkflowStep {
  name?: string;
  run?: string;
}

interface Workflow {
  jobs?: {
    build?: {
      strategy?: { matrix?: { include?: MatrixEntry[] } };
      steps?: WorkflowStep[];
    };
  };
}

const loadYaml = <T>(relativePath: string): T => {
  const url = new URL(relativePath, import.meta.url);
  return load(readFileSync(fileURLToPath(url), "utf8")) as T;
};

const ARCH_FLAGS = ["--x64", "--arm64", "--ia32", "--universal"] as const;

const archFlagsOf = (buildArgs: string): string[] =>
  buildArgs
    .split(/\s+/)
    .filter((token) =>
      (ARCH_FLAGS as readonly string[]).includes(token),
    );

describe("electron-builder win 配置（发版三包/404 回归）", () => {
  const config = loadYaml<BuilderConfig>("./electron-builder.yml");

  it("win.target 不声明 arch（arch 由 CI CLI flag 控制）", () => {
    expect(config.win?.target).toBeDefined();
    expect(config.win?.target?.length).toBeGreaterThan(0);

    for (const entry of config.win?.target ?? []) {
      if (typeof entry !== "string") {
        expect(
          entry.arch,
          "win.target 声明了 arch：config arch 会覆盖 CI 的 --x64/--arm64（computeArchToTargetNamesMap），" +
            "导致每个 matrix job 打出双 arch + 无后缀合并包，且并发上传同名产物互踩（v0.1.19 事故）",
        ).toBeUndefined();
      }
    }
  });

  it("win.artifactName 带 ${arch}（各 arch 产物命名唯一）", () => {
    expect(config.win?.artifactName).toContain("${arch}");
  });
});

describe("build-and-release.yml windows matrix（发版三包/404 回归）", () => {
  const workflow = loadYaml<Workflow>("../../.github/workflows/build-and-release.yml");
  const matrix = workflow.jobs?.build?.strategy?.matrix?.include ?? [];
  const winEntries = matrix.filter((entry) => (entry.os ?? "").startsWith("windows"));

  it("存在 windows matrix 条目", () => {
    expect(winEntries.length).toBeGreaterThanOrEqual(2);
  });

  it("每个 matrix 条目至多一个 arch flag，且与 target-arch 一致", () => {
    for (const entry of matrix) {
      const flags = archFlagsOf(entry["build-args"] ?? "");
      expect(
        flags.length,
        `${entry.os} ${entry["build-args"]}: 不应叠加多个 arch flag`,
      ).toBeLessThanOrEqual(1);
      if (flags.length === 1) {
        expect(flags[0]).toBe(`--${entry["target-arch"]}`);
      }
    }
  });

  it("每个 windows job 恰好一个 arch flag（host arch 兜底会静默产出重复的 x64 包）", () => {
    for (const entry of winEntries) {
      const flags = archFlagsOf(entry["build-args"] ?? "");
      expect(flags, `${entry["build-args"]}: windows job 必须显式指定 arch`).toHaveLength(1);
    }
  });

  it("上传步骤只上传本 job arch 后缀的安装包（防跨 job 同名并发 clobber 404）", () => {
    const uploadStep = workflow.jobs?.build?.steps?.find(
      (step) => step.name === "Upload Windows installer",
    );
    expect(uploadStep).toBeDefined();

    const run = uploadStep?.run ?? "";
    expect(run).toContain("*-${{ matrix.target-arch }}.exe");
    expect(
      run.includes("release/*.exe"),
      "不得全量 glob 上传 release/*.exe：多 win job 并发时同名资产 --clobber 互踩会 404",
    ).toBe(false);
  });
});
