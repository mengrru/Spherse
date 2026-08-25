export const zhCN = {
  // 应用初始化时的加载占位文案
  "app.loading": "加载中...",
  // web/桌面端断线重连后自动补拉数据失败时右下角 toast 提示（补偿会在下次重连时再次尝试）
  "app.resumeSyncFailed": "连接不可用，部分数据可能未及时刷新",
  // 设置弹窗标题
  "settings.title": "设置",
  // 设置弹窗中的文本模型 tab 标签
  "settings.tabs.text": "文本模型",
  // 设置弹窗中的图片生成 tab 标签
  "settings.tabs.image": "生图模型",
  // 设置弹窗中的通用 tab 标签
  "settings.tabs.general": "通用",
  // 默认模型下拉框的标签
  "settings.models.defaultModel": "默认模型",
  // 默认模型下拉框的占位提示
  "settings.models.selectPlaceholder": "-- 请选择 --",
  // 尚未配置任何 API Key 时的提示
  "settings.models.configureFirst": "请先配置 API Key",
  // 默认模型下拉搜索框的占位提示（打开下拉后输入模型名称筛选）
  "settings.models.searchPlaceholder": "搜索模型…",
  // 默认模型下拉搜索无匹配结果时的提示
  "settings.models.noResults": "未找到匹配的模型",
  // 模型提供商区域标题
  "settings.models.providers": "模型提供商",
  // 文本模型 tab「模型提供商」标题旁 info tooltip 的前半段文案（后接可点击的 DeepSeek 链接），提示只需填一个提供商的密钥、推荐 DeepSeek
  "settings.models.providersHintPre": "只需填写任一提供商的 API Key 即可使用。还没有密钥？推荐使用 ",
  // 文本模型 tab「模型提供商」标题旁 info tooltip 的后半段文案（紧跟 DeepSeek 链接之后）
  "settings.models.providersHintPost": "。",
  // 文本模型 tab「模型提供商」标题旁 info 图标的完整无障碍标签（aria-label，供屏幕阅读器朗读，无需断句）
  "settings.models.providersHintAria": "只需填写任一提供商的 API Key 即可使用。还没有密钥？推荐使用 DeepSeek。",
  // 保存按钮文案
  "settings.models.save": "保存",
  // 保存按钮的加载中状态
  "settings.models.saving": "保存中...",
  // 保存成功提示
  "settings.models.saved": "已保存",
  // 保存失败提示
  "settings.models.saveFailed": "保存失败",
  // 关闭按钮
  "settings.models.close": "关闭",
  // 文本模型 tab → 高级设置折叠区标题（点击展开/收起 temperature、top_p 等采样参数）
  "settings.models.advanced": "高级设置",
  // 高级设置折叠区顶部的警示文案（提示用户改参数有副作用、无需求不要动）
  "settings.models.advancedTip": "调整这些参数会影响模型的输出表现。如果没有明确的需求，建议保持默认。",
  // 高级设置 → temperature 数字输入框的标签
  "settings.models.temperature": "Temperature",
  // 高级设置 → temperature 输入框的 placeholder（未设置时显示，代表用 provider 默认）
  "settings.models.temperaturePlaceholder": "默认",
  // 高级设置 → temperature 输入框下方的范围说明与行为提示
  "settings.models.temperatureHint": "通常 0–2，值越低输出越确定，越高越随机。留空使用模型默认值。",
  // 高级设置 → temperature「恢复默认」按钮（清空回 unset 状态）
  "settings.models.temperatureReset": "恢复默认",
  // 高级设置 → top_p 数字输入框的标签
  "settings.models.topP": "Top P",
  // 高级设置 → top_p 输入框的 placeholder（未设置时显示，代表用 provider 默认）
  "settings.models.topPPlaceholder": "默认",
  // 高级设置 → top_p 输入框下方的范围说明与行为提示
  "settings.models.topPHint": "通常 0–1，与 temperature 共同控制采样：只从累积概率达到 top_p 的候选词中选取。留空使用模型默认值。",
  // 高级设置 → top_p「恢复默认」按钮（清空回 unset 状态）
  "settings.models.topPReset": "恢复默认",
  // provider 状态标签：已填写 API Key
  "settings.provider.apiKeyProvided": "已提供 API Key",
  // provider API Key 输入框占位提示
  "settings.provider.apiKeyPlaceholder": "API密钥",  // provider 状态标签：尚未连接
  "settings.provider.notConnected": "未连接",
  // 模型提供商列表的搜索框占位提示（当提供商数量超过 6 个时显示，输入名称或 id 筛选）
  "settings.provider.searchPlaceholder": "搜索供应商…",
  // 模型提供商列表搜索无匹配结果时的提示
  "settings.provider.noResults": "未找到匹配的供应商",
  // provider 连接按钮的已连接状态
  "settings.provider.connected": "已连接",
  // provider 按钮悬停时的断开连接文案
  "settings.provider.disconnect": "断开连接",
  // provider 连接按钮
  "settings.provider.connect": "连接",
  // 文本模型 tab → 模型提供商列表下方的「添加自定义供应商」按钮文案
  "settings.provider.addCustom": "添加自定义供应商",
  // ModelProviderItem 行内 badge，标识该供应商为用户自定义
  "settings.provider.customBadge": "自定义",
  // ModelProviderItem 行内 badge，标识本地服务器等无需鉴权的供应商
  "settings.provider.keylessBadge": "无需 API Key",
  // keyless badge 旁的辅助说明（tooltip），说明本地服务通常无需 API Key
  "settings.provider.keylessHint": "本地服务通常无需 API Key",
  // 新建自定义供应商对话框标题
  "settings.provider.dialog.titleAdd": "添加自定义供应商",
  // 编辑自定义供应商对话框标题
  "settings.provider.dialog.titleEdit": "编辑自定义供应商",
  // 自定义供应商对话框「名称」字段标签
  "settings.provider.dialog.name": "名称",
  // 名称输入框 placeholder
  "settings.provider.dialog.namePlaceholder": "我的供应商",
  // 自定义供应商对话框「Base URL」字段标签
  "settings.provider.dialog.baseUrl": "Base URL",
  // Base URL 输入框 placeholder（示例：Ollama）
  "settings.provider.dialog.baseUrlPlaceholder": "http://localhost:11434/v1",
  // 自定义供应商对话框「模型 ID」字段标签
  "settings.provider.dialog.models": "模型 ID",
  // 模型 ID 输入框 placeholder
  "settings.provider.dialog.modelsPlaceholder": "llama3.1, qwen2.5",
  // 模型 ID 字段下方辅助说明
  "settings.provider.dialog.modelsHint": "多个模型 ID 用逗号或换行分隔",
  // 自定义供应商对话框 keyless 开关标签
  "settings.provider.dialog.keyless": "无需 API Key",
  // keyless 开关描述，说明适用于本地部署无鉴权的服务
  "settings.provider.dialog.keylessDesc": "适用于本地部署（Ollama、LM Studio 等）无鉴权的服务",
  // 自定义供应商对话框「上下文长度」字段标签（供应商级，应用于该供应商全部模型）
  "settings.provider.dialog.contextWindow": "上下文长度",
  // 上下文长度输入框 placeholder，{value} 为默认值（tokens 数，留空使用默认）
  "settings.provider.dialog.contextWindowPlaceholder": "默认 {value}",
  // 自定义供应商对话框「最大输出长度」字段标签（供应商级，应用于该供应商全部模型）
  "settings.provider.dialog.maxTokens": "最大输出长度",
  // 最大输出长度输入框 placeholder，{value} 为默认值（tokens 数，留空使用默认）
  "settings.provider.dialog.maxTokensPlaceholder": "默认 {value}",
  // 上下文长度 / 最大输出长度两个字段下方的辅助说明
  "settings.provider.dialog.limitsHint": "单位为 token，留空使用默认值；应用于该供应商的全部模型",
  // 校验错误：上下文长度或最大输出长度填写后不是正整数
  "settings.provider.dialog.errLimitInvalid": "请输入正整数",
  // 自定义供应商对话框保存按钮
  "settings.provider.dialog.save": "保存",
  // 自定义供应商对话框取消按钮
  "settings.provider.dialog.cancel": "取消",
  // 校验错误：名称为空
  "settings.provider.dialog.errNameRequired": "请输入名称",
  // 校验错误：Base URL 为空
  "settings.provider.dialog.errBaseUrlRequired": "请输入 Base URL",
  // 校验错误：Base URL 格式非法
  "settings.provider.dialog.errBaseUrlInvalid": "Base URL 必须是合法的 http(s) 地址",
  // 校验错误：未填写模型 ID
  "settings.provider.dialog.errModelsRequired": "请至少填写一个模型 ID",

  // 设置弹窗「移动端」tab 标签（仅桌面端 mobile access 启用时可见）
  "settings.tabs.mobile": "移动端",
  // 移动端 tab → 面板顶部简介文案：提示需先安装 cloudflared，启用后扫码即可远程连接，使用时需保持电脑与桌面端开启
  "settings.mobile.description": "启用后使用手机扫描下方二维码，即可远程连接到本桌面端。使用移动端期间请保持电脑开机、Spherse 桌面端运行。",
  // 移动端 tab → 快速隧道模式未启用时的前置提醒：需先安装 cloudflared 才能使用
  "settings.mobile.cloudflaredPrerequisite": "开启前请先安装 cloudflared（macOS：brew install cloudflared；Windows：winget install cloudflared）。",
  // 移动端 tab → 「连接方式」字段标签（选择快速隧道或自有域名两种暴露方式）
  "settings.mobile.mode": "连接方式",
  // 移动端 tab → 连接方式选项：快速隧道（Cloudflare 自动分配 *.trycloudflare.com 临时域名，需本地安装 cloudflared）
  "settings.mobile.mode.quick": "快速隧道",
  // 移动端 tab → 连接方式选项：自有域名（用户自行运行 cloudflared / 反向代理，使用自己的域名）
  "settings.mobile.mode.manual": "自有域名",
  // 移动端 tab → 选中「快速隧道」时显示的说明（需安装 cloudflared，由应用自动启动）
  "settings.mobile.mode.quickHint": "由应用自动启动 Cloudflare Quick Tunnel。此种连接方式下访问速度可能较慢、不稳定。需先安装 cloudflared。",
  // 移动端 tab → 选中「自有域名」时显示的说明（用户自行配置并运行隧道 / 反向代理）
  "settings.mobile.mode.manualHint": "使用你自己的域名。需自行运行 cloudflared 或其它反向代理工具。",
  // 移动端 tab → 自有域名模式下「本地服务 URL」字段标签（供用户在 Cloudflare 隧道配置中填写的 service URL，如 http://localhost:12345）
  "settings.mobile.serverUrl": "本地服务 URL",
  // 移动端 tab → 本地服务 URL 旁「复制」按钮文案
  "settings.mobile.copyServerUrl": "复制",
  // 移动端 tab → 复制本地服务 URL 成功后的 toast
  "settings.mobile.serverUrlCopied": "URL 已复制到剪贴板",
  // 移动端 tab → 自有域名模式下「公网域名」字段标签（用户填写的自己的域名，用于生成二维码）
  "settings.mobile.manualDomain": "公网域名",
  // 移动端 tab → 公网域名旁「保存」按钮文案
  "settings.mobile.saveDomain": "保存",
  // 移动端 tab → 自有域名模式下的配置指引（提示用户将域名通过 cloudflared / 反代指向本地端口）
  "settings.mobile.manualSetupHint": "请在本地运行 cloudflared 或其它反向代理工具，将你的域名指向上方本地服务 URL，然后在下方填写可访问的公网域名。",
  // 移动端 tab → Cloudflare 隧道官方文档链接文案
  "settings.mobile.cloudflareDocs": "查看 Cloudflare 隧道文档",
  // 移动端 tab → 自有域名模式下尚未填写域名时二维码区域的占位提示
  "settings.mobile.manualDomainEmpty": "请填写并保存公网域名以生成二维码",
  // 移动端 tab → 启用按钮文案（disabled → enabled，快速隧道模式）
  "settings.mobile.enable": "启用快速隧道开启移动端访问",
  // 移动端 tab → 停用按钮文案（enabled → disabled）
  "settings.mobile.disable": "停用移动端访问",
  // 移动端 tab → 令牌字段「显示」按钮（切换令牌明文/掩码）
  "settings.mobile.tokenShow": "显示",
  // 移动端 tab → 令牌字段「隐藏」按钮（切换令牌明文/掩码）
  "settings.mobile.tokenHide": "隐藏",
  // 移动端 tab → 「访问令牌」字段标签（脱敏显示的 Bearer Token）
  "settings.mobile.token": "访问令牌",
  // 移动端 tab → 令牌字段下方说明（提示令牌等同完整访问权限，不要外泄）
  "settings.mobile.tokenHint": "令牌等同完整访问权限。任何持有令牌的人都可以读取项目内容并与你的 AI 对话，请勿外泄。",
  // 移动端 tab → 「复制令牌」按钮文案
  "settings.mobile.copyToken": "复制令牌",
  // 移动端 tab → 「重新生成令牌」按钮文案
  "settings.mobile.regenerateToken": "重新生成令牌",
  // 移动端 tab → 重新生成令牌前的确认提示（提醒会让所有已连接手机掉线、需重新扫码）
  "settings.mobile.regenerateConfirm": "重新生成令牌会使所有已连接的手机立即掉线，且需要重新扫码。确定继续？",
  // 移动端 tab → 「隧道状态」字段标签（Cloudflare Quick Tunnel 当前状态）
  "settings.mobile.tunnelStatus": "隧道状态",
  // 移动端 tab → 隧道状态值：已停止
  "settings.mobile.tunnelStatus.stopped": "已停止",
  // 移动端 tab → 隧道状态值：启动中
  "settings.mobile.tunnelStatus.starting": "启动中…",
  // 移动端 tab → 隧道状态值：运行中
  "settings.mobile.tunnelStatus.running": "运行中",
  // 移动端 tab → 隧道状态值：错误
  "settings.mobile.tunnelStatus.error": "错误",
  // 移动端 tab → 「重启隧道」按钮文案（手动重启 cloudflared 进程，URL 会变化）
  "settings.mobile.restartTunnel": "重启隧道",
  // 移动端 tab → 「公网地址」字段标签（当前 tunnel 的 *.trycloudflare.com URL）
  "settings.mobile.publicUrl": "公网地址",
  // 移动端 tab → 公网地址旁「复制」按钮文案
  "settings.mobile.copyUrl": "复制地址",
  // 移动端 tab → QR 码下方提示文案，引导用户用手机扫码
  "settings.mobile.scanQr": "用手机扫描下方二维码以连接",
  // 移动端 tab → QR 码下方安全提示，提醒二维码等同访问权限、切勿外泄
  "settings.mobile.qrWarning": "二维码包含访问令牌，请勿截图外泄或分享给他人。",
  // 移动端 tab → 操作进行中的通用 loading 文案
  "settings.mobile.working": "处理中…",
  // 移动端 tab → cloudflared 二进制未找到时的错误提示
  "settings.mobile.cloudflaredMissing": "未找到 cloudflared 可执行文件。请确认系统 PATH 中已安装 cloudflared，或参考 Cloudflare 官方文档安装。",
  // 移动端 tab → 复制令牌成功后的 toast
  "settings.mobile.tokenCopied": "令牌已复制到剪贴板",
  // 移动端 tab → 复制公网地址成功后的 toast
  "settings.mobile.urlCopied": "地址已复制到剪贴板",

  // 设置弹窗「关于」tab 标签
  "settings.tabs.about": "关于",
  // 设置弹窗「帮助」tab 标签
  "settings.tabs.help": "帮助",
  // 帮助 tab 内的小节标题，指代在线文档资源
  "settings.help.title": "文档",
  // 帮助 tab 内的说明文案，介绍文档涵盖的内容
  "settings.help.description": "查看 Spherse 的使用文档、配置指南与示例。",
  // 帮助 tab 内打开文档的按钮文案，点击在系统浏览器打开 landing /docs 页
  "settings.help.openDocs": "查看文档",
  // 关于 tab → 当前版本号前的标签
  "settings.about.version": "当前版本",
  // 关于 tab → 检查更新按钮（idle 态）
  "settings.about.checkUpdate": "检查更新",
  // 检查更新按钮 loading 态（checking）
  "settings.about.checking": "检查中...",
  // 检查更新按钮（upToDate 态，灰色禁用，原地显示不弹 toast）
  "settings.about.upToDate": "已是最新版本",
  // 检查更新失败时的错误文案（error 态，原地显示）
  "settings.about.checkFailed": "检查更新失败，请稍后重试",
  // error 态的重试按钮
  "settings.about.retry": "重试",
  // error 态引导用户前往官网下载页（landing page，按平台/架构自动选包）手动下载新版本的按钮
  "settings.about.gotoDownloadPage": "前往官网下载",
  // 更新确认弹窗标题，{version} 为新版本号
  "settings.update.newVersion": "发现新版本 v{version}",
  // 更新确认弹窗中 release notes 区域标题
  "settings.update.releaseNotes": "更新内容",
  // 更新确认弹窗 → 同意下载按钮
  "settings.update.download": "立即更新",
  // 更新确认弹窗 → 稍后按钮（关闭弹窗）
  "settings.update.later": "稍后",
  // 下载进度文案，{percent} 为百分比数字
  "settings.update.downloading": "下载中 {percent}%",
  // 下载中取消按钮
  "settings.update.cancel": "取消",
  // 下载失败错误文案
  "settings.update.downloadError": "下载失败",
  // 下载完成弹窗标题
  "settings.update.downloaded": "更新已下载完成",
  // 下载完成弹窗描述（提示需要重启才能完成安装）
  "settings.update.downloadedDesc": "重启应用以完成安装",
  // 下载完成弹窗 → 立即重启按钮
  "settings.update.restartNow": "立即重启",
  // 下载完成弹窗 → 稍后重启按钮
  "settings.update.restartLater": "稍后重启",
  // macOS 通知模式 → 打开 GitHub Releases 下载页的按钮
  "settings.update.gotoDownload": "前往下载",

  // --- Common ---
  // 通用取消按钮
  "common.cancel": "取消",
  // 通用删除按钮
  "common.delete": "删除",
  // 通用保存按钮
  "common.save": "保存",
  // 通用保存中状态
  "common.saving": "保存中...",
  // 通用已保存状态
  "common.saved": "已保存",
  // 通用加载中状态
  "common.loading": "加载中...",
  // 通用编辑按钮
  "common.edit": "编辑",
  // 通用重命名按钮
  "common.rename": "重命名",
  // 通用创建按钮
  "common.create": "创建",
  // 通用返回按钮
  "common.back": "返回",
  // 通用关闭按钮
  "common.close": "关闭",
  // 通用添加按钮
  "common.add": "添加",
  // 通用发送按钮
  "common.send": "发送",

  // --- Activity Bar ---
  // 左侧活动栏设置图标悬停提示
  "activity-bar.settingsTooltip": "设置",
  // 左侧活动栏添加项目按钮悬停提示
  "activity-bar.addProjectTooltip": "添加项目",
  // 项目右键菜单：关闭项目
  "activity-bar.closeProject": "关闭项目",
  // 项目右键菜单：在系统文件管理器中打开项目文件夹
  "activity-bar.openProjectFolder": "打开项目文件夹",
  // 项目右键菜单：设置（二级菜单容器，hover 展开子菜单）
  "activity-bar.settings": "设置",
  // 项目右键菜单 → 设置 → 欢迎页（二级菜单项，打开欢迎页设置弹窗）
  "activity-bar.settings.welcomePage": "欢迎页",
  // 项目右键菜单 → 设置 → 主题（二级菜单项，打开主题 CSS 编辑弹窗）
  "activity-bar.settings.theme": "主题",
  // 左侧活动栏固定图标悬停提示：点击后将项目面板切换为鼠标移出后自动收起
  "activity-bar.autoCollapseSidePanelTooltip": "自动收起项目面板",
  // 左侧活动栏收起图标悬停提示：点击后将项目面板固定显示
  "activity-bar.pinSidePanelTooltip": "固定项目面板",
  // 移动端（窄屏）左下角浮动按钮的悬停提示与无障碍标签：点击后项目面板从左侧滑出
  "side-panel.openTooltip": "打开项目面板",

  // --- Agent Dialog ---
  // 智能体创建弹窗标题
  "agent-dialog.createTitle": "创建智能体",
  // 智能体编辑弹窗标题
  "agent-dialog.editTitle": "编辑智能体",
  // 智能体名称字段标签
  "agent-dialog.nameLabel": "名称",
  // 智能体名称输入框占位提示
  "agent-dialog.namePlaceholder": "名称",
  // 智能体名称必填校验提示
  "agent-dialog.nameRequired": "请输入智能体的名称",
  // 智能体别名（alias）字段标签：别名是可选的，设定后会显示在聊天气泡上代替名称
  "agent-dialog.aliasLabel": "别名",
  // 智能体别名输入框占位提示：留空时气泡上显示名称
  "agent-dialog.aliasPlaceholder": "留空则显示名称",
  // 智能体别名 tooltip：说明别名会显示在智能体的消息气泡上，未设置时显示名称
  "agent-dialog.aliasHint": "设置后在智能体的消息气泡上显示该别名，未设置时显示名称。",
  // Agent 提示词字段标签
  "agent-dialog.promptLabel": "提示词",
  // Agent 提示词字段 tooltip：说明提示词的作用（智能体的设定，智能体始终记住）
  "agent-dialog.promptHint": "你的智能体的设定。智能体会一直记住这些内容。",
  // Agent 提示词输入框占位提示，引导用户描述智能体的设定（举例保持通用，并说明可留空）
  "agent-dialog.promptPlaceholder": "描述这个智能体的性格、语气与专长，例如「你是一位专业的翻译，认真对待每一次翻译」。也可以留空",
  // Agent 权限字段标签（读取/写入等权限分组的总标签）
  "agent-dialog.toolsLabel": "权限",
  // Agent 权限字段 tooltip：说明权限表示智能体可使用的工具
  "agent-dialog.toolsHint": "允许智能体在对话过程中使用的工具",
  // 权限分组：读取类（read_file/list_files/search_content）
  "agent-dialog.permRead": "读取文件",
  // 权限分组 tooltip：读取文件的作用说明
  "agent-dialog.permReadHint": "允许智能体读取项目中的文件内容、浏览目录结构和搜索文本",
  // 权限分组：写入类（write_file/edit_file/move_file/copy_file）
  "agent-dialog.permWrite": "写入文件",
  // 权限分组 tooltip：写入文件的作用说明
  "agent-dialog.permWriteHint": "允许智能体创建、编辑、移动和复制项目中的文件",
  // Agent 参考资料字段标签
  "agent-dialog.refsLabel": "参考资料",
  // Agent 参考资料字段 tooltip：说明参考资料是智能体一开始就记住的内容
  "agent-dialog.refsHint": "一开始就让智能体记住的文件内容。智能体会一直记住这些内容。",
  // Agent 参考资料路径输入框占位提示
  "agent-dialog.refsPlaceholder": "输入路径搜索文件，回车添加",
  // Agent 保存失败提示
  "agent-dialog.saveFailed": "保存失败",
  // 编辑 Agent 时读取原始内容/主题失败的提示（出现在弹窗主体）
  "agent-dialog.loadFailed": "读取失败",
  // Agent dialog "基本" 标签页标题
  "agent-dialog.tabBasic": "基本",
  // Agent dialog "主题" 标签页标题
  "agent-dialog.tabTheme": "主题",
  // Agent dialog 提示词模板行标签（预留，当前 UI 未强制展示）
  "agent-dialog.templateLabel": "模板",
  // 提示词下方预设模板按钮组的前缀文案
  "agent-dialog.templatePresetsLabel": "预设模板：",
  // 预制提示词模板：世界观创作助手 badge 文案
  "agent-dialog.template.worldview-assistant": "世界观创作助手",
  // 预制提示词模板：角色扮演 badge 文案
  "agent-dialog.template.roleplay": "角色扮演",
  // 提示词非空时点击模板的确认弹窗标题
  "agent-dialog.templateConfirmTitle": "应用模板",
  // 确认弹窗正文：提示将覆盖当前提示词
  "agent-dialog.templateConfirmDesc": "应用模板将覆盖当前提示词内容，是否继续？",
  // 确认弹窗「应用」按钮
  "agent-dialog.templateConfirmApply": "应用",
  // 确认弹窗「取消」按钮
  "agent-dialog.templateConfirmCancel": "取消",
  // Agent dialog 主题 tab：textarea 上方说明，告知主题 CSS 的作用范围（仅当前智能体的聊天窗口）
  "agent-dialog.themeScopeHint": "仅作用于该智能体的聊天窗口（气泡、输入框、Markdown 等）。",
  // Agent dialog 主题 tab：textarea 占位提示，引导用户与智能体对话来生成主题
  "agent-dialog.themePlaceholder": "与智能体对话来生成主题，或将主题 CSS 粘贴到这里",
  // 时间感知配置区块标签
  "agent-dialog.timePerceptionLabel": "时间感知",
  // 时间感知总开关行 tooltip：说明开启后 Agent 能感受到时间流逝
  "agent-dialog.timePerceptionHint": "开启后，Agent 可以感受到时间的流逝。",
  // 锚定真实时刻字段标签
  "agent-dialog.epochLabel": "锚定时刻",
  // 锚定时刻 tooltip：真实世界的参照时刻，从这一刻起计算感知时间
  "agent-dialog.epochHint": "真实世界的参照时刻。从此刻起，感知时间开始计算，默认自动设为开启时的当前时刻。",
  // 感知时间起点字段标签
  "agent-dialog.startLabel": "感知起点",
  // 感知起点 tooltip：锚定时刻对应的虚拟时间——Agent 感知到的初始时刻
  "agent-dialog.startHint": "锚定时刻对应的虚拟时间——即 Agent 感知到的初始时刻。两者共同定义「真实→虚拟」的时间映射。",
  // 时间流速字段标签
  "agent-dialog.flowRateLabel": "时间流速",
  // 时间流速 tooltip：感知时间与真实时间的比率
  "agent-dialog.flowRateHint": "感知时间 ÷ 真实时间。1 = 正常速度，60 = 加速 60 倍，0 = 冻结。",
  // 时区字段标签
  "agent-dialog.timeZoneLabel": "时区",
  // 时区下拉选项：系统时区
  "agent-dialog.timeZoneSystem": "系统时区",
  // 时区 tooltip
  "agent-dialog.timeZoneHint": "选择感知时间的时区，默认使用系统时区。",
  // 时间感知预览文案前缀
  "agent-dialog.timePerceptionPreview": "当前感知时间",
  // 时间感知举例说明
  "agent-dialog.timePerceptionExample": "举例：锚定 = 现在，感知起点 = 2024-01-01，流速 = 60 → 真实过去 1 分钟，感知时间前进 1 小时。",
  // Yolo 模式开关标签（位于 Agent 基本设置的工具权限下方，开关行左侧标题）
  "agent-dialog.yoloLabel": "自动放行（Yolo）",
  // Yolo 模式开关行提示语：说明启用后哪些工具会跳过用户确认直接执行
  "agent-dialog.yoloHint": "启用后，命令执行、Agent 与 Trigger 配置变更将跳过确认直接运行。文件访问策略不受影响。",

  // --- Agent Session List ---
  // 新建对话按钮文案
  "agent-session-list.newSession": "新建对话",
  // 创建智能体按钮悬停提示
  "agent-session-list.createAgentTooltip": "创建智能体",
  // 无智能体时的空状态提示
  "agent-session-list.emptyAgents": "暂无对话",
  // 删除智能体确认弹窗内容，{name} 为智能体名称
  "agent-session-list.confirmDeleteAgent": "确定要删除「{name}」吗？「{name}」下的所有会话也将被移除。",
  // 删除 Agent 失败提示，{message} 为错误信息
  "agent-session-list.deleteFailed": "删除失败：{message}",
  // 重命名 Agent 失败提示，{message} 为错误信息
  "agent-session-list.renameFailed": "重命名失败：{message}",
  // 会话名称必填校验提示
  "agent-session-list.sessionNameRequired": "请输入会话名称",
  // 会话名称长度超限提示
  "agent-session-list.sessionNameTooLong": "会话名称不能超过 80 个字符",
  // 侧边栏智能体分组标签
  "agent-session-list.groupLabel": "对话",
  // 右键菜单：将对话显示为浮窗
  "agent-session-list.floatSession": "浮窗",
  // 右键菜单：取消对话浮窗
  "agent-session-list.cancelFloat": "取消浮窗",
  // 智能体会话列表分组底部的「加载更多」按钮，用于分页加载下一批会话
  "agent-session-list.loadMore": "加载更多",
  // 智能体右键菜单：复制该智能体的 slug 到剪贴板
  "agent-session-list.copyAgentId": "复制 slug",
  // 复制智能体 slug 成功后的提示
  "agent-session-list.agentIdCopied": "slug 已复制",
  // 会话右键菜单：复制该会话 ID 到剪贴板
  "agent-session-list.copySessionId": "复制会话 ID",
  // 复制会话 ID 成功后的提示
  "agent-session-list.sessionIdCopied": "会话 ID 已复制",
  // 会话右键菜单：导出该会话的纯文本聊天记录（仅 user/assistant 文本，不含工具调用与思考），下载为 .txt 文件
  "agent-session-list.exportSession": "导出聊天记录",
  // 导出聊天记录成功后的提示，{filename} 为下载文件名
  "agent-session-list.exportSessionDone": "已导出：{filename}",
  // 导出聊天记录失败后的提示
  "agent-session-list.exportSessionFailed": "导出失败",
  // 会话右键菜单：打开「会话状态」弹窗，查看当前 turn 的上下文 token 用量等信息
  "agent-session-list.sessionStatus": "会话状态",

  // --- Agent Trigger ---
  // 触发类型选择器标签（时间触发 / 事件触发）
  "agent-trigger.type": "触发类型",
  // 触发类型：基于 cron 表达式的时间触发
  "agent-trigger.typeTime": "时间触发",
  // 触发类型：基于自定义事件名的事件触发
  "agent-trigger.typeEvent": "事件触发",
  // 搭档右键菜单中的触发器入口
  "agent-trigger.menuItem": "触发器",
  // 触发器弹窗标题
  "agent-trigger.dialogTitle": "触发器",
  // 触发器弹窗标题旁的提示（InfoIcon tooltip）：说明触发器依赖电脑开机与应用运行
  "agent-trigger.dialogTitleHint": "触发器仅在电脑开机且本应用运行时才会执行，请保持两者开启。",
  // 触发器名称输入框标签
  "agent-trigger.name": "名称",
  // 触发器名称输入框占位
  "agent-trigger.namePlaceholder": "可选，如「每日早安」",
  // 事件名输入框标签（事件触发模式下显示）
  "agent-trigger.eventName": "事件名",
  // 事件名输入框占位
  "agent-trigger.eventNamePlaceholder": "输入自定义事件名，如 daily-review",
  // 事件触发模式提示：当此事件被触发时执行此任务
  "agent-trigger.eventHint": "当此事件被触发时执行此任务",
  // 事件名校验失败提示：不能使用 sp: 保留前缀
  "agent-trigger.eventNameReserved": "事件名不能以 sp: 开头（保留前缀）",
  // 事件触发模式下提示：使用 {{payload}} 引用事件发送方的消息内容
  "agent-trigger.payloadVarHint": "使用 {{payload}} 引用事件发送方的消息内容",
  // 定时频率输入框标签（时间触发模式下显示）
  "agent-trigger.frequency": "频率",
  // 时间触发频率模板：每 30 分钟执行一次
  "agent-trigger.presetEvery30Minutes": "每 30 分钟",
  // 时间触发频率模板：每小时整点执行一次
  "agent-trigger.presetHourly": "每小时",
  // 时间触发频率模板：每天 09:00 执行一次
  "agent-trigger.presetDaily0900": "每天 09:00",
  // 时间触发频率模板：每周一 09:00 执行一次
  "agent-trigger.presetWeeklyMonday0900": "每周一 09:00",
  // cron 表达式输入框占位
  "agent-trigger.cronPlaceholder": "0 9 * * *",
  // 时间触发表单频率区域提示：说明当前调度器按 10 分钟轮询执行，不保证分钟级精确触发
  "agent-trigger.granularityHint": "时间触发每 10 分钟检查一次，实际执行时间可能有数分钟延迟。",
  // 触发器执行模式标签
  "agent-trigger.mode": "会话模式",
  // 执行模式：每次新建对话
  "agent-trigger.modeNewSession": "新建对话",
  // 执行模式：在已有对话中追加
  "agent-trigger.modeExistingSession": "已有对话",
  // 执行模式：首次触发新建并绑定一个会话，之后每次触发复用该会话（新建 trigger 的默认模式）
  "agent-trigger.modeReusableSession": "复用对话",
  // 绑定已有会话模式下，会话 ID 输入框标签
  "agent-trigger.targetSessionId": "会话 ID",
  // 绑定已有会话模式下，会话 ID 输入框占位
  "agent-trigger.targetSessionIdPlaceholder": "输入要绑定的会话 ID",
  // 复用对话模式下，已绑定会话的状态标签（后接会话 ID）
  "agent-trigger.boundSession": "已绑定会话",
  // 复用对话模式下，尚未绑定会话时的提示（首次触发时自动创建）
  "agent-trigger.boundSessionNone": "尚未绑定（首次触发时自动创建）",
  // 复用对话模式下，解除当前绑定会话的按钮（点击后下次触发会新建并重新绑定）
  "agent-trigger.clearBinding": "解除绑定",
  // 消息内容输入框标签
  "agent-trigger.message": "消息内容",
  // 消息内容输入框占位
  "agent-trigger.messagePlaceholder": "输入触发时发送的消息内容...",
  // 触发器完成后的通知开关标签（触发时机为执行完成，而非发送瞬间）
  "agent-trigger.notify": "完成后通知",
  // 触发器表单：开启通知后显示的通知内容输入框占位，最多 30 字
  "agent-trigger.notificationMessagePlaceholder": "通知内容，最多 30 字",
  // 触发器完成后，用户开启通知但未填写自定义通知内容时显示的 toast 文案
  "agent-trigger.notificationDefault": "触发器已完成",
  // 触发器完成通知 toast 上的「查看会话」按钮，点击后跳转到触发器产生的会话
  "agent-trigger.openSession": "查看会话",
  // 触发器列表行上的手动执行按钮悬停提示
  "agent-trigger.triggerNow": "立即触发",
  // 触发器列表行上的手动执行按钮运行中状态提示
  "agent-trigger.runningNow": "运行中",
  // 触发器配置页右上角创建按钮
  "agent-trigger.createTrigger": "创建触发器",
  // 新增/编辑触发器表单点击保存时，必填项（消息、cron/事件名、已有会话 ID）未填写完整的提示
  "agent-trigger.invalidTrigger": "触发器信息不完整：请检查消息、频率/事件名以及会话绑定是否已填写。",
  // 配置 tab 标题
  "agent-trigger.tabConfig": "配置",
  // 运行日志 tab 标题
  "agent-trigger.tabLogs": "运行日志",
  // 日志列表为空时显示
  "agent-trigger.noLogs": "暂无运行日志",
  // 触发器列表为空时显示
  "agent-trigger.noTriggers": "暂无触发器，点击上方按钮添加",
  // 删除触发器确认提示
  "agent-trigger.confirmDelete": "确定删除此触发器吗？",
  // 日志状态：运行中
  "agent-trigger.logStatusRunning": "运行中",
  // 日志状态：成功
  "agent-trigger.logStatusSuccess": "成功",
  // 日志状态：失败
  "agent-trigger.logStatusFailed": "失败",
  // 日志条数限制提示，{path} 为该 agent 的 logs.jsonl 完整项目相对路径（如 .spherse/agents/historian-abc123/triggers/logs.jsonl）
  "agent-trigger.logLimitNotice": "最多显示 {count} 条，更多请查看 {path}",
  // agent 列表项上的 Clock icon tooltip：该 agent 至少有一条 enabled trigger，hover icon 时显示
  "agent-trigger.indicatorTooltip": "已开启触发器",

  // --- Agent MCP (连接器) ---
  // 搭档右键菜单中的「连接器（MCP）」入口，点击打开 MCP 配置弹窗
  "agent-mcp.menuItem": "连接器（MCP）",
  // MCP 配置弹窗标题
  "agent-mcp.dialogTitle": "连接器（MCP）",
  // 弹窗标题旁的警告图标 tooltip：提示连接 MCP server 可能执行任意代码或访问网络
  "agent-mcp.securityHint": "MCP 连接器会运行外部程序或访问网络地址，请仅添加你信任的服务。",
  // 服务列表为空时的占位文案
  "agent-mcp.empty": "暂无 MCP 连接器，点击上方按钮添加",
  // 「添加连接器」按钮
  "agent-mcp.addServer": "添加连接器",
  // 单个连接器的启用开关的无障碍标签
  "agent-mcp.toggleEnabled": "启用/停用此连接器",
  // 删除确认弹窗标题
  "agent-mcp.confirmDeleteTitle": "删除连接器",
  // 删除确认弹窗正文，{name} 为连接器名称
  "agent-mcp.confirmDeleteDescription": "确定要删除连接器「{name}」吗？",
  // 保存失败时校验提示（如缺少名称/命令/地址）
  "agent-mcp.invalidServer": "连接器信息不完整：请检查名称、命令或地址是否已填写。",
  // 加载 MCP 配置失败的 toast，{message} 为错误信息
  "agent-mcp.loadFailed": "加载连接器配置失败：{message}",
  // 保存成功的 toast
  "agent-mcp.saved": "连接器配置已保存",
  // 保存失败的 toast，{message} 为错误信息
  "agent-mcp.saveFailed": "保存连接器配置失败：{message}",
  // 表单：连接器名称字段标签
  "agent-mcp.fieldName": "名称",
  // 表单：连接器名称字段占位
  "agent-mcp.fieldNamePlaceholder": "如「文件系统」「搜索」",
  // 表单：传输方式字段标签
  "agent-mcp.fieldTransport": "传输方式",
  // 传输方式：stdio（本地子进程）
  "agent-mcp.transport-stdio": "本地进程",
  // 传输方式：http（Streamable HTTP）
  "agent-mcp.transport-http": "HTTP",
  // 传输方式：sse（Server-Sent Events）
  "agent-mcp.transport-sse": "SSE",
  // 表单（stdio）：可执行命令字段标签
  "agent-mcp.fieldCommand": "命令",
  // 表单（stdio）：可执行命令字段占位
  "agent-mcp.fieldCommandPlaceholder": "如 npx -y @modelcontextprotocol/server-filesystem",
  // 表单（stdio）：启动参数字段标签
  "agent-mcp.fieldArgs": "启动参数",
  // 表单（stdio）：启动参数字段占位，每行一个参数
  "agent-mcp.fieldArgsPlaceholder": "每行一个参数，如\n/path/to/dir",
  // 表单（stdio）：环境变量字段标签
  "agent-mcp.fieldEnv": "环境变量",
  // 表单（stdio）：环境变量字段占位，每行一个 KEY=VALUE
  "agent-mcp.fieldEnvPlaceholder": "每行一个，格式 KEY=VALUE",
  // 表单（stdio）：工作目录字段标签（子进程的 cwd，允许指向项目外）
  "agent-mcp.fieldCwd": "工作目录",
  // 表单（stdio）：工作目录字段占位，建议绝对路径；留空则用应用进程的 cwd
  "agent-mcp.fieldCwdPlaceholder": "可选，建议绝对路径，如 /Users/me/work",
  // 表单（http/sse）：服务地址字段标签
  "agent-mcp.fieldUrl": "服务地址",
  // 表单（http/sse）：服务地址字段占位
  "agent-mcp.fieldUrlPlaceholder": "如 http://localhost:3000/mcp",
  // 表单（http/sse）：请求头字段标签
  "agent-mcp.fieldHeaders": "请求头",
  // 表单（http/sse）：请求头字段占位，每行一个 Key: Value
  "agent-mcp.fieldHeadersPlaceholder": "每行一个，格式 Authorization: Bearer xxx",

  // --- Chat ---
  // 聊天输入框占位提示
  "chat.composerPlaceholder": "输入消息... (Shift+Enter 换行)",
  // 折叠按钮
  "chat.collapse": "收起",
  // 展开按钮
  "chat.expand": "展开",
  // 空对话时的引导文案
  "chat.startConversation": "发送一条消息开始对话",
  // 历史消息分页「加载更多」按钮文案
  "chat.loadMore": "加载更多",
  // HtmlCard 通过 file_path 渲染时，前端拉取文件内容期间的占位提示
  "chat.loading": "加载中...",
  // 聊天保存成功提示
  "chat.saveSuccess": "保存成功",
  // 聊天保存失败提示，{message} 为错误信息
  "chat.saveFailed": "保存失败：{message}",
  // 文件不在项目目录内时的错误提示
  "chat.fileMustBeInProject": "文件必须保存在项目目录内",
  // 图片生成中占位提示（image card 骨架屏）
  "chat.imageGenerating": "正在生成图片...",
  // 图片生成失败的默认提示
  "chat.imageGenerateFailed": "图片生成失败",
  // 图片导出成功提示
  "chat.imageExportSuccess": "图片已导出",
  // 图片导出失败提示，{message} 为错误信息
  "chat.imageExportFailed": "导出失败：{message}",
  // image card 右上角导出按钮的悬停提示
  "chat.exportImage": "导出图片",
  // html card 右上角「展开全屏」按钮的悬停提示
  "chat.htmlCard.expand": "全屏查看",
  // 相同 file_path 的较早 html card 默认折叠为占位条，点击展开此卡片的悬停提示
  "chat.htmlCard.showCard": "展开此卡片",
  // 已展开的较早 html card 右上角「折叠」按钮的悬停提示
  "chat.htmlCard.collapse": "折叠",
  // 复制按钮悬停提示
  "chat.copyTooltip": "复制",
  // 最新一条用户消息气泡旁的「撤回」按钮悬停提示，点击撤回该消息及本轮回复
  "chat.withdrawTooltip": "撤回",
  // 撤回按钮两段式确认：点击撤回后出现的 ✓ 确认按钮悬停提示
  "chat.withdrawConfirmTooltip": "确认撤回",
  // 撤回按钮两段式确认：点击撤回后出现的 ✕ 取消按钮悬停提示
  "chat.withdrawCancelTooltip": "取消撤回",
  // markdown 代码块右上角「复制代码」按钮的悬停提示
  "markdown.copyCode": "复制代码",
  // Chat 关闭按钮悬停提示
  "chat.close": "关闭",
  // 消息生成失败时的固定提示文案，点击可展开查看具体错误
  "chat.responseGenerationFailed": "回复生成失败",
  // 用户尚未配置模型时尝试发消息，聊天区显示的错误提示（说明需先到设置中选择模型）
  "chat.error.modelNotConfigured": "尚未配置模型，请在设置中选择一个模型后再发送消息。",
  // LLM 返回鉴权失败（401/403、API Key 无效或缺失）时，错误气泡展开区显示的友好提示
  "chat.error.authFailed": "API Key 可能无效或缺失，请到设置中检查对应模型服务的密钥配置。",
  // 鉴权失败错误气泡上的「打开设置」按钮文案，点击后打开设置弹窗并定位到模型配置
  "chat.error.openSettings": "打开设置",
  // 失败的助手回复或发送失败的用户消息上的「重试」按钮文案
  "chat.retry": "重试",
  "chat.sendFailed": "发送失败",
  // 会话历史加载失败时，ConnectionBanner 中显示的提示文案
  "chat.historyLoadFailed": "会话历史加载失败",
  // 会话历史加载失败时，「重试」按钮文案
  "chat.historyLoadRetry": "重试",
  // 连接已断开且正在自动重连时，ConnectionBanner 显示的文案
  "chat.connectionReconnecting": "连接已断开，正在重连…",
  // 重连次数耗尽、无法自动恢复时，ConnectionBanner 显示的文案
  "chat.connectionReconnectFailed": "连接失败",
  // 连接失败后，手动「点击重连」按钮文案
  "chat.connectionReconnect": "重连",
  // 审批/批准操作因连接断开未送达时显示的 toast 提示
  "chat.approvalNotDelivered": "操作未送达，连接可能已断开",
  // Composer 底部「附加图片」按钮的悬停提示
  "chat.attachImage": "附加图片",
  // 附加图片在压缩或上传过程中失败时的错误提示，{message} 为错误信息
  "chat.imageAttachFailed": "添加图片失败：{message}",
  // Composer 待发送图片缩略图上的「移除」按钮悬停提示
  "chat.removeAttachment": "移除图片",
  // 某会话的 agent 工具调用等待用户批准、且用户当前未停留在该会话时弹出的 toast 文案（无法解析到 agent 名时的泛化兜底）
  "chat.approvalToastMessage": "一个 Agent 正在等待你的确认",
  // 上述 toast 在能解析到 agent 名时的标题文案，{name} 为 agent 名称
  "chat.approvalToastMessageWithName": "「{name}」正在等待你的确认",
  // 上述 toast 上的「跳转」按钮文案，点击跳转到对应会话
  "chat.approvalToastAction": "前往会话",
  // QuestionCard（ask_user 工具卡片）等待用户回答时，自由输入回答的文本框占位文案
  "chat.questionInputPlaceholder": "输入你的回答…",
  // QuestionCard 发送回答的按钮文案
  "chat.questionSend": "发送",
  // QuestionCard 已回答状态下，展示用户所填回答的标签文案
  "chat.questionAnswerLabel": "你的回答",
  // QuestionCard 等待超时、未收到用户回答时的状态标签
  "chat.questionTimeoutLabel": "未回答（等待超时）",
  // 用户提交的回答因连接断开未能送达时显示的 toast 提示
  "chat.questionNotDelivered": "回答未送达，请检查连接后重试",
  // 某会话的 agent 向用户提问等待回答、且用户当前未停留在该会话时弹出的 toast 文案（无法解析到 agent 名时的泛化兜底）
  "chat.questionToastMessage": "一个 Agent 正在等待你的回答",
  // 上述 toast 在能解析到 agent 名时的标题文案，{name} 为 agent 名称
  "chat.questionToastMessageWithName": "「{name}」正在等待你的回答",

  // --- Content Browser ---
  // 内容浏览器文本查找栏：输入框占位文案，也是 Header 查找按钮与无障碍标签
  "content-browser.find.placeholder": "查找",
  // 查找栏「无匹配」计数占位（输入了关键词但无任何匹配时显示）
  "content-browser.find.noMatch": "无匹配",
  // 查找栏「上一个匹配」按钮的悬停提示与无障碍标签
  "content-browser.find.previous": "上一个匹配",
  // 查找栏「下一个匹配」按钮的悬停提示与无障碍标签
  "content-browser.find.next": "下一个匹配",
  // 查找栏「关闭查找」按钮的悬停提示与无障碍标签
  "content-browser.find.close": "关闭查找",
  // 文件被外部修改时的冲突提示横幅
  "content-browser.conflictBannerText": "文件已被外部修改",
  // 冲突时保留本地修改按钮
  "content-browser.conflictKeepMine": "保留我的修改",
  // 冲突时重新加载文件按钮
  "content-browser.conflictReload": "重新加载文件",
  // 离开未保存文件时的确认弹窗标题
  "content-browser.confirmLeaveTitle": "有未保存的修改",
  // 离开未保存文件时的确认弹窗内容
  "content-browser.confirmLeaveMessage": "确定离开当前文件并放弃这些修改吗？",
  // 取消编辑时的确认弹窗内容
  "content-browser.confirmCancelMessage": "确定取消编辑并放弃这些修改吗？",
  // 继续编辑按钮
  "content-browser.continueEditing": "继续编辑",
  // 放弃修改按钮
  "content-browser.discardChanges": "放弃修改",
  // 保存失败提示，{error} 为错误信息
  "content-browser.saveFailed": "保存失败: {error}",
  // 预览 tab 标签
  "content-browser.preview": "预览",
  // 源码 tab 标签
  "content-browser.source": "源码",
  // 复制相对项目路径的按钮文案（content browser Header）
  "content-browser.copyPath": "复制路径",
  // 复制路径成功后的 toast 提示
  "content-browser.pathCopied": "路径已复制",
  // 刷新按钮（content browser Header，图标按钮 title/aria-label）
  "content-browser.refresh": "刷新",
  // 点击 markdown 内部链接指向的文件不存在时的 toast 错误提示，{path} 为目标文件相对项目根的路径
  "content-browser.linkNotFound": "找不到文件：{path}",
  // 打开无法在应用内预览的二进制文件（如 PDF / Word / 音视频 / 压缩包）时，占位卡的主标题
  "content-browser.unsupported.title": "此文件类型无法在 Spherse 内预览",
  // 占位卡说明文案，解释为何不能预览（二进制文件）以及可改用系统默认应用打开
  "content-browser.unsupported.description": "Spherse 暂不支持预览此类文件，可以用系统默认应用打开。",
  // 占位卡上「用默认应用打开」按钮的文案（仅桌面端显示，调用系统默认程序打开该文件）
  "content-browser.unsupported.openExternally": "用默认应用打开",

  // --- File Tree ---
  // 新建文件按钮
  "file-tree.newFile": "新建文件",
  // 新建文件夹按钮
  "file-tree.newFolder": "新建文件夹",
  // 删除确认弹窗标题
  "file-tree.confirmDeleteTitle": "确认删除",
  // 删除目录确认弹窗内容，{name} 为目录名
  "file-tree.confirmDeleteDir": "确定要删除目录「{name}」吗？此操作不可撤销。",
  // 删除文件确认弹窗内容，{name} 为文件名
  "file-tree.confirmDeleteFile": "确定要删除文件「{name}」吗？此操作不可撤销。",
  // 创建失败提示，{message} 为错误信息
  "file-tree.createFailed": "创建失败：{message}",
  // 删除失败提示，{message} 为错误信息
  "file-tree.deleteFailed": "删除失败：{message}",
  // 文件树右键菜单：复制路径
  "file-tree.copyPath": "复制路径",
  // 文件树右键菜单（仅文件）：将文件在浮窗中打开
  "file-tree.float": "浮窗",
  // 文件树右键菜单（仅文件）：该文件已在浮窗中打开，点击关闭其浮窗
  "file-tree.cancelFloat": "取消浮窗",
  // 复制路径成功提示
  "file-tree.pathCopied": "路径已复制",
  // 文件树没有文件时的空状态提示
  "file-tree.empty": "暂无文件",

  // --- In-App Browser ---
  // 简易浏览器地址栏的占位提示（输入本地页面地址后回车跳转）
  "browser.addressPlaceholder": "输入本地页面地址…",
  // 简易浏览器工具栏「刷新」按钮的 tooltip
  "browser.refresh": "刷新",
  // 简易浏览器工具栏「在系统浏览器中打开」按钮的 tooltip
  "browser.openInSystemBrowser": "在系统浏览器中打开",
  // 浮窗级浏览器「展开为页面」按钮的 tooltip（从浮窗切换到整页）
  "browser.expandToPage": "展开为页面",
  // 页面级浏览器「收起为浮窗」按钮的 tooltip（从整页切换到浮窗）
  "browser.collapseToFloat": "收起为浮窗",
  // 地址栏输入非本地地址（非 localhost）时的错误提示
  "browser.localOnly": "仅支持本地页面（localhost）",

  // --- AI Read Denylist ---
  // AI 读取限制面板标题
  "ai-read-denylist.title": "AI 读取限制",
  // AI 读取限制弹窗的说明文案
  "ai-read-denylist.description": "列表中的文件或目录不会被 AI 工具读取；你仍可正常查看和编辑。",
  // 无限制路径时的空状态提示
  "ai-read-denylist.emptyState": "暂无限制路径",
  // 路径输入框占位提示
  "ai-read-denylist.placeholder": "例如 secrets 或 notes/private.md",
  // 移除路径按钮的 aria 标签，{path} 为路径
  "ai-read-denylist.removeLabel": "移除 {path}",
  // 读取限制列表失败提示，{message} 为错误信息
  "ai-read-denylist.loadFailed": "读取 AI 读取限制失败：{message}",
  // 路径无效时的提示
  "ai-read-denylist.invalidPath": "路径无效或不可加入限制列表",
  // 路径已存在时的提示
  "ai-read-denylist.pathExists": "路径已存在",
  // 保存成功提示
  "ai-read-denylist.saved": "AI 读取限制已保存",
  // 保存失败提示，{message} 为错误信息
  "ai-read-denylist.saveFailed": "保存失败：{message}",

  // --- Project Panel ---
  // AI 读取限制设置按钮悬停提示
  "project-panel.aiReadDenylistTooltip": "设置 AI 文件读取限制",
  // 文件面板的分组标签
  "project-panel.files": "文件",
  // 技能面板的分组标签（project panel 中「文件」下方的「技能」section 标题）
  "project-panel.skills": "技能",

  // --- Skill Panel ---
  // 技能面板右上角三点菜单的「创建技能」项
  "skill-panel.create": "创建技能",
  // 技能面板右上角三点菜单的「安装技能」项
  "skill-panel.install": "安装技能",
  // 「安装技能」菜单项的后缀提示，提醒用户需选择 .zip 压缩包
  "skill-panel.install.hint": "ZIP 包",
  // 技能面板没有技能时的空状态提示
  "skill-panel.empty": "暂无技能",
  // 技能名称非法（空、含 / \ : 或以 . 开头）时的提示
  "skill-panel.nameInvalid": "名称只能包含字母、数字、连字符和下划线，且不能以点开头",
  // 创建技能弹窗标题
  "skill-panel.createDialog.title": "创建技能",
  // 创建技能弹窗的「名称」字段标签（同时用作文件夹名与 SKILL.md frontmatter name）
  "skill-panel.createDialog.nameLabel": "名称",
  // 创建技能弹窗的「描述」字段标签（SKILL.md frontmatter description）
  "skill-panel.createDialog.descriptionLabel": "描述",
  // 创建技能弹窗「描述」字段的占位提示
  "skill-panel.createDialog.descriptionPlaceholder": "简要描述该技能是什么以及应该什么情况下被 AI 调用",
  // 创建技能弹窗的「内容」字段标签（SKILL.md 正文 instructions）
  "skill-panel.createDialog.contentLabel": "内容",
  // 创建技能弹窗「内容」字段的占位提示
  "skill-panel.createDialog.contentPlaceholder": "详细描述该技能的指令内容，AI 将在调用此技能时遵循这些指引",
  // 创建技能弹窗的提交按钮
  "skill-panel.createDialog.submit": "创建",
  // 创建技能弹窗的取消按钮
  "skill-panel.createDialog.cancel": "取消",
  // 创建技能成功提示，{name} 为技能名
  "skill-panel.create.success": "技能「{name}」已创建",
  // 创建技能失败提示，{message} 为错误信息
  "skill-panel.create.failed": "创建技能失败：{message}",
  // 创建技能时名称已存在的提示，{name} 为技能名
  "skill-panel.create.exists": "技能「{name}」已存在",
  // 安装技能成功提示，{name} 为技能名
  "skill-panel.install.success": "技能「{name}」已安装",
  // 安装技能失败提示，{message} 为错误信息
  "skill-panel.install.failed": "安装技能失败：{message}",
  // 安装技能时名称已存在的提示（安装时无法在客户端获知技能名，故不展示名称）
  "skill-panel.install.exists": "该技能已存在",

  // 技能面板右上角三点菜单的「技能市场」项（打开市场浮层）
  "skill-panel.marketplace": "技能市场",
  // 技能市场弹窗的标题
  "skill-panel.marketplace.title": "技能市场",
  // 技能市场弹窗加载清单时的提示
  "skill-panel.marketplace.loading": "正在加载市场技能…",
  // 技能市场清单加载失败时的提示
  "skill-panel.marketplace.loadFailed": "市场技能加载失败",
  // 技能市场加载失败后的「重试」按钮
  "skill-panel.marketplace.retry": "重试",
  // 技能市场没有任何技能时的空状态提示
  "skill-panel.marketplace.empty": "市场中暂无技能",
  // 市场技能卡片上的「安装」按钮（该技能尚未安装在当前项目）
  "skill-panel.marketplace.install": "安装",
  // 市场技能卡片上的「更新」按钮（本地版本落后于市场版本）
  "skill-panel.marketplace.update": "更新",
  // 市场技能卡片上该技能已安装且为最新版本的标签
  "skill-panel.marketplace.installed": "已安装",
  // 技能安装成功提示，{name} 为技能名
  "skill-panel.marketplace.installSuccess": "技能「{name}」安装成功",
  // 技能更新成功提示，{name} 为技能名，{version} 为更新后的版本号
  "skill-panel.marketplace.updateSuccess": "技能「{name}」已更新到 {version}",
  // 技能安装失败提示，{name} 为技能名，{message} 为错误信息
  "skill-panel.marketplace.installFailed": "技能「{name}」安装失败：{message}",
  // 技能更新失败提示，{name} 为技能名，{message} 为错误信息
  "skill-panel.marketplace.updateFailed": "技能「{name}」更新失败：{message}",
  // 安装时市场清单已发生变化（版本对不上）的提示，界面会自动刷新清单
  "skill-panel.marketplace.manifestChanged": "市场清单已更新，请重试",
  // 市场技能卡片上的发布时间，{date} 为格式化后的日期
  "skill-panel.marketplace.updatedAt": "更新于 {date}",
  // 技能市场弹窗底部说明文案（技能来源与安装位置）
  "skill-panel.marketplace.note": "技能来自官方市场，安装到当前项目",

  // --- Text Selection Session ---
  // 文本选择会话的角色下拉框占位提示
  "text-selection.agentPlaceholder": "选择智能体",
  // 文本选择会话的补充说明输入框占位提示
  "text-selection.supplementPlaceholder": "添加补充说明（可选）...",
  // 引用来源提示，{path} 为文件路径
  "text-selection.quoteFrom": "引用自 {path}",
  "text-selection.startSession": "发起会话",
  // 文本选择浮动菜单：复制按钮
  "text-selection.copy": "复制",
  // 文本选择浮动菜单：发送至当前会话
  "text-selection.sendToCurrentSession": "发送至当前会话",
  // 文本选择浮动菜单：发送至浮窗会话
  "text-selection.sendToFloatingSession": "发送至浮窗会话",
  // 文本选择浮动菜单：无活动会话提示
  "text-selection.noActiveSession": "无活动会话",
  // 发起会话时的 AI 提示前缀，{path} 为文件路径，{text} 为引用内容
  "text-selection.promptPrefix": "请处理以下来自「{path}」的内容：\n\n{text}",

  // --- Session ---
  // 删除会话确认弹窗标题
  "session.confirmDeleteTitle": "删除会话？",
  // 删除会话确认弹窗描述，{title} 为会话名称
  "session.confirmDeleteDescription": "确定要删除会话「{title}」吗？此操作无法撤销。",
  // 无标题会话的默认名称
  "session.untitled": "无标题会话",
  // 会话状态弹窗的标题，展示当前 turn 的上下文窗口 token 用量等信息
  "session.statusTitle": "会话状态",
  // 会话状态弹窗中「上下文 token 用量」字段的标签，即当前 turn 已占用上下文窗口的 token 数
  "session.statusContextTokens": "上下文 Token 用量",
  // 会话状态弹窗中「上下文窗口上限」字段的标签，即模型允许的最大上下文 token 数
  "session.statusContextLimit": "上下文窗口上限",
  // 会话状态弹窗加载状态数据时的提示文案
  "session.statusLoading": "加载中…",
  // 会话状态弹窗加载失败时的错误提示
  "session.statusLoadFailed": "状态加载失败",
  // 会话状态弹窗中上下文窗口上限无法解析（未配置模型等）时显示的占位符
  "session.statusUnknown": "未知",

  // --- Settings ---
  // 设置中语言选择器的标签
  "settings.language": "语言 / Language",
  // 设置 > 通用：外观（亮色/暗色/跟随系统）模式选择器的标签
  "settings.appearance": "外观",
  // 设置 > 通用：外观选择器的「亮色」选项
  "settings.appearance.light": "亮色",
  // 设置 > 通用：外观选择器的「暗色」选项
  "settings.appearance.dark": "暗色",
  // 设置 > 通用：外观选择器的「跟随系统」选项
  "settings.appearance.system": "跟随系统",
  // 设置 > 通用：调试工具开关的标题（开启后在侧边栏显示调试入口）
  "settings.debugTools": "调试工具",
  // 设置 > 通用：调试工具开关下方的说明文案
  "settings.debugToolsDesc": "在侧边栏显示调试菜单入口",
  // 图片生成设置中默认模型下拉框的标签
  "settings.image.defaultModel": "默认生图模型",

  // --- Welcome Page Settings ---
  // 欢迎页设置弹窗标题
  "welcome-page-settings.title": "设置欢迎页",
  // 欢迎页设置弹窗的说明文案
  "welcome-page-settings.description": "选择项目内 HTML 文件或图片作为项目欢迎页。",
  // 文件路径输入框标签
  "welcome-page-settings.pathLabel": "文件路径",
  // 文件路径输入框占位提示
  "welcome-page-settings.pathPlaceholder": "例如 welcome.html 或 assets/banner.png",
  // 清除欢迎页路径按钮
  "welcome-page-settings.clear": "清除",
  // 路径校验失败提示
  "welcome-page-settings.invalidPath": "路径无效，请使用项目内相对路径并确保文件扩展名为 HTML 或图片格式",
  // 欢迎页保存成功提示
  "welcome-page-settings.saved": "欢迎页已保存",
  // 欢迎页保存失败提示，{message} 为错误信息
  "welcome-page-settings.saveFailed": "保存失败：{message}",
  // 读取欢迎页设置失败提示，{message} 为错误信息
  "welcome-page-settings.loadFailed": "读取欢迎页设置失败：{message}",

  // --- Pages ---
  // 项目不存在时的提示文案
  "pages.projectNotFound": "项目不存在",

  // --- Tool Labels ---
  // 独立工具标签：数据访问（read_data/query_data/mutate_data 三个工具，对 *.data.json 活网页数据文件的选择性读写）
  "tool.data_access": "数据文件读写",
  // 独立工具 tooltip：数据文件读写的作用说明——按 $manifest 入口/outline 局部读写，避免整文件进上下文
  "tool.data_access_hint":
    "允许智能体按入口读写页面数据文件（*.data.json）：查看结构大纲、按业务入口查询与变更，与页面数据联动而无需读取整个文件",
  // 独立工具标签：追加日志
  "tool.append_log": "追加日志",
  // 独立工具 tooltip：追加日志的作用说明
  "tool.append_log_hint": "允许智能体向项目变更日志（CHANGELOG.md）追加操作记录",
  // 独立工具标签：使用技能
  "tool.load_skill": "使用技能",
  // 独立工具 tooltip：使用技能的作用说明
  "tool.load_skill_hint": "允许智能体加载并激活技能（Skill）的完整指令",
  // 独立工具标签：渲染卡片
  "tool.render_card": "渲染卡片",
  // 独立工具 tooltip：渲染卡片的作用说明
  "tool.render_card_hint": "允许智能体在对话中渲染 HTML 卡片",
  // 独立工具标签：生成图片
  "tool.generate_image": "生成图片",
  // 独立工具 tooltip：生成图片的作用说明
  "tool.generate_image_hint": "允许智能体根据文字描述生成图片",
  // 独立工具标签：触发事件（emit trigger event，agent 在对话中调用，触发其它 agent 的事件触发器）
  "tool.emit_trigger_event": "触发事件",
  // 独立工具 tooltip：触发事件的作用说明
  "tool.emit_trigger_event_hint": "允许智能体发出自定义事件，触发本项目内其它智能体的事件触发器，使其自动执行预设任务",
  // 独立工具标签：运行命令（run_command，agent 执行 shell 命令，高危，需逐次人工确认）
  "tool.run_command": "运行命令",
  // 独立工具 tooltip：运行命令的安全提示——强调任意命令、逐次确认、有风险
  "tool.run_command_hint": "允许智能体执行 shell 命令（unix sh / Windows PowerShell）。每次执行前都会要求你确认；进程将以你的系统权限运行，请仅在你信任该智能体时启用",
  // 独立工具标签：向用户提问（ask_user，agent 运行中向用户提出问题并等待回答）
  "tool.ask_user": "向你提问",
  // 独立工具 tooltip：向用户提问的作用说明
  "tool.ask_user_hint": "允许智能体在运行中向你提问并等待回答，适合缺少关键信息时使用",
  // 独立工具标签：管理智能体（manage_agent，agent 可查看/新建/修改本项目内智能体的名称、提示词、工具、上下文、时间感知开关，高危，写操作需人工确认）
  "tool.manage_agent": "管理智能体",
  // 独立工具 tooltip：管理智能体的作用与风险说明
  "tool.manage_agent_hint": "允许智能体查看、创建和修改本项目内其它智能体的配置（名称、别名、提示词、模型、工具权限、上下文文件），以及开启/关闭其它智能体的时间感知（锚点、起点、流速、时区等详细参数仍需你在界面中配置）。新建和修改前都会要求你确认；智能体 ID 和目录名由应用生成，无法指定；删除智能体仍需你在界面中手动操作",
  // 独立工具标签：管理触发器（manage_trigger，agent 可查看/新建/修改/删除定时与事件触发器，高危，写操作需人工确认）
  "tool.manage_trigger": "管理触发器",
  // 独立工具 tooltip：管理触发器的作用与风险说明
  "tool.manage_trigger_hint": "允许智能体查看、创建、修改和删除本项目内智能体的定时/事件触发器。新建、修改和删除前都会要求你确认；触发器可让智能体在无人值守时自动运行",
  // agent 配置工具权限区的高级功能折叠分组标题（高危工具收起在此）
  "tool.advanced_section": "高级 / 危险操作",

  // --- Command Card（run_command 工具调用结果卡片与审批） ---
  // 审批态标题：等待用户批准执行命令
  "command.pendingApproval": "等待确认：智能体请求执行命令",
  // 审批态工作目录标签，{cwd} 为相对项目根的路径
  "command.cwd": "工作目录",
  // 审批态安全警告：命令将以用户权限在系统上执行
  "command.warning": "此命令将以你的系统权限执行，可读写项目外文件、发起网络请求，请仔细核对后再批准。",
  // 审批按钮：拒绝执行
  "command.reject": "拒绝",
  // 审批按钮：批准执行（destructive 配色，需刻意点击）
  "command.approve": "批准执行",
  // 结果态标记：命令被用户拒绝
  "command.rejected": "已拒绝",
  // 结果态标记：命令执行超时被强制终止
  "command.timedOut": "已超时",
  // 结果态标记：命令被用户中途取消
  "command.aborted": "已取消",
  // 结果态退出码徽标，{code} 为进程退出码
  "command.exitCode": "退出码 {code}",
  // 结果态：命令无任何输出时显示
  "command.noOutput": "（无输出）",

  // --- Approval Card（manage_agent / manage_trigger 等配置类工具的通用审批卡片） ---
  // 审批态标题：等待用户批准某个高级工具调用，{tool} 为工具的中文名（如「管理智能体」）
  "approval.pending": "等待确认：智能体请求使用「{tool}」",
  // 审批态安全警告：该操作会修改项目配置
  "approval.warning": "此操作会修改本项目的配置，请核对下方参数后再批准。",
  // 审批按钮：拒绝该操作
  "approval.reject": "拒绝",
  // 审批按钮：批准该操作（destructive 配色，需刻意点击）
  "approval.approve": "批准操作",
  // 结果态标记：操作已被用户批准并执行
  "approval.approved": "已批准",
  // 结果态标记：操作已被用户拒绝
  "approval.rejected": "已拒绝",

  // --- Viewer Card ---
  // edit_file diff 左栏标题，显示原始内容
  "viewer-card.old": "旧",
  // edit_file diff 右栏标题，显示替换后内容
  "viewer-card.new": "新",
  // write_file 操作内容为空时 viewer card 中的占位文案
  "viewer-card.emptyContent": "（空内容）",
  // write_file 操作子区块头部显示的写入字节数，{n} 为数字
  "viewer-card.bytes": "{n} 字节",
  // edit_file 操作子区块头部显示的替换次数，{n} 为数字
  "viewer-card.occurrence": "{n} 处替换",
  // viewer card 头部当同一文件有多次操作时显示的操作数 badge，{n} 为数字（>1 时显示）
  "viewer-card.changeCount": "{n} 次变更",
  // viewer card 头部状态标记：文件仅含 write_file 操作（新文件）
  "viewer-card.created": "新创建",
  // viewer card 头部状态标记：文件含 edit_file 操作（已修改）
  "viewer-card.modified": "有变更",

  // --- Debug ---
  // 调试菜单：打开 DevTools
  "debug.devTools": "DevTools",
  // 调试菜单：重新加载页面
  "debug.reload": "Reload",
  // 调试菜单：应用数据目录
  "debug.appData": "App Data",
  // 调试菜单：重置应用数据按钮
  "debug.resetAppData": "Reset App Data",
  // 调试菜单：取消按钮
  "debug.cancel": "Cancel",
  // 调试菜单：确认重置按钮
  "debug.reset": "Reset",
  // 重置应用数据确认弹窗标题
  "debug.confirmResetTitle": "Reset App Data",
  // 重置应用数据确认弹窗内容
  "debug.confirmResetMessage": "This will clear all app settings and project connections. Are you sure?",
  // 调试菜单标题
  "debug.debug": "Debug",
  // 调试菜单：下载当前 session 的完整 turn 上下文（system prompt + messages + tools）
  "debug.downloadTurnContext": "Download Turn Context",
  // 调试菜单：下载 turn 上下文失败时的 toast 提示（无活跃 session 或请求失败）
  "debug.downloadTurnContextNoSession": "No active session",
  // 调试菜单：下载 turn 上下文失败时的 toast 提示（服务端返回错误）
  "debug.downloadTurnContextFailed": "Failed to download turn context",

  // 欢迎页文件缺失时的错误提示，{path} 为文件路径
  "welcome-page.fileMissing": "欢迎页文件不存在：{path}",
  // 欢迎页加载失败的错误提示
  "welcome-page.loadFailed": "欢迎页加载失败",
  // 项目欢迎页未配置自定义内容时的空状态提示文案
  "welcome-page.emptyState": "Spherse",

  // --- Error ---
  // 通用请求失败提示
  "error.requestFailed": "请求失败",
  // 全局错误边界（react-router errorElement）标题：应用发生未预期错误时的全屏兜底页
  "error.unexpectedTitle": "应用出现了问题",
  // 全局错误边界正文，提示用户可通过重试恢复
  "error.unexpectedMessage": "发生了未预期的错误。请尝试重新加载。",
  // 全局错误边界「重新加载应用」按钮文案
  "error.reload": "重新加载",
  // 全局错误边界「返回项目列表」按钮文案（回到欢迎页/项目入口）
  "error.goHome": "返回项目",

  // --- Theme Settings Dialog ---
  // 主题设置弹窗标题
  "theme-settings.title": "设置主题",
  // 主题设置弹窗顶部说明，引导用户通过覆盖 CSS 变量自定义界面外观，并说明作用范围为整个应用
  "theme-settings.description": "覆盖 .spherse/theme.css 中的 CSS 变量来自定义整个应用的界面外观。",
  // 主题设置 textarea 占位提示，引导用户与 AI 对话来生成主题
  "theme-settings.placeholder": "与 AI 对话来生成主题，或将主题 CSS 粘贴到这里",
  // 读取主题设置失败提示，{message} 为错误信息
  "theme-settings.loadFailed": "读取主题设置失败：{message}",
  // 保存主题设置失败提示，{message} 为错误信息
  "theme-settings.saveFailed": "保存失败：{message}",
  // 主题设置保存成功提示
  "theme-settings.saved": "主题已保存",
  // --- Onboarding ---
  // 引导页（无项目打开时）主标题
  "onboarding.title": "Spherse",
  // 引导页副标题
  "onboarding.subtitle": "搭建属于你自己的世界",
  // 引导卡片1按钮：打开已有项目或新建项目（合并入口，点击后弹出目录选择器，可选择已有文件夹，也可在其中新建文件夹）
  "onboarding.action.openOrCreate": "打开或创建项目",
  // 引导卡片2按钮：打开示例项目，{name} 为示例项目名称
  "onboarding.action.openSample": "打开示例项目：{name}",
  // 引导卡片1描述：说明该入口同时支持打开已有项目文件夹与新建空项目文件夹
  "onboarding.desc.openOrCreate": "选择已有项目文件夹，或新建一个文件夹从空项目开始",
  // 引导卡片2描述
  "onboarding.desc.openSample": "将内置示例项目拷贝到选定位置并打开",
  // 引导页两卡片下方的「探索更多示例」文字链接：点击在系统浏览器打开 landing /explore 示例画廊
  "onboarding.action.explore": "探索更多示例",
  // 引导卡片2（打开示例项目）的 tooltip：说明示例项目的搭建方式与用途，鼠标悬浮于卡片时展示
  "onboarding.tooltip.openSample": "该示例项目在 Spherse 中从零开始搭建，使用的模型为 DeepSeek V4 Flash。通过该项目熟悉 Spherse 的使用方式，从而搭建完全属于你自己的世界。",
  // 拷贝示例项目失败时的错误提示
  "onboarding.error.copyFailed": "拷贝示例项目失败，请重试",
  // 示例项目拷贝成功但注册/打开失败时的错误提示（区分于拷贝失败）
  "onboarding.error.openFailed": "打开示例项目失败，请重试",
  // 引导页操作（打开/创建/示例）发生未预期异常时的通用错误提示
  "onboarding.error.unexpected": "操作失败，请重试",
  // 内置示例资源缺失时的错误提示
  "onboarding.error.sampleNotFound": "找不到内置示例，请重新安装应用",
  // 打开示例项目时，选择示例项目拷贝目标位置的对话框标题（Electron 原生对话框）
  "onboarding.dialog.sampleLocation": "选择示例项目的保存位置",

  // --- 移动端连接页（MobileConnectPage） ---
  // 移动端未连接 server 时显示的连接页主标题
  "mobile-connect.title": "Spherse",
  // 移动端连接页副标题：提示用户该应用需要连接桌面端
  "mobile-connect.subtitle": "连接到桌面端以继续",
  // 移动端连接页「扫码连接」按钮文字
  "mobile-connect.scan": "扫码连接",
  // 移动端连接页「手动输入」按钮文字
  "mobile-connect.manual": "手动输入",
  // 移动端连接页扫码区提示：将桌面端 QR 码对准摄像头
  "mobile-connect.scanHint": "将桌面端二维码对准摄像头",
  // 移动端连接页手动输入模式下，baseUrl 字段的 label
  "mobile-connect.baseUrl": "服务器地址",
  // 移动端连接页手动输入模式下，token 字段的 label
  "mobile-connect.token": "访问令牌",
  // 移动端连接页手动输入模式下的「连接」按钮
  "mobile-connect.connect": "连接",
  // 移动端连接页「返回」按钮（关闭扫码/手动输入面板回到主入口）
  "mobile-connect.back": "返回",
  // 移动端连接页扫码时摄像头权限被拒绝的错误提示
  "mobile-connect.cameraDenied": "无法访问摄像头，请改用手动输入",
  // 移动端连接页扫码失败（无摄像头/无 BarcodeDetector 支持）的兜底提示
  "mobile-connect.scanUnavailable": "当前设备不支持扫码，请改用手动输入",
  // 移动端连接成功时 toast 提示
  "mobile-connect.connected": "已连接",
  // 移动端连接失败（fetch /api/projects 报错或 token 无效）时的错误提示，{error} 为详细错误
  "mobile-connect.connectFailed": "连接失败：{error}",
  // 移动端扫到的 QR 不是合法的 spherse://connect 链接时的提示
  "mobile-connect.invalidQr": "无效的二维码，请扫描 Spherse 桌面端生成的二维码",

  // --- 文本框右键菜单（input/textarea 的原生 context-menu）---
  // 文本框右键菜单「撤销」
  "contextMenu.undo": "撤销",
  // 文本框右键菜单「重做」
  "contextMenu.redo": "重做",
  // 文本框右键菜单「剪切」
  "contextMenu.cut": "剪切",
  // 文本框右键菜单「复制」
  "contextMenu.copy": "复制",
  // 文本框右键菜单「粘贴」
  "contextMenu.paste": "粘贴",
  // 文本框右键菜单「全选」
  "contextMenu.selectAll": "全选",

  // --- UI SDK ---
  // sendMessage action 收到失效/未知 sessionId 时弹出的 toast 提示
  "ui-sdk.sessionNotFound": "找不到该会话，可能已被删除",
} as const;
