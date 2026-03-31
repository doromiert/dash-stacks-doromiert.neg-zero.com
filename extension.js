import * as DND from "resource:///org/gnome/shell/ui/dnd.js";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Pango from "gi://Pango";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

const CONFIG = {
  popupWidth: 400,
  popupHeight: 300,
  iconSize: 48,
  tooltipDelay: 500, // ms
};

const StackTooltip = GObject.registerClass(
  class StackTooltip extends St.Label {
    _init(text) {
      super._init({
        text,
        style_class: "dash-label stack-tooltip",
        visible: false,
        y_align: Clutter.ActorAlign.CENTER,
      });
      // fix for "glitchy" text: ensure pango doesn't clip
      this.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
      this.clutter_text.line_wrap = false;
      Main.layoutManager.addTopChrome(this);
    }

    show_for_actor(actor) {
      const [x, y] = actor.get_transformed_position();
      const [w, h] = actor.get_transformed_size();

      this.opacity = 0;
      this.show();

      const labelWidth = this.get_width();
      this.set_position(
        Math.floor(x + w / 2 - labelWidth / 2),
        Math.floor(y - this.get_height() - 8),
      );

      this.ease({
        opacity: 255,
        duration: 150,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      });
    }

    hide_tooltip() {
      this.ease({
        opacity: 0,
        duration: 100,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete: () => this.hide(),
      });
    }
  },
);

const CalloutArrow = GObject.registerClass(
  class CalloutArrow extends St.DrawingArea {
    _init() {
      super._init({
        width: 24,
        height: 12,
      });
    }
    vfunc_repaint() {
      let cr = this.get_context();
      cr.moveTo(0, 0);
      cr.lineTo(24, 0);
      cr.lineTo(12, 12);
      cr.closePath();
      cr.setSourceRGBA(54 / 255, 54 / 255, 58 / 255, 1);
      cr.fill();
    }
  },
);

const StackItem = GObject.registerClass(
  class StackItem extends St.Button {
    _init(fileInfo, dirPath, popupRef) {
      super._init({
        style_class: "stack-item",
        reactive: true,
        track_hover: true,
        width: 84,
        height: 84,
        x_expand: false,
        y_expand: false,
      });

      const fileName = fileInfo.get_name();
      this.path = dirPath + "/" + fileName;
      let isDir = fileInfo.get_file_type() === Gio.FileType.DIRECTORY;
      let isApp = fileName.endsWith(".desktop");

      let box = new St.BoxLayout({
        vertical: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
      });

      let icon = new St.Icon({
        gicon: fileInfo.get_icon(),
        icon_size: CONFIG.iconSize,
      });

      let label = new St.Label({
        text: fileName.replace(".desktop", ""),
        style_class: "stack-item-label",
        style: "max-width: 68px;",
      });

      label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
      label.clutter_text.line_wrap = false;

      box.add_child(icon);
      box.add_child(label);
      this.set_child(box);

      this.connect("clicked", () => {
        if (isDir) {
          popupRef._navigate(this.path, fileName);
        } else if (isApp) {
          let app = Gio.DesktopAppInfo.new_from_filename(this.path);
          if (app) app.launch([], null);
          Main.overview.hide();
          popupRef.sourceActor._closePopup();
        } else {
          Gio.AppInfo.launch_default_for_uri("file://" + this.path, null);
          Main.overview.hide();
          popupRef.sourceActor._closePopup();
        }
      });
      // Make the file draggable
      this._delegate = this;
      let draggable = DND.makeDraggable(this, {
        restoreOnSuccess: false,
        manualMode: false,
      });

      draggable.connect("drag-begin", () => {
        let fileUri = Gio.File.new_for_path(
          dirPath + "/" + fileInfo.get_name(),
        ).get_uri();
        let clipboard = St.Clipboard.get_default();
        clipboard.set_text(St.ClipboardType.CLIPBOARD, fileUri + "\r\n");

        if (popupRef && popupRef.sourceActor) {
          popupRef.sourceActor._closePopup();
        }
      });

      draggable.connect("drag-end", () => {
        let fileName = fileInfo.get_name();
        let filePath = dirPath + "/" + fileName;

        try {
          if (fileName.endsWith(".desktop")) {
            let appInfo = Gio.DesktopAppInfo.new_from_filename(filePath);
            if (appInfo) appInfo.launch([], null);
          } else {
            let file = Gio.File.new_for_path(filePath);
            Gio.AppInfo.launch_default_for_uri_async(
              file.get_uri(),
              null,
              null,
              null,
            );
          }
        } catch (e) {
          console.error(
            `Dash Stacks: Failed to open dragged item - ${e.message}`,
          );
        }
      });
    }
  },
);

const StackPopup = GObject.registerClass(
  class StackPopup extends St.BoxLayout {
    _init(stackConfig, sourceActor) {
      super._init({
        style_class: "stack-popup-wrapper",
        vertical: true,
        reactive: true,
        width: CONFIG.popupWidth,
      });

      this.sourceActor = sourceActor;
      this.history = [{ path: stackConfig.path, name: stackConfig.name }];
      this.set_pivot_point(0.5, 1.0);

      let contentBox = new St.BoxLayout({
        style_class: "stack-popup-content",
        vertical: true,
        height: CONFIG.popupHeight,
      });

      this.header = new St.BoxLayout({
        style_class: "stack-header",
        vertical: false,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
      });

      this.backBtn = new St.Button({
        child: new St.Icon({
          icon_name: "go-previous-symbolic",
          icon_size: 16,
        }),
        style_class: "stack-back-button",
        reactive: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        opacity: 0,
      });
      this.backBtn.connect("clicked", () => this._goBack());

      this.titleLabel = new St.Label({
        text: stackConfig.name,
        style_class: "stack-header-title",
        x_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
      });

      this.nautilusBtn = new St.Button({
        child: new St.Icon({
          icon_name: "folder-open-symbolic",
          icon_size: 16,
        }),
        style_class: "stack-nautilus-button",
        reactive: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
      });

      this.nautilusBtn.connect("clicked", () => {
        let current = this.history[this.history.length - 1];
        Gio.AppInfo.launch_default_for_uri("file://" + current.path, null);

        this.sourceActor._closePopup();
        Main.overview.hide();
      });

      this.header.add_child(this.backBtn);
      this.header.add_child(this.titleLabel);
      this.header.add_child(this.nautilusBtn);
      contentBox.add_child(this.header);

      this.scroll = new St.ScrollView({
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.AUTOMATIC,
        enable_mouse_scrolling: true,
        overlay_scrollbars: true,
        x_expand: true,
        y_expand: true,
      });

      let touchStartY = null;
      let lastTouchY = null;
      let lastTouchTime = null;
      let velocity = 0;
      let isDragging = false;

      this.scroll.connect("captured-event", (actor, event) => {
        let type = event.type();

        if (type === Clutter.EventType.TOUCH_BEGIN) {
          this.scroll.vadjustment.remove_transition("value");

          let [x, y] = event.get_coords();
          touchStartY = y;
          lastTouchY = y;
          lastTouchTime = Date.now();
          velocity = 0;
          isDragging = false;
          return Clutter.EVENT_PROPAGATE;
        }

        if (type === Clutter.EventType.TOUCH_UPDATE) {
          if (touchStartY === null) return Clutter.EVENT_PROPAGATE;

          let [x, y] = event.get_coords();
          let dy = lastTouchY - y;
          let now = Date.now();
          let timeSinceLastFrame = now - lastTouchTime;

          if (!isDragging && Math.abs(touchStartY - y) > 10) {
            isDragging = true;
          }

          if (isDragging) {
            if (timeSinceLastFrame > 0) velocity = dy / timeSinceLastFrame;

            this.scroll.vadjustment.value += dy;
            lastTouchY = y;
            lastTouchTime = now;
            return Clutter.EVENT_STOP;
          }
        }

        if (
          type === Clutter.EventType.TOUCH_END ||
          type === Clutter.EventType.TOUCH_CANCEL
        ) {
          touchStartY = null;

          if (isDragging) {
            isDragging = false;

            if (Math.abs(velocity) > 0.5) {
              let amplitude = velocity * 400; // How far it glides
              let targetValue = this.scroll.vadjustment.value + amplitude;

              let lower = this.scroll.vadjustment.lower;
              let upper =
                this.scroll.vadjustment.upper -
                this.scroll.vadjustment.page_size;
              targetValue = Math.max(lower, Math.min(targetValue, upper));

              this.scroll.vadjustment.ease(targetValue, {
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                duration: 800, // ms
              });
            }
            return Clutter.EVENT_STOP;
          }
        }

        return Clutter.EVENT_PROPAGATE;
      });

      this.grid = new St.BoxLayout({
        vertical: true,
        style: "spacing: 12px;",
        x_expand: true,
        y_expand: true,
      });
      this.scroll.add_child(this.grid);
      contentBox.add_child(this.scroll);

      let arrowContainer = new St.Widget({
        width: CONFIG.popupWidth,
        height: 12,
      });
      let arrow = new CalloutArrow();
      arrow.set_position(CONFIG.popupWidth / 2 - 12, 0);
      arrowContainer.add_child(arrow);

      this.add_child(contentBox);
      this.add_child(arrowContainer);

      this._updateView();
    }

    _navigate(path, name) {
      this.history.push({ path, name });
      this._updateView();
    }

    _goBack() {
      if (this.history.length > 1) {
        this.history.pop();
        this._updateView();
      }
    }

    _updateView() {
      let current = this.history[this.history.length - 1];
      this.titleLabel.set_text(current.name);

      let isRoot = this.history.length === 1;
      this.backBtn.opacity = isRoot ? 0 : 255;
      this.backBtn.reactive = !isRoot;

      this.grid.destroy_all_children();

      GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        let dir = Gio.File.new_for_path(current.path);
        try {
          let enumerator = dir.enumerate_children(
            "standard::name,standard::icon,standard::type",
            Gio.FileQueryInfoFlags.NONE,
            null,
          );
          let info;
          let items = [];

          while ((info = enumerator.next_file(null)) != null) {
            if (info.get_name().startsWith(".")) continue;
            items.push(new StackItem(info, current.path, this));
          }

          const COLS = 4;
          let currentRow = null;
          items.forEach((item, index) => {
            if (index % COLS === 0) {
              currentRow = new St.BoxLayout({ style: "spacing: 12px;" });
              this.grid.add_child(currentRow);
            }
            currentRow.add_child(item);
          });
        } catch (e) {
          console.error(`[dash-stacks] error: ${e}`);
        }
        return GLib.SOURCE_REMOVE;
      });
    }
  },
);

const StackButton = GObject.registerClass(
  class StackButton extends St.Button {
    _init(stackConfig, settings, index) {
      super._init({
        style_class: "dash-stack-button dash-item-container",
        reactive: true,
        track_hover: true,
        can_focus: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
      });

      this.config = stackConfig;
      this._settings = settings;
      this._index = index;
      this._tooltipTimeoutId = 0;

      this.set_child(
        new St.Icon({
          icon_name: stackConfig.icon,
          icon_size: 64,
        }),
      );

      this.tooltip = new StackTooltip(stackConfig.name);

      this.connect("notify::hover", () => {
        if (this.hover) {
          this._tooltipTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            CONFIG.tooltipDelay,
            () => {
              this.tooltip.show_for_actor(this);
              this._tooltipTimeoutId = 0;
              return GLib.SOURCE_REMOVE;
            },
          );
        } else {
          if (this._tooltipTimeoutId > 0) {
            GLib.source_remove(this._tooltipTimeoutId);
            this._tooltipTimeoutId = 0;
          }
          this.tooltip.hide_tooltip();
        }
      });

      this._menuManager = new PopupMenu.PopupMenuManager(this);
      this._menu = new PopupMenu.PopupMenu(this, 0.5, St.Side.BOTTOM);
      this._menu.actor.add_style_class_name("dash-stacks-context-menu");
      this._menuManager.addMenu(this._menu);
      Main.uiGroup.add_child(this._menu.actor);
      this._menu.actor.hide();

      this._buildMenu();

      this.connect("button-press-event", (actor, event) => {
        const button = event.get_button();
        if (button === 1) {
          this._togglePopup();
          return Clutter.EVENT_STOP;
        } else if (button === 3) {
          this.tooltip.hide_tooltip();
          this._menu.toggle();
          return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
      });
    }

    _createHeader(title) {
      let item = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false,
      });

      let headerBox = new St.BoxLayout({
        style_class: "menu-header",
        x_expand: true,
      });

      let label = new St.Label({
        text: title,
        style_class: "header-text",
      });

      let line = new St.Widget({
        style_class: "header-line",
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
      });

      headerBox.add_child(label);
      headerBox.add_child(line);

      item.add_child(headerBox);
      return item;
    }

    _buildMenu() {
      this._menu.removeAll();

      // 1. Rename Section
      this._menu.addMenuItem(this._createHeader("Rename"));

      let nameItem = new PopupMenu.PopupBaseMenuItem({
        reactive: true, // reactive so the whole row is a hit-target
        can_focus: true,
        style_class: "menu-input-row",
      });

      let nameEntry = new St.Entry({
        text: this.config.name,
        style_class: "menu-entry",
        x_expand: true,
      });
      nameEntry.set_x_align(Clutter.ActorAlign.FILL);

      // Transfer focus to entry if the row is clicked
      nameItem.connect("button-press-event", () => {
        nameEntry.grab_key_focus();
        return Clutter.EVENT_STOP;
      });

      nameEntry.clutter_text.connect("activate", () => {
        this._updateConfig("name", nameEntry.get_text());
        this._menu.close();
      });

      nameItem.add_child(nameEntry);
      this._menu.addMenuItem(nameItem);

      // 2. Icon Section
      this._menu.addMenuItem(this._createHeader("Change Icon"));

      let iconItem = new PopupMenu.PopupBaseMenuItem({
        reactive: true,
        can_focus: true,
        style_class: "menu-input-row",
      });

      let iconEntry = new St.Entry({
        text: this.config.icon,
        style_class: "menu-entry",
        x_expand: true,
      });
      iconEntry.set_x_align(Clutter.ActorAlign.FILL);

      iconItem.connect("button-press-event", () => {
        iconEntry.grab_key_focus();
        return Clutter.EVENT_STOP;
      });

      iconEntry.clutter_text.connect("activate", () => {
        this._updateConfig("icon", iconEntry.get_text());
        this._menu.close();
      });

      iconItem.add_child(iconEntry);
      this._menu.addMenuItem(iconItem);

      // 3. Delete
      this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      let deleteItem = new PopupMenu.PopupMenuItem("Delete Stack");
      deleteItem.add_style_class_name("destruct-button");
      deleteItem.connect("activate", () => this._deleteSelf());
      this._menu.addMenuItem(deleteItem);
    }
    _updateConfig(key, value) {
      let stacks = JSON.parse(this._settings.get_string("stacks"));
      if (stacks[this._index]) {
        stacks[this._index][key] = value;
        this._settings.set_string("stacks", JSON.stringify(stacks));
      }
    }

    _deleteSelf() {
      let stacks = JSON.parse(this._settings.get_string("stacks"));
      stacks.splice(this._index, 1);
      this._settings.set_string("stacks", JSON.stringify(stacks));
    }

    _togglePopup() {
      if (this.popup) {
        this._closePopup();
        return;
      }

      this.popup = new StackPopup(this.config, this);
      this.popup.opacity = 0;
      this.popup.scale_x = 0.8;
      this.popup.scale_y = 0.8;

      Main.layoutManager.uiGroup.add_child(this.popup);

      let [x, y] = this.get_transformed_position();
      this.popup.set_position(
        Math.max(0, x - CONFIG.popupWidth / 2 + this.get_width() / 2),
        y - CONFIG.popupHeight - 16,
      );

      this.popup.ease({
        opacity: 255,
        scale_x: 1.0,
        scale_y: 1.0,
        duration: 200,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      });

      this._capturedEventId = global.stage.connect(
        "captured-event",
        (actor, event) => {
          let type = event.type();
          if (
            type === Clutter.EventType.KEY_PRESS &&
            event.get_key_symbol() === Clutter.KEY_Escape
          ) {
            this._closePopup();
            return Clutter.EVENT_STOP;
          }

          if (
            type === Clutter.EventType.BUTTON_PRESS ||
            type === Clutter.EventType.TOUCH_BEGIN
          ) {
            let [clickX, clickY] = event.get_coords();
            let [pX, pY] = this.popup.get_transformed_position();
            let [pW, pH] = this.popup.get_transformed_size();
            let insidePopup =
              clickX >= pX &&
              clickX <= pX + pW &&
              clickY >= pY &&
              clickY <= pY + pH;
            let [bX, bY] = this.get_transformed_position();
            let [bW, bH] = this.get_transformed_size();
            let insideButton =
              clickX >= bX &&
              clickX <= bX + bW &&
              clickY >= bY &&
              clickY <= bY + bH;

            if (!insidePopup && !insideButton) this._closePopup();
          }
          return Clutter.EVENT_PROPAGATE;
        },
      );
    }

    _closePopup() {
      if (!this.popup || this._isClosing) return;
      this._isClosing = true;

      if (this._capturedEventId) {
        global.stage.disconnect(this._capturedEventId);
        this._capturedEventId = 0;
      }

      this.popup.ease({
        opacity: 0,
        scale_x: 0.8,
        scale_y: 0.8,
        duration: 150,
        mode: Clutter.AnimationMode.EASE_IN_QUAD,
        onComplete: () => {
          this.popup.destroy();
          this.popup = null;
          this._isClosing = false;
        },
      });
    }

    destroy() {
      if (this._tooltipTimeoutId > 0)
        GLib.source_remove(this._tooltipTimeoutId);
      this.tooltip.destroy();
      this._menu.destroy();
      super.destroy();
    }
  },
);

export default class DashStacksExtension extends Extension {
  enable() {
    this._settings = this.getSettings();
    this._settingsSignal = this._settings.connect("changed::stacks", () => {
      this._injectStacks();
    });

    this._buttons = [];
    this._boxSignals = [];

    let dash = Main.overview.dash;
    this._originalRedisplay = dash._redisplay;
    this._overviewHidingId = Main.overview.connect("hiding", () => {
      this._buttons.forEach((btn) => {
        if (btn.popup) btn._closePopup();
      });
    });

    dash._redisplay = () => {
      this._originalRedisplay.call(dash);
      this._injectStacks();
      if (
        this.masterLayout &&
        dash.showAppsButton.get_parent() !== this.masterLayout
      ) {
        dash._box.remove_child(dash.showAppsButton);
        this.masterLayout.add_child(dash.showAppsButton);
      }
    };

    if (dash._box) {
      this._boxSignals.push(
        dash._box.connect("child-added", () => this._enforceLayout()),
      );
      this._boxSignals.push(
        dash._box.connect("child-removed", () => this._enforceLayout()),
      );
    }

    this._injectStacks();

    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      let dash = Main.overview.dash;
      let dashBox = dash._box;
      let dashParent = dashBox.get_parent();

      if (this.dashScroll) return GLib.SOURCE_REMOVE;

      this.masterLayout = new St.BoxLayout({
        style_class: "dash-scroll-master",
        vertical: false,
        x_expand: true,
        y_expand: false,
        reactive: true,
      });

      this.dashScroll = new St.ScrollView({
        style_class: "dash-scroll-view",
        hscrollbar_policy: St.PolicyType.EXTERNAL,
        vscrollbar_policy: St.PolicyType.NEVER,
        overlay_scrollbars: true,
        enable_mouse_scrolling: true,
        x_expand: true,
        y_expand: false,
        height: 96,
      });

      this.dashWrapper = new St.BoxLayout({
        style_class: "dash-scroll-wrapper",
        vertical: false,
        x_expand: false,
        y_expand: true,
        height: 96,
      });

      this.dashScroll.reactive = true;
      this.dashWrapper.reactive = true;

      let dashTouchStartX = null;
      let dashLastTouchX = null;
      let dashIsDragging = false;

      this.dashScroll.connect("captured-event", (actor, event) => {
        let type = event.type();
        let adj = this.dashScroll.hadjustment;

        if (type === Clutter.EventType.SCROLL) {
          let direction = event.get_scroll_direction();
          let scrollAmount = 76;
          if (direction === Clutter.ScrollDirection.SMOOTH) {
            let [dx, dy] = event.get_scroll_delta();
            let delta = Math.abs(dx) > Math.abs(dy) ? dx : dy;
            adj.value += delta * 30;
          } else if (
            direction === Clutter.ScrollDirection.UP ||
            direction === Clutter.ScrollDirection.LEFT
          ) {
            adj.value -= scrollAmount;
          } else if (
            direction === Clutter.ScrollDirection.DOWN ||
            direction === Clutter.ScrollDirection.RIGHT
          ) {
            adj.value += scrollAmount;
          }
          return Clutter.EVENT_STOP;
        }

        if (type === Clutter.EventType.TOUCH_BEGIN) {
          let [x, y] = event.get_coords();
          dashTouchStartX = x;
          dashLastTouchX = x;
          dashIsDragging = false;
          return Clutter.EVENT_PROPAGATE;
        }

        if (type === Clutter.EventType.TOUCH_UPDATE) {
          if (dashTouchStartX === null) return Clutter.EVENT_PROPAGATE;
          let [x, y] = event.get_coords();
          let dx = dashLastTouchX - x;
          if (!dashIsDragging && Math.abs(dashTouchStartX - x) > 10)
            dashIsDragging = true;
          if (dashIsDragging) {
            adj.value += dx;
            dashLastTouchX = x;
            return Clutter.EVENT_STOP;
          }
        }

        if (
          type === Clutter.EventType.TOUCH_END ||
          type === Clutter.EventType.TOUCH_CANCEL
        ) {
          dashTouchStartX = null;
          if (dashIsDragging) {
            dashIsDragging = false;
            return Clutter.EVENT_STOP;
          }
        }
        return Clutter.EVENT_PROPAGATE;
      });

      let showApps = dash.showAppsButton;
      dashBox.remove_child(showApps);

      dashParent.remove_child(dashBox);
      this.dashWrapper.add_child(dashBox);
      this.dashScroll.set_child(this.dashWrapper);

      this.masterLayout.add_child(this.dashScroll);
      this.masterLayout.add_child(showApps);

      dashParent.insert_child_at_index(this.masterLayout, 0);

      this._updateMaxWidth = () => {
        let monitor = Main.layoutManager.currentMonitor;
        // Padding: 76*2 (edges) + 80 (approx space for All Apps button)
        let maxWidth = monitor.width - 76 * 2 - 80;
        this.dashScroll.style = `max-width: ${maxWidth}px;`;
      };

      this._updateMaxWidth();
      this._monitorsChangedId = Main.layoutManager.connect(
        "monitors-changed",
        () => this._updateMaxWidth(),
      );

      return GLib.SOURCE_REMOVE;
    });
  }

  _injectStacks() {
    this._buttons.forEach((b) => {
      if (b.popup) b._closePopup();
      b.destroy();
    });
    this._buttons = [];

    const stacks = this._getStacksConfig();
    if (stacks.length === 0) return;

    let separator = new St.Widget({
      style_class: "dash-stacks-separator",
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._buttons.push(separator);
    Main.overview.dash._box.add_child(separator);

    stacks.forEach((stack, index) => {
      let btn = new StackButton(stack, this._settings, index);
      this._buttons.push(btn);
      Main.overview.dash._box.add_child(btn);
    });
  }

  _enforceLayout() {
    if (this._enforceTimeoutId) {
      GLib.source_remove(this._enforceTimeoutId);
    }

    this._enforceTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
      let dash = Main.overview.dash;
      // We check dash._box directly now
      if (!this.dashWrapper || !dash._box) {
        this._enforceTimeoutId = null;
        return GLib.SOURCE_REMOVE;
      }

      let totalWidth = 0;
      dash._box.layout_manager.spacing = 0;

      dash._box.get_children().forEach((c) => {
        // Skip the ghost/null children if any
        if (!c) return;

        c.x_expand = false;
        let isSepC = c.style_class && c.style_class.includes("separator");
        let child = c.get_first_child ? c.get_first_child() : null;
        let isSepChild =
          child && child.style_class && child.style_class.includes("separator");

        if (child) {
          child.x_expand = false;
          if (isSepC || isSepChild) {
            c.set_width(1);
            child.set_width(1);
            child.set_margin_left(6);
            child.set_margin_right(6);
            totalWidth += 13;
          } else {
            c.set_width(80);
            child.set_width(76);
            totalWidth += 80;
          }
        } else {
          if (isSepC) {
            c.set_width(1);
            totalWidth += 13;
          } else {
            c.set_width(0);
          }
        }
      });

      dash._box.set_width(totalWidth);
      this.dashWrapper.set_width(totalWidth);

      this._enforceTimeoutId = null;
      return GLib.SOURCE_REMOVE;
    });
    let paddingForShowApps = 80;

    dash._box.set_width(totalWidth + paddingForShowApps);
    this.dashWrapper.set_width(totalWidth + paddingForShowApps);
  }

  _getStacksConfig() {
    try {
      const stacksJson = this._settings.get_string("stacks");
      const stacks = JSON.parse(stacksJson);
      const homeDir = GLib.get_home_dir();
      return stacks.map((stack) => {
        if (stack.path && stack.path.startsWith("~/"))
          stack.path = homeDir + stack.path.substring(1);
        return stack;
      });
    } catch (e) {
      return [];
    }
  }

  disable() {
    if (this._monitorsChangedId) {
      Main.layoutManager.disconnect(this._monitorsChangedId);
      this._monitorsChangedId = null;
    }

    if (this._settingsSignal) this._settings.disconnect(this._settingsSignal);
    this._settings = null;

    if (this._originalRedisplay)
      Main.overview.dash._redisplay = this._originalRedisplay;

    if (this._overviewHidingId)
      Main.overview.disconnect(this._overviewHidingId);

    this._buttons.forEach((btn) => btn.destroy());
    this._buttons = [];

    if (this._boxSignals) {
      let dash = Main.overview.dash;
      if (dash && dash._box)
        this._boxSignals.forEach((id) => dash._box.disconnect(id));
      this._boxSignals = [];
    }

    if (this.dashScroll) {
      let dash = Main.overview.dash;
      let dashParent = this.masterLayout.get_parent();

      if (dashParent) {
        this.dashWrapper.remove_child(dash._box);

        this.masterLayout.remove_child(dash.showAppsButton);
        dash._box.add_child(dash.showAppsButton);

        dashParent.insert_child_at_index(dash._box, 0);
        dashParent.remove_child(this.masterLayout);
      }

      dash._box.set_width(-1);

      this.dashWrapper.destroy();
      this.dashScroll.destroy();
      this.masterLayout.destroy();

      this.dashScroll = null;
      this.dashWrapper = null;
      this.masterLayout = null;
    }
  }
}
