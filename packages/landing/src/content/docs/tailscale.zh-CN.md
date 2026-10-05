# 用 Tailscale 从手机访问 Spherse

Tailscale 会把你的电脑和手机组成一个私有网络（tailnet）。借助它，你可以在任何网络下用手机安全地访问电脑上的 Spherse——无需公网 IP，也不会把服务暴露到互联网。整个过程只需要一个免费的 Tailscale 账号。

## 1. 在电脑上安装 Tailscale

下载并安装 [Tailscale 客户端](https://tailscale.com/download)，启动后登录你的账号。登录成功后，这台电脑就加入了你的 tailnet。

## 2. 把 Spherse 端口发布到 tailnet

在 Spherse 桌面端打开 设置 → 移动端，将「连接方式」切换为「自有域名」（若此前启用过快速隧道，请先关闭其开关），记下「本地服务 URL」中的端口号，然后在电脑终端执行：

```sh
tailscale serve --bg 12345
```

把 `12345` 替换为你的实际端口。命令会输出一个 `https://<机器名>.<tailnet>.ts.net` 地址，只有你 tailnet 中的设备可以访问它。

macOS 下如提示找不到命令，请改用完整路径执行：`/Applications/Tailscale.app/Contents/MacOS/Tailscale`

## 3. 在 Spherse 中填写域名

回到 Spherse 的 设置 → 移动端，把上一步得到的 ts.net 地址填入「公网域名」并保存，二维码会立即显示。

## 4. 在手机上连接 Tailscale

在手机上安装 Tailscale App（App Store / Google Play），登录同一个账号，然后开启连接。

## 5. 扫码访问

用手机扫描 Spherse 设置页中的二维码，浏览器打开后即完成连接。之后随时在手机上访问你的 Spherse。

## 管理与排错

- `tailscale serve status`：查看已发布的地址与运行状态
- `tailscale serve reset`：停止发布并清除本机全部 serve 配置，手机将无法继续访问
- 若首次执行时提示需要启用 HTTPS 证书，跟随命令输出中的指引在 Tailscale 管理台开启一次即可

更多用法参考 [Tailscale Serve 官方文档](https://tailscale.com/kb/1242/tailscale-serve)。
