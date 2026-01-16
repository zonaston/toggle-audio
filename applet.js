const Applet = imports.ui.applet;
const Main = imports.ui.main;
const GLib = imports.gi.GLib;
const ByteArray = imports.byteArray;
const Settings = imports.ui.settings;
const Gio = imports.gi.Gio;
const PopupMenu = imports.ui.popupMenu;
const Clutter = imports.gi.Clutter;
const Tweener = imports.ui.tweener;
const Keybinding = imports.ui.keybindings;

const PACTL = "/usr/bin/pactl";
const UUID = "toggle-audio@zonaston";

// Check if pactl exists at startup
function checkPactlExists() {
  let pactlFile = Gio.File.new_for_path(PACTL);
  if (!pactlFile.query_exists(null)) {
    // Try alternative paths
    let altPaths = ["/bin/pactl", "/usr/local/bin/pactl"];
    for (let path of altPaths) {
      let altFile = Gio.File.new_for_path(path);
      if (altFile.query_exists(null)) {
        global.log(`[Audio Toggle] Found pactl at alternate path: ${path}`);
        return path;
      }
    }
    global.logError(`[Audio Toggle] ERROR: pactl not found at ${PACTL} or alternate paths`);
    return null;
  }
  return PACTL;
}

function runSync(cmd) {
  try {
    global.log(`[Audio Toggle] Running: ${cmd}`);
    let [ok, out, err, status] = GLib.spawn_command_line_sync(cmd);
    let result = { ok, status, out: ByteArray.toString(out || []), err: ByteArray.toString(err || []) };
    if (!ok || status !== 0) {
      global.logError(`[Audio Toggle] Command failed: ${cmd}\nStatus: ${status}\nError: ${result.err}`);
    }
    return result;
  } catch (e) {
    global.logError(`[Audio Toggle] Exception running command: ${cmd}\n${e}`);
    return { ok: false, status: -1, out: "", err: String(e) };
  }
}

function runAsync(cmd) {
  try {
    global.log(`[Audio Toggle] Running async: ${cmd}`);
    GLib.spawn_command_line_async(cmd);
  } catch (e) {
    global.logError(`[Audio Toggle] Failed to run async command: ${cmd}\n${e}`);
  }
}

function getDefaultSink() {
  let r = runSync(`${PACTL} get-default-sink`);
  if (r.ok) {
    let name = (r.out || "").trim();
    if (name) return name;
  }
  return null;
}


function getSinkInputs() {
  let r = runSync(`${PACTL} list short sink-inputs`);
  if (!r.ok) return [];
  return r.out.split('\n').map(l => l.trim()).filter(Boolean).map(l => l.split(/\s+/)[0]);
}

function moveAllInputsTo(sink) {
  let ids = getSinkInputs();
  ids.forEach(id => runAsync(`${PACTL} move-sink-input ${id} ${sink}`));
}

function getAvailableSinks() {
  let r = runSync(`${PACTL} list short sinks`);
  if (!r.ok) {
    global.logError("[Audio Toggle] Failed to get sink list");
    return {};
  }

  let sinks = {};
  r.out.split('\n').forEach(line => {
    line = line.trim();
    if (!line) return;

    let parts = line.split(/\s+/);
    if (parts.length >= 2) {
      let sinkName = parts[1];
      sinks[sinkName] = sinkName; // Store temporarily, will get descriptions below
    }
  });

  // Get detailed sink info for better display names
  let detailsResult = runSync(`${PACTL} list sinks`);
  if (detailsResult.ok) {
    let currentSink = null;
    let currentDesc = null;

    detailsResult.out.split('\n').forEach(line => {
      // Look for "Name: sink_name"
      let nameMatch = line.match(/^\s*Name:\s*(.+)$/);
      if (nameMatch) {
        currentSink = nameMatch[1].trim();
        currentDesc = null;
      }

      // Look for "Description: Friendly Name"
      let descMatch = line.match(/^\s*Description:\s*(.+)$/);
      if (descMatch && currentSink && sinks.hasOwnProperty(currentSink)) {
        currentDesc = descMatch[1].trim();
        sinks[currentSink] = currentDesc;
      }
    });
  }

  // Fallback to friendly name generation for any sinks without descriptions
  for (let sinkName in sinks) {
    if (sinks[sinkName] === sinkName) {
      let displayName = sinkName;

      // Try to make a friendlier display name
      if (sinkName.includes('hdmi')) {
        displayName = "HDMI Output";
      } else if (sinkName.includes('usb')) {
        displayName = "USB Audio Device";
      } else if (sinkName.includes('analog')) {
        displayName = "Analog Output";
      } else if (sinkName.includes('bluetooth')) {
        displayName = "Bluetooth Device";
      } else if (sinkName.includes('pipewire')) {
        displayName = "PipeWire Device";
      } else {
        // Extract device name from sink name
        let match = sinkName.match(/(?:alsa_output|pipewire)\.(.+?)(?:\.|$)/);
        if (match) {
          displayName = match[1].replace(/[_-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        }
      }

      sinks[sinkName] = displayName;
    }
  }

  global.log(`[Audio Toggle] Found ${Object.keys(sinks).length} sinks`);
  return sinks;
}

function resolveSink(value) {
  if (!value) return null;
  let sinks = getAvailableSinks();
  if (sinks[value]) return value; // exact sink ID
  // try resolve by display name
  for (let [id, name] of Object.entries(sinks)) {
    if (name === value) return id;
  }
  // try partial match by tail of id
  let match = Object.keys(sinks).find(id => id.endsWith(value));
  return match || null;
}

// Get current volume for a sink (returns percentage 0-100)
function getSinkVolume(sink) {
  let r = runSync(`${PACTL} get-sink-volume ${sink}`);
  if (r.ok) {
    // Parse output like "Volume: front-left: 65536 / 100% / 0.00 dB, ..."
    let match = r.out.match(/(\d+)%/);
    if (match) {
      return parseInt(match[1]);
    }
  }
  return null;
}

// Set volume for a sink (percentage 0-100)
function setSinkVolume(sink, volume) {
  runSync(`${PACTL} set-sink-volume ${sink} ${volume}%`);
}

function MyApplet(orientation, panel_height, instance_id) {
  this._init(orientation, panel_height, instance_id);
}

MyApplet.prototype = {
  __proto__: Applet.IconApplet.prototype,

  _init: function(orientation, panel_height, instance_id) {
    Applet.IconApplet.prototype._init.call(this, orientation, panel_height, instance_id);

    global.log("[Audio Toggle] Initializing applet");

    // Check if pactl is available
    this.pactlPath = checkPactlExists();
    if (!this.pactlPath) {
      this.set_applet_icon_symbolic_name('dialog-error-symbolic');
      this.set_applet_tooltip('Audio Toggle: pactl not found. Please install pulseaudio-utils or pipewire-pulse');
      Main.notifyError("Audio Toggle Error", "pactl command not found.\n\nPlease install:\n• Debian/Ubuntu: pulseaudio-utils or pipewire-pulse\n• Fedora: pulseaudio-utils or pipewire-utils\n• Arch: pulseaudio or pipewire-pulse");
      return;
    }

    // Initialize settings
    this.settings = new Settings.AppletSettings(this, UUID, instance_id);
    // Use BIDIRECTIONAL so changes we make programmatically reflect in the UI immediately
    this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "device1", "device1", this.on_settings_changed, null);
    this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "device2", "device2", this.on_settings_changed, null);
    this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "show-notifications", "showNotifications", this.on_settings_changed, null);
    this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "device1-icon", "device1Icon", this.on_settings_changed, null);
    this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "device2-icon", "device2Icon", this.on_settings_changed, null);
    this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "device1-nickname", "device1Nickname", this.on_settings_changed, null);
    this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "device2-nickname", "device2Nickname", this.on_settings_changed, null);
    this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "remember-volume", "rememberVolume", this.on_settings_changed, null);
    this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "toggle-keybinding", "toggleKeybinding", this.on_keybinding_changed, null);

    // Visual toggle state used when both devices are the same (icon-only toggle)
    this._visualToggleState = false;

    // Track if this is first run (no devices configured)
    this._isFirstRun = (!this.device1 && !this.device2);

    // Volume memory storage (device ID -> volume percentage)
    this._volumeMemory = {};

    // Setup right-click context menu
    this.menuManager = new PopupMenu.PopupMenuManager(this);
    this.menu = new Applet.AppletPopupMenu(this, orientation);
    this.menuManager.addMenu(this.menu);

    // Setup keyboard shortcut
    this.setupKeybinding();

    // Attempt to migrate any legacy values (e.g. human labels instead of sink IDs)
    this.migrateSettingsValues();

    // Auto-detect devices on startup if none configured
    this.autoDetectDevices();

    // Populate settings UI combobox options dynamically based on current sinks
    this.populateDeviceOptions();

    // Build initial popup menu
    this.buildMenu();

    this.updateDisplay();

    // Show first-run help if needed
    if (this._isFirstRun && (!this.device1 || !this.device2)) {
      this.showFirstRunHelp();
    }

    global.log("[Audio Toggle] Initialization complete");
  },

  showFirstRunHelp: function() {
    Main.notify(
      "Audio Toggle - Setup Required",
      "Welcome! To use this applet:\n\n" +
      "1. Right-click the applet icon\n" +
      "2. Select 'Configure...'\n" +
      "3. Choose your two audio devices\n" +
      "4. Click to switch between them!\n\n" +
      "Tip: Middle-click opens settings"
    );
  },

  // Setup keyboard shortcut binding
  setupKeybinding: function() {
    if (this.toggleKeybinding && this.toggleKeybinding !== "") {
      try {
        Main.keybindingManager.addHotKey(
          UUID + "-toggle",
          this.toggleKeybinding,
          () => { this.toggleDevices(); }
        );
        global.log(`[Audio Toggle] Keyboard shortcut bound: ${this.toggleKeybinding}`);
      } catch (e) {
        global.logError(`[Audio Toggle] Failed to bind keyboard shortcut: ${e}`);
      }
    }
  },

  // Called when keybinding setting changes
  on_keybinding_changed: function() {
    // Remove old keybinding
    try {
      Main.keybindingManager.removeHotKey(UUID + "-toggle");
    } catch (e) {
      // Ignore if it wasn't set
    }
    // Setup new keybinding
    this.setupKeybinding();
  },

  // Get display name for a device (nickname or friendly name)
  getDeviceName: function(deviceId, isDevice1) {
    if (!deviceId) return "Unknown";

    // Use nickname if set
    let nickname = isDevice1 ? this.device1Nickname : this.device2Nickname;
    if (nickname && nickname.trim() !== "") {
      return nickname.trim();
    }

    // Otherwise use friendly name from sinks
    let sinks = getAvailableSinks();
    return sinks[deviceId] || deviceId.split('.').pop();
  },

  // Play test sound on current device
  playTestSound: function() {
    try {
      // Use paplay to play a simple beep
      GLib.spawn_command_line_async("paplay /usr/share/sounds/freedesktop/stereo/audio-volume-change.oga");
      if (this.showNotifications) {
        Main.notify("Audio Toggle", "Playing test sound on current device");
      }
    } catch (e) {
      global.logError(`[Audio Toggle] Failed to play test sound: ${e}`);
      Main.notify("Audio Toggle", "Could not play test sound. Make sure 'paplay' is installed.");
    }
  },

  // Build the right-click popup menu
  buildMenu: function() {
    this.menu.removeAll();

    let sinks = getAvailableSinks();
    let current = getDefaultSink();

    // Add all available devices
    for (let [sinkId, sinkName] of Object.entries(sinks)) {
      let itemLabel = sinkName;
      if (sinkId === current) {
        itemLabel = "✓ " + itemLabel;
      }

      let menuItem = new PopupMenu.PopupMenuItem(itemLabel);
      menuItem.connect('activate', () => {
        this.switchToDevice(sinkId);
      });
      this.menu.addMenuItem(menuItem);
    }

    // Add separator
    this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    // Add "Configure" option
    let configItem = new PopupMenu.PopupMenuItem("⚙ Configure");
    configItem.connect('activate', () => {
      GLib.spawn_command_line_async("cinnamon-settings applets");
    });
    this.menu.addMenuItem(configItem);
  },

  // Visual feedback animation
  animateIcon: function() {
    try {
      let icon = this.actor.get_children()[0];
      if (icon) {
        // Pulse animation
        Tweener.addTween(icon, {
          scale_x: 1.2,
          scale_y: 1.2,
          time: 0.1,
          transition: 'easeOutQuad',
          onComplete: () => {
            Tweener.addTween(icon, {
              scale_x: 1.0,
              scale_y: 1.0,
              time: 0.1,
              transition: 'easeInQuad'
            });
          }
        });
      }
    } catch (e) {
      global.logError(`[Audio Toggle] Animation error: ${e}`);
    }
  },

  // Toggle between configured devices (for keyboard shortcut)
  toggleDevices: function() {
    this.on_applet_clicked(null);
  },

  // Build and apply combobox options for device1 and device2 from available sinks
  populateDeviceOptions: function() {
    try {
      let sinks = getAvailableSinks();
      let current = getDefaultSink();
      let options = { "Unset": "" };

      // Ensure unique and informative display labels
      for (let [id, name] of Object.entries(sinks)) {
        let label = name || id;
        // Add a short suffix of the id to disambiguate duplicates
        let shortId = id.length > 24 ? id.slice(-24) : id;

        // Add status badge
        let badge = "";
        if (id === current) {
          badge = " (Active)";
        }

        label = `${label}${badge} — ${shortId}`;
        options[label] = id;
      }

      // Preserve current selections even if temporarily unavailable
      if (this.device1 && !Object.values(options).includes(this.device1)) {
        options[`⚠ Disconnected: ${this.device1}`] = this.device1;
      }
      if (this.device2 && !Object.values(options).includes(this.device2)) {
        options[`⚠ Disconnected: ${this.device2}`] = this.device2;
      }

      if (typeof this.settings.setOptions === 'function') {
        this.settings.setOptions("device1", options);
        this.settings.setOptions("device2", options);
        global.log("[Audio Toggle] Device options populated successfully");
      }
    } catch (e) {
      global.logError(`[Audio Toggle] Error populating device options: ${e}`);
    }
  },

  // Callback for the settings button defined in settings-schema.json
  refreshDevices: function() {
    this.populateDeviceOptions();
    if (this.showNotifications) {
      let sinks = getAvailableSinks();
      Main.notify("Audio Toggle", `Found ${Object.keys(sinks).length} audio devices.`);
    }
  },

  autoDetectDevices: function() {
    // Only auto-detect if both devices are empty (startup behavior)
    if (!this.device1 && !this.device2) {
      global.log("[Audio Toggle] Auto-detecting devices...");
      let sinks = getAvailableSinks();
      let sinkNames = Object.keys(sinks);

      if (sinkNames.length >= 2) {
        // Try to intelligently pick devices
        let hdmiDevice = sinkNames.find(s => s.includes('hdmi'));
        let usbDevice = sinkNames.find(s => s.includes('usb'));
        let analogDevice = sinkNames.find(s => s.includes('analog'));

        if (hdmiDevice && usbDevice) {
          // HDMI and USB headset - common setup
          this.settings.setValue("device1", hdmiDevice);
          this.settings.setValue("device2", usbDevice);
          global.log(`[Audio Toggle] Auto-detected: HDMI (${hdmiDevice}) and USB (${usbDevice})`);
        } else if (hdmiDevice && analogDevice) {
          // HDMI and analog - another common setup
          this.settings.setValue("device1", hdmiDevice);
          this.settings.setValue("device2", analogDevice);
          global.log(`[Audio Toggle] Auto-detected: HDMI (${hdmiDevice}) and Analog (${analogDevice})`);
        } else {
          // Just pick the first two
          this.settings.setValue("device1", sinkNames[0]);
          this.settings.setValue("device2", sinkNames[1]);
          global.log(`[Audio Toggle] Auto-detected: ${sinkNames[0]} and ${sinkNames[1]}`);
        }

        // Show notification about auto-detection
        Main.notify(
          "Audio Toggle - Auto-configured",
          `Detected ${sinks[this.device1]} and ${sinks[this.device2]}.\n\n` +
          "Right-click > Configure to customize.\n" +
          "Middle-click for quick settings access."
        );
      } else if (sinkNames.length === 1) {
        this.settings.setValue("device1", sinkNames[0]);
        global.log(`[Audio Toggle] Only one device found: ${sinkNames[0]}`);
      } else {
        global.logError("[Audio Toggle] No audio devices found!");
      }
    }
  },

  // If the saved values are labels (from older versions), convert them to real sink IDs
  migrateSettingsValues: function() {
    try {
      let sinks = getAvailableSinks();
      let keys = Object.keys(sinks);
      // Build reverse map displayName -> sinkName
      let reverse = {};
      for (let k of keys) {
        reverse[sinks[k]] = k;
      }

      let changed = false;

      if (this.device1 && !keys.includes(this.device1) && reverse[this.device1]) {
        global.log(`[Audio Toggle] Migrating device1 from "${this.device1}" to "${reverse[this.device1]}"`);
        this.settings.setValue("device1", reverse[this.device1]);
        changed = true;
      }
      if (this.device2 && !keys.includes(this.device2) && reverse[this.device2]) {
        global.log(`[Audio Toggle] Migrating device2 from "${this.device2}" to "${reverse[this.device2]}"`);
        this.settings.setValue("device2", reverse[this.device2]);
        changed = true;
      }

      if (changed) {
        Main.notify("Audio Toggle - Settings Updated", "Device settings migrated to current system configuration.");
        global.log("[Audio Toggle] Migration complete");
      }
    } catch (e) {
      global.logError(`[Audio Toggle] Error during settings migration: ${e}`);
    }
  },

  on_settings_changed: function() {
    // Re-run migration in case user picked a label from an old schema or leftover config
    this.migrateSettingsValues();
    // Keep combobox options up to date whenever settings change
    this.populateDeviceOptions();
    // Rebuild menu in case device list changed
    this.buildMenu();
    this.updateDisplay();
  },

  updateDisplay: function() {
    if (!this.device1 || !this.device2) {
      this.set_applet_icon_symbolic_name('audio-card-symbolic');
      this.set_applet_tooltip(
        'Audio Toggle - Setup Required\n\n' +
        'Right-click > Configure to set up devices\n' +
        'Middle-click for quick settings access'
      );
      return;
    }

    let current = getDefaultSink();
    let sinks = getAvailableSinks();
    let dev1 = resolveSink(this.device1);
    let dev2 = resolveSink(this.device2);

    // Check if devices are available
    let dev1Available = dev1 && sinks[dev1];
    let dev2Available = dev2 && sinks[dev2];

    if (!dev1Available || !dev2Available) {
      this.set_applet_icon_symbolic_name('dialog-warning-symbolic');
      let missingDevices = [];
      if (!dev1Available) missingDevices.push(this.device1);
      if (!dev2Available) missingDevices.push(this.device2);
      this.set_applet_tooltip(
        'Audio Toggle - Device Unavailable\n\n' +
        `Missing: ${missingDevices.join(', ')}\n\n` +
        'Right-click > Configure > Refresh device list\n' +
        'Or select different devices'
      );
      return;
    }

    // When both configured devices resolve to the same sink, honor a visual-only toggle using _visualToggleState
    if (dev1 && dev2 && dev1 === dev2) {
      let deviceName = this.getDeviceName(dev1, true);
      let iconName = this._visualToggleState ? (this.device2Icon || 'audio-headphones-symbolic') : (this.device1Icon || 'video-display-symbolic');
      this.set_applet_icon_symbolic_name(iconName);
      this.set_applet_tooltip(
        `Audio Toggle - Visual Mode\n\n` +
        `Device: ${deviceName}\n` +
        `ID: ${dev1}\n\n` +
        `Click: Switch icon\n` +
        `Right-click: Device menu\n` +
        `Middle-click: Settings\n` +
        `Scroll: No effect (same device)`
      );
    } else if (current === dev1) {
      // Prefer user-selected icon, fallback to the previous default
      if (this.device1Icon) {
        this.set_applet_icon_symbolic_name(this.device1Icon);
      } else {
        this.set_applet_icon_symbolic_name('video-display-symbolic');
      }
      let deviceName = this.getDeviceName(dev1, true);
      let otherDeviceName = this.getDeviceName(dev2, false);
      this.set_applet_tooltip(
        `Audio Toggle\n\n` +
        `Current: ${deviceName}\n` +
        `Switch to: ${otherDeviceName}\n\n` +
        `Click/Scroll: Switch devices\n` +
        `Right-click: Device menu\n` +
        `Middle-click: Settings`
      );
    } else if (current === dev2) {
      if (this.device2Icon) {
        this.set_applet_icon_symbolic_name(this.device2Icon);
      } else {
        this.set_applet_icon_symbolic_name('audio-headphones-symbolic');
      }
      let deviceName = this.getDeviceName(dev2, false);
      let otherDeviceName = this.getDeviceName(dev1, true);
      this.set_applet_tooltip(
        `Audio Toggle\n\n` +
        `Current: ${deviceName}\n` +
        `Switch to: ${otherDeviceName}\n\n` +
        `Click/Scroll: Switch devices\n` +
        `Right-click: Device menu\n` +
        `Middle-click: Settings`
      );
    } else {
      this.set_applet_icon_symbolic_name('audio-card-symbolic');
      let dev1Name = this.getDeviceName(dev1, true);
      let dev2Name = this.getDeviceName(dev2, false);
      this.set_applet_tooltip(
        `Audio Toggle - Unknown Device Active\n\n` +
        `Current device is neither:\n` +
        `• ${dev1Name}\n` +
        `• ${dev2Name}\n\n` +
        `Click to switch to ${dev1Name}\n` +
        `Right-click: Device menu`
      );
    }
  },

  switchToDevice: function(target) {
    let sinks = getAvailableSinks();

    // Get display name using nickname if available
    let isDevice1 = (target === resolveSink(this.device1));
    let targetName = this.getDeviceName(target, isDevice1);
    if (!targetName || targetName === "Unknown") {
      targetName = sinks[target] || target.split('.').pop();
    }

    // Validate that target device exists
    if (!sinks[target]) {
      Main.notifyError(
        "Audio Toggle - Device Not Found",
        `${targetName} is not available.\n\n` +
        `This may be because:\n` +
        `• Device is unplugged\n` +
        `• Device is turned off\n` +
        `• Audio service restarted\n\n` +
        `Right-click > Configure > Refresh device list`
      );
      global.logError(`[Audio Toggle] Device not found: ${target}`);
      return false;
    }

    // Save current device's volume if volume memory is enabled
    if (this.rememberVolume) {
      let currentDevice = getDefaultSink();
      if (currentDevice) {
        let currentVolume = getSinkVolume(currentDevice);
        if (currentVolume !== null) {
          this._volumeMemory[currentDevice] = currentVolume;
          global.log(`[Audio Toggle] Saved volume ${currentVolume}% for ${currentDevice}`);
        }
      }
    }

    // Try to switch device
    global.log(`[Audio Toggle] Switching to device: ${target}`);
    let result = runSync(`${PACTL} set-default-sink ${target}`);
    if (result.status !== 0) {
      Main.notifyError(
        "Audio Toggle - Switch Failed",
        `Could not switch to ${targetName}\n\n` +
        `Error: ${result.err || 'Unknown error'}\n\n` +
        `Try:\n` +
        `• Refresh device list\n` +
        `• Check device is enabled\n` +
        `• Restart audio service`
      );
      return false;
    }

    // Success - animate icon
    this.animateIcon();

    // Move audio streams, restore volume, and update display
    global.log(`[Audio Toggle] Successfully switched to ${target}`);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
      moveAllInputsTo(target);

      // Restore volume if we have it saved
      if (this.rememberVolume && this._volumeMemory.hasOwnProperty(target)) {
        let savedVolume = this._volumeMemory[target];
        setSinkVolume(target, savedVolume);
        global.log(`[Audio Toggle] Restored volume ${savedVolume}% for ${target}`);
      }

      this.updateDisplay();
      if (this.showNotifications) {
        Main.notify("Audio Toggle", `Switched to ${targetName}`);
      }
      return GLib.SOURCE_REMOVE;
    });
    return true;
  },

  on_applet_clicked: function(event) {
    if (!this.device1 || !this.device2) {
      Main.notify(
        "Audio Toggle - Setup Required",
        "Please configure devices:\n\n" +
        "1. Right-click this applet\n" +
        "2. Select 'Configure...'\n" +
        "3. Choose two audio devices"
      );
      return;
    }

    let current = getDefaultSink();
    let dev1 = resolveSink(this.device1);
    let dev2 = resolveSink(this.device2);

    if (!dev1 || !dev2) {
      Main.notify(
        "Audio Toggle - Configuration Error",
        "Could not resolve configured devices.\n\n" +
        "Right-click > Configure to fix settings"
      );
      global.logError(`[Audio Toggle] Failed to resolve devices: dev1=${this.device1}, dev2=${this.device2}`);
      return;
    }

    if (dev1 === dev2) {
      // Same device configured in both slots: visual toggle only
      this._visualToggleState = !this._visualToggleState;
      global.log(`[Audio Toggle] Visual toggle: ${this._visualToggleState}`);
      this.updateDisplay();
      return;
    }

    let target = (current === dev1) ? dev2 : dev1;
    this.switchToDevice(target);
  },

  on_applet_middle_clicked: function(event) {
    // Open settings on middle-click
    global.log("[Audio Toggle] Middle-click: opening settings");
    try {
      // Open general applets settings page
      GLib.spawn_command_line_async("cinnamon-settings applets");
    } catch (e) {
      global.logError(`[Audio Toggle] Failed to open settings: ${e}`);
      Main.notify("Audio Toggle", "Could not open settings. Try right-click > Configure");
    }
  },

  on_applet_scroll: function(event) {
    if (!this.device1 || !this.device2) {
      return;
    }

    let dev1 = resolveSink(this.device1);
    let dev2 = resolveSink(this.device2);

    if (!dev1 || !dev2 || dev1 === dev2) {
      return; // Don't scroll if devices not configured or same device
    }

    let current = getDefaultSink();
    let target = (current === dev1) ? dev2 : dev1;

    global.log(`[Audio Toggle] Scroll event: switching to ${target}`);
    this.switchToDevice(target);
  },

  on_applet_right_clicked: function(event) {
    // Build and show the popup menu
    this.buildMenu();
    this.menu.toggle();
  }
};

function main(metadata, orientation, panel_height, instance_id) {
  return new MyApplet(orientation, panel_height, instance_id);
}