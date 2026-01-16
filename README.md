Audio Toggle Applet

A simple Cinnamon applet to toggle between two audio output devices (PulseAudio/pipewire-pulse) with a clean settings UI.

Features
- Toggle between any two configured audio sinks (moves existing audio streams to the new default sink)
- **Multiple interaction modes:**
  - Click to switch devices
  - Middle-click for quick settings access
- **Smart device detection:** Auto-detects common device combinations on first run
- **Dynamic device lists:** Settings comboboxes populated from your system's current sinks
- **Rich device names:** Shows friendly descriptions from pactl instead of cryptic IDs
- **Device status indicators:** Shows (Active), (Available), or ⚠ Disconnected badges
- **Comprehensive error handling:** Helpful notifications with troubleshooting steps
- **Detailed logging:** Debug info logged to `~/.xsession-errors` for troubleshooting
- **Per-device icon selection:** Pick symbolic icon names or image files
- Works with PulseAudio or PipeWire (via pactl)

Requirements
**Required:** `pactl` command must be available
- **Debian/Ubuntu:** `sudo apt install pulseaudio-utils` or `pipewire-pulse`
- **Fedora:** `sudo dnf install pulseaudio-utils` or `pipewire-utils`
- **Arch:** `sudo pacman -S pulseaudio` or `pipewire-pulse`

The applet will check for `pactl` on startup and show a helpful error if missing.

Install
Option 1: Clone into your local Cinnamon applets directory

  cd ~/.local/share/cinnamon/applets/

  git clone https://github.com/zonaston/toggle-audio.git toggle-audio@zonaston


Option 2: Download and extract
- Download the archive
- Extract into: `~/.local/share/cinnamon/applets/toggle-audio@zonaston/`

Enable
- Open System Settings > Applets
- Find "Audio Toggle" and add it to the panel
- The applet will auto-detect your devices on first run
- Right-click > Configure to customize device selection and icons

Usage
- **Left-click:** Switch between configured devices
- **Middle-click:** Open settings (quick access)
- **Right-click:** Access device menu and configuration

Troubleshooting
**Device not appearing in list?**
- Click the "Refresh device list" button in settings
- Check device is connected and enabled
- Run `pactl list short sinks` in terminal to verify device exists

**Switch failing?**
- Ensure device is not disconnected
- Check `~/.xsession-errors` for detailed error logs
- Try restarting the audio service: `systemctl --user restart pulseaudio` or `pipewire-pulse`

**First-time setup:**
- If auto-detection doesn't find ideal devices, right-click the applet
- Select "Configure..." to manually choose your preferred devices
- Device names include helpful descriptions and current status

Notes
- The device dropdown is filled dynamically when settings are opened
- If you plug in new devices, click the "Refresh device list" button
- If both selected devices resolve to the same sink, clicking toggles only the icon (visual toggle)
- All operations are logged to `~/.xsession-errors` for debugging

Contributing
PRs, issues, and feature requests welcome.

Credits
Originally created by zonaston. Based on Cinnamon applet API and pactl.
