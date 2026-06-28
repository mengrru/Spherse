export const zhCN = {
  // 应用初始化时的加载占位文案
  "app.loading": "加载中...",
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
  // 模型提供商区域标题
  "settings.models.providers": "模型提供商",
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
  // 文本模型 tab → 高级设置折叠区标题（点击展开/收起 temperature 等参数）
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
  // provider 状态标签：已填写 API Key
  "settings.provider.apiKeyProvided": "已提供 API Key",
  // provider API Key 输入框占位提示
  "settings.provider.apiKeyPlaceholder": "API密钥",  // provider 状态标签：尚未连接
  "settings.provider.notConnected": "未连接",
  // provider 连接按钮的已连接状态
  "settings.provider.connected": "已连接",
  // provider 按钮悬停时的断开连接文案
  "settings.provider.disconnect": "断开连接",
  // provider 连接按钮
  "settings.provider.connect": "连接",

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
  // 项目右键菜单：在 Finder 中显示
  "activity-bar.revealInFinder": "在 Finder 中显示",
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

  // --- Agent Dialog ---
  // 对话对象创建弹窗标题
  "agent-dialog.createTitle": "创建对话对象",
  // 对话对象编辑弹窗标题
  "agent-dialog.editTitle": "编辑对话对象",
  // 对话对象名称字段标签
  "agent-dialog.nameLabel": "名称",
  // 对话对象名称输入框占位提示
  "agent-dialog.namePlaceholder": "名称",
  // 对话对象名称必填校验提示
  "agent-dialog.nameRequired": "请输入对话对象的名称",
  // Agent 提示词字段标签
  "agent-dialog.promptLabel": "提示词",
  // Agent 权限字段标签（读取/写入等权限分组的总标签）
  "agent-dialog.toolsLabel": "权限",
  // 权限分组：读取类（read_file/list_files/search_content）
  "agent-dialog.permRead": "读取文件",
  // 权限分组：写入类（write_file/edit_file/move_file/copy_file）
  "agent-dialog.permWrite": "写入文件",
  // Agent 参考资料字段标签
  "agent-dialog.refsLabel": "参考资料",
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

  // --- Agent Session List ---
  // 新建对话按钮文案
  "agent-session-list.newSession": "新建对话",
  // 创建对话对象按钮悬停提示
  "agent-session-list.createAgentTooltip": "创建对话对象",
  // 无对话对象时的空状态提示
  "agent-session-list.emptyAgents": "暂无对话",
  // 删除对话对象确认弹窗内容，{name} 为对话对象名称
  "agent-session-list.confirmDeleteAgent": "确定要删除「{name}」吗？「{name}」下的所有会话也将被移除。",
  // 删除 Agent 失败提示，{message} 为错误信息
  "agent-session-list.deleteFailed": "删除失败：{message}",
  // 重命名 Agent 失败提示，{message} 为错误信息
  "agent-session-list.renameFailed": "重命名失败：{message}",
  // 会话名称必填校验提示
  "agent-session-list.sessionNameRequired": "请输入会话名称",
  // 会话名称长度超限提示
  "agent-session-list.sessionNameTooLong": "会话名称不能超过 80 个字符",
  // 侧边栏对话对象分组标签
  "agent-session-list.groupLabel": "对话",
  // 右键菜单：将对话显示为浮窗
  "agent-session-list.floatSession": "浮窗",
  // 右键菜单：取消对话浮窗
  "agent-session-list.cancelFloat": "取消浮窗",

  // --- Agent Schedule ---
  // 搭档右键菜单中的定时消息入口
  "agent-schedule.menuItem": "定时消息",
  // 定时消息弹窗标题
  "agent-schedule.dialogTitle": "定时消息",
  // 定时消息名称输入框标签
  "agent-schedule.name": "名称",
  // 定时消息名称输入框占位
  "agent-schedule.namePlaceholder": "可选，如「每日早安」",
  // 定时频率选择标签
  "agent-schedule.frequency": "频率",
  // 定时消息频率预设：每 30 分钟执行一次
  "agent-schedule.presetEvery30Minutes": "每 30 分钟",
  // 定时消息频率预设：每小时整点执行一次
  "agent-schedule.presetHourly": "每小时",
  // 定时消息频率预设：每天 09:00 执行一次
  "agent-schedule.presetDaily0900": "每天 09:00",
  // 定时消息频率预设：每周一 09:00 执行一次
  "agent-schedule.presetWeeklyMonday0900": "每周一 09:00",
  // 定时消息频率预设：用户手动输入 cron 表达式
  "agent-schedule.presetCustom": "自定义",
  // 定时消息表单频率区域提示：说明当前调度器按 10 分钟轮询执行，不保证分钟级精确触发
  "agent-schedule.granularityHint": "定时任务每 10 分钟检查一次，实际执行时间可能有数分钟延迟。",
  // 频率选择下拉框占位
  "agent-schedule.selectPreset": "选择预设...",
  // 定时消息发送模式标签
  "agent-schedule.mode": "会话模式",
  // 发送模式：每次新建对话
  "agent-schedule.modeNewSession": "新建对话",
  // 发送模式：在已有对话中追加
  "agent-schedule.modeExistingSession": "已有对话",
  // 消息内容输入框标签
  "agent-schedule.message": "消息内容",
  // 消息内容输入框占位
  "agent-schedule.messagePlaceholder": "输入定时发送的消息内容...",
  // 消息发送通知开关标签
  "agent-schedule.notify": "发送后通知",
  // 定时消息表单：开启通知后显示的通知内容输入框占位，最多 30 字
  "agent-schedule.notificationMessagePlaceholder": "通知内容，最多 30 字",
  // 定时消息完成后，用户开启通知但未填写自定义通知内容时显示的 toast 文案
  "agent-schedule.notificationDefault": "定时消息已完成",
  // 定时任务列表行上的手动执行按钮悬停提示
  "agent-schedule.triggerNow": "立即触发",
  // 定时任务列表行上的手动执行按钮运行中状态提示
  "agent-schedule.runningNow": "运行中",
  // 定时消息配置页右上角创建按钮
  "agent-schedule.createSchedule": "创建定时任务",
  // 配置 tab 标题
  "agent-schedule.tabConfig": "配置",
  // 运行日志 tab 标题
  "agent-schedule.tabLogs": "运行日志",
  // 日志列表为空时显示
  "agent-schedule.noLogs": "暂无运行日志",
  // 定时任务列表为空时显示
  "agent-schedule.noSchedules": "暂无定时任务",
  // 删除定时任务确认提示
  "agent-schedule.confirmDelete": "确定删除此定时任务吗？",
  // 日志状态：运行中
  "agent-schedule.logStatusRunning": "运行中",
  // 日志状态：成功
  "agent-schedule.logStatusSuccess": "成功",
  // 日志状态：失败
  "agent-schedule.logStatusFailed": "失败",
  // 日志条数限制提示
  "agent-schedule.logLimitNotice": "最多显示 {count} 条，更多请查看 schedule-logs.jsonl",
  // agent 列表项上的 Clock icon tooltip：该 agent 至少有一条 enabled schedule，hover icon 时显示
  "agent-schedule.indicatorTooltip": "已开启定时消息",

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
  // 复制按钮悬停提示
  "chat.copyTooltip": "复制",
  // Chat 关闭按钮悬停提示
  "chat.close": "关闭",
  // 消息生成失败时的固定提示文案，点击可展开查看具体错误
  "chat.responseGenerationFailed": "回复生成失败",

  // --- Content Browser ---
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
  // 复制路径成功提示
  "file-tree.pathCopied": "路径已复制",
  // 文件树没有文件时的空状态提示
  "file-tree.empty": "暂无文件",

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

  // --- Text Selection Session ---
  // 文本选择会话的角色下拉框占位提示
  "text-selection.agentPlaceholder": "选择对话对象",
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

  // --- Settings ---
  // 设置中语言选择器的标签
  "settings.language": "语言 / Language",
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
  // 独立工具标签：追加日志
  "tool.append_log": "追加日志",
  // 独立工具标签：使用技能
  "tool.load_skill": "使用技能",
  // 独立工具标签：渲染卡片
  "tool.render_card": "渲染卡片",
  // 独立工具标签：生成图片
  "tool.generate_image": "生成图片",

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

  // --- Theme Settings Dialog ---
  // 主题设置弹窗标题
  "theme-settings.title": "设置主题",
  // 主题设置弹窗顶部说明，引导用户通过覆盖 CSS 变量自定义界面外观
  "theme-settings.description": "覆盖 .spherse/theme.css 中的 CSS 变量来自定义界面外观。完整变量清单请参考 create-ui-theme skill。",
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
  "onboarding.subtitle": "你的文字创作与演绎空间",
  // 引导卡片1按钮：从已有项目打开
  "onboarding.action.openExisting": "从已有项目打开",
  // 引导卡片2按钮：创建新项目
  "onboarding.action.createNew": "创建新项目",
  // 引导卡片3按钮：打开示例项目，{name} 为示例项目名称
  "onboarding.action.openSample": "打开示例项目：{name}",
  // 引导卡片1描述
  "onboarding.desc.openExisting": "打开一个已有的文件夹",
  // 引导卡片2描述
  "onboarding.desc.createNew": "从一个空文件夹开始",
  // 引导卡片3描述
  "onboarding.desc.openSample": "将内置示例项目拷贝到选定位置并打开",
  // 创建项目时目标目录已存在且非空的错误提示
  "onboarding.error.dirExistsNotEmpty": "该目录已存在且非空，请选择其它位置",
  // 创建项目失败时的通用错误提示
  "onboarding.error.createFailed": "创建项目失败，请重试",
  // 拷贝示例项目失败时的错误提示
  "onboarding.error.copyFailed": "拷贝示例项目失败，请重试",
  // 内置示例资源缺失时的错误提示
  "onboarding.error.sampleNotFound": "找不到内置示例，请重新安装应用",
  // 新建项目时，选择项目保存位置的保存对话框标题（Electron 原生对话框）
  "onboarding.dialog.newProjectLocation": "选择新建项目的位置",
  // 打开示例项目时，选择示例项目拷贝目标位置的对话框标题（Electron 原生对话框）
  "onboarding.dialog.sampleLocation": "选择示例项目的保存位置",
  // 新建项目保存对话框默认文件夹名建议
  "onboarding.defaultProjectName": "新建项目",
} as const;
