# plan：移动端连接体验增强

design doc：`design.md`

## 任务拆分

- [x] 1. `packages/app/src/lib/connect-payload.ts`：`buildConnectUrl`（自 MobileAccessPanel 收编，行为等价）+ `parseConnectPayload`；`packages/app/package.json` exports 加 `./connect-payload`；`MobileAccessPanel` 改导入
- [x] 2. `connect-payload.test.ts`：round-trip / hash 与 query / targetPath 有无 / 旧协议与非法输入 null
- [x] 3. `app-store.ts`：`restoreProjects(bridge, { initialGate })`；`app-store.test.ts` 覆盖 initialGate 两条路径
- [x] 4. `host-bridge.ts` 加 `clearConnection?()`；`host-bridge-web.tsx` 实现；确认 contracts/桌面侧无需同步
- [x] 5. `MobileConnectPage.tsx`：menu/scan/manual 三态；ScanPanel（高分辨率约束、rVFC/轮询、BarcodeDetector→jsQR(960)、图片识别兜底（降采样 960→原图重试）、错误态出口）；handleConnect 并行 version guard（onDismiss late binding）+ `initialGate:false` + connecting 态 + bus re-init；`packages/web/package.json` 加 `jsqr`
- [x] 6. `App.tsx`：mount restore catch（仅 web toast）
- [x] 7. ActivityBar web 断开按钮 + AlertDialog 确认 → `clearConnection` + `reload`；连接页 menu 在已存连接时补断开出口（零项目连接态，review I1）
- [x] 8. i18n：zh-CN/zh-TW/en 三 locale 键新增与注释修正（加载 i18n skill）
- [x] 9. `npm run lint` + `npm run build` + `npm run typecheck` + `npm test -w @spherse/app -w @spherse/i18n` 通过
- [ ] 10. doc-sync：`docs/official/project-structure.md`、`docs/dev/backlog.md`、architecture 检查
- [ ] 11. 手动验证清单：
  - 桌面开移动端访问 → 手机 Safari 打开 web → 扫码连接成功直达项目页，全程无登录页闪回
  - iOS 真机：扫码检出（BarcodeDetector 路径，iOS 17.4+）；拒绝摄像头权限 → 「识别二维码图片」拍照/选图可连
  - 连接后 bus 功能正常（trigger/fs-watch 生效，无需 reload）
  - 侧栏抽屉左下角断开按钮 → 确认 → 回连接页；重连同桌面恢复上次项目
  - 版本墙：dev 桌面 × prod web 仍被拦截；「暂不升级」后能进入
