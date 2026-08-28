import { describe, expect, it, vi } from "vitest";
import {
  buildChangelog,
  compareTagsDesc,
  fetchAllPages,
  parseEntry,
  parseWhatChanged,
  transformReleases,
} from "../../scripts/build-changelog.mjs";

const REALISTIC_BODY = [
  "## What's Changed",
  "* feat: 支持载入 .agents/skills by @mengrru in https://github.com/mengrru/Spherse/pull/40",
  "* fix：移动端回车改换行 by @Csomnia in https://github.com/mengrru/Spherse/pull/44",
  "* chore: 启用全包 typecheck 并清零现有类型错误 by @mengrru in https://github.com/mengrru/Spherse/pull/41",
  "* docs: 文档体系重构 by @mengrru in https://github.com/mengrru/Spherse/pull/43",
  "* infra: 根命令体系整理 by @mengrru in https://github.com/mengrru/Spherse/pull/48",
  "* refactor: project queries 按需订阅拆分 in https://github.com/mengrru/Spherse/pull/49",
  "* 无类型前缀条目 in https://github.com/mengrru/Spherse/pull/53",
  "",
  "",
  "**Full Changelog**: https://github.com/mengrru/Spherse/compare/v0.3.0...v0.3.1",
].join("\n");

const BODY_WITH_NEW_CONTRIBUTORS = [
  "## What's Changed",
  "* feat: something by @mengrru in https://github.com/mengrru/Spherse/pull/1",
  "## New Contributors",
  "* @newcomer made their first contribution in https://github.com/mengrru/Spherse/pull/2",
  "",
  "**Full Changelog**: https://github.com/mengrru/Spherse/compare/v0.2.2...v0.3.0",
].join("\n");

describe("parseEntry", () => {
  it("keeps feat/fix/refactor and strips `by @user in <url>` tails", () => {
    expect(
      parseEntry(
        "* feat: 支持载入 .agents/skills by @mengrru in https://github.com/mengrru/Spherse/pull/40",
      ),
    ).toEqual({ type: "feat", text: "支持载入 .agents/skills" });
    expect(
      parseEntry("* refactor: project queries 重构 in https://github.com/mengrru/Spherse/pull/49"),
    ).toEqual({ type: "refactor", text: "project queries 重构" });
  });

  it("filters docs/chore/infra entries including full-width colon", () => {
    expect(parseEntry("* docs: 文档体系重构 by @mengrru in https://x/pull/1")).toBeNull();
    expect(parseEntry("* chore: typecheck by @mengrru in https://x/pull/1")).toBeNull();
    expect(parseEntry("* infra：项目生命周期 by @mengrru in https://x/pull/1")).toBeNull();
    expect(parseEntry("* chore：全角冒号 by @mengrru in https://x/pull/1")).toBeNull();
  });

  it("keeps full-width-colon entries of non-filtered types", () => {
    expect(parseEntry("* fix：移动端回车改换行 by @mengrru in https://x/pull/44")).toEqual({
      type: "fix",
      text: "移动端回车改换行",
    });
  });

  it("returns type null for entries without a type prefix", () => {
    expect(parseEntry("* 无类型前缀条目 in https://x/pull/53")).toEqual({
      type: null,
      text: "无类型前缀条目",
    });
  });

  it("ignores non-bullet lines and empty entries", () => {
    expect(parseEntry("## What's Changed")).toBeNull();
    expect(parseEntry("**Full Changelog**: https://x/compare/a...b")).toBeNull();
    expect(parseEntry("* feat: by @mengrru in https://x/pull/1")).toBeNull();
    expect(parseEntry("random text")).toBeNull();
  });
});

describe("parseWhatChanged", () => {
  it("extracts only the What's Changed section from a realistic auto-generated body", () => {
    expect(parseWhatChanged(REALISTIC_BODY)).toEqual([
      { type: "feat", text: "支持载入 .agents/skills" },
      { type: "fix", text: "移动端回车改换行" },
      { type: "refactor", text: "project queries 按需订阅拆分" },
      { type: null, text: "无类型前缀条目" },
    ]);
  });

  it("ignores New Contributors and Full Changelog sections", () => {
    expect(parseWhatChanged(BODY_WITH_NEW_CONTRIBUTORS)).toEqual([
      { type: "feat", text: "something" },
    ]);
  });

  it("returns empty notes for missing or section-less bodies", () => {
    expect(parseWhatChanged(undefined)).toEqual([]);
    expect(parseWhatChanged("")).toEqual([]);
    expect(parseWhatChanged("**Full Changelog**: https://x/compare/a...b")).toEqual([]);
  });
});

describe("compareTagsDesc", () => {
  it("orders semver tags descending, tolerating skipped numbers and bare versions", () => {
    const tags = ["v0.2.0", "0.3.1", "v0.1.19", "v0.3.0"];
    expect(tags.toSorted(compareTagsDesc)).toEqual(["0.3.1", "v0.3.0", "v0.2.0", "v0.1.19"]);
  });

  it("sorts non-semver tags last", () => {
    const tags = ["v0.2.0", "nightly", "v0.1.0"];
    expect(tags.toSorted(compareTagsDesc)).toEqual(["v0.2.0", "v0.1.0", "nightly"]);
  });
});

describe("transformReleases", () => {
  const release = (overrides: Record<string, unknown> = {}) => ({
    tag_name: "v0.3.1",
    published_at: "2026-08-28T01:09:59Z",
    body: REALISTIC_BODY,
    draft: false,
    prerelease: false,
    ...overrides,
  });

  it("maps releases to structured entries with version/tag/date", () => {
    const [entry] = transformReleases([release()]);
    expect(entry.version).toBe("0.3.1");
    expect(entry.tag).toBe("v0.3.1");
    expect(entry.date).toBe("2026-08-28");
    expect(entry.notes).toHaveLength(4);
  });

  it("skips draft and prerelease releases", () => {
    expect(transformReleases([release({ draft: true })])).toEqual([]);
    expect(transformReleases([release({ prerelease: true })])).toEqual([]);
  });

  it("drops releases whose notes are empty after filtering", () => {
    const onlyChore = release({
      tag_name: "v0.3.0",
      body: "## What's Changed\n* chore: x by @u in https://x/pull/1",
    });
    expect(transformReleases([onlyChore])).toEqual([]);
    expect(transformReleases([release({ body: null })])).toEqual([]);
    expect(transformReleases([release({ body: "**Full Changelog**: https://x/a...b" })])).toEqual(
      [],
    );
  });

  it("sorts output from newest to oldest", () => {
    const result = transformReleases([
      release({ tag_name: "v0.2.0" }),
      release({ tag_name: "v0.3.1" }),
      release({ tag_name: "v0.3.0" }),
    ]);
    expect(result.map((r: { version: string }) => r.version)).toEqual(["0.3.1", "0.3.0", "0.2.0"]);
  });
});

describe("buildChangelog", () => {
  it("wraps transformed releases with generatedAt", () => {
    const now = new Date("2026-08-28T10:00:00Z");
    const changelog = buildChangelog(
      [{ tag_name: "v0.1.0", published_at: "2026-08-01T00:00:00Z", body: "## What's Changed\n* feat: x" }],
      now,
    );
    expect(changelog.generatedAt).toBe("2026-08-28T10:00:00.000Z");
    expect(changelog.releases).toEqual([
      {
        version: "0.1.0",
        tag: "v0.1.0",
        date: "2026-08-01",
        notes: [{ type: "feat", text: "x" }],
      },
    ]);
  });
});

describe("fetchAllPages", () => {
  it("follows Link rel=next pagination and merges pages", async () => {
    const pages = [
      {
        body: JSON.stringify([{ tag_name: "v0.1.0" }, { tag_name: "v0.1.1" }]),
        headers: { link: '<https://api.github.com/repos/o/r/releases?per_page=100&page=2>; rel="next"' },
      },
      { body: JSON.stringify([{ tag_name: "v0.2.0" }]), headers: {} },
    ];
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      const page = pages[calls.length - 1];
      return new Response(page.body, { status: 200, headers: page.headers });
    });
    const releases = await fetchAllPages("o/r", { token: "t", fetchImpl });
    expect(releases.map((r: { tag_name: string }) => r.tag_name)).toEqual([
      "v0.1.0",
      "v0.1.1",
      "v0.2.0",
    ]);
    expect(calls).toEqual([
      "https://api.github.com/repos/o/r/releases?per_page=100&page=1",
      "https://api.github.com/repos/o/r/releases?per_page=100&page=2",
    ]);
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer t");
  });

  it("throws on non-2xx responses", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 403 }));
    await expect(fetchAllPages("o/r", { fetchImpl })).rejects.toThrow("403");
  });

  it("throws when the response is not an array", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: "hi" }), { status: 200 }));
    await expect(fetchAllPages("o/r", { fetchImpl })).rejects.toThrow("non-array");
  });
});
