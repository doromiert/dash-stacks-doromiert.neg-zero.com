import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class DashStacksPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        window.add(page);

        let group = null; // Track the active group

        const renderList = () => {
            // 1. Remove the entire old group if it exists
            if (group) {
                page.remove(group);
            }

            // 2. Create a fresh group
            group = new Adw.PreferencesGroup({
                title: 'Stacks Configuration',
                description: 'Manage your dash folder stacks.'
            });
            page.add(group);

            let stacks = [];
            try {
                stacks = JSON.parse(settings.get_string('stacks'));
            } catch (e) {
                console.error('Failed to parse stacks:', e);
            }

            stacks.forEach((stack, index) => {
                let row = new Adw.ExpanderRow({ title: stack.name || 'Unnamed Stack' });
                
                let nameEntry = new Adw.EntryRow({ title: 'Name', text: stack.name });
                nameEntry.connect('changed', () => {
                    stacks[index].name = nameEntry.text;
                    row.title = nameEntry.text || 'Unnamed Stack';
                    save(stacks);
                });

                let pathEntry = new Adw.EntryRow({ title: 'Path', text: stack.path });
                pathEntry.connect('changed', () => {
                    stacks[index].path = pathEntry.text;
                    save(stacks);
                });

                let iconEntry = new Adw.EntryRow({ title: 'Icon Name', text: stack.icon });
                iconEntry.connect('changed', () => {
                    stacks[index].icon = iconEntry.text;
                    save(stacks);
                });

                let deleteBtn = new Gtk.Button({
                    label: 'Remove Stack',
                    margin_top: 12, margin_bottom: 12, margin_start: 12, margin_end: 12,
                    css_classes: ['destructive-action']
                });
                deleteBtn.connect('clicked', () => {
                    stacks.splice(index, 1);
                    save(stacks);
                    renderList(); // Re-render will now cleanly wipe and rebuild
                });

                row.add_row(nameEntry);
                row.add_row(pathEntry);
                row.add_row(iconEntry);
                row.add_row(deleteBtn);
                group.add(row);
            });

            // "Add New" button
            let addRow = new Adw.ActionRow({ title: 'Add New Stack' });
            let addBtn = new Gtk.Button({ icon_name: 'list-add-symbolic', valign: Gtk.Align.CENTER });
            addBtn.connect('clicked', () => {
                stacks.push({ name: 'New Stack', path: '~/', icon: 'folder' });
                save(stacks);
                renderList(); // Re-render will now cleanly wipe and rebuild
            });
            addRow.add_suffix(addBtn);
            group.add(addRow);
        };

        const save = (stacks) => {
            settings.set_string('stacks', JSON.stringify(stacks));
        };

        renderList();
    }
}
