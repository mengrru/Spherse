export const zhCN = {
  "hero.title": "Spherse",
  // 首页 Hero 主定位，紧跟产品名说明 Spherse 的产品类别与使用门槛。
  "hero.subtitle": "本地运行、开箱即用的个人 Agent 运行时",
  // 首页 Hero 价值说明，用具体使用场景直观表达多个 Agent 能为用户做什么。
  "hero.tagline": "在这里搭建故事世界、创造角色、记录生活，让散落的想法慢慢长成一个会回应你、不断生长的世界",
  "hero.downloadMac": "下载 macOS",
  "hero.downloadWin": "下载 Windows",
  "hero.downloadLinux": "下载 Linux",
  // 首页 Hero 点击「下载 macOS」后在按钮下方出现的提示：macOS Gatekeeper 首次打开未签名应用会拦截，引导用户在终端运行 xattr 命令解除隔离属性。
  "hero.macosTip": "首次打开时如果出现“已损坏”或“无法验证开发者”提示，请在终端执行以下命令即可打开：",
  // 首页 Hero 点击「下载 Windows」后在按钮下方出现的提示：未签名 exe 会触发浏览器下载警告（默认删除）和 SmartScreen，引导用户主动选择保留并放行运行。
  "hero.windowsTip": "Windows 版安装包尚未进行代码签名。下载时浏览器可能提示「可能危害你的电脑」并将「删除」作为默认操作，请主动选择「保留」或「更多 → 仍要保留」以保存安装包。运行安装时若弹出「Windows 已保护你的电脑」，点击「更多信息」→「仍要运行」即可继续。",
  // 首页 Hero 点击「下载 Linux」后在按钮下方出现的提示：AppImage 需先赋予可执行权限；Ubuntu 23.10+ 默认限制 unprivileged userns，Electron sandbox 启动失败时给出 sysctl workaround。
  "hero.linuxTip": "Linux 版为 AppImage 格式，下载后需先赋予可执行权限再运行（终端执行 chmod +x Spherse-*.AppImage，或在文件管理器属性中勾选「允许作为程序执行」）。Ubuntu 23.10 及以上版本若启动时报 SUID sandbox 错误，请先执行 sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0 后重试；deb 安装包可前往 GitHub Releases 下载。",
  // macOS 安装提示中复制命令按钮的无障碍标签（点击前）。
  "hero.copyCommand": "复制命令",
  // macOS 安装提示中复制命令按钮的无障碍标签（点击后短暂展示）。
  "hero.copied": "已复制",

  // 首页功能卡片区标题，概括 Spherse 将文件、Agent 与应用组织为同一运行空间。
  "feature.heading": "从一个文件夹，搭建你的 Agent Workspace",
  // 首页功能卡片区副标题，解释卡片之间共同描述的产品运行模型。
  "feature.subheading": "数据、Agent、自动化与交互页面，在同一个本地运行时中协作",
  // 首页第一张功能卡片，说明项目目录既是共享数据源，也是用户可直接管理的文件空间。
  "feature.workspace.title": "一个文件夹，就是共享数据空间",
  // 首页第一张功能卡片描述，强调数据本地保存以及多个 Agent 对同一项目内容协作。
  "feature.workspace.desc": "文件保存在本地，用户可以直接查看、编辑和备份；多个 Agent 围绕同一份项目数据分工协作。",
  // 首页第二张功能卡片，说明每个 Agent 拥有彼此隔离的能力与体验配置。
  "feature.agents.title": "每个 Agent 都真正独立",
  // 首页第二张功能卡片描述，列出 Agent 级提示词、权限、Skill、MCP、会话和主题配置。
  "feature.agents.desc": "分别配置系统提示词、工具权限、私有 Skill、MCP Server、多个会话与聊天主题。",
  // 首页第三张功能卡片，表达 Agent 可由计划和事件主动运行，而非只能被动聊天。
  "feature.automation.title": "让 Agent 主动工作",
  // 首页第三张功能卡片描述，说明定时、自定义事件以及 Agent 间联动能力。
  "feature.automation.desc": "按计划定时执行，或响应用户、页面和其他 Agent 发出的事件，组成持续运行的自动化流程。",
  // 首页第四张功能卡片，说明项目 HTML 可成为调用 Agent 运行时的交互应用。
  "feature.apps.title": "把内容做成可交互应用",
  // 首页第四张功能卡片描述，说明内置预览服务和 UI SDK 提供的主要交互能力。
  "feature.apps.desc": "直接运行项目中的 HTML，并通过 UI SDK 读写数据、创建会话、发送消息和触发 Agent。",
  // 首页第五张功能卡片，说明项目文件夹可携带完整运行配置进行复制和分享。
  "feature.portable.title": "整个 Workspace 都能分享",
  // 首页第五张功能卡片描述，强调接收者获得的是包含数据和运行能力的完整作品。
  "feature.portable.desc": "数据、Agent、Skill、自动化、主题和页面随项目目录一同分发，打开后即可运行和继续扩展。",
  // 首页第六张功能卡片，说明用户可通过受保护的 Web 入口从移动设备访问桌面运行时。
  "feature.mobile.title": "离开电脑也能继续访问",
  // 首页第六张功能卡片描述，说明扫码连接和 Tunnel 带来的跨设备使用体验。
  "feature.mobile.desc": "通过受访问令牌保护的 Web 客户端和 Tunnel，扫码即可从移动设备连接你的桌面运行时。",
  // 首页功能卡片区结语，强化 Spherse 分发完整 Agent Workspace 而非单一提示词的差异。
  "feature.slogan": "你创造和分享的不只是一段 Prompt，而是一个可以直接运行的 Agent Workspace。",
  // 首页功能卡片区最末的品牌邀请句，紧接 feature.slogan 定位句下方，用「积木筐」比喻邀请用户动手搭建属于自己的世界。
  "feature.motto": "Spherse 是你的积木筐，用它来打造完全属于你自己的世界吧！",
  "feature.moreCases": "更多使用案例",

  "usecase.1": "（使用案例描述占位）",
  "usecase.2": "（使用案例描述占位）",
  "usecase.3": "（使用案例描述占位）",
  "usecase.4": "（使用案例描述占位）",

  "upcoming.memory.title": "Agent 跨 Session 记忆",
  "upcoming.memory.desc": "Agent 将能跨会话保持长期记忆",
  // 首页「即将到来」区第二张卡片：多 Agent 圆桌讨论
  "upcoming.roundtable.title": "Agent 圆桌",
  // 圆桌卡片描述：多个 Agent 围绕同一话题展开讨论
  "upcoming.roundtable.desc": "多个 Agent 将能围绕同一话题展开圆桌讨论，自主协作得出结论",
  "upcoming.label": "即将到来",

  "home.moreCases": "探索更多可能",
  "nav.explore": "探索",
  "nav.download": "下载",
  // 顶部导航「文档」链接
  "nav.docs": "文档",

  // 下载页（/download）标题与副标题。
  "download.pageTitle": "下载 Spherse",
  "download.pageSubtitle": "获取最新版本，或浏览各版本更新记录",
  // 下载页最新版本区的无障碍名称。
  "download.latestSection": "最新版本下载",
  // 下载页最新版本徽章中「最新版本」字样。
  "download.latestLabel": "最新版本",
  "download.macArm64": "macOS（Apple Silicon）",
  "download.macIntel": "macOS（Intel）",
  "download.winX64": "Windows（x64）",
  "download.winArm64": "Windows（ARM64）",
  "download.linuxX64": "Linux（x64 · AppImage）",
  // 平台卡片上按钮旁的补充说明（安装包直链）。
  "download.hint": "安装包直链下载",
  "download.download": "下载",
  // manifest 拉取失败时的兜底卡片文案。
  "download.fallback": "前往 GitHub Releases 下载",
  "download.changelogTitle": "更新日志",
  // changelog 每版本面板右上角 GitHub 外链的无障碍标签。
  "download.viewOnGithub": "在 GitHub 查看",

  "cases.pageTitle": "案例",
  "cases.pageSubtitle": "下载示例项目，体验 Spherse 的更多可能",
  "cases.download": "下载示例项目",
  // 案例卡片截图的无障碍标签：点击放大查看
  "cases.viewLarger": "查看大图",
  "cases.backHome": "返回首页",
  // 文档页（/docs）标题
  "docs.title": "文档",
  // 文档页副标题
  "docs.subtitle": "指南与教程",
  // 文档页 Tailscale 教程标题：手机远程访问
  "docs.tailscale.title": "用 Tailscale 从手机访问 Spherse",
  // Tailscale 教程简介：说明 tailnet 私有网络的价值与所需准备
  "docs.tailscale.intro":
    "Tailscale 会把你的电脑和手机组成一个私有网络（tailnet）。借助它，你可以在任何网络下用手机安全地访问电脑上的 Spherse——无需公网 IP，也不会把服务暴露到互联网。整个过程只需要一个免费的 Tailscale 账号。",
  // 教程第 1 步标题：电脑安装 Tailscale 客户端
  "docs.tailscale.step1.title": "在电脑上安装 Tailscale",
  // 教程第 1 步说明：下载、登录、加入 tailnet
  "docs.tailscale.step1.desc":
    "下载并安装 Tailscale 客户端，启动后登录你的账号。登录成功后，这台电脑就加入了你的 tailnet。",
  // 教程第 2 步标题：tailscale serve 发布端口
  "docs.tailscale.step2.title": "把 Spherse 端口发布到 tailnet",
  // 教程第 2 步说明：从设置页获取端口号并执行 serve 命令
  "docs.tailscale.step2.desc":
    "在 Spherse 桌面端打开 设置 → 移动端，将「连接方式」切换为「自有域名」（若此前启用过快速隧道，请先关闭其开关），记下「本地服务 URL」中的端口号，然后在电脑终端执行：",
  // 教程第 2 步命令说明：替换端口、ts.net 地址仅 tailnet 内可见
  "docs.tailscale.step2.hint":
    "把 12345 替换为你的实际端口。命令会输出一个 https://<机器名>.<tailnet>.ts.net 地址，只有你 tailnet 中的设备可以访问它。",
  // 教程第 2 步 macOS 补充：CLI 不在 PATH 中需用完整路径
  "docs.tailscale.step2.macosHint": "macOS 下如提示找不到命令，请改用完整路径执行：",
  // 教程第 3 步标题：Spherse 中保存公网域名
  "docs.tailscale.step3.title": "在 Spherse 中填写域名",
  // 教程第 3 步说明：填入 ts.net 地址生成二维码
  "docs.tailscale.step3.desc":
    "回到 Spherse 的 设置 → 移动端，把上一步得到的 ts.net 地址填入「公网域名」并保存，二维码会立即显示。",
  // 教程第 4 步标题：手机加入 tailnet
  "docs.tailscale.step4.title": "在手机上连接 Tailscale",
  // 教程第 4 步说明：安装 App、同账号登录并开启连接
  "docs.tailscale.step4.desc":
    "在手机上安装 Tailscale App（App Store / Google Play），登录同一个账号，然后开启连接。",
  // 教程第 5 步标题：扫码配对
  "docs.tailscale.step5.title": "扫码访问",
  // 教程第 5 步说明：扫码完成连接后可随时访问
  "docs.tailscale.step5.desc":
    "用手机扫描 Spherse 设置页中的二维码，浏览器打开后即完成连接。之后随时在手机上访问你的 Spherse。",
  // 教程附注区标题：管理与排错
  "docs.tailscale.notes.title": "管理与排错",
  // 附注：查看 serve 状态的命令说明
  "docs.tailscale.notes.status": "查看已发布的地址与运行状态",
  // 附注：停止 serve 的命令说明
  "docs.tailscale.notes.off": "停止发布并清除本机全部 serve 配置，手机将无法继续访问",
  // 附注：首次使用可能需要启用 HTTPS 证书
  "docs.tailscale.notes.https":
    "若首次执行时提示需要启用 HTTPS 证书，跟随命令输出中的指引在 Tailscale 管理台开启一次即可。",
  // 附注：Tailscale Serve 官方文档外链文案
  "docs.tailscale.notes.docs": "更多用法参考 Tailscale Serve 官方文档",
  "cases.item1.title": "哈利波特",
  "cases.item1.desc": "走进霍格沃茨的魔法世界——预言家日报社、冥想盆等多个 Agent 协同演绎，展示如何用 Spherse 构建一个鲜活的交互式故事宇宙。",
  // 案例页第二张卡片，在 Spherse 中原生打造的世界观创作应用。
  "cases.item2.title": "世界观创作框架",
  // 案例页第二张卡片描述，说明内置框架覆盖的创作维度与 AI 辅助能力。
  "cases.item2.desc": "在 Spherse 中原生打造的世界观创作应用。跟随内置框架管理角色、阵营、地理与时间线，借助 AI 进行创作、审查与角色扮演。",

  "lang.zhCN": "简体",
  "lang.zhTW": "繁体",
  "lang.en": "EN",
} as const;
