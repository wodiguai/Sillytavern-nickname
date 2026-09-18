import {
    DEFAULT_SETTINGS,
    applyPrivatePreset,
    buildPrompt,
    createRecord,
    exportLedger,
    getMentionStats,
    importLedger,
    normalizeLedger,
    normalizeRecord,
} from './core.js';

const MODULE_ID = 'address_ledger';
const METADATA_KEY = 'addressLedger';
const PROMPT_ID = 'address-ledger-state';

function getTemplateFolder() {
    const directoryUrl = new URL('.', import.meta.url);
    const folderName = directoryUrl.pathname.split('/').filter(Boolean).at(-1);
    if (!folderName) {
        throw new Error('无法识别扩展安装目录。');
    }

    return `third-party/${decodeURIComponent(folderName)}`;
}

const TEMPLATE_FOLDER = getTemplateFolder();

const TYPE_LABELS = Object.freeze({
    formal: '正式称呼',
    name: '姓名',
    nickname: '昵称',
    daily_affectionate: '日常爱称',
    private_intimate: '私密爱称',
    family: '家庭称呼',
    work: '工作称呼',
    forbidden: '禁用称呼',
});

const STATUS_LABELS = Object.freeze({
    new: '首次/未确认',
    testing: '试探中',
    tolerated: '默认允许',
    accepted: '已接受',
    habitual: '已经习惯',
    rejected: '已拒绝',
    retired: '已停用',
});

let initialized = false;
let subscriptions = [];
let refreshTimer = null;

function context() {
    return globalThis.SillyTavern?.getContext?.();
}

function byId(id) {
    return document.getElementById(id);
}

function numberInRange(value, minimum, maximum, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

function getSettings() {
    const ctx = context();
    if (!ctx) return { ...DEFAULT_SETTINGS };

    if (!ctx.extensionSettings[MODULE_ID]) {
        ctx.extensionSettings[MODULE_ID] = structuredClone(DEFAULT_SETTINGS);
    }

    const settings = ctx.extensionSettings[MODULE_ID];
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (!Object.hasOwn(settings, key)) {
            settings[key] = value;
        }
    }

    settings.injectionDepth = numberInRange(settings.injectionDepth, 0, 999, 1);
    settings.injectionRole = numberInRange(settings.injectionRole, 0, 2, 0);
    settings.maxRecords = numberInRange(settings.maxRecords, 1, 200, 30);
    return settings;
}

function getLedger() {
    const metadata = context()?.chatMetadata;
    if (!metadata) return normalizeLedger();
    return normalizeLedger(metadata[METADATA_KEY]);
}

async function saveLedger(ledger) {
    const ctx = context();
    if (!ctx?.chatMetadata) {
        throw new Error('当前没有可以保存数据的聊天。');
    }

    ctx.chatMetadata[METADATA_KEY] = normalizeLedger(ledger);
    await ctx.saveMetadata();
}

function notify(message, type = 'info') {
    const toast = globalThis.toastr?.[type];
    if (typeof toast === 'function') {
        toast(message, 'Address Ledger');
        return;
    }

    console[type === 'error' ? 'error' : 'log'](`[Address Ledger] ${message}`);
}

function escapeHtml(value) {
    const element = document.createElement('div');
    element.textContent = String(value ?? '');
    return element.innerHTML;
}

function getActorDefaults() {
    const ctx = context();
    const character = Number.isInteger(ctx?.characterId) ? ctx?.characters?.[ctx.characterId] : null;
    const characterName = character?.name || ctx?.name2 || '角色';
    const userName = ctx?.name1 || ctx?.userName || '用户';
    return { characterName, userName };
}

function currentPrompt() {
    const ctx = context();
    return buildPrompt(getLedger(), ctx?.chat ?? [], getSettings());
}

async function updateInjection() {
    const ctx = context();
    if (!ctx) return;

    const prompt = currentPrompt();
    const settings = getSettings();
    const preview = byId('al-prompt-preview');
    if (preview) preview.value = prompt;

    if (typeof ctx.setExtensionPrompt !== 'function') {
        setStatus('当前SillyTavern未提供setExtensionPrompt；数据已保存，但无法自动注入。', true);
        return;
    }

    await ctx.setExtensionPrompt(
        PROMPT_ID,
        settings.enabled ? prompt : '',
        1,
        settings.injectionDepth,
        false,
        settings.injectionRole,
    );

    const recordCount = getLedger().records.length;
    setStatus(`当前聊天：${recordCount}条称呼记录；注入预览：${prompt.length}字符。`);
}

async function clearInjection() {
    const ctx = context();
    if (typeof ctx?.setExtensionPrompt !== 'function') return;
    const settings = getSettings();
    await ctx.setExtensionPrompt(PROMPT_ID, '', 1, settings.injectionDepth, false, settings.injectionRole);
}

function setStatus(message, isError = false) {
    const element = byId('al-status');
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('al-error', isError);
}

function scoreSummary(value) {
    const score = numberInRange(value, 0, 100, 0);
    if (score >= 86) return '极高';
    if (score >= 71) return '很高';
    if (score >= 56) return '较高';
    if (score >= 41) return '中等';
    if (score >= 21) return '较低';
    return '很低';
}

function renderRecords() {
    const list = byId('al-record-list');
    const empty = byId('al-empty');
    if (!list || !empty) return;

    const ledger = getLedger();
    const chat = context()?.chat ?? [];
    empty.hidden = ledger.records.length > 0;
    list.innerHTML = ledger.records.map(record => {
        const stats = getMentionStats(record, chat);
        const notes = record.notes ? `<div class="al-record-notes">${escapeHtml(record.notes)}</div>` : '';
        return `
            <article class="al-record-card" data-record-id="${escapeHtml(record.id)}">
                <div class="al-record-title">${escapeHtml(record.speaker || '未指定')} → ${escapeHtml(record.target || '未指定')}：“${escapeHtml(record.address)}”</div>
                <div class="al-record-meta">
                    <span class="al-chip">${escapeHtml(TYPE_LABELS[record.type] ?? record.type)}</span>
                    <span class="al-chip">${escapeHtml(STATUS_LABELS[record.status] ?? record.status)}</span>
                    <span class="al-chip">接受度 ${record.acceptance}</span>
                    <span class="al-chip">熟悉度 ${record.familiarity}</span>
                    <span class="al-chip">情绪 ${record.emotionalSalience}</span>
                    <span class="al-chip">抗习惯化 ${record.habituationResistance}</span>
                    <span class="al-chip">当前聊天出现 ${stats.usageCount} 次</span>
                </div>
                ${notes}
                <div class="al-record-actions">
                    <button class="menu_button al-edit-record" data-id="${escapeHtml(record.id)}">编辑</button>
                    <button class="menu_button al-delete-record" data-id="${escapeHtml(record.id)}">删除</button>
                </div>
            </article>`;
    }).join('');

    list.querySelectorAll('.al-edit-record').forEach(button => {
        button.addEventListener('click', () => openEditor(button.dataset.id));
    });
    list.querySelectorAll('.al-delete-record').forEach(button => {
        button.addEventListener('click', () => deleteRecord(button.dataset.id));
    });
}

function setRange(id, value) {
    const input = byId(`al-${id}`);
    const output = byId(`al-${id}-value`);
    if (input) input.value = String(value);
    if (output) output.value = String(value);
}

function writeEditor(record) {
    byId('al-record-id').value = record.id;
    byId('al-speaker').value = record.speaker;
    byId('al-target').value = record.target;
    byId('al-address').value = record.address;
    byId('al-type').value = record.type;
    byId('al-record-status').value = record.status;
    byId('al-frequency').value = record.preferredFrequency;
    byId('al-public-use').value = record.publicUse;
    byId('al-recovery').value = String(record.recoveryWindowMessages);
    byId('al-contexts').value = record.allowedContexts.join(', ');
    byId('al-allowed-speakers').value = record.allowedSpeakers.join(', ');
    byId('al-reactions').value = record.reactionProfile.join(', ');
    byId('al-exclusive').checked = record.exclusiveToSpeaker;
    byId('al-notes').value = record.notes;
    setRange('acceptance', record.acceptance);
    setRange('familiarity', record.familiarity);
    setRange('salience', record.emotionalSalience);
    setRange('resistance', record.habituationResistance);
}

function readEditor() {
    const id = byId('al-record-id').value;
    const existing = getLedger().records.find(record => record.id === id);
    return normalizeRecord({
        ...(existing ?? {}),
        id,
        speaker: byId('al-speaker').value,
        target: byId('al-target').value,
        address: byId('al-address').value,
        type: byId('al-type').value,
        status: byId('al-record-status').value,
        preferredFrequency: byId('al-frequency').value,
        publicUse: byId('al-public-use').value,
        recoveryWindowMessages: byId('al-recovery').value,
        allowedContexts: byId('al-contexts').value,
        allowedSpeakers: byId('al-allowed-speakers').value,
        reactionProfile: byId('al-reactions').value,
        exclusiveToSpeaker: byId('al-exclusive').checked,
        notes: byId('al-notes').value,
        acceptance: byId('al-acceptance').value,
        familiarity: byId('al-familiarity').value,
        emotionalSalience: byId('al-salience').value,
        habituationResistance: byId('al-resistance').value,
        updatedAt: new Date().toISOString(),
    });
}

function openEditor(recordId = null) {
    const ledger = getLedger();
    const existing = recordId ? ledger.records.find(record => record.id === recordId) : null;
    const { characterName, userName } = getActorDefaults();
    const record = existing ?? createRecord({
        speaker: characterName,
        target: userName,
        allowedSpeakers: [characterName],
    });

    writeEditor(record);
    const editor = byId('al-editor');
    editor.open = true;
    byId('al-address').focus();
}

function closeEditor() {
    const editor = byId('al-editor');
    if (editor) editor.open = false;
}

async function saveEditorRecord() {
    const record = readEditor();
    if (!record.speaker || !record.target || !record.address) {
        notify('使用者、被称呼者和称呼都不能为空。', 'warning');
        return;
    }

    const ledger = getLedger();
    const index = ledger.records.findIndex(item => item.id === record.id);
    if (index >= 0) ledger.records[index] = record;
    else ledger.records.push(record);

    try {
        await saveLedger(ledger);
        closeEditor();
        await refreshAll();
        notify('称呼记录已保存。', 'success');
    } catch (error) {
        notify(`保存失败：${error.message}`, 'error');
    }
}

async function deleteRecord(recordId) {
    const ledger = getLedger();
    const record = ledger.records.find(item => item.id === recordId);
    if (!record) return;
    if (!globalThis.confirm(`删除“${record.speaker}→${record.target}：${record.address}”吗？`)) return;

    ledger.records = ledger.records.filter(item => item.id !== recordId);
    try {
        await saveLedger(ledger);
        await refreshAll();
        notify('称呼记录已删除。', 'success');
    } catch (error) {
        notify(`删除失败：${error.message}`, 'error');
    }
}

function applyPresetToEditor() {
    const record = applyPrivatePreset(readEditor());
    writeEditor(record);
    notify('已套用“稀少但高冲击”私密称呼预设。', 'success');
}

function syncSliderOutput(inputId, outputId) {
    const input = byId(inputId);
    const output = byId(outputId);
    input.addEventListener('input', () => {
        output.value = input.value;
    });
}

function updateSettingsFromUi() {
    const ctx = context();
    const settings = getSettings();
    settings.enabled = byId('al-enabled').checked;
    settings.includeRules = byId('al-include-rules').checked;
    settings.scanUsage = byId('al-scan-usage').checked;
    settings.injectionDepth = numberInRange(byId('al-depth').value, 0, 999, 1);
    settings.injectionRole = numberInRange(byId('al-role').value, 0, 2, 0);
    settings.maxRecords = numberInRange(byId('al-max-records').value, 1, 200, 30);
    ctx.saveSettingsDebounced();
    void updateInjection();
}

function writeSettingsToUi() {
    const settings = getSettings();
    byId('al-enabled').checked = settings.enabled;
    byId('al-include-rules').checked = settings.includeRules;
    byId('al-scan-usage').checked = settings.scanUsage;
    byId('al-depth').value = String(settings.injectionDepth);
    byId('al-role').value = String(settings.injectionRole);
    byId('al-max-records').value = String(settings.maxRecords);
}

function downloadLedger() {
    const blob = new Blob([exportLedger(getLedger())], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `address-ledger-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

async function importFromFile(file) {
    if (!file) return;
    try {
        const ledger = importLedger(await file.text());
        const currentCount = getLedger().records.length;
        if (currentCount > 0 && !globalThis.confirm(`导入将替换当前聊天的${currentCount}条记录，继续吗？`)) {
            return;
        }
        await saveLedger(ledger);
        await refreshAll();
        notify(`已导入${ledger.records.length}条称呼记录。`, 'success');
    } catch (error) {
        notify(`导入失败：${error.message}`, 'error');
    } finally {
        byId('al-import-file').value = '';
    }
}

async function copyPrompt() {
    const prompt = currentPrompt();
    if (!prompt) {
        notify('当前没有可复制的注入内容。', 'warning');
        return;
    }

    try {
        await navigator.clipboard.writeText(prompt);
        notify('注入预览已复制。', 'success');
    } catch {
        byId('al-prompt-preview').focus();
        byId('al-prompt-preview').select();
        notify('无法直接访问剪贴板，已选中预览文本。', 'warning');
    }
}

function bindUi() {
    writeSettingsToUi();
    ['al-enabled', 'al-include-rules', 'al-scan-usage', 'al-depth', 'al-role', 'al-max-records']
        .forEach(id => byId(id).addEventListener('change', updateSettingsFromUi));

    syncSliderOutput('al-acceptance', 'al-acceptance-value');
    syncSliderOutput('al-familiarity', 'al-familiarity-value');
    syncSliderOutput('al-salience', 'al-salience-value');
    syncSliderOutput('al-resistance', 'al-resistance-value');

    byId('al-add-record').addEventListener('click', () => openEditor());
    byId('al-save-record').addEventListener('click', saveEditorRecord);
    byId('al-cancel-edit').addEventListener('click', closeEditor);
    byId('al-private-preset').addEventListener('click', applyPresetToEditor);
    byId('al-export').addEventListener('click', downloadLedger);
    byId('al-import').addEventListener('click', () => byId('al-import-file').click());
    byId('al-import-file').addEventListener('change', event => importFromFile(event.target.files?.[0]));
    byId('al-copy-prompt').addEventListener('click', copyPrompt);
}

async function renderUi() {
    if (byId('address-ledger-settings')) return;
    const ctx = context();
    let target = document.querySelector('#extensions_settings2') ?? document.querySelector('#extensions_settings');
    const deadline = Date.now() + 2500;
    while (!target && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 50));
        target = document.querySelector('#extensions_settings2') ?? document.querySelector('#extensions_settings');
    }
    if (!ctx?.renderExtensionTemplateAsync || !target) {
        throw new Error('找不到SillyTavern扩展设置面板或模板渲染接口。');
    }

    const html = await ctx.renderExtensionTemplateAsync(TEMPLATE_FOLDER, 'settings', {});
    target.insertAdjacentHTML('beforeend', html);
    bindUi();
}

async function refreshAll() {
    renderRecords();
    await updateInjection();
}

function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void refreshAll();
    }, 100);
}

function subscribeEvents() {
    const ctx = context();
    if (!ctx?.eventSource || !ctx?.event_types) return;

    const refreshEvents = [
        ctx.event_types.CHAT_CHANGED,
        ctx.event_types.CHAT_CREATED,
        ctx.event_types.MESSAGE_SENT,
        ctx.event_types.MESSAGE_RECEIVED,
        ctx.event_types.MESSAGE_EDITED,
        ctx.event_types.MESSAGE_DELETED,
        ctx.event_types.MESSAGE_SWIPED,
    ].filter(Boolean);

    for (const eventType of refreshEvents) {
        ctx.eventSource.on(eventType, scheduleRefresh);
        subscriptions.push([eventType, scheduleRefresh]);
    }

    if (ctx.event_types.GENERATION_AFTER_COMMANDS) {
        ctx.eventSource.on(ctx.event_types.GENERATION_AFTER_COMMANDS, updateInjection);
        subscriptions.push([ctx.event_types.GENERATION_AFTER_COMMANDS, updateInjection]);
    }
}

function unsubscribeEvents() {
    const ctx = context();
    for (const [eventType, handler] of subscriptions) {
        if (typeof ctx?.eventSource?.removeListener === 'function') {
            ctx.eventSource.removeListener(eventType, handler);
        } else if (typeof ctx?.eventSource?.off === 'function') {
            ctx.eventSource.off(eventType, handler);
        }
    }
    subscriptions = [];
}

async function initialize() {
    if (initialized) return;
    initialized = true;

    try {
        getSettings();
        await renderUi();
        subscribeEvents();
        await refreshAll();
        console.info('[Address Ledger] initialized');
    } catch (error) {
        initialized = false;
        console.error('[Address Ledger] initialization failed', error);
        notify(`初始化失败：${error.message}`, 'error');
    }
}

export async function onActivate() {
    await initialize();
}

export async function onEnable() {
    await initialize();
}

export async function onDisable() {
    unsubscribeEvents();
    if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
    }
    await clearInjection();
    byId('address-ledger-settings')?.remove();
    initialized = false;
}
