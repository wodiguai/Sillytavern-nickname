export const SCHEMA_VERSION = 1;

export const RECORD_TYPES = Object.freeze([
    'formal',
    'name',
    'nickname',
    'daily_affectionate',
    'private_intimate',
    'family',
    'work',
    'forbidden',
]);

export const RECORD_STATUSES = Object.freeze([
    'new',
    'testing',
    'tolerated',
    'accepted',
    'habitual',
    'rejected',
    'retired',
]);

export const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    injectionDepth: 1,
    injectionRole: 0,
    includeRules: true,
    maxRecords: 30,
    scanUsage: true,
});

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

const FREQUENCY_LABELS = Object.freeze({
    rare: '稀少',
    occasional: '偶尔',
    normal: '普通',
    frequent: '频繁',
});

const PUBLIC_USE_LABELS = Object.freeze({
    allowed: '公开场合允许',
    unconfirmed: '公开场合尚未确认',
    not_allowed: '公开场合不允许',
});

const REACTION_LABELS = Object.freeze({
    shyness: '害羞',
    tenderness: '温柔',
    emotional_stirring: '动情',
    feigned_annoyance: '亲昵嗔怪',
    loss_of_composure: '短暂失去从容',
    affection: '亲近回应',
    boundary: '边界反应',
});

function nowIso() {
    return new Date().toISOString();
}

function createId() {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }

    return `al-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(value, minimum, maximum, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return fallback;
    }

    return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

function cleanText(value, fallback = '') {
    return String(value ?? fallback).trim();
}

function cleanList(value) {
    const source = Array.isArray(value) ? value : String(value ?? '').split(/[,，]/u);
    return [...new Set(source.map(item => cleanText(item)).filter(Boolean))];
}

export function createRecord(seed = {}) {
    const timestamp = nowIso();
    return normalizeRecord({
        id: createId(),
        speaker: '',
        target: '',
        address: '',
        type: 'nickname',
        status: 'testing',
        acceptance: 50,
        familiarity: 20,
        emotionalSalience: 40,
        habituationResistance: 40,
        preferredFrequency: 'normal',
        allowedContexts: ['private'],
        allowedSpeakers: [],
        publicUse: 'unconfirmed',
        exclusiveToSpeaker: true,
        reactionProfile: [],
        recoveryWindowMessages: 20,
        notes: '',
        evidence: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        ...seed,
    });
}

export function normalizeRecord(record = {}) {
    const timestamp = nowIso();
    const type = RECORD_TYPES.includes(record.type) ? record.type : 'nickname';
    const status = RECORD_STATUSES.includes(record.status) ? record.status : 'testing';
    const preferredFrequency = ['rare', 'occasional', 'normal', 'frequent'].includes(record.preferredFrequency)
        ? record.preferredFrequency
        : 'normal';
    const publicUse = ['allowed', 'unconfirmed', 'not_allowed'].includes(record.publicUse)
        ? record.publicUse
        : 'unconfirmed';

    return {
        id: cleanText(record.id) || createId(),
        speaker: cleanText(record.speaker),
        target: cleanText(record.target),
        address: cleanText(record.address),
        type,
        status,
        acceptance: clamp(record.acceptance, 0, 100, 50),
        familiarity: clamp(record.familiarity, 0, 100, 20),
        emotionalSalience: clamp(record.emotionalSalience, 0, 100, 40),
        habituationResistance: clamp(record.habituationResistance, 0, 100, 40),
        preferredFrequency,
        allowedContexts: cleanList(record.allowedContexts),
        allowedSpeakers: cleanList(record.allowedSpeakers),
        publicUse,
        exclusiveToSpeaker: record.exclusiveToSpeaker !== false,
        reactionProfile: cleanList(record.reactionProfile),
        recoveryWindowMessages: clamp(record.recoveryWindowMessages, 1, 9999, 20),
        notes: cleanText(record.notes),
        evidence: Array.isArray(record.evidence) ? record.evidence : [],
        createdAt: cleanText(record.createdAt) || timestamp,
        updatedAt: cleanText(record.updatedAt) || timestamp,
    };
}

export function normalizeLedger(value = {}) {
    const records = Array.isArray(value.records)
        ? value.records.map(normalizeRecord).filter(record => record.address)
        : [];

    return {
        version: SCHEMA_VERSION,
        records,
    };
}

export function applyPrivatePreset(record = {}) {
    return normalizeRecord({
        ...record,
        type: 'private_intimate',
        status: 'accepted',
        acceptance: 90,
        familiarity: 75,
        emotionalSalience: 90,
        habituationResistance: 85,
        preferredFrequency: 'rare',
        allowedContexts: ['private', 'emotionally_intimate'],
        publicUse: 'not_allowed',
        exclusiveToSpeaker: true,
        reactionProfile: ['shyness', 'tenderness', 'emotional_stirring', 'feigned_annoyance'],
        recoveryWindowMessages: 20,
        updatedAt: nowIso(),
    });
}

function normalizedComparable(value) {
    return cleanText(value).toLocaleLowerCase();
}

function countOccurrences(text, needle) {
    const haystack = normalizedComparable(text);
    const query = normalizedComparable(needle);
    if (!query) {
        return 0;
    }

    return haystack.split(query).length - 1;
}

export function getMentionStats(record, chat = []) {
    const normalized = normalizeRecord(record);
    let usageCount = 0;
    let lastUsedMessageId = null;
    const matchingMessageIds = [];

    chat.forEach((message, index) => {
        const messageName = cleanText(message?.name);
        if (normalized.speaker && normalizedComparable(messageName) !== normalizedComparable(normalized.speaker)) {
            return;
        }

        const mentions = countOccurrences(message?.mes, normalized.address);
        if (mentions > 0) {
            usageCount += mentions;
            lastUsedMessageId = index;
            matchingMessageIds.push(index);
        }
    });

    const messagesSinceLastUse = lastUsedMessageId === null
        ? null
        : Math.max(0, chat.length - 1 - lastUsedMessageId);
    const recentFloor = Math.max(0, chat.length - normalized.recoveryWindowMessages);
    const recentUseCount = matchingMessageIds.filter(index => index >= recentFloor).length;

    return {
        usageCount,
        lastUsedMessageId,
        messagesSinceLastUse,
        recentUseCount,
        recovered: lastUsedMessageId === null || messagesSinceLastUse >= normalized.recoveryWindowMessages,
    };
}

function scoreLabel(score) {
    if (score >= 86) return '极高';
    if (score >= 71) return '很高';
    if (score >= 56) return '较高';
    if (score >= 41) return '中等';
    if (score >= 21) return '较低';
    return '很低';
}

function compactNotes(value) {
    return cleanText(value).replace(/\s+/gu, ' ').slice(0, 240);
}

function formatRecord(record, chat, scanUsage) {
    const stats = scanUsage ? getMentionStats(record, chat) : null;
    const contexts = record.allowedContexts.length ? record.allowedContexts.join('、') : '未限定';
    const allowedSpeakers = record.allowedSpeakers.length ? record.allowedSpeakers.join('、') : record.speaker;
    const reactions = record.reactionProfile.length
        ? record.reactionProfile.map(item => REACTION_LABELS[item] ?? item).join('、')
        : '由当前性格与心理状态决定';
    const fields = [
        `${record.speaker || '未指定使用者'}→${record.target || '未指定对象'}：“${record.address}”`,
        `类型=${TYPE_LABELS[record.type] ?? record.type}`,
        `状态=${STATUS_LABELS[record.status] ?? record.status}`,
        `接受度=${scoreLabel(record.acceptance)}`,
        `熟悉度=${scoreLabel(record.familiarity)}`,
        `情绪显著度=${scoreLabel(record.emotionalSalience)}`,
        `抗习惯化=${scoreLabel(record.habituationResistance)}`,
        `频率=${FREQUENCY_LABELS[record.preferredFrequency] ?? record.preferredFrequency}`,
        `场景=${contexts}`,
        PUBLIC_USE_LABELS[record.publicUse] ?? record.publicUse,
        `获准使用者=${allowedSpeakers || '未指定'}`,
        `反应方向=${reactions}`,
    ];

    if (stats) {
        if (stats.recentUseCount > 1) {
            fields.push(`近期已出现${stats.recentUseCount}次，同一阶段继续使用时应衰减反应`);
        } else if (record.type === 'private_intimate' && stats.recovered) {
            fields.push('间隔已经足够，下一次合适场景中的使用可以恢复明显但性格化的反应');
        }
    }

    const notes = compactNotes(record.notes);
    if (notes) {
        fields.push(`备注=${notes}`);
    }

    return `- ${fields.join('；')}。`;
}

export function buildPrompt(ledgerValue, chat = [], options = {}) {
    const ledger = normalizeLedger(ledgerValue);
    const settings = { ...DEFAULT_SETTINGS, ...options };
    if (!settings.enabled || ledger.records.length === 0) {
        return '';
    }

    const records = ledger.records
        .filter(record => record.status !== 'retired')
        .slice(0, clamp(settings.maxRecords, 1, 200, DEFAULT_SETTINGS.maxRecords));

    if (records.length === 0) {
        return '';
    }

    const lines = [
        '[Address Ledger / 当前聊天称呼状态]',
        ...records.map(record => formatRecord(record, chat, settings.scanUsage)),
    ];

    if (settings.includeRules) {
        lines.push(
            '',
            '[称呼连续性规则]',
            '1. 上述记录按“使用者→被称呼者”分别生效，不得反向套用，也不得擅自授权第三者。',
            '2. 已接受或已习惯的称呼不得重新上演初次许可确认；普通使用应自然背景化。',
            '3. 私密爱称可以已接受、已熟悉但仍具有很高情绪冲击；反应应由当前性格与心理状态决定，不固定映射为脸红或嗔怪。',
            '4. 稀少称呼不应变成普通口头禅；同一场景连续使用时反应逐次减弱，间隔足够后可恢复。',
            '5. 公开使用、错误使用者或语气变化应被视为场景与边界变化，而不是把称呼重置为第一次。',
            '6. 只约束角色自己的称呼和反应，不替用户说话、行动或决定。',
        );
    }

    return lines.join('\n');
}

export function exportLedger(ledger) {
    return JSON.stringify(normalizeLedger(ledger), null, 2);
}

export function importLedger(text) {
    const parsed = JSON.parse(String(text));
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.records)) {
        throw new Error('文件中缺少 records 数组。');
    }

    return normalizeLedger(parsed);
}
