import type { zhCN } from "./zh-CN";

export const zhTW: Record<keyof typeof zhCN, string> = {
  "hero.title": "Spherse",
  "hero.subtitle": "本地運行、開箱即用的個人 Agent 執行環境",
  "hero.tagline": "在這裡搭建故事世界、創造角色、記錄生活，讓散落的想法慢慢長成一個會回應你、不斷生長的世界",
  "hero.downloadMac": "下載 macOS",
  "hero.downloadWin": "下載 Windows",
  // 首頁 Hero 點擊「下載 macOS」後在按鈕下方出現的提示：macOS Gatekeeper 首次開啟未簽章應用會攔截，引導使用者在終端機執行 xattr 指令解除隔離屬性。
  "hero.macosTip": "首次開啟時如果出現「已損毀」或「無法驗證開發者」提示，請在終端機執行以下指令即可開啟：",
  // 首頁 Hero 點擊「下載 Windows」後在按鈕下方出現的提示：未簽章 exe 會觸發瀏覽器下載警告（預設刪除）和 SmartScreen，引導使用者主動選擇保留並放行執行。
  "hero.windowsTip": "Windows 版安裝包尚未進行程式碼簽章。下載時瀏覽器可能提示「可能危害您的電腦」並將「刪除」作為預設操作，請主動選擇「保留」或「更多 → 仍要保留」以儲存安裝包。執行安裝時若彈出「Windows 已保護您的電腦」，點擊「更多資訊」→「仍要執行」即可繼續。",
  "hero.copyCommand": "複製指令",
  "hero.copied": "已複製",

  "feature.heading": "從一個資料夾，搭建你的 Agent Workspace",
  "feature.subheading": "資料、Agent、自動化與互動頁面，在同一個本地執行環境中協作",
  "feature.workspace.title": "一個資料夾，就是共享資料空間",
  "feature.workspace.desc": "檔案保存在本地，使用者可以直接檢視、編輯和備份；多個 Agent 圍繞同一份專案資料分工協作。",
  "feature.agents.title": "每個 Agent 都真正獨立",
  "feature.agents.desc": "分別設定系統提示詞、工具權限、私有 Skill、MCP Server、多個會話與聊天主題。",
  "feature.automation.title": "讓 Agent 主動工作",
  "feature.automation.desc": "按計畫定時執行，或回應使用者、頁面和其他 Agent 發出的事件，組成持續運行的自動化流程。",
  "feature.apps.title": "把內容做成可互動應用",
  "feature.apps.desc": "直接運行專案中的 HTML，並透過 UI SDK 讀寫資料、建立會話、傳送訊息和觸發 Agent。",
  "feature.portable.title": "整個 Workspace 都能分享",
  "feature.portable.desc": "資料、Agent、Skill、自動化、主題和頁面隨專案資料夾一同分發，開啟後即可運行和繼續擴充。",
  "feature.mobile.title": "離開電腦也能繼續存取",
  "feature.mobile.desc": "透過受存取權杖保護的 Web 客戶端和 Tunnel，掃碼即可從行動裝置連接你的桌面執行環境。",
  "feature.slogan": "你創造和分享的不只是一段 Prompt，而是一個可以直接運行的 Agent Workspace。",
  "feature.moreCases": "更多使用案例",

  "usecase.1": "（使用案例描述佔位）",
  "usecase.2": "（使用案例描述佔位）",
  "usecase.3": "（使用案例描述佔位）",
  "usecase.4": "（使用案例描述佔位）",

  "upcoming.memory.title": "Agent 跨 Session 記憶",
  "upcoming.memory.desc": "Agent 將能跨會話保持長期記憶",
  "upcoming.label": "即將到來",

  "home.moreCases": "探索更多可能",
  "nav.explore": "探索",

  "cases.pageTitle": "案例",
  "cases.pageSubtitle": "下載範例專案，體驗 Spherse 的更多可能",
  "cases.download": "下載範例專案",
  "cases.viewLarger": "查看大圖",
  "cases.backHome": "返回首頁",
  "docs.title": "文件",
  "docs.construction": "施工中…",
  "cases.item1.title": "哈利波特",
  "cases.item1.desc": "走進霍格沃茨的魔法世界——預言家日報社、冥想盆等多個 Agent 協同演繹，展示如何用 Spherse 構建一個鮮活的互動式故事宇宙。",
  "cases.item2.title": "世界觀創作框架",
  "cases.item2.desc": "在 Spherse 中原生打造的世界觀創作應用。跟隨內建框架管理角色、陣營、地理與時間線，借助 AI 進行創作、審查與角色扮演。",

  "lang.zhCN": "简体",
  "lang.zhTW": "繁体",
  "lang.en": "EN",
};
