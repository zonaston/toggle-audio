const Applet = imports.ui.applet;
const Main = imports.ui.main;
const GLib = imports.gi.GLib;
const ByteArray = imports.byteArray;
const Settings = imports.ui.settings;
// const Gio = imports.gi.Gio; // no longer used

const PACTL = "/usr/bin/pactl";

function runSync(cmd) {
  try {
    let [ok, out, err, status] = GLib.spawn_command_line_sync(cmd);
    return { ok, status, out: ByteArray.toString(out || []), err: ByteArray.toString(err || []) };
  } catch (e) {
    return { ok: false, status: -1, out: "", err: String(e) };
  }
}

function runAsync(cmd) {
  try {
    GLib.spawn_command_line_async(cmd);
  } catch (e) {
    // Silent fail
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
  if (!r.ok) return {};
  
  let sinks = {};
  r.out.split('\n').forEach(line => {
    line = line.trim();
    if (!line) return;
    
    let parts = line.split(/\s+/);
    if (parts.length >= 2) {
      let sinkName = parts[1];
      let displayName = sinkName;
      
      // Try to make a friendlier display name for both PulseAudio and PipeWire
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
        // Extract device name from sink name (works for both ALSA and PipeWire)
        let match = sinkName.match(/(?:alsa_output|pipewire)\.(.+?)(?:\.|$)/);
        if (match) {
          displayName = match[1].replace(/[_-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        }
      }
      
      sinks[sinkName] = displayName;
    }
  });
  
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

function MyApplet(orientation, panel_height, instance_id) {
  this._init(orientation, panel_height, instance_id);
}

MyApplet.prototype = {
  __proto__: Applet.IconApplet.prototype,

  _init: function(orientation, panel_height, instance_id) {
    Applet.IconApplet.prototype._init.call(this, orientation, panel_height, instance_id);
    
    // Initialize settings
    this.settings = new Settings.AppletSettings(this, "toggle-audio@zonaston", instance_id);
    // Use BIDIRECTIONAL so changes we make programmatically reflect in the UI immediately
    this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "device1", "device1", this.on_settings_changed, null);
    this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "device2", "device2", this.on_settings_changed, null);
    this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "show-notifications", "showNotifications", this.on_settings_changed, null);
    this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "device1-icon", "device1Icon", this.on_settings_changed, null);
    this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "device2-icon", "device2Icon", this.on_settings_changed, null);

    // Visual toggle state used when both devices are the same (icon-only toggle)
    this._visualToggleState = false;

    // Attempt to migrate any legacy values (e.g. human labels instead of sink IDs)
    this.migrateSettingsValues();

    // Auto-detect devices on startup if none configured
    this.autoDetectDevices();

    // Populate settings UI combobox options dynamically based on current sinks
    this.populateDeviceOptions();

    this.updateDisplay();
  },

  // Build and apply combobox options for device1 and device2 from available sinks
  populateDeviceOptions: function() {
    try {
      let sinks = getAvailableSinks();
      let options = { "Unset": "" };

      // Ensure unique and informative display labels
      for (let [id, name] of Object.entries(sinks)) {
        let label = name || id;
        // Add a short suffix of the id to disambiguate duplicates
        let shortId = id.length > 24 ? id.slice(-24) : id;
        label = `${label} — ${shortId}`;
        options[label] = id;
      }

      // Preserve current selections even if temporarily unavailable
      if (this.device1 && !Object.values(options).includes(this.device1)) {
        options[`(Unavailable) ${this.device1}`] = this.device1;
      }
      if (this.device2 && !Object.values(options).includes(this.device2)) {
        options[`(Unavailable) ${this.device2}`] = this.device2;
      }

      if (typeof this.settings.setOptions === 'function') {
        this.settings.setOptions("device1", options);
        this.settings.setOptions("device2", options);
      }
    } catch (e) {
      // best-effort; ignore errors if settings UI isn't open or setOptions unavailable
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
        } else if (hdmiDevice && analogDevice) {
          // HDMI and analog - another common setup
          this.settings.setValue("device1", hdmiDevice);
          this.settings.setValue("device2", analogDevice);
        } else {
          // Just pick the first two
          this.settings.setValue("device1", sinkNames[0]);
          this.settings.setValue("device2", sinkNames[1]);
        }
        
        // Show notification about auto-detection
        if (this.showNotifications) {
          Main.notify("Audio Toggle", "Auto-detected audio devices. Check settings to customize.");
        }
      } else if (sinkNames.length === 1) {
        this.settings.setValue("device1", sinkNames[0]);
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
        this.settings.setValue("device1", reverse[this.device1]);
        changed = true;
      }
      if (this.device2 && !keys.includes(this.device2) && reverse[this.device2]) {
        this.settings.setValue("device2", reverse[this.device2]);
        changed = true;
      }

      if (changed && this.showNotifications) {
        Main.notify("Audio Toggle", "Updated device settings to match current system sink IDs.");
      }
    } catch (e) {
      // ignore
    }
  },

  on_settings_changed: function() {
    // Re-run migration in case user picked a label from an old schema or leftover config
    this.migrateSettingsValues();
    // Keep combobox options up to date whenever settings change
    this.populateDeviceOptions();
    this.updateDisplay();
  },

  updateDisplay: function() {
    if (!this.device1 || !this.device2) {
      this.set_applet_icon_symbolic_name('audio-card-symbolic');
      this.set_applet_tooltip('Audio Toggle: Please configure devices in settings');
      return;
    }
    
    let current = getDefaultSink();
    let sinks = getAvailableSinks();
    let dev1 = resolveSink(this.device1);
    let dev2 = resolveSink(this.device2);
    
    // When both configured devices resolve to the same sink, honor a visual-only toggle using _visualToggleState
    if (dev1 && dev2 && dev1 === dev2) {
      let deviceName = sinks[dev1] || (dev1 ? dev1.split('.').pop() : 'Unknown');
      let iconName = this._visualToggleState ? (this.device2Icon || 'audio-headphones-symbolic') : (this.device1Icon || 'video-display-symbolic');
      this.set_applet_icon_symbolic_name(iconName);
      this.set_applet_tooltip(`Audio: ${deviceName} (visual toggle) - click to switch icon`);
    } else if (current === dev1) {
      // Prefer user-selected icon, fallback to the previous default
      if (this.device1Icon) {
        this.set_applet_icon_symbolic_name(this.device1Icon);
      } else {
        this.set_applet_icon_symbolic_name('video-display-symbolic');
      }
      let deviceName = sinks[dev1] || (dev1 ? dev1.split('.').pop() : 'Unknown');
      this.set_applet_tooltip(`Audio: ${deviceName} (click to switch)`);
    } else if (current === dev2) {
      if (this.device2Icon) {
        this.set_applet_icon_symbolic_name(this.device2Icon);
      } else {
        this.set_applet_icon_symbolic_name('audio-headphones-symbolic');
      }
      let deviceName = sinks[dev2] || (dev2 ? dev2.split('.').pop() : 'Unknown');
      this.set_applet_tooltip(`Audio: ${deviceName} (click to switch)`);
    } else {
      this.set_applet_icon_symbolic_name('audio-card-symbolic');
      this.set_applet_tooltip('Audio: Unknown device (click to switch)');
    }
  },

  on_applet_clicked: function() {
    if (!this.device1 || !this.device2) {
      Main.notify("Audio Toggle", "Please configure audio devices in applet settings");
      return;
    }
    
    let current = getDefaultSink();
    let dev1 = resolveSink(this.device1);
    let dev2 = resolveSink(this.device2);

    if (!dev1 || !dev2) {
      if (this.showNotifications) {
        Main.notify("Audio Toggle", "Please configure two audio devices in settings.");
      }
      return;
    }

    if (dev1 === dev2) {
      // Same device configured in both slots: visual toggle only
      this._visualToggleState = !this._visualToggleState;
      this.updateDisplay();
      return;
    }

    let target = (current === dev1) ? dev2 : dev1;
    let sinks = getAvailableSinks();
    let targetName = sinks[target] || target.split('.').pop();
    
    // Validate that target device exists
    if (!sinks[target]) {
      if (this.showNotifications) {
        Main.notify("Audio Toggle", `Device ${targetName} not found. Please refresh device list in settings.`);
      }
      return;
    }
    
    // Try to switch device
    let result = runSync(`${PACTL} set-default-sink ${target}`);
    if (result.status !== 0) {
      if (this.showNotifications) {
        Main.notify("Audio Toggle", `Failed to switch to ${targetName}: ${result.err || 'Unknown error'}`);
      }
      return;
    }
    
    // Success - move audio streams and update display
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
      moveAllInputsTo(target);
      this.updateDisplay();
      if (this.showNotifications) {
        Main.notify("Audio Output", `Switched to ${targetName}`);
      }
      return GLib.SOURCE_REMOVE;
    });
  }
};

function main(metadata, orientation, panel_height, instance_id) {
  return new MyApplet(orientation, panel_height, instance_id);
}