# 用 Tailscale 從手機存取 Spherse

Tailscale 會把你的電腦和手機組成一個私有網路（tailnet）。藉助它，你可以在任何網路下用手機安全地存取電腦上的 Spherse——無需公網 IP，也不會把服務暴露到網際網路。整個過程只需要一個免費的 Tailscale 帳號。

## 1. 在電腦上安裝 Tailscale

下載並安裝 [Tailscale 用戶端](https://tailscale.com/download)，啟動後登入你的帳號。登入成功後，這台電腦就加入了你的 tailnet。

## 2. 把 Spherse 連接埠發佈到 tailnet

在 Spherse 桌面端開啟 設定 → 行動裝置，將「連線方式」切換為「自有網域」（若此前啟用過快速通道，請先關閉其開關），記下「本地服務 URL」中的連接埠號，然後在電腦終端機執行：

```sh
tailscale serve --bg 12345
```

把 `12345` 替換為你的實際連接埠。命令會輸出一個 `https://<機器名>.<tailnet>.ts.net` 位址，只有你 tailnet 中的裝置可以存取它。

macOS 下如提示找不到命令，請改用完整路徑執行：`/Applications/Tailscale.app/Contents/MacOS/Tailscale`

## 3. 在 Spherse 中填寫網域

回到 Spherse 的 設定 → 行動裝置，把上一步得到的 ts.net 位址填入「公用網域」並儲存，QR Code 會立即顯示。

## 4. 在手機上連線 Tailscale

在手機上安裝 Tailscale App（App Store / Google Play），登入同一個帳號，然後開啟連線。

## 5. 掃碼存取

用手機掃描 Spherse 設定頁中的 QR Code，瀏覽器開啟後即完成連線。之後隨時在手機上存取你的 Spherse。

## 管理與疑難排解

- `tailscale serve status`：查看已發佈的位址與運行狀態
- `tailscale serve reset`：停止發佈並清除本機全部 serve 設定，手機將無法繼續存取
- 若首次執行時提示需要啟用 HTTPS 憑證，跟隨命令輸出中的指引在 Tailscale 管理後台開啟一次即可

更多用法參考 [Tailscale Serve 官方文件](https://tailscale.com/kb/1242/tailscale-serve)。
