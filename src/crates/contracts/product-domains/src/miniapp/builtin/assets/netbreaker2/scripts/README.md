# NetBreaker2 kernel placement

NetBreaker2 does not commit a Clash / mihomo binary. Place a
platform-appropriate kernel next to these scripts:

- Linux / macOS: `scripts/mihomo` (or `scripts/clash`, `scripts/clash-meta`)
- Windows: `scripts/mihomo.exe` (or `scripts/clash.exe`)

Optional fallbacks: `bin/mihomo`, `bin/clash`, or the same names on PATH.

The named script `ensure-kernel` (or the Fetch kernel button) can download an
official MetaCubeX/mihomo release into `scripts/` for the current OS/arch. If
download or extract fails, the UI reports that the kernel is missing.

`scripts/clash.js` is the named-script locator, not the kernel binary.

## TUN and elevation

Start uses a generated Clash TUN config (`tun.enable`, `stack: system` or
`gvisor`, `auto-route`). Creating the virtual NIC requires elevated rights.
Start shows an OS prompt: pkexec/polkit on Linux, administrator osascript on
macOS, UAC on Windows. Elevation is never silent. If the prompt is denied, or
the host is remote / peer / headless without a prompt, the app fails loudly
and does not pretend a SOCKS inbound is a TUN.
