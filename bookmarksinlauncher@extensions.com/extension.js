import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const VIVALDI_BOOKMARKS_PATH = `${GLib.get_home_dir()}/.config/vivaldi/Default/Bookmarks`;
const DESKTOP_DIR = `${GLib.get_home_dir()}/.local/share/applications/vivaldi-bookmarks/`;

let bookmarksMonitor = null;
let debounceTimeoutId = 0;

function getVivaldiBookmarks() {
    const bookmarks = [];
    try {
        if (!GLib.file_test(VIVALDI_BOOKMARKS_PATH, GLib.FileTest.EXISTS))
            return bookmarks;

        const file = Gio.File.new_for_path(VIVALDI_BOOKMARKS_PATH);
        const [, contents] = file.load_contents(null);
        const text = new TextDecoder().decode(contents);
        const data = JSON.parse(text);
        const nodes = data?.roots?.bookmark_bar?.children || [];

        for (const node of nodes) {
            if (node.type === 'url') {
                bookmarks.push({ title: node.name, url: node.url });
            }
        }
    } catch (e) {
        logError(`Failed to load Vivaldi bookmarks: ${e.message}`);
    }
    return bookmarks;
}

function exportBookmarksToDesktopFiles() {
    // Ensure target directory exists
    GLib.mkdir_with_parents(DESKTOP_DIR, 0o755);

    // Delete old .desktop files
    const dir = Gio.File.new_for_path(DESKTOP_DIR);
    try {
        const enumerator = dir.enumerate_children('standard::*', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            if (info.get_name().endsWith('.desktop')) {
                dir.get_child(info.get_name()).delete(null);
            }
        }
    } catch (e) {
        // If directory doesn't exist, no need to remove
    }

    // Write updated .desktop files
    const bookmarks = getVivaldiBookmarks();
    bookmarks.forEach((bm, i) => {
        const name = bm.title.replace(/\//g, '-');
        const desktopFilePath = `${DESKTOP_DIR}vivaldi-bookmark-${i}.desktop`;
        const desktopFileContent = `[Desktop Entry]
Type=Application
Name=${name}
Exec=vivaldi "${bm.url}"
Icon=web-browser
Categories=Network;WebBrowser;
`;
        GLib.file_set_contents(desktopFilePath, desktopFileContent);
    });
}

function forceGnomeShellDesktopRefresh() {
    const desktopDir = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share', 'applications']);
    const dummyPath = GLib.build_filenamev([desktopDir, 'vivaldi-refresh.desktop']);

    try {
        const contents = `[Desktop Entry]
Type=Application
Name=Refresh Trigger
Exec=true
NoDisplay=true`;

        GLib.file_set_contents(dummyPath, contents);

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            try {
                const file = Gio.File.new_for_path(dummyPath);
                file.delete(null);
            } catch (e) {
                logError(e);
            }
            return GLib.SOURCE_REMOVE;
        });
    } catch (e) {
        logError(e);
    }
}

function debounceUpdate() {
    if (debounceTimeoutId !== 0) {
        GLib.source_remove(debounceTimeoutId);
    }

    debounceTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
        exportBookmarksToDesktopFiles();
        forceGnomeShellDesktopRefresh();
        debounceTimeoutId = 0;
        return GLib.SOURCE_REMOVE;
    });
}

export default class VivaldiBookmarksExtension extends Extension {
    enable() {
        exportBookmarksToDesktopFiles();
        forceGnomeShellDesktopRefresh();

        try {
            const bookmarksFile = Gio.File.new_for_path(VIVALDI_BOOKMARKS_PATH);
            bookmarksMonitor = bookmarksFile.monitor_file(Gio.FileMonitorFlags.NONE, null);
            bookmarksMonitor.connect('changed', (_monitor, _file, _otherFile, eventType) => {
                if (eventType === Gio.FileMonitorEvent.CHANGES_DONE_HINT) {
                    log('Vivaldi bookmarks changed — scheduling update');
                    debounceUpdate();
                }
            });
        } catch (e) {
            logError(`Failed to monitor Vivaldi bookmarks file: ${e.message}`);
        }
    }

    disable() {
        if (bookmarksMonitor) {
            bookmarksMonitor.cancel();
            bookmarksMonitor = null;
        }

        if (debounceTimeoutId !== 0) {
            GLib.source_remove(debounceTimeoutId);
            debounceTimeoutId = 0;
        }

        const dir = Gio.File.new_for_path(DESKTOP_DIR);
        try {
            const enumerator = dir.enumerate_children('standard::*', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                if (info.get_name().endsWith('.desktop')) {
                    dir.get_child(info.get_name()).delete(null);
                }
            }
            forceGnomeShellDesktopRefresh();
        } catch (e) {
            // Ignore errors during cleanup
        }
    }
}

// Helper for logging errors in GJS
function logError(msg) {
    globalThis.logError ? globalThis.logError(msg) : console.error(msg);
}
