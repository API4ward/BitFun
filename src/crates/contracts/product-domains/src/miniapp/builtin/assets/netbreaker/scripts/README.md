# NetBreaker kernel placement

NetBreaker does not commit a v2ray binary. Place a platform-appropriate kernel
next to these scripts:

- Linux / macOS: `scripts/v2ray`
- Windows: `scripts/v2ray.exe`

Optional fallbacks: `bin/v2ray`, `bin/v2ray.exe`, or a `v2ray` executable on PATH.

The named script `ensure-kernel` (or the Fetch kernel button) can download an
official v2fly/v2ray-core release into `scripts/` for the current OS/arch. If
download or extract fails, the UI reports that the kernel is missing.

`scripts/v2ray.js` is the named-script locator, not the kernel binary.
