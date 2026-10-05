# Access Spherse from your phone with Tailscale

Tailscale puts your computer and phone on the same private network (a tailnet). With it, you can securely reach the Spherse instance on your computer from your phone on any network — no public IP needed, and nothing is exposed to the internet. All you need is a free Tailscale account.

## 1. Install Tailscale on your computer

Download and install the [Tailscale client](https://tailscale.com/download), then sign in to your account. Once signed in, this computer joins your tailnet.

## 2. Serve the Spherse port on your tailnet

In the Spherse desktop app, open Settings → Mobile, switch Connection mode to Custom domain (if you previously enabled the quick tunnel, turn it off first), note the port from the Local service URL, then run this in a terminal:

```sh
tailscale serve --bg 53972
```

Spherse listens on port 53972 by default; if the Local service URL shows a different port, replace it with yours. The command prints a `https://<machine>.<tailnet>.ts.net` URL that only devices in your tailnet can reach.

On macOS, if the command is not found, use the full path instead: `/Applications/Tailscale.app/Contents/MacOS/Tailscale`

## 3. Enter the domain in Spherse

Back in Settings → Mobile in Spherse, paste the ts.net URL into Public domain and save. The QR code appears immediately.

## 4. Connect your phone to Tailscale

Install the Tailscale app (App Store / Google Play) on your phone, sign in with the same account, and turn on the connection.

## 5. Scan and connect

Scan the QR code on the Spherse settings page with your phone. Once it opens in the browser, you're connected — your Spherse is now reachable from your phone anywhere.

## Manage and troubleshoot

- `tailscale serve status`: list the served URL and running status
- `tailscale serve reset`: stop serving and clear all serve config on this machine; your phone will no longer reach Spherse
- If the first run asks you to enable HTTPS certificates, follow the link in the command output and enable it once in the Tailscale admin console

See the [official Tailscale Serve docs](https://tailscale.com/kb/1242/tailscale-serve) for more.
