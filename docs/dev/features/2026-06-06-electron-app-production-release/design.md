# [infra] Electron App Production Release

## 概述

为 Spherse 桌面应用配置 electron-builder 打包流程，生成可分发的安装包（macOS DMG + Windows NSIS）。

## 需求约束

| 项目 | 决策 |
|------|------|
| 目标平台 | macOS + Windows |
| 分发方式 | 本地构建 + 手动分发 |
| 代码签名 | 暂不签名（后续按需添加） |
| 自动更新 | 不需要（后续按需添加） |
| 安装包格式 | macOS DMG + Windows NSIS 安装程序 |
| 设计范围 | 仅打包（不含 CI/CD、验证流水线、E2E） |
| 应用图标 | 暂用 Electron 默认图标 |

## 工具选型

选择 **electron-builder**（方案 A），理由：

- 与 electron-vite 兼容性好，社区有成熟的集成实践
- 配置简洁，一个 YAML 文件即可完成
- 后续扩展代码签名、公证、自动更新只需追加配置项，无需换工具
- Electron Forge（方案 B）虽然官方推荐，但配置复杂度更高且需要为每种格式安装单独的 maker 插件

## 设计细节

### 1. 应用元数据与 electron-builder 配置

在 `packages/app/package.json` 中补充：

```jsonc
{
  "name": "@spherse/app",
  "productName": "Spherse",
  "version": "0.1.0"
}
```

新增 `packages/app/electron-builder.yml`：

```yaml
appId: com.spherse.app
productName: Spherse
directories:
  buildResources: build
  output: release
files:
  - dist/**/*
  - package.json
extraMetadata:
  main: dist/main/index.js
mac:
  category: public.app-category.productivity
  target:
    - dmg
win:
  target:
    - nsis
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

**配置说明：**

- `appId`: `com.spherse.app` — 全局唯一标识，macOS 用作 Bundle ID，Windows 用作 AppUserModelID
- `directories.buildResources`: `build/` 目录存放图标等资源（暂时为空）
- `directories.output`: `release/` 目录存放构建产物
- `files`: 仅包含 `dist/` 编译产物和 `package.json`
- `extraMetadata.main`: 覆盖 package.json 的 main 字段，确保打包后入口点指向 `dist/main/index.js`
- `mac.target`: DMG 镜像
- `win.target`: NSIS 安装程序，允许用户自定义安装目录

### 2. 构建脚本

`packages/app/package.json` 新增 scripts：

```jsonc
{
  "scripts": {
    "build": "electron-vite build",
    "pack": "electron-builder --dir",
    "dist": "electron-builder",
    "dist:mac": "electron-builder --mac",
    "dist:win": "electron-builder --win"
  }
}
```

root `package.json` 新增 scripts：

```jsonc
{
  "scripts": {
    "dist": "npm run dist --workspace=packages/app",
    "dist:mac": "npm run dist:mac --workspace=packages/app",
    "dist:win": "npm run dist:win --workspace=packages/app"
  }
}
```

**完整发布流程：**

```bash
npm run build       # 按拓扑顺序编译所有 workspace（core -> presets -> server -> app）
npm run dist:mac    # macOS 上运行 → packages/app/release/Spherse-0.1.0.dmg
npm run dist:win    # Windows 上运行 → packages/app/release/Spherse Setup 0.1.0.exe
```

**依赖安装：**

- `electron-builder` 作为 `packages/app/` 的 `devDependencies`

### 3. 构建产物

```
packages/app/release/
├── {platform}-unpacked/          # unpacked app（调试用）
└── Spherse[-Setup]-0.1.0.{dmg|exe}  # 可分发的安装包
```

### 4. Native 依赖处理

**better-sqlite3：**

- electron-builder 的 `npmRebuild` 默认为 `true`，会自动检测 `electron` 依赖并使用正确的 Electron ABI headers 重新编译 native 模块
- 不需要手动干预，electron-builder 内建了此逻辑

**Workspace 依赖：**

- `npm run build`（root）已按拓扑顺序编译所有 workspace，`packages/app/node_modules/@spherse/*` 已指向编译好的产物
- electron-builder 会将 workspace 的编译产物正确打包进 app

**asar：**

- Electron 41 默认启用 asar
- electron-builder 自动将 native 模块的 `.node` 文件从 asar 中解出（`asar.unpack` 模式）

### 5. 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `packages/app/package.json` | 修改 | 添加 `productName`，新增 `pack`/`dist`/`dist:mac`/`dist:win` scripts，添加 `electron-builder` devDependency |
| `packages/app/electron-builder.yml` | 新增 | electron-builder 配置 |
| `package.json` (root) | 修改 | 新增 `dist`/`dist:mac`/`dist:win` scripts |
| `.gitignore` | 修改 | 添加 `packages/app/release/` |
| `packages/app/build/` | 新增 | buildResources 空目录（后续存放图标） |

### 6. 后续扩展点（本次不实现）

以下能力已通过 electron-builder 架构预留，后续按需添加：

- **代码签名**: 在 `electron-builder.yml` 中添加 `mac.identity`、`win.certificateFile` 等配置
- **macOS 公证**: 添加 `mac.notarize` 配置
- **自动更新**: 集成 `electron-updater`，配置 `publish` provider（如 GitHub Releases）
- **应用图标**: 在 `packages/app/build/` 中放入 `icon.icns`（macOS）和 `icon.ico`（Windows）
- **CI/CD**: 在 GitHub Actions 中配置多平台构建，推送到 GitHub Releases
