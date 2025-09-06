Audio Toggle Applet

A simple Cinnamon applet to toggle between two audio output devices (PulseAudio/pipewire-pulse) with a clean settings UI.

Features
- Toggle between any two configured audio sinks (moves existing audio streams to the new default sink)
- Per-device icon selection (pick symbolic icon names or image files)
- Works with PulseAudio or PipeWire (via pactl)

Install
Option 1: Clone into your local Cinnamon applets directory

  cd ~/.local/share/cinnamon/applets/
  git clone https://github.com/zonaston/toggle-audio.git toggle-audio@zonaston

Option 2: Download and extract
- Download the archive
- Extract into: ~/.local/share/cinnamon/applets/toggle-audio@zonaston/ (folder name must match UUID in metadata.json)

Enable
- Open System Settings > Applets
- Find "Audio Toggle" and add it to the panel
- Right-click the applet > Configure, then choose your two devices

Notes
- The device dropdown shows known sinks at the time of editing settings. If you plug in new devices, just re-open settings to pick them.
- If both selected devices resolve to the same sink, clicking toggles only the icon (visual toggle). This is intentional and configurable in the code.

Contributing
PRs, issues, and feature requests welcome.

Credits
Originally created by zonaston. Based on Cinnamon applet API and pactl.
