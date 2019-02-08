/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

// ping-monitor: Gnome shell extension displaying ping informations in gnome shell status bar.
// Copyright (C) 2019 Samuel Bachmann, samuel.bachmann@gmail.com

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Author: Samuel Bachmann aka samuelba

/* Ugly. This is here so that we don't crash old libnm-glib based shells unnecessarily
 * by loading the new libnm.so. Should go away eventually */
const libnm_glib = imports.gi.GIRepository.Repository.get_default().is_registered('NMClient', '1.0');

let debugOutput = false;
let smDepsGtop = true;

const Config = imports.misc.config;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;

const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Power = imports.ui.status.power;
// const System = imports.system;
const ModalDialog = imports.ui.modalDialog;

const ExtensionSystem = imports.ui.extensionSystem;
const ExtensionUtils = imports.misc.extensionUtils;

const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const Compat = Me.imports.compat;

let Background, GTop, IconSize, Locale, Schema, StatusArea, Style, menu_timeout;

try {
  GTop = imports.gi.GTop;
} catch (e) {
  log('[Ping monitor] catched error: ' + e);
  smDepsGtop = false;
}

const Main = imports.ui.main;
const Panel = imports.ui.panel;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const Gettext = imports.gettext.domain('ping-monitor');
const Mainloop = imports.mainloop;
const Util = imports.misc.util;
const _ = Gettext.gettext;

const MESSAGE = _('Dependencies Missing\n\
Please install: \n\
libgtop and gir bindings\n\
\t    on Ubuntu: gir1.2-gtop-2.0\n\
\t    on Fedora: libgtop2-devel\n\
\t    on Arch: libgtop\n\
\t    on openSUSE: typelib-1_0-GTop-2_0\n');

// stale network shares will cause the shell to freeze, enable this with caution
const ENABLE_NETWORK_DISK_USAGE = false;

let extension = imports.misc.extensionUtils.getCurrentExtension();
let metadata = extension.metadata;
let shell_Version = Config.PACKAGE_VERSION;

function print_info(str) {
  log('[Ping monitor INFO] ' + str);
}

function print_debug(str) {
  if (debugOutput) {
    log('[Ping monitor DEBUG] ' + str);
  }
}

function l_limit(t) {
  return (t > 0) ? t : 1000;
}

function change_text() {
  print_debug('change_text()');

  this.label.visible = this.show_name;
}

function change_style() {
  print_debug('change_style()');

  this.text_box.visible = true;
  this.chart.actor.visible = this.visible;
}

function build_menu_info() {
  print_debug('build_menu_info()');

  let elts = Main.__sm.elts;
  let tray_menu = Main.__sm.tray.menu;

  if (tray_menu._getMenuItems().length &&
    typeof tray_menu._getMenuItems()[0].actor.get_last_child() !== 'undefined') {
    tray_menu._getMenuItems()[0].actor.get_last_child().destroy_all_children();
    for (let elt in elts) {
      elts[elt].menu_items = elts[elt].create_menu_items();
    }
  } else {
    return;
  }

  let menu_info_box_table = new St.Widget({
    style: 'padding: 10px 0px 10px 0px; spacing-rows: 10px; spacing-columns: 15px;',
    layout_manager: new Clutter.TableLayout()
  });
  let menu_info_box_table_layout = menu_info_box_table.layout_manager;

  // Populate Table
  let row_index = 0;
  for (let elt in elts) {
    if (!elts[elt].menu_visible) {
      continue;
    }

    // Add item name to table
    menu_info_box_table_layout.pack(
      new St.Label({
        text: elts[elt].name,
        style_class: Style.get('sm-title')
      }), 0, row_index);

    // Add item data to table
    let col_index = 1;
    for (let item in elts[elt].menu_items) {
      menu_info_box_table_layout.pack(
        elts[elt].menu_items[item], col_index, row_index);

      col_index++;
    }

    row_index++;
  }
  tray_menu._getMenuItems()[0].actor.get_last_child().add(menu_info_box_table, {expand: true});
}

function change_menu() {
  print_debug('change_menu()');

  this.menu_visible = true;
  build_menu_info();
}

let color_from_string = Compat.color_from_string;

const smStyleManager = new Lang.Class({
  Name: 'PingMonitor.smStyleManager',
  _extension: '',
  _iconsize: 1,
  _diskunits: _('MiB/s'),
  _netunits_kbytes: _('KiB/s'),
  _netunits_mbytes: _('MiB/s'),
  _netunits_kbits: _('kbit/s'),
  _netunits_mbits: _('Mbit/s'),
  _pie_width: 300,
  _pie_height: 300,
  _pie_fontsize: 14,
  _bar_width: 300,
  _bar_height: 150,
  _bar_fontsize: 14,
  _text_scaling: 1,

  _init: function () {
    print_debug('smStyleManager _init()');

    let interfaceSettings = new Gio.Settings({
      schema: 'org.gnome.desktop.interface'
    });
    this._text_scaling = interfaceSettings.get_double('text-scaling-factor');
    if (!this._text_scaling) {
      this._text_scaling = 1;
    }
  },
  get: function (style) {
    return style + this._extension;
  },
  iconsize: function () {
    return this._iconsize;
  },
  diskunits: function () {
    return this._diskunits;
  },
  netunits_kbytes: function () {
    return this._netunits_kbytes;
  },
  netunits_mbytes: function () {
    return this._netunits_mbytes;
  },
  netunits_kbits: function () {
    return this._netunits_kbits;
  },
  netunits_mbits: function () {
    return this._netunits_mbits;
  },
  pie_width: function () {
    return this._pie_width;
  },
  pie_height: function () {
    return this._pie_height;
  },
  pie_fontsize: function () {
    return this._pie_fontsize * this._text_scaling;
  },
  bar_width: function () {
    return this._bar_width;
  },
  bar_height: function () {
    return this._bar_height;
  },
  bar_fontsize: function () {
    return this._bar_fontsize * this._text_scaling;
  },
  text_scaling: function () {
    return this._text_scaling;
  },
});

const smDialog = Lang.Class({
  Name: 'PingMonitor.smDialog',
  Extends: ModalDialog.ModalDialog,

  _init: function () {
    print_debug('smDialog _init()');

    this.parent({styleClass: 'prompt-dialog'});
    let mainContentBox = new St.BoxLayout({
      style_class: 'prompt-dialog-main-layout',
      vertical: false
    });
    this.contentLayout.add(mainContentBox,
      {
        x_fill: true,
        y_fill: true
      });

    let messageBox = new St.BoxLayout({
      style_class: 'prompt-dialog-message-layout',
      vertical: true
    });
    mainContentBox.add(messageBox,
      {y_align: St.Align.START});

    this._subjectLabel = new St.Label({
      style_class: 'prompt-dialog-headline',
      text: _('Ping Monitor Extension')
    });

    messageBox.add(this._subjectLabel,
      {
        y_fill: false,
        y_align: St.Align.START
      });

    this._descriptionLabel = new St.Label({
      style_class: 'prompt-dialog-description',
      text: MESSAGE
    });

    messageBox.add(this._descriptionLabel,
      {
        y_fill: true,
        y_align: St.Align.START
      });


    this.setButtons([
      {
        label: _('Cancel'),
        action: Lang.bind(this, function () {
          this.close();
        }),
        key: Clutter.Escape
      }
    ]);
  },

});

const StatusSquare = new Lang.Class({
  Name: 'PingMonitor.StatusSquare',

  _width: 10,
  _color: '#ff0000',
  _activityState: 0,
  _activityWidth: 4,
  _isPingUpdate: false,

  _init: function (height, parent) {
    print_debug('StatusSquare _init()');

    this.actor = new St.DrawingArea({style_class: Style.get('sm-chart'), reactive: false});
    this.parentC = parent;
    this.actor.set_width(this._width);
    this.actor.set_height(this.height = height);
    this.actor.connect('repaint', Lang.bind(this, this._draw));
    this.data = [];
  },
  update: function (color, isPingUpdate) {
    print_debug('StatusSquare update()');

    this._color = color;
    this._isPingUpdate = isPingUpdate;

    if (!this.actor.visible) {
      return;
    }
    this.actor.queue_repaint();
  },
  _draw: function () {
    print_debug('StatusSquare _draw()');

    if (!this.actor.visible) {
      return;
    }
    let [width, height] = this.actor.get_surface_size();

    // Draw ping status.
    let cr = this.actor.get_context();
    Clutter.cairo_set_source_color(cr, color_from_string(this._color));
    cr.rectangle(0, (height - this._width) / 2, this._width, this._width);
    cr.fill();

    // Draw activity state.
    Clutter.cairo_set_source_color(cr, color_from_string('#000000'));
    switch (this._activityState) {
      case 0:
        cr.rectangle(0, (height - this._width) / 2,
          this._activityWidth, this._activityWidth);
        // this._activityState = 1;
        break;
      case 1:
        cr.rectangle(this._width - this._activityWidth, (height - this._width) / 2,
          this._activityWidth, this._activityWidth);
        // this._activityState = 2;
        break;
      case 2:
        cr.rectangle(this._width - this._activityWidth, (height - this._width) / 2 + this._width - this._activityWidth,
          this._activityWidth, this._activityWidth);
        // this._activityState = 3;
        break;
      case 3:
        cr.rectangle(0, (height - this._width) / 2 + this._width - this._activityWidth,
          this._activityWidth, this._activityWidth);
        // this._activityState = 0;
        break;
    }
    if (this._isPingUpdate) {
      this._isPingUpdate = false;
      this._activityState += 2;
      if (this._activityState >= 4) {
        this._activityState = 0;
      }
    }
    cr.fill();

    if (Compat.versionCompare(shell_Version, '3.7.4')) {
      cr.$dispose();
    }
  },
  resize: function (schema, key) {
    print_debug('StatusSquare resize()');
  }
});

const TipItem = new Lang.Class({
  Name: 'PingMonitor.TipItem',
  Extends: PopupMenu.PopupBaseMenuItem,

  _init: function () {
    print_debug('TipItem _init()');

    PopupMenu.PopupBaseMenuItem.prototype._init.call(this);
    this.actor.remove_style_class_name('popup-menu-item');
    this.actor.add_style_class_name('sm-tooltip-item');
  }
});

/**
 * Tooltip when hovering
 * @type {Lang.Class}
 */
const TipMenu = new Lang.Class({
  Name: 'PingMonitor.TipMenu',
  Extends: PopupMenu.PopupMenuBase,

  _init: function (sourceActor) {
    print_debug('TipMenu _init()');

    // PopupMenu.PopupMenuBase.prototype._init.call(this, sourceActor, 'sm-tooltip-box');
    this.parent(sourceActor, 'sm-tooltip-box');
    this.actor = new Shell.GenericContainer();
    this.actor.connect('get-preferred-width',
      Lang.bind(this, this._boxGetPreferredWidth));
    this.actor.connect('get-preferred-height',
      Lang.bind(this, this._boxGetPreferredHeight));
    this.actor.connect('allocate', Lang.bind(this, this._boxAllocate));
    this.actor.add_actor(this.box);
  },
  _boxGetPreferredWidth: function (actor, forHeight, alloc) {
    print_debug('TipMenu _boxGetPreferredWidth()');

    [alloc.min_size, alloc.natural_size] = this.box.get_preferred_width(forHeight);
  },
  _boxGetPreferredHeight: function (actor, forWidth, alloc) {
    print_debug('TipMenu _boxGetPreferredHeight()');

    [alloc.min_size, alloc.natural_size] = this.box.get_preferred_height(forWidth);
  },
  _boxAllocate: function (actor, box, flags) {
    print_debug('TipMenu _boxAllocate()');

    this.box.allocate(box, flags);
  },
  _shift: function () {
    print_debug('TipMenu _shift()');

    // Probably old but works
    let node = this.sourceActor.get_theme_node();
    let contentbox = node.get_content_box(this.sourceActor.get_allocation_box());
    let allocation = Shell.util_get_transformed_allocation(this.sourceActor);
    let monitor = Main.layoutManager.findMonitorForActor(this.sourceActor)
    let [x, y] = [allocation.x1 + contentbox.x1,
      allocation.y1 + contentbox.y1];
    let [cx, cy] = [allocation.x1 + (contentbox.x1 + contentbox.x2) / 2,
      allocation.y1 + (contentbox.y1 + contentbox.y2) / 2];
    let [xm, ym] = [allocation.x1 + contentbox.x2,
      allocation.y1 + contentbox.y2];
    let [width, height] = this.actor.get_size();
    let tipx = cx - width / 2;
    tipx = Math.max(tipx, monitor.x);
    tipx = Math.min(tipx, monitor.x + monitor.width - width);
    let tipy = Math.floor(ym);
    // Hacky condition to determine if the status bar is at the top or at the bottom of the screen
    if (allocation.y1 / monitor.height > 0.3) {
      tipy = allocation.y1 - height; // If it is at the bottom, place the tooltip above instead of below
    }
    this.actor.set_position(tipx, tipy);
  },
  open: function (animate) {
    print_debug('TipMenu open()');

    if (this.isOpen) {
      return;
    }

    this.isOpen = true;
    this.actor.show();
    this._shift();
    this.actor.raise_top();
    this.emit('open-state-changed', true);
  },
  close: function (animate) {
    print_debug('TipMenu close()');

    this.isOpen = false;
    this.actor.hide();
    this.emit('open-state-changed', false);
  }
});

const TipBox = new Lang.Class({
  Name: 'PingMonitor.TipBox',

  show_tooltip: true, // show mouseover tooltip

  _init: function () {
    print_debug('TipBox _init()');

    this.actor = new St.BoxLayout({reactive: true}); // this is visualized
    this.actor._delegate = this;
    this.set_tip(new TipMenu(this.actor));
    this.in_to = this.out_to = 0;
    this.actor.connect('enter-event', Lang.bind(this, this.on_enter));
    this.actor.connect('leave-event', Lang.bind(this, this.on_leave));
  },
  set_tip: function (tipmenu) {
    print_debug('TipBox set_tip()');

    if (this.tipmenu) {
      this.tipmenu.destroy();
    }
    this.tipmenu = tipmenu;
    if (this.tipmenu) {
      Main.uiGroup.add_actor(this.tipmenu.actor);
      this.hide_tip();
    }
  },
  show_tip: function () {
    print_debug('TipBox show_tip()');

    if (!this.tipmenu) {
      return;
    }
    this.tipmenu.open();
    if (this.in_to) {
      Mainloop.source_remove(this.in_to);
      this.in_to = 0;
    }
  },
  hide_tip: function () {
    print_debug('TipBox hide_tip()');

    if (!this.tipmenu) {
      return;
    }
    this.tipmenu.close();
    if (this.out_to) {
      Mainloop.source_remove(this.out_to);
      this.out_to = 0;
    }
    if (this.in_to) {
      Mainloop.source_remove(this.in_to);
      this.in_to = 0;
    }
  },
  on_enter: function () {
    print_debug('TipBox on_enter()');

    let show_tooltip = this.show_tooltip;

    if (!show_tooltip) {
      return;
    }

    if (this.out_to) {
      Mainloop.source_remove(this.out_to);
      this.out_to = 0;
    }
    if (!this.in_to) {
      this.in_to = Mainloop.timeout_add(500,
        Lang.bind(this,
          this.show_tip));
    }
  },
  on_leave: function () {
    print_debug('TipBox on_leave()');

    if (this.in_to) {
      Mainloop.source_remove(this.in_to);
      this.in_to = 0;
    }
    if (!this.out_to) {
      this.out_to = Mainloop.timeout_add(500,
        Lang.bind(this,
          this.hide_tip));
    }
  },
  destroy: function () {
    print_debug('TipBox destroy()');

    if (this.in_to) {
      Mainloop.source_remove(this.in_to);
      this.in_to = 0;
    }

    if (this.out_to) {
      Mainloop.source_remove(this.out_to);
      this.out_to = 0;
    }

    this.actor.destroy();
  },
});

const ElementBase = new Lang.Class({
  Name: 'PingMonitor.ElementBase',
  Extends: TipBox,

  elt: '',
  name: '',
  color_name: [],
  text_items: [],
  menu_items: [],
  menu_visible: true,
  color: '#ff0000',
  isRunning: false,

  refresh_interval: 5000, // milliseconds between ping
  visible: true, // show in the system tray
  timeout: undefined,

  _init: function () {
    print_debug('ElementBase _init()');

    this.parent(arguments);
    this.vals = [];
    this.tip_labels = [];
    this.tip_vals = [];
    this.tip_unit_labels = [];

    this.chart = new StatusSquare(IconSize, this);
    Schema.connect('changed::background',
      Lang.bind(this,
        function () {
          this.chart.actor.queue_repaint();
        }));

    this.actor.visible = this.visible;//Schema.get_boolean(this.elt + '-display');

    this.interval = this.refresh_interval; // milliseconds
    // Add the timeout for the first time.
    this.add_timeout();

    this.label = new St.Label({text: this.name, style_class: Style.get('sm-status-label')});
    change_text.call(this);

    this.menu_visible = true;

    this.actor.add_actor(this.label); //this.actor = new St.BoxLayout({reactive: true});
    this.text_box = new St.BoxLayout();

    this.text_items = this.create_text_items();
    this.actor.add_actor(this.chart.actor);
    change_style.call(this);
    this.menu_items = this.create_menu_items();

    this.chart.actor.queue_repaint();
  },
  add_timeout: function () {
    this.remove_timeout();
    print_debug('Add timeout: ' + this.tag);
    this.timeout = Mainloop.timeout_add(
      this.interval,
      Lang.bind(this, this.update)
    );
  },
  remove_timeout: function () {
    print_debug('Remove (try) timeout: ' + this.tag);
    if (this.timeout !== undefined) {
      print_debug('Remove timeout: ' + this.tag);
      Mainloop.source_remove(this.timeout);
      this.timeout = undefined;
    }
  },
  tip_format: function () {
    print_debug('ElementBase tip_format()');

    for (let i = 0; i < this.color_name.length; i++) {
      let tipline = new TipItem();
      this.tipmenu.addMenuItem(tipline);
      // tipline.actor.add(new St.Label({text: _(this.color_name[i])}));
      this.tip_labels[i] = new St.Label({text: ''});
      tipline.actor.add(this.tip_labels[i]);

      // this.tip_unit_labels[i] = new St.Label({text: unit[i]});
      // tipline.actor.add(this.tip_unit_labels[i]);
      this.tip_vals[i] = 0;
    }
  },
  update: function () {
    print_debug('ElementBase update()');

    // Remove timeout from Mainloop.
    // It will be added again after the async reading of the ping std output (_pingReadStdout).
    this.remove_timeout();

    // Refresh ping.
    if (!this.menu_visible && !this.actor.visible) {
      return false;
    }
    this.refresh();

    return true;
  },
  updateDrawing: function () {
    this._apply();
    this.chart.update(this.color, true);
    for (let i = 0; i < this.tip_vals.length; i++) {
      this.tip_labels[i].text = this.tip_vals[i].toString();
    }
  },
  reset_style: function () {
    print_debug('ElementBase reset_style()');

    this.text_items[0].set_style('color: rgba(255, 255, 255, 1)');
  },
  threshold: function () {
    print_debug('ElementBase threshold()');

    if (Schema.get_int('thermal-threshold')) {
      if (this.temp_over_threshold) {
        this.text_items[0].set_style('color: rgba(255, 0, 0, 1)');
      } else {
        this.text_items[0].set_style('color: rgba(255, 255, 255, 1)');
      }
    }
  },
  destroy: function () {
    print_debug('ElementBase destroy()');

    TipBox.prototype.destroy.call(this);
    this.remove_timeout();
  }
});

const Ping = new Lang.Class({
  Name: 'PingMonitor.Ping',
  Extends: ElementBase,

  elt: 'ping', // element type
  id: 0, // id
  tag: '', // tag
  name: '', // name
  address: '8.8.8.8', // ip address
  ping_count: 2, // number of ping per refresh interval
  ping_interval: 0.5, // next ping after x seconds
  ping_deadline: 3, // max seconds for ping
  // refresh_interval: 5000, // milliseconds between ping
  active: true, // run ping
  // visible: true, // show in the system tray
  show_name: true, // show name in the system tray
  show_address: true, // show address in the system tray
  // show_tooltip: true, // show mouseover tooltip
  warning_threshold: 20, // if ping ms higher -> orange
  ping_message: '', // the last ping result

  color_name: ['used'],

  _init: function (id, tag, name, address, ping_count, ping_interval,
                   ping_deadline, refresh_interval, active, visible,
                   show_name, show_address, show_tooltip, warning_threshold) {
    print_debug('Ping _init()');

    this.id = id;
    this.tag = tag;
    if (show_address) {
      this.name = name + '\n' + address;
    } else {
      this.name = name;
    }
    this.address = address;
    this.ping_count = ping_count;
    this.ping_interval = ping_interval;
    this.ping_deadline = ping_deadline;
    this.refresh_interval = refresh_interval;
    this.active = active;
    this.visible = visible;
    this.show_name = show_name;
    this.show_address = show_address;
    this.show_tooltip = show_tooltip;
    this.warning_threshold = warning_threshold;
    this.parent();
    this.tip_format();
    this.update();
  },

  _pingReadStdout: function () {
    this._pingDataStdout.fill_async(-1, GLib.PRIORITY_DEFAULT, null, Lang.bind(this, function (stream, result) {
      if (stream.fill_finish(result) == 0) {
        try {
          if (stream.peek_buffer() instanceof Uint8Array) {
            this._pingOutput = imports.byteArray.toString(stream.peek_buffer())
          } else {
            this._pingOutput = stream.peek_buffer().toString();
          }
          if (this._pingOutput) {
            print_debug('Ping info: ' + this._pingOutput);

            let firstLine = this._pingOutput.match(/[\w .:()]+\n/m);
            print_debug('First line: ' + firstLine[0]);

            let lastLines = this._pingOutput.match(/---[\w\W]+/m);
            lastLines[0] = lastLines[0].replace(/^\s+|\s+$/g, '');
            print_debug('Last lines: ' + lastLines[0]);

            // this.ping_message = this._pingOutput.toString();
            this.ping_message = firstLine[0] + lastLines[0];
            print_debug('Ping info: ' + this.ping_message);

            let loss = this._pingOutput.match(/received, (\d*)/m);
            let times = this._pingOutput.match(/mdev = (\d*.\d*)\/(\d*.\d*)\/(\d*.\d*)\/(\d*.\d*)/m);

            if (times != null && times.length == 5 &&
              loss != null && loss.length == 2) {
              print_debug('loss: ' + loss[1]);
              print_debug('min: ' + times[1]);
              print_debug('avg: ' + times[2]);
              print_debug('max: ' + times[3]);
              print_debug('mdev: ' + times[4]);

              if (loss[1] != 0 && loss[1] != 100) {
                this.color = Schema.get_string('ping-loss-color');
              } else if (loss[1] == 100) {
                this.color = Schema.get_string('ping-bad-color');
              } else if (times[3] > this.warning_threshold) {
                this.color = Schema.get_string('ping-warning-color');
              } else {
                this.color = Schema.get_string('ping-good-color');
              }
            } else {
              this.color = Schema.get_string('ping-bad-color');
            }
            this.updateDrawing();
          }
        } catch (e) {
          print_info(e.toString());
          this.color = Schema.get_string('ping-bad-color');
          this.updateDrawing();
        }
        this._pingStdout.close(null);
        this._pingStdout = null;
        this._pingDataStdout.close(null);
        this._pingDataStdout = null;

        // Add timeout to Mainloop, this will call ping the next time after the defined interval.
        this.add_timeout();
        return;
      }

      stream.set_buffer_size(2 * stream.get_buffer_size());
      this._pingReadStdout();
    }));
  },

  _pingReadStderr: function () {
    this._pingDataStderr.fill_async(-1, GLib.PRIORITY_DEFAULT, null, Lang.bind(this, function (stream, result) {
      if (stream.fill_finish(result) == 0) {
        try {
          if (stream.peek_buffer() instanceof Uint8Array) {
            this._pingOutputErr = imports.byteArray.toString(stream.peek_buffer())
          } else {
            this._pingOutputErr = stream.peek_buffer().toString();
          }
          if (this._pingOutputErr) {
            this.ping_message = this._pingOutputErr;
            print_debug('Ping error: ' + this.ping_message);

            this.color = Schema.get_string('ping-bad-color');

            this.updateDrawing();
          }
        } catch (e) {
          print_info(e.toString());
          this.color = Schema.get_string('ping-bad-color');
          this.updateDrawing();
        }
        this._pingStderr.close(null);
        this._pingStderr = null;
        this._pingDataStderr.close(null);
        this._pingDataStderr = null;

        return;
      }

      stream.set_buffer_size(2 * stream.get_buffer_size());
      this._pingReadStderr();
    }));
  },

  refresh: function () {
    print_debug('Ping refresh()');

    // Run asynchronously, to avoid shell freeze
    try {
      let path = Me.dir.get_path();
      let script = [
        '/bin/bash',
        path + '/ping.sh',
        this.address,
        '' + this.ping_count,
        '' + this.ping_deadline,
        '' + this.ping_interval
      ];

      let [, pid, in_fd, out_fd, err_fd] = GLib.spawn_async_with_pipes(
        null, /* cwd */
        script,
        null, /* env */
        GLib.SpawnFlags.DO_NOT_REAP_CHILD,
        null /* child_setup */);

      this._pingStdout = new Gio.UnixInputStream({fd: out_fd, close_fd: true});
      this._pingDataStdout = new Gio.DataInputStream({base_stream: this._pingStdout});
      this._pingStderr = new Gio.UnixInputStream({fd: err_fd, close_fd: true});
      this._pingDataStderr = new Gio.DataInputStream({base_stream: this._pingStderr});
      new Gio.UnixOutputStream({fd: in_fd, close_fd: true}).close(null);

      this._pingReadStdout();
      this._pingReadStderr();
    } catch (e) {
      print_info(e.toString());
      // Deal with the error
    }
  },

  _endProcess: function () {
    print_debug('Ping _endProcess()');

    if (this._process_stream) {
      this._process_stream.close(null);
      this._process_stream = null;
    }
    if (this._process_error) {
      this._process_error.close(null);
      this._process_error = null;
    }
  },
  _apply: function () {
    print_debug('Ping _apply()');

    this.menu_items[0].text = this.ping_message;
    // this.menu_items[1].text = '2';
    this.tip_vals[0] = this.ping_message;
  },
  create_text_items: function () {
    print_debug('Ping create_text_items()');

    return [
      new St.Label({
        text: '',
        style_class: Style.get('sm-status-value'),
        y_align: Clutter.ActorAlign.CENTER
      }),
      new St.Label({
        text: '%',
        style_class: Style.get('sm-perc-label'),
        y_align: Clutter.ActorAlign.CENTER
      })
    ];
  },
  create_menu_items: function () {
    print_debug('Ping create_menu_items()');

    return [
      new St.Label({
        text: '',
        style_class: Style.get('sm-value-left')
      }),
      // new St.Label({
      //     text: '',
      //     style_class: Style.get('sm-label')}),
      // new St.Label({
      //     text: '',
      //     style_class: Style.get('sm-label')}),
      // new St.Label({
      //     text: '',
      //     style_class: Style.get('sm-value')}),
      // new St.Label({
      //     text: '',
      //     style_class: Style.get('sm-label')})
    ];
  }
});

const Icon = new Lang.Class({
  Name: 'PingMonitor.Icon',

  _init: function () {
    print_debug('Icon _init()');

    this.actor = new St.Icon({
      icon_name: 'system-run-symbolic',
      style_class: 'system-status-icon'
    });
    this.actor.visible = Schema.get_boolean('icon-display');
    Schema.connect(
      'changed::icon-display',
      Lang.bind(this,
        function () {
          print_debug('changed icon-display');
          this.actor.visible = Schema.get_boolean('icon-display');
        })
    );
  }
});

function read_from_file(path) {
  print_info('read_from_file()');

  try {
    let [ok, contents] = GLib.file_get_contents(path);
    if (ok) {
      if (contents instanceof Uint8Array)
        contents = imports.byteArray.toString(contents);
      let map = JSON.parse(contents);

      try {
        debugOutput = map['debug_output'];
      } catch (e) {
        debugOutput = false;
      }

      try {
        for (let i = 0; i < map['ping_config'].length; i++) {
          let tag = map['ping_config'][i]['tag'];
          let name = map['ping_config'][i]['name'];
          let address = map['ping_config'][i]['address'];
          let ping_count = map['ping_config'][i]['ping_count'];
          let ping_interval = map['ping_config'][i]['ping_interval'];
          let ping_deadline = map['ping_config'][i]['ping_deadline'];
          let refresh_interval = map['ping_config'][i]['refresh_interval'];
          let active = map['ping_config'][i]['active'];
          let visible = map['ping_config'][i]['visible'];
          let show_name = map['ping_config'][i]['show_name'];
          let show_address = map['ping_config'][i]['show_address'];
          let show_tooltip = map['ping_config'][i]['show_tooltip'];
          let warning_threshold = map['ping_config'][i]['warning_threshold'];

          print_debug('tag:               ' + tag);
          print_debug('name:              ' + name);
          print_debug('address:           ' + address);
          print_debug('ping_count:        ' + ping_count);
          print_debug('ping_interval:     ' + ping_interval);
          print_debug('ping_deadline:     ' + ping_deadline);
          print_debug('refresh_interval:  ' + refresh_interval);
          print_debug('active:            ' + active);
          print_debug('visible:           ' + visible);
          print_debug('show_name:         ' + show_name);
          print_debug('show_address:      ' + show_address);
          print_debug('show_tooltip:      ' + show_tooltip);
          print_debug('warning_threshold: ' + warning_threshold);

          // id, tag, name, address, ping_count, ping_interval,
          // ping_deadline, refresh_interval, active, visible,
          // show_name, show_tooltip, warning_threshold

          Main.__sm.elts.push(new Ping(
            i,
            tag,
            name,
            address,
            ping_count,
            ping_interval,
            ping_deadline,
            refresh_interval,
            active,
            visible,
            show_name,
            show_address,
            show_tooltip,
            warning_threshold));
        }
      } catch (e) {
        print_info('could not load config');
        print_info('error: ' + e);
        return false;
      }
    }
  } catch (e) {
    print_info('Error: ' + e);
    return false;
  }

  return true;
}

function build_ping_applet() {
  Schema = Convenience.getSettings();
  Style = new smStyleManager();

  Background = color_from_string(Schema.get_string('background'));

  if (!(smDepsGtop)) {
    Main.__sm = {
      smdialog: new smDialog()
    }

    let dialog_timeout = Mainloop.timeout_add_seconds(
      1,
      function () {
        Main.__sm.smdialog.open();
        Mainloop.source_remove(dialog_timeout);
        return true;
      });
  } else {
    let panel = Main.panel._rightBox;
    StatusArea = Main.panel._statusArea;
    if (typeof (StatusArea) === 'undefined') {
      StatusArea = Main.panel.statusArea;
    }

    // Debug
    Main.__sm = {
      tray: new PanelMenu.Button(0.5),
      icon: new Icon(),
      elts: [],
    };

    // Items to Monitor
    let isFileOk = false;
    let path = Schema.get_string('ping-config-path');
    if (path == '') {
      path = GLib.getenv('HOME') + '/.config/ping-monitor.conf';
      Schema.set_string('ping-config-path', path);
    }
    isFileOk = read_from_file(path);
    Schema.set_boolean('icon-display', !isFileOk);

    let tray = Main.__sm.tray;
    let elts = Main.__sm.elts;

    Schema.connect('changed::background', Lang.bind(
      this, function (schema, key) {
        Background = color_from_string(Schema.get_string(key));
      }));
    if (!Compat.versionCompare(shell_Version, '3.5.5')) {
      StatusArea.systemMonitor = tray;
      panel.insert_child_at_index(tray.actor, 1);
      panel.child_set(tray.actor, {y_fill: true});
    } else {
      Main.panel._addToPanelBox('ping-monitor', tray, 1, panel);
    }

    // The spacing adds a distance between the graphs/text on the top bar
    let spacing = '4'; // TODO '1' ?
    let box = new St.BoxLayout({style: 'spacing: ' + spacing + 'px;'});
    tray.actor.add_actor(box);
    box.add_actor(Main.__sm.icon.actor);
    // Add items to panel box
    for (let elt in elts) {
      box.add_actor(elts[elt].actor);
    }

    // Build Menu Info Box Table
    let menu_info = new PopupMenu.PopupBaseMenuItem({reactive: false});
    let menu_info_box = new St.BoxLayout();
    menu_info.actor.add(menu_info_box);
    Main.__sm.tray.menu.addMenuItem(menu_info, 0);

    build_menu_info();

    tray.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    tray.menu.connect(
      'open-state-changed',
      function (menu, isOpen) {
        if (isOpen) {
          // Main.__sm.pie.actor.queue_repaint();

          menu_timeout = Mainloop.timeout_add_seconds(
            5,
            function () {
              // Main.__sm.pie.actor.queue_repaint();
              return true;
            });
        } else {
          Mainloop.source_remove(menu_timeout);
        }
      }
    );

    let _appSys = Shell.AppSystem.get_default();
    let _gsmPrefs = _appSys.lookup_app('gnome-shell-extension-prefs.desktop');
    let item;

    // Reload config.
    item = new PopupMenu.PopupMenuItem(_('Reload config'));
    item.connect('activate', function () {
      destroy_ping_applet();
      build_ping_applet();
    });
    tray.menu.addMenuItem(item);

    // Preferences.
    item = new PopupMenu.PopupMenuItem(_('Preferences...'));
    item.connect('activate', function () {
      Util.spawn(["gnome-shell-extension-prefs", "ping-monitor@samuel.bachmann.gmail.com"]);
    });
    tray.menu.addMenuItem(item);

    if (Compat.versionCompare(shell_Version, '3.5.5')) {
      Main.panel.menuManager.addMenu(tray.menu);
    } else {
      Main.panel._menus.addMenu(tray.menu);
    }

    Schema.connect('changed::ping-config-path', Lang.bind(
      this, function () {
        print_info("Config path changed.");
        // destroy_ping_applet();
        // build_ping_applet();
      }));
  }
};

function destroy_ping_applet() {
  if (Style) {
    Style = null;
  }
  Schema.run_dispose();

  for (let eltName in Main.__sm.elts) {
    Main.__sm.elts[eltName].destroy();
  }

  if (!Compat.versionCompare(shell_Version, '3.5')) {
    Main.__sm.tray.destroy();
    StatusArea.systemMonitor = null;
  } else {
    Main.__sm.tray.actor.destroy();
  }
  Main.__sm = null;
};

var init = function () {
  print_info('applet init from ' + extension.path);

  Convenience.initTranslations();
  // Get locale, needed as an argument for toLocaleString() since GNOME Shell 3.24
  // See: mozjs library bug https://bugzilla.mozilla.org/show_bug.cgi?id=999003
  // Locale = GLib.get_language_names()[0];
  // if (Locale.indexOf('_') !== -1) {
  //     Locale = Locale.split('_')[0];
  // }

  IconSize = Math.round(Panel.PANEL_ICON_SIZE * 4 / 5);
};

var enable = function () {
  print_info('applet enabling');

  // Schema = Convenience.getSettings();
  // Style = new smStyleManager();

  build_ping_applet();

  print_info('applet enabling done');
};

var disable = function () {
  print_info('disable applet');

  // if (Style) {
  //     Style = null;
  // }
  // Schema.run_dispose();

  destroy_ping_applet();

  print_info('applet disabled');
};
