import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Main from 'resource:///org/gnome/shell/ui/main.js';
import St from 'gi://St';
import { toString } from 'imports.byteArray';

const BOOKMARK_PATHS = {
    vivaldi: `${GLib.get_home_dir()}/.config/vivaldi/Default/Bookmarks`,
    chrome: `${GLib.get_home_dir()}/.config/google-chrome/Default/Bookmarks`,
    chromium: `${GLib.get_home_dir()}/.config/chromium/Default/Bookmarks`,
    brave: `${GLib.get_home_dir()}/.config/BraveSoftware/Brave-Browser/Default/Bookmarks`,
    opera: `${GLib.get_home_dir()}/.config/opera/Bookmarks`,
};

function findFirstExistingBookmarkFile() {
    for (const [browser, path] of Object.entries(BOOKMARK_PATHS)) {
        if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
            log(`Using bookmarks from ${browser} at ${path}`);
            return path;
        }
    }
    return null;
}

function parseBookmarks(path) {
    try {
        const file = Gio.File.new_for_path(path);
        const [, contents] = file.load_contents(null);
        const json = JSON.parse(toString(contents));
        const bookmarks = [];

        function walk(node) {
            if (node.type === 'url') {
                bookmarks.push({
                    name: node.name,
                    url: node.url
                });
            } else if (node.children) {
                node.children.forEach(walk);
            }
        }

        const roots = json.roots;
        for (const key of ['bookmark_bar', 'other', 'synced']) {
            if (roots[key]?.children) {
                roots[key].children.forEach(walk);
            }
        }

        return bookmarks;
    } catch (e) {
        logError(e, 'Failed to parse bookmarks');
        return [];
    }
}

function createDesktopFile(bookmark, desktopDir) {
    const desktopEntry = `[Desktop Entry]
Type=Application
Name=${bookmark.name}
Exec=xdg-open "${bookmark.url}"
Icon=internet-web-browser
Terminal=false
Categories=Network;WebBrowser;
`;

    const safeFileName = bookmark.name.replace(/[^a-z0-9]+/gi, '_').substring(0, 50);
    const filePath = `${desktopDir}/${safeFileName}.desktop`;

    try {
        const file = Gio.File.new_for_path(filePath);
        file.replace_contents(desktopEntry, null, false, Gio.FileCreateFlags.NONE, null);
    } catch (e) {
        logError(e, `Failed to write desktop entry for ${bookmark.name}`);
    }
}

export default class BookmarkLauncherExtension extends Extension {
    enable() {
        const desktopDir = `${GLib.get_home_dir()}/.local/share/applications/bookmark-launcher/`;
        const dir = Gio.File.new_for_path(desktopDir);

        if (!dir.query_exists(null)) {
            dir.make_directory_with_parents(null);
        }

        const bookmarkPath = findFirstExistingBookmarkFile();
        if (!bookmarkPath) {
            log('No supported bookmark file found');
            return;
        }

        const bookmarks = parseBookmarks(bookmarkPath);
        bookmarks.forEach(b => createDesktopFile(b, desktopDir));

        this._indicator = new St.Label({ text: `Bookmarks: ${bookmarks.length}` });
        Main.panel._rightBox.insert_child_at_index(this._indicator, 0);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        const desktopDir = `${GLib.get_home_dir()}/.local/share/applications/bookmark-launcher/`;
        const dir = Gio.File.new_for_path(desktopDir);

        try {
            if (dir.query_exists(null)) {
                dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null)
                    .forEach(info => {
                        const child = dir.get_child(info.get_name());
                        child.delete(null);
                    });
                dir.delete(null);
            }
        } catch (e) {
            logError(e, 'Failed to clean up .desktop files');
        }
    }
}
