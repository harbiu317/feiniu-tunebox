// templates/app.js

// 轻量 Toast 通知，替代原生 alert
(function() {
    let container = null;
    function getContainer() {
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        return container;
    }
    /**
     * 显示 toast 通知
     * @param {string} msg - 消息文本
     * @param {'info'|'success'|'error'} type - 类型
     * @param {number} duration - 持续毫秒数
     */
    window.showToast = function(msg, type, duration) {
        type = type || 'info';
        duration = duration || 2500;
        var el = document.createElement('div');
        el.className = 'toast' + (type !== 'info' ? ' toast-' + type : '');
        el.textContent = msg;
        getContainer().appendChild(el);
        setTimeout(function() {
            el.classList.add('toast-out');
            el.addEventListener('animationend', function() { el.remove(); });
        }, duration);
    };
})();

const API_ROOT = window.API_ROOT;
const WEB_SETTINGS_KEY = 'musicdl:web_settings';
const INSPECT_REQUEST_DELAY_MS = 100;
const DEFAULT_WEB_PAGE_SIZE = 50;
const DEFAULT_CLI_PAGE_SIZE = 50;
let webSettings = {
    embedDownload: false,
    downloadToLocal: false,
    downloadDir: '',
    webPageSize: DEFAULT_WEB_PAGE_SIZE,
    cliPageSize: DEFAULT_CLI_PAGE_SIZE,
    vgChangeCover: false,
    vgChangeAudio: false,
    vgChangeLyric: false,
    vgExportVideo: false
};

function normalizeWebSettings(raw) {
    const next = {
        embedDownload: false,
        downloadToLocal: false,
        downloadDir: '',
        webPageSize: DEFAULT_WEB_PAGE_SIZE,
        cliPageSize: DEFAULT_CLI_PAGE_SIZE,
        vgChangeCover: false,
        vgChangeAudio: false,
        vgChangeLyric: false,
        vgExportVideo: false
    };

    if (!raw || typeof raw !== 'object') {
        return next;
    }

    if (typeof raw.embedDownload === 'boolean') {
        next.embedDownload = raw.embedDownload;
    }
    if (typeof raw.downloadToLocal === 'boolean') {
        next.downloadToLocal = raw.downloadToLocal;
    }
    if (typeof raw.downloadDir === 'string' && raw.downloadDir.trim() !== '') {
        next.downloadDir = raw.downloadDir.trim();
    }
    if (Number.isInteger(raw.webPageSize) && raw.webPageSize > 0) {
        next.webPageSize = Math.min(raw.webPageSize, 200);
    }
    if (Number.isInteger(raw.cliPageSize) && raw.cliPageSize > 0) {
        next.cliPageSize = Math.min(raw.cliPageSize, 200);
    }
    if (typeof raw.vgChangeCover === 'boolean') {
        next.vgChangeCover = raw.vgChangeCover;
    }
    if (typeof raw.vgChangeAudio === 'boolean') {
        next.vgChangeAudio = raw.vgChangeAudio;
    }
    if (typeof raw.vgChangeLyric === 'boolean') {
        next.vgChangeLyric = raw.vgChangeLyric;
    }
    if (typeof raw.vgExportVideo === 'boolean') {
        next.vgExportVideo = raw.vgExportVideo;
    }
    return next;
}

function loadWebSettingsFromCache() {
    try {
        const raw = localStorage.getItem(WEB_SETTINGS_KEY);
        if (!raw) return webSettings;
        webSettings = normalizeWebSettings(JSON.parse(raw));
    } catch (_) {
    }
    return webSettings;
}

function persistWebSettingsCache() {
    try {
        localStorage.setItem(WEB_SETTINGS_KEY, JSON.stringify(webSettings));
    } catch (_) {
    }
}

function applyVideoGenFeatureVisibility() {
    const featureDisplayMap = {
        vgChangeCover: 'vg-feature-change-cover',
        vgChangeAudio: 'vg-feature-change-audio',
        vgChangeLyric: 'vg-feature-change-lyric',
        vgExportVideo: 'vg-feature-export-video'
    };

    Object.entries(featureDisplayMap).forEach(([key, elementId]) => {
        const element = document.getElementById(elementId);
        if (!element) return;
        element.style.display = webSettings[key] ? 'flex' : 'none';
    });
}

function applyWebSettings(settings) {
    webSettings = normalizeWebSettings(settings);
    persistWebSettingsCache();

    // 下载目录 - 使用新的 UI 状态切换
    updateDirUI(webSettings.downloadDir);

    // Toggles
    const ids = {
        'setting-embed-download': 'embedDownload',
        'setting-download-to-local': 'downloadToLocal',
        'setting-vg-change-cover': 'vgChangeCover',
        'setting-vg-change-audio': 'vgChangeAudio',
        'setting-vg-change-lyric': 'vgChangeLyric',
        'setting-vg-export-video': 'vgExportVideo',
    };
    for (const [id, key] of Object.entries(ids)) {
        const el = document.getElementById(id);
        if (el) el.checked = webSettings[key];
    }

    // Number inputs
    const webPageSizeInput = document.getElementById('setting-web-page-size');
    if (webPageSizeInput) webPageSizeInput.value = String(webSettings.webPageSize || DEFAULT_WEB_PAGE_SIZE);
    const cliPageSizeInput = document.getElementById('setting-cli-page-size');
    if (cliPageSizeInput) cliPageSizeInput.value = String(webSettings.cliPageSize || DEFAULT_CLI_PAGE_SIZE);

    applyVideoGenFeatureVisibility();
    refreshDownloadLinks();
}

async function fetchWebSettings() {
    try {
        const response = await fetch(API_ROOT + '/settings');
        if (!response.ok) return;
        const data = await response.json();
        applyWebSettings(data);

        // 如果 downloadDir 为空，尝试自动设为 data-share 默认目录
        if (!webSettings.downloadDir) {
            autoSetDefaultDir();
        }
    } catch (_) {
    }
}

async function autoSetDefaultDir() {
    try {
        const resp = await fetch(API_ROOT + '/authorized-dirs');
        if (!resp.ok) return;
        const data = await resp.json();
        if (!data.dirs || data.dirs.length === 0) return;
        // 优先用 share 类型（安装时自动创建的共享目录）
        const shareDir = data.dirs.find(d => d.source === 'share');
        const dir = shareDir || data.dirs[0];
        if (dir && dir.path) {
            webSettings.downloadDir = dir.path;
            updateDirUI(dir.path);
            // 自动保存到后端
            fetch(API_ROOT + '/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(webSettings)
            }).catch(() => {});
        }
    } catch (_) {
    }
}

function buildDownloadRequestURL(id, source, name, artist, cover, extra, options = {}) {
    const params = new URLSearchParams({
        id: String(id || ''),
        source: String(source || ''),
        name: String(name || ''),
        artist: String(artist || '')
    });

    const coverValue = String(cover || '');
    if (coverValue !== '') {
        params.set('cover', coverValue);
    }
    const extraValue = String(extra || '');
    if (extraValue !== '' && extraValue !== '{}' && extraValue !== 'null') {
        params.set('extra', extraValue);
    }
    if (options.embed) {
        params.set('embed', '1');
    }
    if (options.saveLocal) {
        params.set('save_local', '1');
    }

    return `${API_ROOT}/download?${params.toString()}`;
}

function buildStreamURL(id, source, name, artist, cover, extra) {
    return buildDownloadRequestURL(id, source, name, artist, cover, extra, {
        embed: webSettings.embedDownload
    });
}

function buildDownloadURL(id, source, name, artist, cover, extra) {
    return buildDownloadRequestURL(id, source, name, artist, cover, extra, {
        embed: webSettings.embedDownload,
        saveLocal: webSettings.downloadToLocal
    });
}

function updateDownloadButton(link) {
    if (!link) return;

    const card = link.closest('.song-card');
    if (!card) return;

    const ds = card.dataset;
    link.href = buildDownloadURL(ds.id, ds.source, ds.name, ds.artist, ds.cover || '', ds.extra || '');
    link.title = webSettings.downloadToLocal ? '保存到本地目录' : '下载歌曲';
}

function refreshDownloadLinks(root = document) {
    root.querySelectorAll('.song-card').forEach(card => {
        updateDownloadButton(card.querySelector('.btn-download'));
    });
}

async function requestLocalDownload(url) {
    const response = await fetch(url, {
        headers: {
            'Accept': 'application/json'
        }
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.error) {
        throw new Error((data && data.error) || '保存失败');
    }
    return data;
}

function formatBatchSongLabel(song) {
    const name = (song && song.name) ? song.name : 'Unknown';
    const artist = (song && song.artist) ? song.artist : 'Unknown';
    return `${name} - ${artist}`;
}

function buildBatchFailureMessage(failures, title) {
    if (!failures || failures.length === 0) {
        return '';
    }

    let message = `\n\n${title} ${failures.length} 首：`;
    failures.forEach((item, index) => {
        const reason = item.reason ? `：${item.reason}` : '';
        message += `\n${index + 1}. ${formatBatchSongLabel(item.song)}${reason}`;
    });
    return message;
}

function inferExtFromContentType(contentType) {
    const raw = String(contentType || '').toLowerCase().split(';')[0].trim();
    switch (raw) {
    case 'audio/flac':
    case 'audio/x-flac':
        return 'flac';
    case 'audio/ogg':
    case 'application/ogg':
        return 'ogg';
    case 'audio/mp4':
    case 'audio/x-m4a':
    case 'audio/aac':
    case 'audio/aacp':
        return 'm4a';
    case 'audio/x-ms-wma':
    case 'audio/wma':
        return 'wma';
    default:
        return 'mp3';
    }
}

function getDownloadFilenameFromResponse(response, song) {
    const disposition = response.headers.get('Content-Disposition') || '';
    const encodedMatch = disposition.match(/filename\*\s*=\s*utf-8''([^;]+)/i);
    if (encodedMatch && encodedMatch[1]) {
        try {
            return decodeURIComponent(encodedMatch[1].trim().replace(/^"|"$/g, ''));
        } catch (_) {
        }
    }

    const plainMatch = disposition.match(/filename\s*=\s*"([^"]+)"/i) || disposition.match(/filename\s*=\s*([^;]+)/i);
    if (plainMatch && plainMatch[1]) {
        return plainMatch[1].trim().replace(/^"|"$/g, '');
    }

    return `${formatBatchSongLabel(song)}.${inferExtFromContentType(response.headers.get('Content-Type'))}`;
}

async function requestBrowserDownload(song) {
    const response = await fetch(song.url);
    if (!response.ok) {
        let reason = '';
        try {
            reason = (await response.text()).trim();
        } catch (_) {
        }
        throw new Error(reason || `HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const filename = getDownloadFilenameFromResponse(response, song);
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);

    return {
        warning: response.headers.get('X-MusicDL-Warning') || ''
    };
}

async function handleDownloadClick(link) {
    // 如果已设置 NAS 下载目录，默认保存到 NAS
    if (webSettings.downloadDir && link) {
        const card = link.closest('.song-card');
        const songName = card ? `${card.dataset.name} - ${card.dataset.artist}` : '歌曲';
        addToDlQueue(songName, link.href);
        return true;
    }
    // 否则走浏览器下载
    return false;
}

// ===== 下载菜单 =====
function toggleDlMenu(btn) {
    // 关闭其他所有打开的菜单
    document.querySelectorAll('.dl-menu.show').forEach(m => {
        if (m !== btn.nextElementSibling) m.classList.remove('show');
    });
    const menu = btn.nextElementSibling;
    menu.classList.toggle('show');
}

function getDlLinkFromMenu(menuItem) {
    const group = menuItem.closest('.dl-btn-group');
    return group ? group.querySelector('.btn-download') : null;
}

function dlToNas(menuItem) {
    const link = getDlLinkFromMenu(menuItem);
    if (!link) return;
    menuItem.closest('.dl-menu').classList.remove('show');

    if (!webSettings.downloadDir) {
        showToast('请先在设置中选择下载目录', 'error');
        return;
    }
    const card = link.closest('.song-card');
    const songName = card ? `${card.dataset.name} - ${card.dataset.artist}` : '歌曲';
    addToDlQueue(songName, link.href);
}

function dlToBrowser(menuItem) {
    const link = getDlLinkFromMenu(menuItem);
    if (!link) return;
    menuItem.closest('.dl-menu').classList.remove('show');
    // 用不带 save_local 的 URL 在新窗口下载
    const url = link.href.replace(/&save_local=1/, '');
    window.open(url, '_blank');
}

// 点击页面其他地方关闭下载菜单
document.addEventListener('click', function(e) {
    if (!e.target.closest('.dl-btn-group')) {
        document.querySelectorAll('.dl-menu.show').forEach(m => m.classList.remove('show'));
    }
});

// ===== 下载队列 =====
const dlQueue = [];

function toggleDlQueue() {
    const panel = document.getElementById('dlQueuePanel');
    panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
}

function updateDlQueueBadge() {
    const total = dlQueue.length;
    const active = dlQueue.filter(t => t.status === 'pending' || t.status === 'downloading').length;
    const badge = document.getElementById('dlQueueBadge');
    const float = document.getElementById('dlQueueFloat');
    // 有活跃任务显示活跃数，否则显示总数
    if (badge) badge.textContent = String(active || total);
    if (float) float.style.display = total > 0 ? 'flex' : 'none';
}

function renderDlQueue() {
    const list = document.getElementById('dlQueueList');
    if (!list) return;
    updateDlQueueBadge();
    if (dlQueue.length === 0) {
        list.innerHTML = '<div class="dl-queue-empty">暂无下载任务</div>';
        return;
    }
    list.innerHTML = dlQueue.map((t, i) => {
        const iconClass = t.status;
        let icon, statusText;
        switch (t.status) {
            case 'pending': icon = 'fa-clock'; statusText = '等待中'; break;
            case 'downloading': icon = 'fa-spinner fa-spin'; statusText = '下载中...'; break;
            case 'done': icon = 'fa-circle-check'; statusText = t.path ? `已保存` : '完成'; break;
            case 'error': icon = 'fa-circle-xmark'; statusText = t.error || '失败'; break;
        }
        return `<div class="dl-queue-item">
            <div class="dl-q-icon ${iconClass}"><i class="fa-solid ${icon}"></i></div>
            <div class="dl-q-info">
                <div class="dl-q-name" title="${escapeHtmlText(t.name)}">${escapeHtmlText(t.name)}</div>
                <div class="dl-q-status ${t.status}">${statusText}</div>
            </div>
        </div>`;
    }).join('');
    updateDlQueueBadge();
}

async function processQueue() {
    const next = dlQueue.find(t => t.status === 'pending');
    if (!next) return;
    next.status = 'downloading';
    renderDlQueue();

    try {
        // 构建保存到 NAS 的 URL
        let url = next.url;
        if (!url.includes('save_local=')) {
            url += (url.includes('?') ? '&' : '?') + 'save_local=1';
        }
        if (webSettings.embedDownload && !url.includes('embed=')) {
            url += '&embed=1';
        }
        const data = await requestLocalDownload(url);
        next.status = 'done';
        next.path = data.path || webSettings.downloadDir;
    } catch (e) {
        next.status = 'error';
        next.error = e.message || '下载失败';
    }
    renderDlQueue();
    // 继续处理队列
    processQueue();
}

function addToDlQueue(name, url) {
    dlQueue.unshift({ name, url, status: 'pending', path: '', error: '' });
    renderDlQueue();
    // 如果没有正在下载的任务，开始处理
    if (!dlQueue.some(t => t.status === 'downloading')) {
        processQueue();
    }
    // 显示队列面板
    document.getElementById('dlQueuePanel').style.display = 'flex';
}

let navigationAbortController = null;
let pageNavigationEventsBound = false;

function isAppRoute(pathname) {
    return pathname === API_ROOT || pathname.startsWith(`${API_ROOT}/`);
}

function bindSourceSelectorButtons(root = document) {
    const checkboxes = root.querySelectorAll('.source-checkbox');

    const btnAll = document.getElementById('btn-all');
    if (btnAll) {
        btnAll.onclick = () => {
            checkboxes.forEach(cb => {
                if (!cb.disabled) cb.checked = true;
            });
        };
    }

    const btnNone = document.getElementById('btn-none');
    if (btnNone) {
        btnNone.onclick = () => {
            checkboxes.forEach(cb => {
                if (!cb.disabled) cb.checked = false;
            });
        };
    }
}

function bindSearchForm(root = document) {
    const searchForm = root.querySelector('#search-form');
    if (!searchForm) return;

    searchForm.onsubmit = (event) => {
        event.preventDefault();

        const pageInput = searchForm.querySelector('input[name="page"]');
        if (pageInput) {
            pageInput.value = '1';
        }

        const targetURL = new URL(searchForm.action, window.location.href);
        const params = new URLSearchParams();
        new FormData(searchForm).forEach((value, key) => {
            params.append(key, String(value));
        });
        targetURL.search = params.toString();

        navigateTo(targetURL.toString());
    };
}

function bindSongCardCovers(root = document) {
    const cards = root.querySelectorAll('.song-card');
    cards.forEach((card, index) => {
        queueInspectSong(card, index * INSPECT_REQUEST_DELAY_MS);

        const coverWrap = card.querySelector('.cover-wrapper');
        if (!coverWrap) return;

        coverWrap.style.cursor = 'pointer';
        coverWrap.title = '点击生成视频';
        coverWrap.onclick = (e) => {
            e.stopPropagation();
            if (window.VideoGen) {
                const img = coverWrap.querySelector('img');
                const currentCover = img ? img.src : (card.dataset.cover || '');

                window.VideoGen.open({
                    id: card.dataset.id,
                    source: card.dataset.source,
                    name: card.dataset.name,
                    artist: card.dataset.artist,
                    cover: currentCover,
                    duration: parseInt(card.dataset.duration) || 0
                });
            } else {
                console.error("VideoGen library not loaded.");
                showToast('视频生成组件加载失败，请刷新页面重试', 'error');
            }
        };
    });
}

function initializePageContent(root = document) {
    bindSourceSelectorButtons(root);
    bindSearchForm(root);

    const initialTypeEl = root.querySelector('input[name="type"]:checked');
    if (initialTypeEl) {
        toggleSearchType(initialTypeEl.value);
    }

    refreshDownloadLinks(root);
    bindSongCardCovers(root);
    updateBatchToolbar();
    highlightCard(currentPlayingId);
    syncAllPlayButtons();
    syncMediaSession();
}

function shouldHandleInternalNavigation(link, event) {
    if (!link || event.defaultPrevented) return false;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return false;
    }
    if (link.hasAttribute('download')) return false;

    const hrefAttr = String(link.getAttribute('href') || '').trim();
    if (!hrefAttr || hrefAttr.startsWith('#') || hrefAttr.startsWith('javascript:') || hrefAttr.startsWith('mailto:') || hrefAttr.startsWith('tel:')) {
        return false;
    }

    const targetAttr = String(link.getAttribute('target') || '').trim().toLowerCase();
    if (targetAttr && targetAttr !== '_self') {
        return false;
    }

    if (link.classList.contains('btn-download') || link.classList.contains('btn-lyric') || link.classList.contains('btn-cover')) {
        return false;
    }

    let targetURL;
    try {
        targetURL = new URL(hrefAttr, window.location.href);
    } catch (_) {
        return false;
    }

    return targetURL.origin === window.location.origin && isAppRoute(targetURL.pathname);
}

async function navigateTo(url, options = {}) {
    let targetURL;
    try {
        targetURL = new URL(url, window.location.href);
    } catch (_) {
        return false;
    }

    if (targetURL.origin !== window.location.origin || !isAppRoute(targetURL.pathname)) {
        window.location.href = targetURL.toString();
        return false;
    }

    if (navigationAbortController) {
        navigationAbortController.abort();
    }

    const controller = new AbortController();
    navigationAbortController = controller;

    try {
        const response = await fetch(targetURL.toString(), {
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            },
            signal: controller.signal
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const html = await response.text();
        const parser = new DOMParser();
        const nextDoc = parser.parseFromString(html, 'text/html');
        const nextContainer = nextDoc.querySelector('.container');
        const currentContainer = document.querySelector('.container');

        if (!nextContainer || !currentContainer) {
            throw new Error('missing container');
        }

        currentContainer.innerHTML = nextContainer.innerHTML;
        defaultDocumentTitle = nextDoc.title || defaultDocumentTitle;
        document.title = defaultDocumentTitle;

        const historyMode = options.historyMode || 'push';
        if (historyMode === 'replace') {
            window.history.replaceState(null, '', targetURL.toString());
        } else if (historyMode !== 'none') {
            if (targetURL.toString() === window.location.href) {
                window.history.replaceState(null, '', targetURL.toString());
            } else {
                window.history.pushState(null, '', targetURL.toString());
            }
        }

        initializePageContent(currentContainer);

        if (options.scroll !== false) {
            window.scrollTo({ top: 0, behavior: 'auto' });
        }

        return true;
    } catch (error) {
        if (error && error.name === 'AbortError') {
            return false;
        }
        window.location.href = targetURL.toString();
        return false;
    } finally {
        if (navigationAbortController === controller) {
            navigationAbortController = null;
        }
    }
}

function refreshCurrentPageContent(options = {}) {
    return navigateTo(window.location.href, {
        historyMode: 'replace',
        scroll: false,
        ...options
    });
}

function isEditableElement(element) {
    if (!(element instanceof Element)) return false;
    if (element.isContentEditable) return true;
    return !!element.closest('[contenteditable=""], [contenteditable="true"], input, textarea, select');
}

function hasVisibleModalOverlay() {
    return Array.from(document.querySelectorAll('.modal-overlay')).some((overlay) => {
        return window.getComputedStyle(overlay).display !== 'none';
    });
}

function getActivePaginationState() {
    const paginationBar = Array.from(document.querySelectorAll('.pagination-bar[data-current-page][data-total-pages]'))
        .find((bar) => bar.offsetParent !== null);
    if (!paginationBar) return null;

    const currentPage = parsePositiveInt(paginationBar.dataset.currentPage, 1);
    const totalPages = parsePositiveInt(paginationBar.dataset.totalPages, 1);
    if (totalPages <= 1) return null;

    return { currentPage, totalPages };
}

function handlePaginationShortcut(event) {
    if (event.defaultPrevented || event.isComposing) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (isEditableElement(event.target) || isEditableElement(document.activeElement)) return;
    if (hasVisibleModalOverlay()) return;

    let delta = 0;
    if (event.key === 'PageUp') {
        delta = -1;
    } else if (event.key === 'PageDown') {
        delta = 1;
    }
    if (delta === 0) return;

    const state = getActivePaginationState();
    if (!state) return;

    const nextPage = state.currentPage + delta;
    if (nextPage < 1 || nextPage > state.totalPages) return;

    event.preventDefault();
    goToPage(nextPage);
}

function bindPageNavigationEvents() {
    if (pageNavigationEventsBound) return;
    pageNavigationEventsBound = true;

    document.addEventListener('click', async function(event) {
        const link = event.target.closest('.btn-download');
        if (!link) return;
        if (!webSettings.downloadDir && !webSettings.downloadToLocal) return;
        event.preventDefault();
        await handleDownloadClick(link);
    });

    document.addEventListener('click', function(event) {
        const link = event.target.closest('a');
        if (!shouldHandleInternalNavigation(link, event)) return;

        event.preventDefault();
        navigateTo(link.href);
    }, true);

    document.addEventListener('keydown', handlePaginationShortcut);

    window.addEventListener('popstate', function() {
        navigateTo(window.location.href, {
            historyMode: 'none',
            scroll: false
        });
    });
}

document.addEventListener('DOMContentLoaded', function() {
    loadWebSettingsFromCache();
    applyWebSettings(webSettings);
    fetchWebSettings();
    bindPageNavigationEvents();
    initializePageContent(document);
    return;
    /*

    const cards = document.querySelectorAll('.song-card');
    cards.forEach((card, index) => {
        queueInspectSong(card, index * INSPECT_REQUEST_DELAY_MS);
    });

    cards.forEach(card => {
        const coverWrap = card.querySelector('.cover-wrapper');
        if (!coverWrap) return;
        
        coverWrap.style.cursor = 'pointer';
        coverWrap.title = '点击生成视频';
        
        coverWrap.onclick = (e) => {
            e.stopPropagation();
            if (window.VideoGen) {
                const img = coverWrap.querySelector('img');
                const currentCover = img ? img.src : (card.dataset.cover || '');

                window.VideoGen.open({
                    id: card.dataset.id,
                    source: card.dataset.source,
                    name: card.dataset.name,
                    artist: card.dataset.artist,
                    cover: currentCover,
                    duration: parseInt(card.dataset.duration) || 0
                });
            } else {
                console.error("VideoGen library not loaded.");
                showToast('视频生成组件加载失败，请刷新页面重试', 'error');
            }
        };
    });

    document.addEventListener('click', async function(event) {
        const link = event.target.closest('.btn-download');
        if (!link) return;
        if (!webSettings.downloadDir && !webSettings.downloadToLocal) return;
        event.preventDefault();
        await handleDownloadClick(link);
    });

    updateBatchToolbar();

    syncAllPlayButtons();
    */
});

function toggleSearchType(type) {
    const checkboxes = document.querySelectorAll('.source-checkbox');
    const searchInput = document.getElementById('search-keyword');
    const placeholders = {
        song: '搜索歌曲、歌手，或直接粘贴分享链接',
        playlist: '搜索歌单、创建者，或直接粘贴歌单链接',
        album: '搜索专辑、歌手，或直接粘贴专辑链接'
    };

    if (searchInput && placeholders[type]) {
        searchInput.placeholder = placeholders[type];
    }

    checkboxes.forEach(cb => {
        let isSupported = true;
        if (type === 'playlist') {
            isSupported = cb.dataset.playlistSupported === 'true';
        } else if (type === 'album') {
            isSupported = cb.dataset.albumSupported === 'true';
        }

        if (type === 'playlist' || type === 'album') {
            if (!isSupported) {
                cb.disabled = true;
                cb.checked = false;
            } else {
                cb.disabled = false;
            }
        } else {
            cb.disabled = false;
        }
    });
}

function goToRecommend() {
    const supported = ['netease', 'qq', 'kugou', 'kuwo'];
    const selected = [];
    document.querySelectorAll('.source-checkbox:checked').forEach(cb => {
        if (supported.includes(cb.value)) {
            selected.push(cb.value);
        }
    });
    
    if (selected.length === 0) {
        navigateTo(API_ROOT + '/recommend?sources=' + supported.join('&sources='));
    } else {
        navigateTo(API_ROOT + '/recommend?sources=' + selected.join('&sources='));
    }
}

function goToPage(page) {
    const target = parseInt(page, 10);
    if (!Number.isFinite(target) || target < 1) return;
    const url = new URL(window.location.href);
    url.searchParams.set('page', String(target));
    navigateTo(url.toString());
}

function parsePositiveInt(value, fallbackValue) {
    const parsed = Number.parseInt(String(value || ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallbackValue;
    }
    return parsed;
}

function songFromCard(card) {
    if (!card) return null;
    const ds = card.dataset;
    if (!ds.id || !ds.source) return null;

    let coverUrl = ds.cover || '';
    const imgEl = card.querySelector('.cover-wrapper img');
    if (imgEl && imgEl.src) {
        coverUrl = imgEl.src;
    }

    return {
        id: ds.id,
        source: ds.source,
        name: ds.name || '',
        artist: ds.artist || '',
        album: ds.album || '',
        duration: parsePositiveInt(ds.duration, 0),
        cover: coverUrl,
        extra: ds.extra || ''
    };
}

function inspectSong(card) {
    const id = card.dataset.id;
    const source = card.dataset.source;
    const duration = card.dataset.duration;
    const extra = card.dataset.extra || '';

    const params = new URLSearchParams({
        id: String(id || ''),
        source: String(source || ''),
        duration: String(duration || '')
    });
    if (extra !== '' && extra !== '{}' && extra !== 'null') {
        params.set('extra', extra);
    }

    fetch(`${API_ROOT}/inspect?${params.toString()}`)
        .then(r => r.json())
        .then(data => {
            const sizeTag = document.getElementById(`size-${id}`);
            const bitrateTag = document.getElementById(`bitrate-${id}`);

            if (data.valid) {
                if (sizeTag) {
                    sizeTag.textContent = data.size;
                    sizeTag.className = "tag tag-success"; 
                }
                if (bitrateTag) {
                    bitrateTag.textContent = data.bitrate;
                    bitrateTag.className = "tag";
                }
            } else {
                if (sizeTag) {
                    sizeTag.textContent = "无效";
                    sizeTag.className = "tag tag-fail";
                }
                if (bitrateTag) {
                    bitrateTag.textContent = "-";
                    bitrateTag.className = "tag";
                }
            }
        })
        .catch(() => {
            const el = document.getElementById(`size-${id}`);
            if(el) el.textContent = "检测失败";
        });
}

function queueInspectSong(card, delay = INSPECT_REQUEST_DELAY_MS) {
    window.setTimeout(() => inspectSong(card), delay);
}

// ===== Tab 切换 =====
function switchSettingsTab(name, el) {
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.stab-panel').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    const panel = document.getElementById('stab-' + name);
    if (panel) panel.classList.add('active');
}

// ===== 授权文件夹选择 =====
let _dirPickerVisible = false;

function updateDirUI(path) {
    const notSet = document.getElementById('dirNotSet');
    const field = document.getElementById('dirField');
    const input = document.getElementById('setting-download-dir');
    if (path) {
        if (notSet) notSet.style.display = 'none';
        if (field) field.style.display = 'flex';
        if (input) input.value = path;
    } else {
        if (notSet) notSet.style.display = 'flex';
        if (field) field.style.display = 'none';
        if (input) input.value = '';
    }
}

async function openDirPicker() {
    const listEl = document.getElementById('authorizedDirList');
    if (_dirPickerVisible) {
        listEl.style.display = 'none';
        _dirPickerVisible = false;
        return;
    }

    listEl.style.display = 'block';
    listEl.innerHTML = '<div class="dir-empty">加载中...</div>';
    _dirPickerVisible = true;

    try {
        const resp = await fetch(API_ROOT + '/authorized-dirs');
        if (!resp.ok) throw new Error();
        const data = await resp.json();
        const currentDir = document.getElementById('setting-download-dir')?.value || '';

        if (!data.dirs || data.dirs.length === 0) {
            let debug = '';
            if (data.shareFile) {
                debug = '<br><small style="color:#d4d4d4;word-break:break-all;">' +
                    'share: ' + escapeHtmlText(data.shareFile) +
                    '<br>access: ' + escapeHtmlText(data.accessFile || '') +
                    '<br>HOME: ' + escapeHtmlText(data.home || '?') + '</small>';
            }
            listEl.innerHTML = '<div class="dir-empty">暂无可用目录<br>请在飞牛 应用设置 → 共享文件夹权限 中授权<br>授权后需重启应用或重新打开本页面' + debug + '</div>';
            return;
        }

        let html = '';
        for (const d of data.dirs) {
            const selected = (d.path === currentDir) ? ' selected' : '';
            const escapedPath = d.path.replace(/&/g,'&amp;').replace(/'/g,'&#39;');
            const icon = d.source === 'share' ? 'fa-hard-drive' : 'fa-folder';
            html += '<div class="dir-item' + selected + '" onclick="selectAuthorizedDir(\'' + escapedPath + '\', this)">' +
                '<i class="fa-solid ' + icon + '"></i>' +
                '<span>' + escapeHtmlText(d.name) + '</span>' +
                '<span class="dir-path">' + escapeHtmlText(d.path) + '</span>' +
                '</div>';
        }
        listEl.innerHTML = html;
    } catch (e) {
        listEl.innerHTML = '<div class="dir-empty">获取失败，请重试</div>';
    }
}

function selectAuthorizedDir(path, el) {
    updateDirUI(path);
    document.getElementById('authorizedDirList').style.display = 'none';
    _dirPickerVisible = false;
    if (el) {
        document.querySelectorAll('.dir-item').forEach(d => d.classList.remove('selected'));
        el.classList.add('selected');
    }
}

function escapeHtmlText(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function openCookieModal() {
    document.getElementById('cookieModal').style.display = 'flex';
    // 重置到下载 tab
    document.querySelectorAll('.settings-tab').forEach((t, i) => t.classList.toggle('active', i === 0));
    document.querySelectorAll('.stab-panel').forEach((p, i) => p.classList.toggle('active', i === 0));
    // 关闭目录列表
    _dirPickerVisible = false;
    const dirList = document.getElementById('authorizedDirList');
    if (dirList) dirList.style.display = 'none';
    Promise.all([
        fetch(API_ROOT + '/cookies').then(r => r.json()),
        fetch(API_ROOT + '/settings').then(r => r.json())
    ]).then(([cookies, settings]) => {
        applyWebSettings(settings);
        for (const [k, v] of Object.entries(cookies || {})) {
            const el = document.getElementById(`cookie-${k}`);
            if (el) el.value = v;
        }
    }).catch(() => {
        applyWebSettings(webSettings);
    });
}

function saveCookies() {
    const webPageSizeInput = document.getElementById('setting-web-page-size');
    const cliPageSizeInput = document.getElementById('setting-cli-page-size');

    const nextSettings = normalizeWebSettings({
        embedDownload: !!document.getElementById('setting-embed-download')?.checked,
        downloadToLocal: !!document.getElementById('setting-download-to-local')?.checked,
        downloadDir: document.getElementById('setting-download-dir')?.value || '',
        webPageSize: parsePositiveInt(webPageSizeInput?.value, DEFAULT_WEB_PAGE_SIZE),
        cliPageSize: parsePositiveInt(cliPageSizeInput?.value, DEFAULT_CLI_PAGE_SIZE),
        vgChangeCover: !!document.getElementById('setting-vg-change-cover')?.checked,
        vgChangeAudio: !!document.getElementById('setting-vg-change-audio')?.checked,
        vgChangeLyric: !!document.getElementById('setting-vg-change-lyric')?.checked,
        vgExportVideo: !!document.getElementById('setting-vg-export-video')?.checked
    });

    const data = {};
    document.querySelectorAll('input[id^="cookie-"]').forEach(input => {
        data[input.id.replace('cookie-', '')] = input.value;
    });

    Promise.all([
        fetch(API_ROOT + '/cookies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        }),
        fetch(API_ROOT + '/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(nextSettings)
        }).then(r => r.ok ? r.json() : Promise.reject())
    ]).then(([, savedSettings]) => {
        applyWebSettings(savedSettings || nextSettings);
        showToast('保存成功', 'success');
        document.getElementById('cookieModal').style.display = 'none';
    }).catch(() => {
        showToast('保存失败，请稍后重试', 'error');
    });
}

window.addEventListener('scroll', () => {
    const btn = document.getElementById('back-to-top');
    if(!btn) return;
    if (window.scrollY > 300) {
        btn.classList.add('show');
    } else {
        btn.classList.remove('show');
    }
});

function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

let defaultDocumentTitle = document.title;
let mediaSessionSyncTimer = 0;
let mediaSessionSyncVersion = 0;
const mediaSessionCoverCache = new Map();

function mediaSessionControllerSupported() {
    return typeof navigator !== 'undefined' && !!navigator.mediaSession;
}

function mediaSessionMetadataSupported() {
    return mediaSessionControllerSupported() && typeof window.MediaMetadata === 'function';
}

function getCurrentAPlayerAudio() {
    if (!ap || !ap.list || !Array.isArray(ap.list.audios)) return null;
    const index = ap.list.index;
    if (typeof index !== 'number' || index < 0) return null;
    return ap.list.audios[index] || null;
}

function buildMediaSessionTrackKey(audio = getCurrentAPlayerAudio()) {
    if (!audio) return '';

    const customId = String(audio.custom_id || '').trim();
    if (customId) return customId;

    const source = String(audio.source || '').trim();
    const name = String(audio.name || '').trim();
    const artist = String(audio.artist || '').trim();
    if (!source && !name && !artist) return '';

    return `${source}::${name}::${artist}`;
}

function normalizeMediaSessionURL(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    try {
        return new URL(raw, window.location.href).toString();
    } catch (_) {
        return raw;
    }
}

function isTransientMediaSessionURL(value) {
    const lowered = String(value || '').trim().toLowerCase();
    return lowered.startsWith('data:') || lowered.startsWith('blob:');
}

function extractURLFromBackgroundImage(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const match = raw.match(/^url\((['"]?)(.*)\1\)$/i);
    if (!match || !match[2]) return '';
    return match[2].trim();
}

function buildMediaSessionCoverURL(audio = getCurrentAPlayerAudio()) {
    const candidates = [];
    const trackKey = buildMediaSessionTrackKey(audio);

    if (audio) {
        candidates.push({
            url: audio.cover,
            source: audio.source || ''
        });
    }

    const currentId = String(audio?.custom_id || '').trim();
    if (currentId) {
        const card = Array.from(document.querySelectorAll('.song-card')).find(item => item?.dataset?.id === currentId);
        if (card) {
            const imgEl = card.querySelector('.cover-wrapper img');
            if (imgEl && imgEl.src) {
                candidates.unshift({
                    url: imgEl.src,
                    source: card.dataset.source || audio?.source || ''
                });
            }

            if (card.dataset.cover) {
                candidates.push({
                    url: card.dataset.cover,
                    source: card.dataset.source || audio?.source || ''
                });
            }
        }
    }

    const apPic = document.querySelector('.aplayer-pic');
    if (apPic?.style?.backgroundImage) {
        const playerCover = extractURLFromBackgroundImage(apPic.style.backgroundImage);
        if (playerCover) {
            candidates.unshift({
                url: playerCover,
                source: audio?.source || ''
            });
        }
    }

    const fallbackCandidates = [];
    const seen = new Set();
    for (const candidate of candidates) {
        const normalized = normalizeMediaSessionURL(candidate?.url);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);

        if (isTransientMediaSessionURL(normalized)) {
            fallbackCandidates.push(normalized);
            continue;
        }

        try {
            const parsed = new URL(normalized, window.location.href);
            if (parsed.origin === window.location.origin && parsed.pathname === `${API_ROOT}/cover_proxy`) {
                const resolved = parsed.toString();
                if (trackKey) {
                    mediaSessionCoverCache.set(trackKey, resolved);
                }
                return resolved;
            }

            const proxy = new URL(`${API_ROOT}/cover_proxy`, window.location.href);
            proxy.searchParams.set('url', parsed.toString());
            const sourceValue = String(candidate?.source || '').trim();
            if (sourceValue) {
                proxy.searchParams.set('source', sourceValue);
            }
            const resolved = proxy.toString();
            if (trackKey) {
                mediaSessionCoverCache.set(trackKey, resolved);
            }
            return resolved;
        } catch (_) {
            if (trackKey) {
                mediaSessionCoverCache.set(trackKey, normalized);
            }
            return normalized;
        }
    }

    if (trackKey) {
        const cached = mediaSessionCoverCache.get(trackKey);
        if (cached) {
            return cached;
        }
    }

    if (fallbackCandidates.length > 0) {
        return fallbackCandidates[0];
    }

    return '';
}

function buildMediaSessionArtwork(audio = getCurrentAPlayerAudio()) {
    const src = buildMediaSessionCoverURL(audio);
    if (!src) return [];

    return [{ src }];
}

function updateDocumentTitleForMedia(audio) {
    if (!audio || !audio.name) {
        document.title = defaultDocumentTitle;
        return;
    }

    const parts = [audio.name];
    if (audio.artist) {
        parts.push(audio.artist);
    }
    document.title = `${parts.join(' - ')} | music-dl`;
}

function shouldPreserveMediaSessionMetadata() {
    return !!(ap?.list?.audios?.length);
}

function updateMediaSessionMetadata(audio = getCurrentAPlayerAudio()) {
    if (!mediaSessionControllerSupported()) return;

    if (!audio) {
        if (shouldPreserveMediaSessionMetadata()) {
            return;
        }
        if (mediaSessionMetadataSupported()) {
            navigator.mediaSession.metadata = null;
        }
        updateDocumentTitleForMedia(null);
        return;
    }

    if (!mediaSessionMetadataSupported()) {
        updateDocumentTitleForMedia(audio);
        return;
    }

    const metadata = {
        title: audio.name || 'music-dl',
        artist: audio.artist || ''
    };

    if (audio.album) {
        metadata.album = audio.album;
    }

    const artwork = buildMediaSessionArtwork(audio);
    if (artwork.length > 0) {
        metadata.artwork = artwork;
    }

    navigator.mediaSession.metadata = new MediaMetadata(metadata);
    updateDocumentTitleForMedia(audio);
}

function updateMediaSessionPlaybackState() {
    if (!mediaSessionControllerSupported()) return;

    const audio = getCurrentAPlayerAudio();
    if (!ap?.audio || !audio) {
        navigator.mediaSession.playbackState = 'none';
        return;
    }

    navigator.mediaSession.playbackState = ap.audio.paused ? 'paused' : 'playing';
}

function updateMediaSessionPositionState() {
    if (!mediaSessionControllerSupported()) return;
    if (!ap?.audio || typeof navigator.mediaSession.setPositionState !== 'function') return;

    const duration = Number(ap.audio.duration);
    const position = Number(ap.audio.currentTime);
    const playbackRate = Number(ap.audio.playbackRate) || 1;

    if (!Number.isFinite(duration) || duration <= 0) return;
    if (!Number.isFinite(position) || position < 0) return;

    try {
        navigator.mediaSession.setPositionState({
            duration,
            playbackRate,
            position: Math.min(position, duration)
        });
    } catch (_) {
    }
}

function syncMediaSession(audio = getCurrentAPlayerAudio()) {
    if (!mediaSessionControllerSupported()) return;
    updateMediaSessionMetadata(audio);
    updateMediaSessionPlaybackState();
    updateMediaSessionPositionState();
}

function scheduleMediaSessionSync(audio = getCurrentAPlayerAudio(), delayMs = 160) {
    if (!mediaSessionControllerSupported()) return;

    const expectedId = String(audio?.custom_id || '').trim();
    const syncVersion = ++mediaSessionSyncVersion;

    if (mediaSessionSyncTimer) {
        clearTimeout(mediaSessionSyncTimer);
    }

    mediaSessionSyncTimer = setTimeout(() => {
        if (syncVersion !== mediaSessionSyncVersion) return;

        const currentAudio = getCurrentAPlayerAudio();
        if (expectedId && currentAudio && String(currentAudio.custom_id || '').trim() !== expectedId) {
            return;
        }

        syncMediaSession(currentAudio || audio);
    }, Math.max(0, Number(delayMs) || 0));
}

function clearMediaSession() {
    if (!mediaSessionControllerSupported()) return;
    mediaSessionSyncVersion++;
    if (mediaSessionSyncTimer) {
        clearTimeout(mediaSessionSyncTimer);
        mediaSessionSyncTimer = 0;
    }
    if (mediaSessionMetadataSupported()) {
        navigator.mediaSession.metadata = null;
    }
    navigator.mediaSession.playbackState = 'none';
    updateDocumentTitleForMedia(null);
}

function switchTrackByOffset(offset) {
    if (!ap?.list?.audios?.length) return;

    const total = ap.list.audios.length;
    const currentIndex = (typeof ap.list.index === 'number' && ap.list.index >= 0) ? ap.list.index : 0;
    const nextIndex = (currentIndex + offset + total) % total;

    ap.list.switch(nextIndex);
    ap.play();
}

function seekCurrentTrack(position) {
    if (!ap?.audio) return;

    const duration = Number(ap.audio.duration);
    if (!Number.isFinite(duration) || duration <= 0) return;

    const target = Math.max(0, Math.min(duration, Number(position) || 0));
    try {
        if (typeof ap.audio.fastSeek === 'function') {
            ap.audio.fastSeek(target);
        } else {
            ap.audio.currentTime = target;
        }
    } catch (_) {
        ap.audio.currentTime = target;
    }

    updateMediaSessionPositionState();
}

function adjustCurrentTrackPosition(offset) {
    if (!ap?.audio) return;
    seekCurrentTrack((Number(ap.audio.currentTime) || 0) + offset);
}

function registerMediaSessionAction(action, handler) {
    if (!mediaSessionControllerSupported()) return;
    try {
        navigator.mediaSession.setActionHandler(action, handler);
    } catch (_) {
    }
}

function bindMediaSessionAudioEvents() {
    if (!ap?.audio || ap.audio.dataset.mediaSessionBound === '1') return;

    ap.audio.dataset.mediaSessionBound = '1';
    const syncPosition = () => updateMediaSessionPositionState();
    const syncState = () => {
        updateMediaSessionPlaybackState();
        updateMediaSessionPositionState();
    };

    ['timeupdate', 'durationchange', 'loadedmetadata', 'seeked', 'ratechange'].forEach((eventName) => {
        ap.audio.addEventListener(eventName, syncPosition);
    });
    ['play', 'pause'].forEach((eventName) => {
        ap.audio.addEventListener(eventName, syncState);
    });
    ap.audio.addEventListener('loadedmetadata', () => {
        syncMediaSession();
        scheduleMediaSessionSync(getCurrentAPlayerAudio(), 180);
    });
}

function setupMediaSession() {
    if (!mediaSessionControllerSupported()) return;

    bindMediaSessionAudioEvents();

    registerMediaSessionAction('play', () => {
        if (!ap?.list?.audios?.length) return;
        ap.play();
    });
    registerMediaSessionAction('pause', () => {
        ap?.pause();
    });
    registerMediaSessionAction('stop', () => {
        ap?.pause();
        seekCurrentTrack(0);
        syncMediaSession();
    });
    registerMediaSessionAction('previoustrack', () => {
        switchTrackByOffset(-1);
    });
    registerMediaSessionAction('nexttrack', () => {
        switchTrackByOffset(1);
    });
    registerMediaSessionAction('seekbackward', (details) => {
        adjustCurrentTrackPosition(-(Number(details?.seekOffset) || 10));
    });
    registerMediaSessionAction('seekforward', (details) => {
        adjustCurrentTrackPosition(Number(details?.seekOffset) || 10);
    });
    registerMediaSessionAction('seekto', (details) => {
        if (!details || typeof details.seekTime !== 'number') return;
        seekCurrentTrack(details.seekTime);
    });

    syncMediaSession();
}

// APlayer Config
const ap = new APlayer({
    container: document.getElementById('aplayer'),
    fixed: true, 
    autoplay: false, 
    theme: '#10b981',
    loop: 'all', 
    order: 'list', 
    preload: 'auto', 
    volume: 0.7, 
    listFolded: false, 
    lrcType: 3, 
    audio: []
});

window.ap = ap; 
let currentPlayingId = null;
window.currentPlayingId = null; 

setupMediaSession();

setTimeout(() => {
    const apPic = document.querySelector('.aplayer-pic');
    if (apPic) {
        apPic.style.cursor = 'pointer';
        apPic.title = '点击打开详情/生成视频';
        
        apPic.addEventListener('click', (e) => {
            if (e.target.closest('.aplayer-button') || e.target.closest('.aplayer-play')) {
                return;
            }
            e.stopPropagation();
            e.preventDefault();
            
            const idx = ap.list.index;
            const audio = ap.list.audios[idx];
            
            if (audio && audio.custom_id && window.VideoGen) {
                window.VideoGen.open({
                    id: audio.custom_id,
                    source: audio.source || 'netease',
                    name: audio.name,
                    artist: audio.artist,
                    cover: audio.cover,
                    duration: 0 
                });
            }
        }, true);
    }
}, 800); 

ap.on('listswitch', (e) => {
    const index = e.index;
    const newAudio = ap.list.audios[index];
    if (newAudio && newAudio.custom_id) {
        currentPlayingId = newAudio.custom_id;
        window.currentPlayingId = currentPlayingId; 
        highlightCard(currentPlayingId);
        syncAllPlayButtons();

        const vgModal = document.getElementById("vg-modal");
        if (vgModal && vgModal.classList.contains("active") && window.VideoGen) {
            if (!window.VideoGen.data || window.VideoGen.data.id !== currentPlayingId) {
                window.VideoGen.open({
                    id: newAudio.custom_id,
                    source: newAudio.source || 'netease',
                    name: newAudio.name,
                    artist: newAudio.artist,
                    cover: newAudio.cover,
                    duration: 0
                });
            }
        }
    }
    syncMediaSession(newAudio || getCurrentAPlayerAudio());
    scheduleMediaSessionSync(newAudio || getCurrentAPlayerAudio(), 180);
});

ap.on('play', () => {
    const idx = ap?.list?.index;
    const audio = (typeof idx === 'number') ? ap.list.audios[idx] : null;
    if (audio && audio.custom_id) {
        currentPlayingId = audio.custom_id;
        window.currentPlayingId = currentPlayingId; 
        highlightCard(currentPlayingId);
    }
    syncAllPlayButtons();
    syncMediaSession(audio || getCurrentAPlayerAudio());
    scheduleMediaSessionSync(audio || getCurrentAPlayerAudio(), 180);
    
    if (window.VideoGen && window.VideoGen.updatePlayBtnState) {
        window.VideoGen.updatePlayBtnState(true);
    }
});

ap.on('pause', () => {
    syncAllPlayButtons();
    syncMediaSession();
    if (window.VideoGen && window.VideoGen.updatePlayBtnState) {
        window.VideoGen.updatePlayBtnState(false);
    }
});

ap.on('ended', () => {
    currentPlayingId = null;
    window.currentPlayingId = null; 
    highlightCard(null);
    syncAllPlayButtons();
    scheduleMediaSessionSync(getCurrentAPlayerAudio(), 180);
});

function highlightCard(targetId) {
    document.querySelectorAll('.song-card').forEach(c => c.classList.remove('playing-active'));
    if(!targetId) return;
    const target = document.querySelector(`.song-card[data-id="${targetId}"]`);
    if (target) {
        target.classList.add('playing-active');
    }
}

function setPlayButtonState(card, isPlaying) {
    if (!card) return;
    const btn = card.querySelector('.btn-play');
    if(!btn) return;
    const icon = btn.querySelector('i');
    if (!icon) return;

    icon.classList.remove('fa-play', 'fa-stop');
    icon.classList.add(isPlaying ? 'fa-stop' : 'fa-play');
    btn.title = isPlaying ? '停止' : '播放';
}

function syncAllPlayButtons() {
    const isActuallyPlaying = ap?.audio && !ap.audio.paused;
    document.querySelectorAll('.song-card').forEach(card => {
        const id = card.dataset.id;
        const active = isActuallyPlaying && currentPlayingId && id === currentPlayingId;
        setPlayButtonState(card, active);
    });
}

function formatDuration(seconds) {
    const s = Number(seconds || 0);
    if (!s || s <= 0) return '-';
    const min = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => {
        switch (char) {
        case '&':
            return '&amp;';
        case '<':
            return '&lt;';
        case '>':
            return '&gt;';
        case '"':
            return '&quot;';
        case '\'':
            return '&#39;';
        default:
            return char;
        }
    });
}

function containsEastAsianChar(value) {
    return /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/.test(String(value || ''));
}

function trimArtistToken(value) {
    return String(value || '').trim().replace(/^[-_·•/|\\,，、;；&＆]+|[-_·•/|\\,，、;；&＆]+$/g, '').trim();
}

function splitArtistTokens(artist) {
    const rawArtist = String(artist || '').trim();
    if (!rawArtist) return [];

    let normalized = rawArtist.replace(/\s+(feat(?:uring)?\.?|ft\.?|with|x)\s+/ig, '|');
    normalized = normalized.replace(/[、,，;；|]/g, '|');

    if (containsEastAsianChar(rawArtist)) {
        normalized = normalized.replace(/[\/／&＆]/g, '|');
    } else {
        normalized = normalized.replace(/\s+(?:\/|／|&|＆)\s+/g, '|');
    }

    const tokens = [];
    const seen = new Set();
    normalized.split('|').forEach((item) => {
        const token = trimArtistToken(item);
        const key = token.toLowerCase().replace(/\s+/g, ' ').trim();
        if (!key || seen.has(key)) return;
        seen.add(key);
        tokens.push(token);
    });

    return tokens.length > 0 ? tokens : [rawArtist];
}

function buildArtistSearchURL(source, artist) {
    const params = new URLSearchParams({
        q: String(artist || ''),
        type: 'song',
        exact_artist: String(artist || ''),
        sources: String(source || '')
    });
    return `${API_ROOT}/search?${params.toString()}`;
}

function buildAlbumDetailURL(source, albumId) {
    const params = new URLSearchParams({
        id: String(albumId || ''),
        source: String(source || '')
    });
    return `${API_ROOT}/album?${params.toString()}`;
}

function buildAlbumJumpURL(source, album, artist) {
    const params = new URLSearchParams({
        name: String(album || ''),
        artist: String(artist || ''),
        source: String(source || '')
    });
    return `${API_ROOT}/album_jump?${params.toString()}`;
}

function getSongAlbumId(song) {
    if (song && song.album_id) return String(song.album_id);
    if (song && song.albumId) return String(song.albumId);
    if (song && song.extra && typeof song.extra === 'object' && song.extra.album_id) {
        return String(song.extra.album_id);
    }
    return '';
}

function renderArtistLineHTML(song) {
    const artists = splitArtistTokens(song.artist || '');
    const parts = ['<i class="fa-regular fa-user artist-icon"></i>'];

    if (artists.length > 0) {
        artists.forEach((artist, index) => {
            if (index > 0) {
                parts.push('<span class="meta-separator">/</span>');
            }
            parts.push(`<a href="${buildArtistSearchURL(song.source, artist)}" class="meta-link artist-link">${escapeHTML(artist)}</a>`);
        });
    } else {
        parts.push('<span>-</span>');
    }

    if (song.album) {
        const albumId = getSongAlbumId(song);
        parts.push('<span class="meta-separator">&middot;</span>');
        const href = albumId
            ? buildAlbumDetailURL(song.source, albumId)
            : buildAlbumJumpURL(song.source, song.album, song.artist || '');
        parts.push(`<a href="${href}" class="meta-link album-link">${escapeHTML(song.album)}</a>`);
    }

    return parts.join('');
}

function updateCardWithSong(card, song) {
    const oldId = card.dataset.id; 

    card.dataset.id = song.id;
    card.dataset.source = song.source;
    card.dataset.albumId = getSongAlbumId(song);
    card.dataset.album = song.album || '';
    card.dataset.duration = song.duration || 0;
    card.dataset.name = song.name || card.dataset.name;
    card.dataset.artist = song.artist || card.dataset.artist;
    card.dataset.cover = song.cover || '';
    card.dataset.extra = song.extra ? JSON.stringify(song.extra) : '';

    const titleEl = card.querySelector('.song-info h3');
    if (titleEl) {
        if (song.link) {
            titleEl.innerHTML = `<a href="${song.link}" target="_blank" class="song-title-link" title="打开原始链接">${song.name || ''}</a>`;
        } else {
            titleEl.textContent = song.name || '';
        }
    }

    const artistLine = card.querySelector('.artist-line');
    if (artistLine) {
        artistLine.innerHTML = renderArtistLineHTML(song);
    }

    const sourceTag = card.querySelector('.tag-src');
    if (sourceTag) sourceTag.textContent = song.source;

    const durationTag = card.querySelector('.tag-duration');
    if (durationTag) {
        durationTag.textContent = formatDuration(song.duration);
    }

    const coverWrap = card.querySelector('.cover-wrapper');
    if (coverWrap) {
        let imgEl = coverWrap.querySelector('img');
        if (!imgEl) {
            imgEl = document.createElement('img');
            coverWrap.innerHTML = '';
            coverWrap.appendChild(imgEl);
        }
        imgEl.src = song.cover || 'https://via.placeholder.com/150?text=Music';
        imgEl.alt = song.name || '';
        
        coverWrap.onclick = (e) => {
            e.stopPropagation();
            if (window.VideoGen) {
                window.VideoGen.open({
                    id: card.dataset.id,
                    source: card.dataset.source,
                    name: card.dataset.name,
                    artist: card.dataset.artist,
                    cover: imgEl.src,
                    duration: parseInt(card.dataset.duration) || 0
                });
            }
        };
    }

    const dl = card.querySelector('.btn-download');
    if (dl) {
        dl.href = buildDownloadURL(song.id, song.source, song.name, song.artist, song.cover || '', card.dataset.extra || '');
        dl.id = `dl-${song.id}`;
        dl.title = webSettings.downloadToLocal ? '保存到本地目录' : '下载歌曲';
    }

    const lrc = card.querySelector('.btn-lyric');
    if (lrc) {
        lrc.href = `${API_ROOT}/download_lrc?id=${encodeURIComponent(song.id)}&source=${song.source}&name=${encodeURIComponent(song.name)}&artist=${encodeURIComponent(song.artist)}`;
        lrc.id = `lrc-${song.id}`;
    }

    const coverBtn = card.querySelector('.btn-cover');
    if (coverBtn) {
        // 让新卡片的封面按钮始终能够使用或使用占位图响应
        let targetCoverUrl = song.cover || 'https://via.placeholder.com/600?text=No+Cover';
        coverBtn.href = `${API_ROOT}/download_cover?url=${encodeURIComponent(targetCoverUrl)}&name=${encodeURIComponent(song.name)}&artist=${encodeURIComponent(song.artist)}`;
    }

    const sizeTag = card.querySelector('[id^="size-"]');
    if (sizeTag) {
        sizeTag.id = `size-${song.id}`;
        sizeTag.className = 'tag tag-loading';
        sizeTag.innerHTML = '<i class="fa fa-spinner fa-spin"></i>';
    }
    const bitrateTag = card.querySelector('[id^="bitrate-"]');
    if (bitrateTag) {
        bitrateTag.id = `bitrate-${song.id}`;
        bitrateTag.className = 'tag tag-loading';
        bitrateTag.innerHTML = '<i class="fa fa-circle-notch fa-spin"></i>';
    }

    if (currentPlayingId === oldId) {
        currentPlayingId = song.id;
    }

    syncAllPlayButtons();
    queueInspectSong(card);
    syncSongToAPlayer(oldId, song);
    if (currentPlayingId === song.id) {
        syncMediaSession();
    }
}

function syncSongToAPlayer(oldId, newSong) {
    if (!ap || !ap.list || !ap.list.audios) return;
    const index = ap.list.audios.findIndex(a => a.custom_id === oldId);
    if (index !== -1) {
        const audio = ap.list.audios[index];
        audio.name = newSong.name;
        audio.artist = newSong.artist;
        audio.album = newSong.album || '';
        audio.cover = newSong.cover;
        audio.url = buildStreamURL(newSong.id, newSong.source, newSong.name, newSong.artist, newSong.cover || '', newSong.extra ? JSON.stringify(newSong.extra) : '');
        audio.lrc = `${API_ROOT}/lyric?id=${encodeURIComponent(newSong.id)}&source=${newSong.source}`;
        audio.custom_id = newSong.id; 
        audio.source = newSong.source; 
        
        if (ap.list.index === index) {
            ap.list.switch(index); 
            if (ap.audio.paused) {
                ap.play();
            }
        }
    }
}

function switchSource(btn) {
    const card = btn.closest('.song-card');
    if (!card) return;

    const ds = card.dataset;
    const name = ds.name || '';
    const artist = ds.artist || '';
    const source = ds.source || '';
    if (!name || !source) return;

    btn.disabled = true;
    btn.style.opacity = '0.6';

    const duration = ds.duration || '';
    const url = `${API_ROOT}/switch_source?name=${encodeURIComponent(name)}&artist=${encodeURIComponent(artist)}&source=${encodeURIComponent(source)}&duration=${encodeURIComponent(duration)}`;
    fetch(url)
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(song => {
            updateCardWithSong(card, song);
        })
        .catch(() => {
            showToast('换源失败，请稍后重试', 'error');
        })
        .finally(() => {
            btn.disabled = false;
            btn.style.opacity = '1';
        });
}

function playAllAndJumpTo(btn) {
    const currentCard = btn.closest('.song-card');
    const allCards = Array.from(document.querySelectorAll('.song-card'));
    const clickedIndex = allCards.indexOf(currentCard);

    if (clickedIndex === -1) return;

    const clickedId = currentCard.dataset.id;
    const isActuallyPlaying = ap?.audio && !ap.audio.paused;

    if (currentPlayingId && currentPlayingId === clickedId && isActuallyPlaying) {
        ap.pause();
        try { ap.seek(0); } catch (e) {}
        currentPlayingId = null;
        highlightCard(null);
        syncAllPlayButtons();
        syncMediaSession();
        return;
    }

    ap.list.clear();
    const playlist = [];

    allCards.forEach(card => {
        const ds = card.dataset;
        let coverUrl = ds.cover || '';
        const imgEl = card.querySelector('.cover-wrapper img');
        if (imgEl && imgEl.src) coverUrl = imgEl.src;

        playlist.push({
            name: ds.name,
            artist: ds.artist,
            album: ds.album || '',
            url: buildStreamURL(ds.id, ds.source, ds.name, ds.artist, ds.cover || '', ds.extra || ''),
            cover: coverUrl,
            lrc: `${API_ROOT}/lyric?id=${encodeURIComponent(ds.id)}&source=${ds.source}`,
            theme: '#10b981',
            custom_id: ds.id,
            source: ds.source
        });
    });

    ap.list.add(playlist);
    ap.list.switch(clickedIndex);
    ap.play();

    currentPlayingId = clickedId;
    highlightCard(currentPlayingId);
    syncAllPlayButtons();
}

window.playAllAndJumpToId = function(songId) {
    const targetCard = document.querySelector(`.song-card[data-id="${songId}"]`);
    if (targetCard) {
        const btn = targetCard.querySelector('.btn-play');
        if (btn) {
            playAllAndJumpTo(btn);
        }
    }
};

let isBatchMode = false;

function toggleBatchMode() {
    isBatchMode = !isBatchMode;
    document.body.classList.toggle('batch-mode', isBatchMode);
    const btn = document.getElementById('btn-batch-toggle');
    const toolbar = document.getElementById('batch-toolbar');
    
    if(!btn || !toolbar) return;

    if (isBatchMode) {
        btn.innerHTML = '<i class="fa-solid fa-xmark"></i> 退出批量';
        btn.style.color = 'var(--error-color)';
        toolbar.classList.add('active'); 
    } else {
        btn.innerHTML = '<i class="fa-solid fa-list-check"></i> 批量操作';
        btn.style.color = 'var(--text-sub)';
        toolbar.classList.remove('active');
        document.querySelectorAll('.song-checkbox').forEach(cb => cb.checked = false);
        updateBatchToolbar();
    }
}

function updateBatchToolbar() {
    const checkedBoxes = document.querySelectorAll('.song-checkbox:checked');
    const count = checkedBoxes.length;
    const selectAllCb = document.getElementById('select-all-checkbox');
    const batchSwitch = document.getElementById('btn-batch-switch');
    const batchDl = document.getElementById('btn-batch-dl');
    
    if(document.getElementById('selected-count')) {
        document.getElementById('selected-count').textContent = count;
    }
    
    const allBoxes = document.querySelectorAll('.song-checkbox');
    if (allBoxes.length > 0 && selectAllCb) {
        selectAllCb.checked = (allBoxes.length === count);
    }

    if (count > 0) {
        if(batchSwitch) batchSwitch.disabled = false;
        if(batchDl) batchDl.disabled = false;
    } else {
        if(batchSwitch) batchSwitch.disabled = true;
        if(batchDl) batchDl.disabled = true;
    }
    
    document.querySelectorAll('.song-card').forEach(card => card.classList.remove('selected'));
    checkedBoxes.forEach(cb => {
        cb.closest('.song-card').classList.add('selected');
    });
}

function toggleSelectAll(mainCb) {
    const checkboxes = document.querySelectorAll('.song-checkbox');
    checkboxes.forEach(cb => cb.checked = mainCb.checked);
    updateBatchToolbar();
}

function selectInvalidSongs() {
    const invalidTags = document.querySelectorAll('.tag-fail');
    if (invalidTags.length === 0) {
        showToast('当前列表中没有检测到无效歌曲');
        return;
    }
    
    let count = 0;
    invalidTags.forEach(tag => {
        const card = tag.closest('.song-card');
        if (card) {
            const cb = card.querySelector('.song-checkbox');
            if (cb && !cb.checked) {
                cb.checked = true;
                count++;
            }
        }
    });
    
    if (count === 0) {
        showToast('无效歌曲已全部选中', 'success');
    }
    updateBatchToolbar();
}

function getSelectedSongs() {
    const checkedBoxes = document.querySelectorAll('.song-checkbox:checked');
    const songs = [];
    checkedBoxes.forEach(cb => {
        const card = cb.closest('.song-card');
        if (card) {
            const song = songFromCard(card);
            if (!song) return;
            const ds = card.dataset;

            songs.push({
                id: song.id,
                source: song.source,
                name: song.name,
                artist: song.artist,
                duration: song.duration,
                extra: song.extra,
                url: buildDownloadURL(song.id, song.source, song.name, song.artist, song.cover || '', song.extra || ''),
                cover: song.cover,
                lrc: `${API_ROOT}/lyric?id=${encodeURIComponent(ds.id)}&source=${ds.source}`,
                theme: '#10b981'
            });
        }
    });
    return songs;
}

async function batchDownload() {
    const songs = getSelectedSongs();
    if (songs.length === 0) return;
    const batchDl = document.getElementById('btn-batch-dl');
    const batchSwitch = document.getElementById('btn-batch-switch');
    const originalBatchDlHTML = batchDl ? batchDl.innerHTML : '';

    if (webSettings.downloadToLocal) {
        if (!confirm(`准备将 ${songs.length} 首歌曲保存到本地目录：\n${webSettings.downloadDir}`)) {
            return;
        }
    } else {
        if (!confirm(`准备下载 ${songs.length} 首歌曲。\n下载会依次开始，请保持页面打开直到提示完成。`)) {
            return;
        }
    }

    if (batchDl) {
        batchDl.disabled = true;
        batchDl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 下载中';
    }
    if (batchSwitch) {
        batchSwitch.disabled = true;
    }

    let success = 0;
    let warningCount = 0;
    const failures = [];

    try {
        for (const song of songs) {
            try {
                const result = webSettings.downloadToLocal
                    ? await requestLocalDownload(song.url)
                    : await requestBrowserDownload(song);
                success++;
                if (result && result.warning) {
                    warningCount++;
                }
            } catch (error) {
                failures.push({
                    song,
                    reason: (error && error.message) ? error.message : '下载失败'
                });
            }
        }

        let message = webSettings.downloadToLocal
            ? `本地保存完成，成功 ${success}/${songs.length}`
            : `批量下载已完成，成功 ${success}/${songs.length}`;

        if (webSettings.downloadToLocal) {
            message += `\n目录：${webSettings.downloadDir}`;
        }
        if (warningCount > 0) {
            message += `\n\n共 ${warningCount} 首触发了降级提示，请查看终端日志`;
        }
        message += buildBatchFailureMessage(failures, '失败');

        showToast(message, 'error');
    } finally {
        if (batchDl) {
            batchDl.innerHTML = originalBatchDlHTML;
        }
        updateBatchToolbar();
        if (batchSwitch && document.querySelectorAll('.song-checkbox:checked').length === 0) {
            batchSwitch.disabled = true;
        }
    }
}

function batchSwitchSource() {
    const checkedBoxes = document.querySelectorAll('.song-checkbox:checked');
    if (checkedBoxes.length === 0) return;

    if (!confirm(`准备对 ${checkedBoxes.length} 首歌曲进行自动换源。\n这可能需要一些时间，请耐心等待。`)) {
        return;
    }

    checkedBoxes.forEach((cb, index) => {
        const card = cb.closest('.song-card');
        if (card) {
            const switchBtn = card.querySelector('.btn-switch');
            if (switchBtn) {
                setTimeout(() => {
                    switchSource(switchBtn);
                }, index * 1000); 
            }
        }
    });
}

// ==========================================
// 自制歌单 (本地收藏夹) 前端交互
// ==========================================

let pendingFavSong = null;

function playAllSongs() {
    const firstPlayBtn = document.querySelector('.song-card .btn-play');
    if (firstPlayBtn) {
        playAllAndJumpTo(firstPlayBtn);
    } else {
        showToast('列表为空，无法播放', 'error');
    }
}

function openCollectionManager() {
    navigateTo(API_ROOT + '/my_collections');
}

function showEditCollectionModal(id = '', name = '', desc = '', cover = '') {
    document.getElementById('editColTitle').textContent = id ? '编辑歌单' : '新建歌单';
    document.getElementById('editColId').value = id;
    document.getElementById('editColName').value = name;
    document.getElementById('editColDesc').value = desc;
    
    if (cover && cover.includes('picsum.photos')) {
        document.getElementById('editColCover').value = '';
    } else {
        document.getElementById('editColCover').value = cover;
    }
    
    document.getElementById('editCollectionModal').style.display = 'flex';
}

function showEditCollectionModalFromButton(btn) {
    if (!btn) return;
    showEditCollectionModal(
        btn.dataset.id || '',
        btn.dataset.name || '',
        btn.dataset.description || '',
        btn.dataset.cover || ''
    );
}

function saveCollection() {
    const id = document.getElementById('editColId').value;
    const name = document.getElementById('editColName').value.trim();
    const desc = document.getElementById('editColDesc').value.trim();
    const cover = document.getElementById('editColCover').value.trim();
    
    if (!name) return showToast('名称不能为空', 'error');
    
    const payload = { name, description: desc, cover };
    const isAddingSongModalOpen = document.getElementById('addToCollectionModal').style.display === 'flex';
    
    const url = id ? `${API_ROOT}/collections/${id}` : `${API_ROOT}/collections`;
    const method = id ? 'PUT' : 'POST';

    fetch(url, {
        method: method,
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
    }).then(r => r.json()).then(res => {
        if (res.error) return showToast(res.error, 'error');

        document.getElementById('editCollectionModal').style.display = 'none';
        
        if (isAddingSongModalOpen) {
            refreshAddToCollectionList();
        } else {
            refreshCurrentPageContent();
        }
    });
}

function setImportCollectionButtonState(btn, imported) {
    if (!btn) return;

    btn.disabled = !!imported;
    if (imported) {
        btn.innerHTML = '<i class="fa-solid fa-check"></i> 已导入';
        btn.style.opacity = '0.85';
    } else {
        btn.innerHTML = '<i class="fa-solid fa-download"></i> 导入本地';
        btn.style.opacity = '';
    }
}

function importCollectionFromButton(btn) {
    if (!btn) return;

    const payload = {
        name: btn.dataset.name || '',
        description: btn.dataset.description || '',
        cover: btn.dataset.cover || '',
        creator: btn.dataset.creator || '',
        track_count: parsePositiveInt(btn.dataset.trackCount, 0),
        source: btn.dataset.source || '',
        external_id: btn.dataset.externalId || '',
        link: btn.dataset.link || '',
        content_type: btn.dataset.contentType || 'playlist'
    };

    if (!payload.source || !payload.external_id) {
        showToast('缺少导入参数', 'error');
        return;
    }

    btn.disabled = true;
    btn.style.opacity = '0.6';

    fetch(`${API_ROOT}/collections/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).then(r => r.json()).then(res => {
        if (res.error) {
            btn.disabled = false;
            btn.style.opacity = '';
            showToast(res.error, 'error');
            return;
        }

        setImportCollectionButtonState(btn, true);
        showToast(res.duplicate ? '该歌单/专辑已在本地列表中' : '导入成功，已加入本地歌单列表', res.duplicate ? 'info' : 'success');
    }).catch(() => {
        btn.disabled = false;
        btn.style.opacity = '';
        showToast('导入失败，请稍后重试', 'error');
    });
}

function deleteCollection(id) {
    if (!confirm('确定删除此歌单吗？内含歌曲记录也将被清空！')) return;
    fetch(`${API_ROOT}/collections/${id}`, { method: 'DELETE' })
        .then(r => r.json())
        .then(res => {
            if (res.error) return showToast(res.error, 'error');
            refreshCurrentPageContent();
        });
}

function deleteCollectionFromModal(id) {
    if (!confirm('确定删除此歌单吗？内含歌曲记录也将被清空！')) return;
    fetch(`${API_ROOT}/collections/${id}`, { method: 'DELETE' })
        .then(r => r.json())
        .then(res => {
            if (res.error) return showToast(res.error, 'error');
            refreshAddToCollectionList();
        });
}

function refreshAddToCollectionList() {
    const container = document.getElementById('addColList');
    container.innerHTML = '<div style="text-align: center; color: #a0aec0; padding: 20px;">加载中...</div>';
    
    fetch(API_ROOT + '/collections')
        .then(r => r.json())
        .then(data => {
            if (!data || data.length === 0) {
                container.innerHTML = '<div style="text-align: center; color: #a0aec0; padding: 20px;">暂无歌单，请点击上方「新建」创建</div>';
                return;
            }
            container.innerHTML = '';
            data.forEach(col => {
                const item = document.createElement('div');
                item.className = 'collection-item';
                item.style.cursor = 'default'; 
                
                let cvr = col.cover;
                if (!cvr) cvr = `https://picsum.photos/seed/col_${col.id}/400/400`;

                item.innerHTML = `
                    <div class="col-clickable-area" style="display:flex; align-items:center; flex:1; overflow:hidden; cursor:pointer;" title="收藏到此歌单">
                        <img src="${cvr}" style="width:40px;height:40px;border-radius:6px;object-fit:cover;margin-right:12px;">
                        <div class="collection-name" style="margin:0; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${col.name}</div>
                    </div>
                    <div style="display:flex; gap:6px; margin-left: 10px;">
                        <button class="col-action-btn btn-edit" title="编辑歌单"><i class="fa-solid fa-pen"></i></button>
                        <button class="col-action-btn del btn-del" title="删除歌单"><i class="fa-solid fa-trash"></i></button>
                    </div>
                `;
                
                item.querySelector('.col-clickable-area').onclick = () => addSongToCollection(col.id);
                item.querySelector('.btn-edit').onclick = (e) => {
                    e.stopPropagation();
                    showEditCollectionModal(col.id, col.name, col.description || '', col.cover || '');
                };
                item.querySelector('.btn-del').onclick = (e) => {
                    e.stopPropagation();
                    deleteCollectionFromModal(col.id);
                };

                container.appendChild(item);
            });
        }).catch(() => {
            container.innerHTML = '<div style="text-align: center; color: #e53e3e; padding: 20px;">加载失败</div>';
        });
}

function openAddToCollectionModal(btn) {
    const card = btn.closest('.song-card');
    if (!card) return;
    
    let coverUrl = card.dataset.cover || '';
    const imgEl = card.querySelector('.cover-wrapper img');
    if (imgEl && imgEl.src) coverUrl = imgEl.src;

    let extra = {};
    try {
        const parsed = JSON.parse(card.dataset.extra || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            extra = parsed;
        }
    } catch (_) {
    }
    extra.saved_from = 'web_ui';

    pendingFavSong = {
        id: card.dataset.id,
        source: card.dataset.source,
        name: card.dataset.name,
        artist: card.dataset.artist,
        duration: parseInt(card.dataset.duration) || 0,
        cover: coverUrl,
        extra: extra
    };
    
    document.getElementById('addToCollectionModal').style.display = 'flex';
    refreshAddToCollectionList();
}

function addSongToCollection(colId) {
    if (!pendingFavSong) return;
    
    fetch(`${API_ROOT}/collections/${colId}/songs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pendingFavSong)
    }).then(r => r.json()).then(res => {
        if (res.error) {
            showToast(res.error, 'error');
        } else {
            showToast('成功收藏至您的歌单！', 'success');
            document.getElementById('addToCollectionModal').style.display = 'none';
        }
    });
}

function removeSongFromCollection(btn, colId, originalSongId, originalSource) {
    if (!confirm('确定将此歌曲移出当前歌单吗？')) return;
    fetch(`${API_ROOT}/collections/${colId}/songs?id=${encodeURIComponent(originalSongId)}&source=${encodeURIComponent(originalSource)}`, { method: 'DELETE' })
        .then(r => r.json())
        .then(res => {
            if(res.error) return showToast(res.error, 'error');
            const card = btn.closest('.song-card');
            if (card) {
                card.style.transition = 'all 0.3s';
                card.style.opacity = '0';
                card.style.transform = 'translateX(30px)';
                setTimeout(() => {
                    refreshCurrentPageContent();
                }, 300);
            } else {
                refreshCurrentPageContent();
            }
        });
}
