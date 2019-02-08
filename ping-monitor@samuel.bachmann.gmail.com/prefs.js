const Gtk = imports.gi.Gtk;
const Gio = imports.gi.Gio;
const Gdk = imports.gi.Gdk;
const GLib = imports.gi.GLib;
const Clutter = imports.gi.Clutter;
const Lang = imports.lang;

const Gettext = imports.gettext.domain('ping-monitor');

let extension = imports.misc.extensionUtils.getCurrentExtension();
let convenience = extension.imports.convenience;
let Compat = extension.imports.compat;

const _ = Gettext.gettext;
const N_ = function (e) {
    return e;
};

let Schema;

function init() {
    // convenience.initTranslations();
    Schema = convenience.getSettings();
}

String.prototype.capitalize = function () {
    return this.replace(/(^|\s)([a-z])/g, function (m, p1, p2) {
        return p1 + p2.toUpperCase();
    });
};

function color_to_hex(color) {
    var output = N_('#%02x%02x%02x%02x').format(
        255 * color.red,
        255 * color.green,
        255 * color.blue,
        255 * color.alpha);
    return output;
}

const ColorSelect = new Lang.Class({
    Name: 'PingMonitor.ColorSelect',

    _init: function (name) {
        this.label = new Gtk.Label({label: name + _(':')});
        this.picker = new Gtk.ColorButton();
        this.actor = new Gtk.HBox({spacing: 5});
        this.actor.add(this.label);
        this.actor.add(this.picker);
        this.picker.set_use_alpha(true);
    },
    set_value: function (value) {
        let clutterColor = Compat.color_from_string(value);
        let color = new Gdk.RGBA();
        let ctemp = [clutterColor.red, clutterColor.green, clutterColor.blue, clutterColor.alpha / 255];
        color.parse('rgba(' + ctemp.join(',') + ')');
        this.picker.set_rgba(color);
    }
});

const IntSelect = new Lang.Class({
    Name: 'PingMonitor.IntSelect',

    _init: function (name) {
        this.label = new Gtk.Label({label: name + _(':')});
        this.spin = new Gtk.SpinButton();
        this.actor = new Gtk.HBox();
        this.actor.add(this.label);
        this.actor.add(this.spin);
        this.spin.set_numeric(true);
    },
    set_args: function (minv, maxv, incre, page) {
        this.spin.set_range(minv, maxv);
        this.spin.set_increments(incre, page);
    },
    set_value: function (value) {
        this.spin.set_value(value);
    }
});

const Select = new Lang.Class({
    Name: 'PingMonitor.Select',

    _init: function (name) {
        this.label = new Gtk.Label({label: name + _(':')});
        // this.label.set_justify(Gtk.Justification.RIGHT);
        this.selector = new Gtk.ComboBoxText();
        this.actor = new Gtk.HBox({spacing: 5});
        this.actor.add(this.label);
        this.actor.add(this.selector);
    },
    set_value: function (value) {
        this.selector.set_active(value);
    },
    add: function (items) {
        items.forEach(Lang.bind(this, function (item) {
            this.selector.append_text(item);
        }));
    }
});

function set_enum(combo, schema, name) {
    Schema.set_enum(name, combo.get_active());
}

function set_color(color, schema, name) {
    Schema.set_string(name, color_to_hex(color.get_rgba()))
}

function set_string(combo, schema, name, _slist) {
    Schema.set_string(name, _slist[combo.get_active()]);
}

const App = new Lang.Class({
    Name: 'PingMonitor.App',

    _init: function () {
        let keys = Schema.list_keys();

        this.items = [];

        this.main_vbox = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL,
            spacing: 10,
            border_width: 10});
        this.hbox1 = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 20,
            border_width: 10
        });
        this.main_vbox.pack_start(this.hbox1, false, false, 0);
        this.hbox2 = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 20,
            border_width: 10
        });
        this.main_vbox.pack_start(this.hbox2, false, false, 0);

        // Colors
        // Good
        let item = new ColorSelect(_('Good'));
        item.set_value(Schema.get_string('ping-good-color'));
        this.items.push(item);
        this.hbox1.pack_start(item.actor, true, false, 0);
        item.picker.connect('color-set', function (color) {
            set_color(color, Schema, 'ping-good-color');
        });
        // Warning
        item = new ColorSelect(_('Warning'));
        item.set_value(Schema.get_string('ping-warning-color'));
        this.items.push(item);
        this.hbox1.pack_start(item.actor, true, false, 0);
        item.picker.connect('color-set', function (color) {
            set_color(color, Schema, 'ping-warning-color');
        });
        // Bad
        item = new ColorSelect(_('Bad'));
        item.set_value(Schema.get_string('ping-bad-color'));
        this.items.push(item);
        this.hbox1.pack_start(item.actor, true, false, 0);
        item.picker.connect('color-set', function (color) {
            set_color(color, Schema, 'ping-bad-color');
        });
        // Loss
        item = new ColorSelect(_('Loss'));
        item.set_value(Schema.get_string('ping-loss-color'));
        this.items.push(item);
        this.hbox1.pack_start(item.actor, true, false, 0);
        item.picker.connect('color-set', function (color) {
            set_color(color, Schema, 'ping-loss-color');
        });

        // Config path
        item = new Gtk.Label({label: 'Configuration path'});
        this.hbox2.add(item);
        // File chooser
        item = new Gtk.FileChooserButton({title: _('Open configuration file')});
        item.set_current_folder(GLib.getenv('HOME') + '/.config');
        item.set_filename(Schema.get_string('ping-config-path'));
        this.items.push(item);
        this.hbox2.add(item);
        item.connect('file-set',Lang.bind(this, function (button) {
            let path = button.get_filename();
            let oldPath = Schema.get_string('ping-config-path');
            if (path !== oldPath) {
                Schema.set_string('ping-config-path', path);
            }
        }));

        this.main_vbox.show_all();
    }
});

function buildPrefsWidget() {
    let widget = new App();
    return widget.main_vbox;
}
