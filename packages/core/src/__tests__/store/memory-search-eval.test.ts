import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { MemoryStore } from "../../store/memory.js";

interface SeedEntry {
  content: string;
  tags?: string[];
}

const CORPUS: SeedEntry[] = [
  { content: "User's name is Mengru and she prefers to be called by her full name", tags: ["identity"] },
  { content: "User lives in Hangzhou and works remotely", tags: ["location", "work"] },
  { content: "User prefers dark theme in all editors and IDEs", tags: ["preference", "ui"] },
  { content: "User drinks green tea every morning, never coffee", tags: ["preference", "food"] },
  { content: "User's main project is called Spherse, an Electron agent runtime", tags: ["project"] },
  { content: "User is learning Japanese, currently at N4 level", tags: ["learning"] },
  { content: "User dislikes meetings before 10am due to late working hours", tags: ["work", "preference"] },
  { content: "User's laptop is a MacBook Pro with M3 chip", tags: ["hardware"] },
  { content: "User keeps notes in Obsidian with a vault named 'brain'", tags: ["tools"] },
  { content: "User plays guitar and prefers fingerstyle arrangements", tags: ["hobby", "music"] },
  { content: "User's timezone is Asia/Shanghai (UTC+8)", tags: ["location"] },
  { content: "User prefers TypeScript over JavaScript for any new project", tags: ["preference", "tech"] },
  { content: "User has a cat named Mochi who interrupts calls", tags: ["family", "pet"] },
  { content: "User reads science fiction, favorite author is Liu Cixin", tags: ["hobby", "book"] },
  { content: "User jogs three times a week along the West Lake", tags: ["health"] },
  { content: "用户的中文名字是孟茹", tags: ["身份"] },
  { content: "用户在杭州的滨江区的科技公司工作", tags: ["工作", "位置"] },
  { content: "用户喜欢在周末爬山，最爱的是黄山", tags: ["爱好", "运动"] },
  { content: "用户对花生过敏，外出就餐必须确认食材", tags: ["健康", "饮食"] },
  { content: "用户正在学习钢琴，目标是明年弹完一首完整的曲子", tags: ["学习", "乐器"] },
  { content: "用户的项目代号是星辰，主要用 TypeScript 编写", tags: ["项目"] },
  { content: "用户偏好简洁的回复，不喜欢冗长的解释", tags: ["偏好"] },
  { content: "用户家里养了一只叫小白的猫，今年三岁", tags: ["宠物"] },
  { content: "用户每周五晚上会和朋友打羽毛球", tags: ["运动", "社交"] },
  { content: "用户使用智谱的模型做日常代码助手", tags: ["工具", "技术"] },
  { content: "用户的博士研究方向是分布式系统", tags: ["学业"] },
  { content: "用户喜欢的电影是《星际穿越》，看过三遍", tags: ["爱好", "电影"] },
  { content: "用户早餐通常吃包子配豆浆", tags: ["饮食"] },
  { content: "User's mother lives in Chengdu and visits every spring festival", tags: ["family"] },
  { content: "User's keyboard is a Keychron K2 with brown switches", tags: ["hardware"] },
  { content: "User backs up data to a NAS at home every night", tags: ["hardware", "tools"] },
  { content: "User attended Zhejiang University for undergraduate", tags: ["education"] },
  { content: "User prefers train travel over flying within China", tags: ["preference", "travel"] },
  { content: "User's favorite restaurant in Hangzhou is a local noodle shop", tags: ["food", "location"] },
  { content: "User writes a personal blog about programming, updated monthly", tags: ["hobby", "tech"] },
  { content: "用户不喜欢辣椒，点菜总是要微辣以下", tags: ["偏好", "饮食"] },
  { content: "用户的英语流利，日语还在初级阶段", tags: ["语言", "学习"] },
  { content: "User mentors two junior developers in a monthly call", tags: ["work"] },
  { content: "User's phone is an iPhone and watch is a Garmin", tags: ["hardware"] },
  { content: "User donates to an open source foundation yearly", tags: ["hobby"] },
  { content: "User's sleep schedule is 1am to 8am on weekdays", tags: ["health"] },
  { content: "用户的目标是在今年年底前发布项目的第一个正式版本", tags: ["项目", "目标"] },
  { content: "User keeps a paper journal for daily planning", tags: ["tools", "habit"] },
  { content: "User's git commit style is conventional commits", tags: ["tech", "work"] },
  { content: "User hates pop-up notifications and keeps Do Not Disturb on", tags: ["preference"] },
  { content: "用户跑步用的鞋是特步的马拉松系列", tags: ["运动", "装备"] },
];

interface LabeledQuery {
  query: string;
  relevantSubstrings: string[];
}

const QUERIES: LabeledQuery[] = [
  { query: "Mengru", relevantSubstrings: ["Mengru"] },
  { query: "dark theme", relevantSubstrings: ["dark theme"] },
  { query: "green tea", relevantSubstrings: ["green tea"] },
  { query: "MacBook", relevantSubstrings: ["MacBook Pro"] },
  { query: "Liu Cixin", relevantSubstrings: ["Liu Cixin"] },
  { query: "West Lake", relevantSubstrings: ["West Lake"] },
  { query: "conventional commits", relevantSubstrings: ["conventional commits"] },
  { query: "Keychron", relevantSubstrings: ["Keychron K2"] },
  { query: "science fiction", relevantSubstrings: ["science fiction"] },
  { query: "Do Not Disturb", relevantSubstrings: ["Do Not Disturb"] },
  { query: "Mochi", relevantSubstrings: ["Mochi"] },
  { query: "fingerstyle", relevantSubstrings: ["fingerstyle"] },
  { query: "Obsidian", relevantSubstrings: ["Obsidian"] },
  { query: "learning Japanese", relevantSubstrings: ["learning Japanese"] },
  { query: "project Spherse", relevantSubstrings: ["Spherse"] },
  { query: "peanut allergy", relevantSubstrings: ["peanut"] },
  { query: "过敏", relevantSubstrings: ["花生过敏"] },
  { query: "黄山", relevantSubstrings: ["黄山"] },
  { query: "小白", relevantSubstrings: ["小白"] },
  { query: "羽毛球", relevantSubstrings: ["羽毛球"] },
  { query: "智谱", relevantSubstrings: ["智谱"] },
  { query: "星际穿越", relevantSubstrings: ["星际穿越"] },
  { query: "包子", relevantSubstrings: ["包子"] },
  { query: "分布式系统", relevantSubstrings: ["分布式系统"] },
  { query: "微辣", relevantSubstrings: ["微辣"] },
  { query: "钢琴", relevantSubstrings: ["钢琴"] },
  { query: "马拉松", relevantSubstrings: ["马拉松"] },
  { query: "正式版本", relevantSubstrings: ["正式版本"] },
  { query: "早餐", relevantSubstrings: ["包子配豆浆"] },
  { query: "名字", relevantSubstrings: ["孟茹"] },
];

const K = 10;

function recallAtK(results: string[], query: LabeledQuery): boolean {
  return query.relevantSubstrings.some((sub) => results.some((r) => r.includes(sub)));
}

function reciprocalRank(results: string[], query: LabeledQuery): number {
  for (let i = 0; i < results.length; i++) {
    if (query.relevantSubstrings.some((sub) => results[i].includes(sub))) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

function substringBaseline(contents: string[], query: string): string[] {
  const q = query.toLowerCase();
  return contents.filter((c) => c.toLowerCase().includes(q));
}

describe("memory retrieval eval", () => {
  let dir: string;
  let store: MemoryStore;
  let contents: string[];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-memeval-"));
    store = new MemoryStore(dir);
    for (const seed of CORPUS) {
      store.save(seed.content, seed.tags);
    }
    contents = store.list().map((e) => e.content);
  });
  afterEach(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("recall@10 >= 0.9 on the labeled query set", () => {
    const hits = QUERIES.filter((q) => recallAtK(store.search(q.query, K).map((e) => e.content), q));
    const recall = hits.length / QUERIES.length;
    expect(recall).toBeGreaterThanOrEqual(0.9);
  });

  it("MRR >= 0.8 on the labeled query set", () => {
    const mrr =
      QUERIES.reduce(
        (sum, q) => sum + reciprocalRank(store.search(q.query, K).map((e) => e.content), q),
        0,
      ) / QUERIES.length;
    expect(mrr).toBeGreaterThanOrEqual(0.8);
  });

  it("fts is not worse than the substring baseline", () => {
    const failures: string[] = [];
    for (const q of QUERIES) {
      const ftsHit = recallAtK(store.search(q.query, K).map((e) => e.content), q);
      const baselineHit = recallAtK(substringBaseline(contents, q.query), q);
      if (baselineHit && !ftsHit) {
        failures.push(q.query);
      }
    }
    expect(failures).toEqual([]);
  });
});
