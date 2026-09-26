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
  { content: "User's sister is a nurse working night shifts in Suzhou", tags: ["family"] },
  { content: "User prefers Vim keybindings in every editor possible", tags: ["preference", "tech"] },
  { content: "User's desk setup includes a 27-inch 4K monitor on an arm mount", tags: ["hardware"] },
  { content: "User listens to lo-fi music while coding but silence while writing", tags: ["music", "preference"] },
  { content: "User's favorite programming language is TypeScript, second is Rust", tags: ["tech", "preference"] },
  { content: "User drinks mostly water, about 2 liters per day", tags: ["health"] },
  { content: "User's passport expires in 2029", tags: ["admin"] },
  { content: "User volunteers at a local dog shelter once a month", tags: ["hobby"] },
  { content: "User's home server runs Ubuntu with Docker containers", tags: ["hardware", "tech"] },
  { content: "User prefers video calls over voice calls for work meetings", tags: ["work", "preference"] },
  { content: "User's bicycle is a fixed-gear built from scratch", tags: ["hobby", "hardware"] },
  { content: "User takes notes with a Pilot Custom 74 fountain pen", tags: ["tools", "stationery"] },
  { content: "User's favorite season is autumn in Hangzhou", tags: ["preference"] },
  { content: "User completed a half marathon in 2 hours 5 minutes last year", tags: ["health", "sport"] },
  { content: "User's emergency contact is sister Li Wei", tags: ["family", "admin"] },
  { content: "User archives old projects into a folder named 'graveyard'", tags: ["work", "habit"] },
  { content: "User's reading goal this year is 24 books, currently at 17", tags: ["hobby", "goal"] },
  { content: "User avoids social media except a private Mastodon account", tags: ["preference"] },
  { content: "User's apartment faces north with a view of the canal", tags: ["location"] },
  { content: "User swaps keyboard switches yearly, currently on tactile silent", tags: ["hardware"] },
  { content: "User's blood type is O positive", tags: ["health"] },
  { content: "User's workplace gives every second Friday off", tags: ["work"] },
  { content: "User keeps a bonsai tree named老头 on the balcony", tags: ["hobby"] },
  { content: "User's photography gear is a Fujifilm X-T5 with two prime lenses", tags: ["hobby", "hardware"] },
  { content: "User backs up photos to both the NAS and a cold storage drive", tags: ["hardware", "habit"] },
  { content: "User's favorite noodle dish is 片儿川, a Hangzhou specialty", tags: ["food"] },
  { content: "用户的女儿在读小学三年级，喜欢画画", tags: ["家庭"] },
  { content: "用户每年春节会回成都陪母亲过节", tags: ["家庭", "习惯"] },
  { content: "用户对芒果也轻微过敏，但不像花生那么严重", tags: ["健康", "饮食"] },
  { content: "用户的公司每年组织一次团建，去年去了千岛湖", tags: ["工作"] },
  { content: "用户正在装修新房，风格是极简原木风", tags: ["生活", "目标"] },
  { content: "用户喜欢收集机械键盘键帽，已经有三十多套", tags: ["爱好", "装备"] },
  { content: "用户的驾驶证是 C1，开车很谨慎从不出险", tags: ["生活"] },
  { content: "用户每周日晚上会做下一周的膳食准备", tags: ["习惯", "饮食"] },
  { content: "用户的姐姐李薇在苏州当护士，上夜班", tags: ["家庭"] },
  { content: "用户的老家在浙江温州，大学才来杭州", tags: ["家庭", "位置"] },
  { content: "用户喜欢在长途火车上看书，不喜欢坐飞机", tags: ["偏好", "出行"] },
  { content: "用户的办公椅是赫曼米勒的，去年双十一买的", tags: ["装备"] },
  { content: "用户会给开源项目提 PR，去年贡献了四个仓库", tags: ["技术", "爱好"] },
  { content: "用户的手机铃声永远是静音振动", tags: ["偏好"] },
  { content: "用户每年体检一次，上次胆固醇略高", tags: ["健康"] },
  { content: "用户的家里有空气净化器，全年开着", tags: ["生活"] },
  { content: "用户对花粉过敏，春天出门会戴口罩", tags: ["健康"] },
  { content: "用户周末喜欢去西湖边上的咖啡馆写代码", tags: ["爱好", "工作"] },
  { content: "用户的毕业论文写的是分布式一致性算法", tags: ["学业"] },
  { content: "用户喜欢吃日料，尤其是三文鱼刺身", tags: ["饮食", "偏好"] },
  { content: "用户的运动手表是佳明的，睡眠数据每天同步", tags: ["装备", "健康"] },
  { content: "用户的公司用的是飞书，个人更喜欢 Telegram", tags: ["工具", "偏好"] },
  { content: "用户养的绿萝已经五年了，搬到哪都带着", tags: ["生活"] },
  { content: "用户会弹一点尤克里里，比吉他简单", tags: ["乐器", "爱好"] },
  { content: "用户的邮政快递都放丰巢，家里没人签收", tags: ["生活"] },
  { content: "用户每个季度会整理一次 Obsidian 笔记库", tags: ["工具", "习惯"] },
  { content: "用户的目标是四十岁前完成一次全程马拉松", tags: ["目标", "运动"] },
  { content: "用户不喜欢喝碳酸饮料，只喝无糖茶", tags: ["饮食", "偏好"] },
  { content: "用户的团队每两周做一次代码回顾会", tags: ["工作"] },
  { content: "用户冬天手脚冰凉，办公室常备一条毯子", tags: ["健康", "生活"] },
  { content: "User's favorite podcast is about ancient history", tags: ["hobby"] },
  { content: "User keeps a spreadsheet of every book read since 2018", tags: ["habit", "book"] },
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
  const terms = query.toLowerCase().split(/\s+/);
  return contents.filter((c) => {
    const lower = c.toLowerCase();
    return terms.every((term) => lower.includes(term));
  });
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
