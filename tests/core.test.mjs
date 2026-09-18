import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyPrivatePreset,
    buildPrompt,
    createRecord,
    getMentionStats,
    importLedger,
    normalizeRecord,
} from '../core.js';

test('normalizes and clamps record values', () => {
    const record = normalizeRecord({
        speaker: ' A ',
        target: ' B ',
        address: ' 小月亮 ',
        acceptance: 120,
        familiarity: -5,
        type: 'invalid',
    });

    assert.equal(record.speaker, 'A');
    assert.equal(record.target, 'B');
    assert.equal(record.address, '小月亮');
    assert.equal(record.acceptance, 100);
    assert.equal(record.familiarity, 0);
    assert.equal(record.type, 'nickname');
});

test('private preset keeps acceptance separate from emotional salience', () => {
    const record = applyPrivatePreset(createRecord({ speaker: 'A', target: 'B', address: '小月亮' }));
    assert.equal(record.type, 'private_intimate');
    assert.equal(record.status, 'accepted');
    assert.equal(record.acceptance, 90);
    assert.equal(record.emotionalSalience, 90);
    assert.equal(record.habituationResistance, 85);
    assert.equal(record.preferredFrequency, 'rare');
});

test('mention scan respects direction', () => {
    const record = createRecord({ speaker: 'A', target: 'B', address: '阿宁' });
    const chat = [
        { name: 'A', mes: '阿宁，过来一下。' },
        { name: 'B', mes: '阿宁是谁？' },
        { name: 'A', mes: '晚安，阿宁。' },
    ];
    const stats = getMentionStats(record, chat);
    assert.equal(stats.usageCount, 2);
    assert.equal(stats.lastUsedMessageId, 2);
});

test('prompt distinguishes accepted private reaction from renewed permission', () => {
    const record = applyPrivatePreset(createRecord({ speaker: 'A', target: 'B', address: '小月亮' }));
    const prompt = buildPrompt({ records: [record] }, [], { enabled: true, includeRules: true });
    assert.match(prompt, /私密爱称/u);
    assert.match(prompt, /情绪冲击/u);
    assert.match(prompt, /不得重新上演初次许可确认/u);
    assert.match(prompt, /间隔已经足够/u);
});

test('imports a valid ledger and rejects a wrong shape', () => {
    const ledger = importLedger(JSON.stringify({ records: [{ address: '阿宁' }] }));
    assert.equal(ledger.records.length, 1);
    assert.throws(() => importLedger('{}'), /records/u);
});
