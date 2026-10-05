import type { zhCN } from "./zh-CN";

export const en: Record<keyof typeof zhCN, string> = {
  "hero.title": "Spherse",
  "hero.subtitle":
    "A local, ready-to-use personal agent runtime",
  "hero.tagline":
    "Build story worlds, create characters, and capture your life here—then watch scattered ideas slowly grow into a living world that responds to you",
  "hero.downloadMac": "Download for macOS",
  "hero.downloadWin": "Download for Windows",
  "hero.downloadLinux": "Download for Linux",
  // Shown below the download buttons after clicking "Download for macOS": macOS Gatekeeper blocks unsigned apps on first launch, so guide the user to run an xattr command in Terminal.
  "hero.macosTip": "If you see a “damaged” or “cannot be verified” warning on first launch, run the following command in Terminal:",
  // Shown below the download buttons after clicking "Download for Windows": an unsigned .exe triggers a browser download warning (Delete by default) and SmartScreen, so guide the user to actively keep the file and allow it to run.
  "hero.windowsTip": "The Windows installer is not yet code-signed. When downloading, your browser may warn it “could harm your computer” and offer Delete as the default action — please choose “Keep” or “More → Keep anyway” to save it. If Windows shows “Windows protected your PC” when you run it, click “More info” → “Run anyway” to continue.",
  // Shown below the download buttons after clicking "Download for Linux": an AppImage needs the executable bit; Ubuntu 23.10+ restricts unprivileged user namespaces, so guide the user through the sysctl workaround.
  "hero.linuxTip": "The Linux build is an AppImage: make it executable before launching (run chmod +x Spherse-*.AppImage in a terminal, or enable “Allow executing file as program” in the file properties). On Ubuntu 23.10 and later, if the app fails to start with a SUID sandbox error, run sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0 and try again; a .deb package is available on GitHub Releases.",
  "hero.copyCommand": "Copy command",
  "hero.copied": "Copied",

  "feature.heading": "Build your Agent Workspace from one folder",
  "feature.subheading": "Bring data, agents, automation, and interactive pages together in one local runtime",
  "feature.workspace.title": "One folder, one shared data space",
  "feature.workspace.desc": "Your files stay local and remain easy to inspect, edit, and back up, while multiple agents collaborate over the same project data.",
  "feature.agents.title": "Every agent is truly independent",
  "feature.agents.desc": "Give each agent its own system prompt, tool permissions, private skills, MCP servers, sessions, and chat theme.",
  "feature.automation.title": "Let agents work proactively",
  "feature.automation.desc": "Run agents on schedules or events emitted by users, pages, and other agents to build continuous automated workflows.",
  "feature.apps.title": "Turn content into interactive apps",
  "feature.apps.desc": "Run project HTML directly, then use the UI SDK to access data, create sessions, send messages, and trigger agents.",
  "feature.portable.title": "Share the entire Workspace",
  "feature.portable.desc": "Data, agents, skills, automations, themes, and pages travel with the project folder, ready to run and extend when opened.",
  "feature.mobile.title": "Keep access away from your desk",
  "feature.mobile.desc": "Use the token-protected Web client and a tunnel to scan and connect to your desktop runtime from a mobile device.",
  "feature.slogan": "Create and share more than a prompt: share an Agent Workspace that is ready to run.",
  "feature.motto": "Spherse is your box of building blocks — use it to build a world entirely your own!",
  "feature.moreCases": "More use cases",

  "usecase.1": "(Use case description placeholder)",
  "usecase.2": "(Use case description placeholder)",
  "usecase.3": "(Use case description placeholder)",
  "usecase.4": "(Use case description placeholder)",

  "upcoming.memory.title": "Cross-Session Memory",
  "upcoming.memory.desc": "Agents will maintain long-term memory across sessions",
  "upcoming.roundtable.title": "Agent Roundtable",
  "upcoming.roundtable.desc": "Multiple agents will discuss the same topic at a roundtable and collaborate toward a conclusion",
  "upcoming.label": "Coming Soon",

  "home.moreCases": "Explore more possibilities",
  "nav.explore": "Explore",
  "nav.download": "Download",

  "download.pageTitle": "Download Spherse",
  "download.pageSubtitle": "Get the latest version, or browse the release history",
  "download.latestSection": "Latest release downloads",
  "download.latestLabel": "Latest",
  "download.macArm64": "macOS (Apple Silicon)",
  "download.macIntel": "macOS (Intel)",
  "download.winX64": "Windows (x64)",
  "download.winArm64": "Windows (ARM64)",
  "download.linuxX64": "Linux (x64 · AppImage)",
  "download.hint": "Direct installer download",
  "download.download": "Download",
  "download.fallback": "Get it from GitHub Releases",
  "download.changelogTitle": "Changelog",
  "download.viewOnGithub": "View on GitHub",

  "cases.pageTitle": "Examples",
  "cases.pageSubtitle": "Download sample projects to explore what Spherse can do",
  "cases.download": "Download sample",
  "cases.viewLarger": "View larger image",
  "cases.backHome": "Back to home",
  "nav.docs": "Docs",
  "docs.title": "Documentation",
  "docs.subtitle": "Guides and tutorials",
  "docs.tailscale.title": "Access Spherse from your phone with Tailscale",
  "docs.tailscale.intro":
    "Tailscale puts your computer and phone on the same private network (a tailnet). With it, you can securely reach the Spherse instance on your computer from your phone on any network — no public IP needed, and nothing is exposed to the internet. All you need is a free Tailscale account.",
  "docs.tailscale.step1.title": "Install Tailscale on your computer",
  "docs.tailscale.step1.desc":
    "Download and install the Tailscale client, then sign in to your account. Once signed in, this computer joins your tailnet.",
  "docs.tailscale.step2.title": "Serve the Spherse port on your tailnet",
  "docs.tailscale.step2.desc":
    "In the Spherse desktop app, open Settings → Mobile, switch Connection mode to Custom domain, note the port from the Local service URL, then run this in a terminal:",
  "docs.tailscale.step2.hint":
    "Replace 12345 with your actual port. The command prints a https://<machine>.<tailnet>.ts.net URL that only devices in your tailnet can reach.",
  "docs.tailscale.step2.macosHint":
    "On macOS, if the command is not found, use the full path instead:",
  "docs.tailscale.step3.title": "Enter the domain in Spherse",
  "docs.tailscale.step3.desc":
    "Back in Settings → Mobile in Spherse, paste the ts.net URL into Public domain and save. The QR code appears immediately.",
  "docs.tailscale.step4.title": "Connect your phone to Tailscale",
  "docs.tailscale.step4.desc":
    "Install the Tailscale app (App Store / Google Play) on your phone, sign in with the same account, and turn on the connection.",
  "docs.tailscale.step5.title": "Scan and connect",
  "docs.tailscale.step5.desc":
    "Scan the QR code on the Spherse settings page with your phone. Once it opens in the browser, you're connected — your Spherse is now reachable from your phone anywhere.",
  "docs.tailscale.notes.title": "Manage and troubleshoot",
  "docs.tailscale.notes.status": "List the served URL and running status",
  "docs.tailscale.notes.off": "Stop serving; your phone will no longer reach Spherse",
  "docs.tailscale.notes.https":
    "If the first run asks you to enable HTTPS certificates, follow the link in the command output and enable it once in the Tailscale admin console.",
  "docs.tailscale.notes.docs": "See the official Tailscale Serve docs for more",
  "cases.item1.title": "Harry Potter",
  "cases.item1.desc": "Step into the wizarding world of Hogwarts — the Daily Prophet, the Pensieve and more, with multiple agents collaborating to show how Spherse brings an interactive story universe to life.",
  "cases.item2.title": "Worldbuilding Framework",
  "cases.item2.desc": "A worldbuilding app crafted natively in Spherse. Follow the built-in framework to manage characters, factions, geography, and timelines — then use AI to create, review, and roleplay.",

  "lang.zhCN": "简体",
  "lang.zhTW": "繁体",
  "lang.en": "EN",
};
