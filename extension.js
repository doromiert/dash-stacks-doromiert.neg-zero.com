import Cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Dash from 'resource:///org/gnome/shell/ui/dash.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const CONFIG = {
    popupWidth: 400,
    popupHeight: 300,
    iconSize: 48
};

const CalloutArrow = GObject.registerClass(
class CalloutArrow extends St.DrawingArea {
    _init() {
        super._init({
            width: 24,
            height: 12
        });
    }
    vfunc_repaint() {
        let cr = this.get_context();
        cr.moveTo(0, 0);
        cr.lineTo(24, 0);
        cr.lineTo(12, 12);
        cr.closePath();
        cr.setSourceRGBA(54/255, 54/255, 58/255, 1);
        cr.fill();
    }
});

const StackItem = GObject.registerClass(
class StackItem extends St.Button {
    _init(fileInfo, dirPath, popupRef) {
        super._init({
            style_class: 'stack-item',
            reactive: true,
            track_hover: true,
            width: 84,
            height: 84,
            x_expand: false,
            y_expand: false
        });

        const fileName = fileInfo.get_name();
        this.path = dirPath + '/' + fileName;
        let isDir = fileInfo.get_file_type() === Gio.FileType.DIRECTORY;
        let isApp = fileName.endsWith('.desktop');
        
        let box = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER
        });
        
        let icon = new St.Icon({
            gicon: fileInfo.get_icon(),
            icon_size: CONFIG.iconSize
        });

        let label = new St.Label({
            text: fileName.replace('.desktop', ''),
            style_class: 'stack-item-label',
            style: 'max-width: 68px;'
        });

        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        label.clutter_text.line_wrap = false;

        box.add_child(icon);
        box.add_child(label);
        this.set_child(box);

        this.connect('clicked', () => {
            if (isDir) {
                popupRef._navigate(this.path, fileName);
            } else if (isApp) {
                let app = Gio.DesktopAppInfo.new_from_filename(this.path);
                if (app) app.launch([], null);
                Main.overview.hide();
                popupRef.sourceActor._closePopup();
            } else {
                Gio.AppInfo.launch_default_for_uri('file://' + this.path, null);
                Main.overview.hide();
                popupRef.sourceActor._closePopup();
            }
        });
    }
});

const StackPopup = GObject.registerClass(
class StackPopup extends St.BoxLayout {
    _init(stackConfig, sourceActor) {
        super._init({
            style_class: 'stack-popup-wrapper',
            vertical: true,
            reactive: true,
            width: CONFIG.popupWidth
        });

        this.sourceActor = sourceActor;
        this.history = [{ path: stackConfig.path, name: stackConfig.name }];
        this.set_pivot_point(0.5, 1.0);
        
        let contentBox = new St.BoxLayout({
            style_class: 'stack-popup-content',
            vertical: true,
            height: CONFIG.popupHeight
        });

        this.header = new St.BoxLayout({
            style_class: 'stack-header',
            vertical: false,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER
        });

        this.backBtn = new St.Button({
            child: new St.Icon({ icon_name: 'go-previous-symbolic', icon_size: 16 }),
            style_class: 'stack-back-button',
            reactive: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            opacity: 0 
        });
        this.backBtn.connect('clicked', () => this._goBack());

        this.titleLabel = new St.Label({
            text: stackConfig.name,
            style_class: 'stack-header-title',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER
        });

        this.dummyBtn = new St.Widget({ style_class: 'stack-dummy-button' });

        this.header.add_child(this.backBtn);
        this.header.add_child(this.titleLabel);
        this.header.add_child(this.dummyBtn);
        contentBox.add_child(this.header);

        this.scroll = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            enable_mouse_scrolling: true,
            x_expand: true,
            y_expand: true
        });

        this.grid = new St.BoxLayout({ 
            vertical: true,
            style: 'spacing: 12px;',
            x_expand: true,
            y_expand: true 
        });
        this.scroll.add_child(this.grid);
        contentBox.add_child(this.scroll);

        let arrowContainer = new St.Widget({ width: CONFIG.popupWidth, height: 12 });
        let arrow = new CalloutArrow();
        arrow.set_position((CONFIG.popupWidth / 2) - 12, 0);
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
                let enumerator = dir.enumerate_children('standard::name,standard::icon,standard::type', Gio.FileQueryInfoFlags.NONE, null);
                let info;
                let items = [];
                
                while ((info = enumerator.next_file(null)) != null) {
                    if (info.get_name().startsWith('.')) continue;
                    items.push(new StackItem(info, current.path, this));
                }

                const COLS = 4;
                let currentRow = null;
                items.forEach((item, index) => {
                    if (index % COLS === 0) {
                        currentRow = new St.BoxLayout({ style: 'spacing: 12px;' });
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
});

const StackButton = GObject.registerClass(
class StackButton extends St.Button {
    _init(stackConfig) {
        super._init({
            style_class: 'dash-stack-button dash-item-container',
            reactive: true,
            track_hover: true,
            can_focus: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER
        });

        this.config = stackConfig;
        this.popup = null;
        this._capturedEventId = 0;
        this._isClosing = false;

        this.set_child(new St.Icon({
            icon_name: stackConfig.icon,
            icon_size: 48
        }));

        this.connect('button-press-event', () => {
            this._togglePopup();
            return Clutter.EVENT_STOP;
        });
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
            Math.max(0, x - (CONFIG.popupWidth / 2) + (this.get_width() / 2)),
            y - CONFIG.popupHeight - 16 
        );

        this.popup.ease({
            opacity: 255, scale_x: 1.0, scale_y: 1.0,
            duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD
        });

        this._capturedEventId = global.stage.connect('captured-event', (actor, event) => {
            let type = event.type();
            if (type === Clutter.EventType.KEY_PRESS && event.get_key_symbol() === Clutter.KEY_Escape) {
                this._closePopup();
                return Clutter.EVENT_STOP;
            }

            if (type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN) {
                let [clickX, clickY] = event.get_coords();
                
                // check if click is inside popup box
                let [pX, pY] = this.popup.get_transformed_position();
                let [pW, pH] = this.popup.get_transformed_size();
                let insidePopup = (clickX >= pX && clickX <= pX + pW && clickY >= pY && clickY <= pY + pH);

                // check if click is inside trigger button
                let [bX, bY] = this.get_transformed_position();
                let [bW, bH] = this.get_transformed_size();
                let insideButton = (clickX >= bX && clickX <= bX + bW && clickY >= bY && clickY <= bY + bH);

                if (!insidePopup && !insideButton) {
                    this._closePopup();
                }
            }
            return Clutter.EVENT_PROPAGATE; 
        });
    }

    _closePopup() {
        if (!this.popup || this._isClosing) return;
        this._isClosing = true;

        if (this._capturedEventId) {
            global.stage.disconnect(this._capturedEventId);
            this._capturedEventId = 0;
        }

        this.popup.ease({
            opacity: 0, scale_x: 0.8, scale_y: 0.8,
            duration: 150, mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                this.popup.destroy();
                this.popup = null;
                this._isClosing = false;
            }
        });
    }
});

export default class DashStacksExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        
        // Listen to settings changes so dash updates without needing to restart extension
        this._settingsSignal = this._settings.connect('changed::stacks', () => {
            this._injectStacks();
        });

        this._buttons = [];
        this._originalRedisplay = Main.overview.dash._redisplay;
        
        Main.overview.dash._redisplay = () => {
            this._originalRedisplay.call(Main.overview.dash);
            this._injectStacks();
        };
        
        this._injectStacks();
    }

    _getStacksConfig() {
        try {
            const stacksJson = this._settings.get_string('stacks');
            const stacks = JSON.parse(stacksJson);
            const homeDir = GLib.get_home_dir();
            
            return stacks.map(stack => {
                // Expand the ~/ shortcut to the actual home directory
                if (stack.path && stack.path.startsWith('~/')) {
                    stack.path = homeDir + stack.path.substring(1);
                }
                return stack;
            });
        } catch (e) {
            console.error('[dash-stacks] Failed to parse stacks config:', e);
            return [];
        }
    }

    _injectStacks() {
        // Clear any existing injected buttons
        this._buttons.forEach(b => {
            if (b.popup) b._closePopup();
            b.destroy();
        });
        this._buttons = [];
        
        const stacks = this._getStacksConfig();
        
        stacks.forEach(stack => {
            let btn = new StackButton(stack);
            this._buttons.push(btn);
            Main.overview.dash._box.add_child(btn);
        });
    }

    disable() {
        if (this._settingsSignal) {
            this._settings.disconnect(this._settingsSignal);
            this._settingsSignal = null;
        }
        this._settings = null;

        if (this._originalRedisplay) {
            Main.overview.dash._redisplay = this._originalRedisplay;
            this._originalRedisplay = null;
        }

        this._buttons.forEach(btn => {
            if (btn.popup) btn._closePopup();
            btn.destroy();
        });
        this._buttons = [];
    }
}
