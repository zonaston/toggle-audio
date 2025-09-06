Audio Toggle Applet

A simple Cinnamon applet to toggle between two audio output devices (PulseAudio/pipewire-pulse) with a clean settings UI.

Features
- Toggle between any two configured audio sinks (moves existing audio streams to the new default sink)
- Dynamic device lists: settings comboboxes are populated from your system's current sinks
- One-click "Refresh device list" button in settings
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
- The device dropdown is filled dynamically when settings are opened. If you plug in new devices, click the "Refresh device list" button in the applet settings.
- If both selected devices resolve to the same sink, clicking toggles only the icon (visual toggle). This is intentional and configurable in the code.

Contributing
PRs, issues, and feature requests welcome.

Credits
Originally created by zonaston. Based on Cinnamon applet API and pactl.
