'use strict';

const fs = require('fs');

function readVarint(buffer, start) {
    let value = 0;
    let shift = 0;
    let offset = start;

    while (offset < buffer.length && shift <= 63) {
        const byte = buffer[offset++];
        value += (byte & 0x7f) * (2 ** shift);
        if ((byte & 0x80) === 0) {
            return { value, offset };
        }
        shift += 7;
    }

    throw new Error(`Invalid varint at ${start}`);
}

function readBlockHandle(buffer, start) {
    const offsetPart = readVarint(buffer, start);
    const sizePart = readVarint(buffer, offsetPart.offset);
    return {
        offset: offsetPart.value,
        size: sizePart.value,
        nextOffset: sizePart.offset
    };
}

function copyFromOutput(output, offset, length) {
    if (!offset || offset > output.length) {
        throw new Error(`Invalid Snappy copy offset ${offset} for output ${output.length}`);
    }

    for (let index = 0; index < length; index += 1) {
        output.push(output[output.length - offset]);
    }
}

function decompressSnappy(buffer) {
    const lengthPart = readVarint(buffer, 0);
    const expectedLength = lengthPart.value;
    const output = [];
    let offset = lengthPart.offset;

    while (offset < buffer.length && output.length < expectedLength) {
        const tag = buffer[offset++];
        const type = tag & 0x03;

        if (type === 0) {
            let literalLength = tag >>> 2;
            if (literalLength < 60) {
                literalLength += 1;
            } else {
                const lengthBytes = literalLength - 59;
                literalLength = 0;
                for (let index = 0; index < lengthBytes; index += 1) {
                    literalLength += buffer[offset++] * (2 ** (8 * index));
                }
                literalLength += 1;
            }

            for (let index = 0; index < literalLength; index += 1) {
                output.push(buffer[offset++]);
            }
            continue;
        }

        if (type === 1) {
            const copyLength = 4 + ((tag >>> 2) & 0x07);
            const copyOffset = ((tag & 0xe0) << 3) | buffer[offset++];
            copyFromOutput(output, copyOffset, copyLength);
            continue;
        }

        const copyLength = 1 + (tag >>> 2);
        const offsetBytes = type === 2 ? 2 : 4;
        let copyOffset = 0;
        for (let index = 0; index < offsetBytes; index += 1) {
            copyOffset += buffer[offset++] * (2 ** (8 * index));
        }
        copyFromOutput(output, copyOffset, copyLength);
    }

    if (output.length !== expectedLength) {
        throw new Error(`Snappy length mismatch: ${output.length} != ${expectedLength}`);
    }

    return Buffer.from(output);
}

function readBlock(table, handle) {
    const end = handle.offset + handle.size;
    if (end + 5 > table.length) {
        throw new Error(`Block outside table: ${handle.offset}+${handle.size}`);
    }

    const compressed = table.subarray(handle.offset, end);
    const compressionType = table[end];
    if (compressionType === 0) {
        return compressed;
    }
    if (compressionType === 1) {
        return decompressSnappy(compressed);
    }
    throw new Error(`Unsupported LevelDB compression type ${compressionType}`);
}

function readEntries(block) {
    if (block.length < 4) {
        return [];
    }

    const restartCount = block.readUInt32LE(block.length - 4);
    const entriesEnd = block.length - 4 - (restartCount * 4);
    if (entriesEnd < 0) {
        throw new Error('Invalid restart array');
    }

    const entries = [];
    let previousKey = Buffer.alloc(0);
    let offset = 0;

    while (offset < entriesEnd) {
        const sharedPart = readVarint(block, offset);
        const nonSharedPart = readVarint(block, sharedPart.offset);
        const valuePart = readVarint(block, nonSharedPart.offset);
        const keyStart = valuePart.offset;
        const keyEnd = keyStart + nonSharedPart.value;
        const valueEnd = keyEnd + valuePart.value;

        if (sharedPart.value > previousKey.length || valueEnd > entriesEnd) {
            throw new Error(`Invalid block entry at ${offset}`);
        }

        const key = Buffer.concat([
            previousKey.subarray(0, sharedPart.value),
            block.subarray(keyStart, keyEnd)
        ]);
        const value = block.subarray(keyEnd, valueEnd);
        entries.push({ key, value });
        previousKey = key;
        offset = valueEnd;
    }

    return entries;
}

function stripInternalKey(key) {
    return key.length >= 8 ? key.subarray(0, key.length - 8) : key;
}

function printable(buffer) {
    return buffer
        .toString('utf8')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/g, '');
}

function parseJsonCandidate(value) {
    const text = printable(value).trim();
    const starts = [text.indexOf('['), text.indexOf('{')].filter((position) => position >= 0);
    if (!starts.length) {
        return null;
    }

    const start = Math.min(...starts);
    try {
        return JSON.parse(text.slice(start));
    } catch (_error) {
        return null;
    }
}

function summarizeRuns(value, options = {}) {
    const parsed = parseJsonCandidate(value);
    if (!Array.isArray(parsed)) {
        return null;
    }

    function compactValue(item, depth = 0) {
        if (item === null || typeof item === 'boolean' || typeof item === 'number') {
            return item;
        }
        if (typeof item === 'string') {
            return item.length <= 180 ? item : `${item.slice(0, 177)}...`;
        }
        if (Array.isArray(item)) {
            return `[${item.length} items]`;
        }
        if (!item || typeof item !== 'object' || depth >= 3) {
            return '[object]';
        }

        const skippedKeys = new Set([
            'id', 'tabId', 'frameId', 'profileName', 'targetCabinetName',
            'itemValue', 'itemValues', 'requestedItemValues', 'targetItemValues',
            'visibleItemValues', 'selectedOrderItemValues', 'selectedOrderSources',
            'diagnosticOutsideItemValues', 'firstItemValues', 'lastItemValue',
            'signature', 'element', 'rect'
        ]);
        const result = {};
        for (const [key, child] of Object.entries(item)) {
            if (!skippedKeys.has(key)) {
                result[key] = compactValue(child, depth + 1);
            }
        }
        return result;
    }

    return parsed.slice(0, 1).map((run) => {
        const events = Array.isArray(run && run.events) ? run.events : [];
        const cabinetEventPattern = /(?:assign_button|bridge:schedule|background:schedule|schedule:|schedule_ready|cabinet_|element_activate)/i;
        const relevantEvents = options.cabinetOnly
            ? events.filter((event) => cabinetEventPattern.test(String(event && (event.event || event.name || event.type) || '')))
            : events;
        const selectedEvents = relevantEvents.map((event) => ({
            event: event && (event.event || event.name || event.type),
            time: event && event.time,
            details: compactValue(event && event.details)
        }));

        return {
            id: run && (run.id || run.runId),
            startedAt: run && (run.startedAt || run.createdAt),
            finishedAt: run && run.finishedAt,
            version: run && (run.extensionVersion || run.version),
            status: run && run.status,
            reason: run && run.reason,
            eventCount: events.length,
            selectedEventCount: selectedEvents.length,
            events: selectedEvents
        };
    });
}

function main() {
    const filename = process.argv[2];
    const cabinetOnly = process.argv.includes('--cabinet');
    const latestRecordOnly = process.argv.includes('--latest-record');
    const recordSummaryOnly = process.argv.includes('--record-summary');
    if (!filename) {
        throw new Error('Usage: node read-extension-leveldb.js <table.ldb>');
    }

    const table = fs.readFileSync(filename);
    if (table.length < 48) {
        throw new Error('LevelDB table is too small');
    }

    const footer = table.subarray(table.length - 48);
    const magic = footer.subarray(40, 48).toString('hex');
    if (magic !== '57fb808b247547db') {
        throw new Error(`Unexpected LevelDB magic ${magic}`);
    }

    const metaHandle = readBlockHandle(footer, 0);
    const indexHandle = readBlockHandle(footer, metaHandle.nextOffset);
    const indexEntries = readEntries(readBlock(table, indexHandle));
    const records = [];

    for (const indexEntry of indexEntries) {
        const dataHandle = readBlockHandle(indexEntry.value, 0);
        for (const entry of readEntries(readBlock(table, dataHandle))) {
            records.push({
                key: stripInternalKey(entry.key),
                value: entry.value
            });
        }
    }

    let diagnostics = records
        .filter((record) => printable(record.key).includes('fillbarsDiagnosticRunsV1'))
        .map((record) => ({
            key: printable(record.key),
            runs: summarizeRuns(record.value, { cabinetOnly }),
            rawLength: record.value.length
        }));
    if (latestRecordOnly) {
        diagnostics = diagnostics.slice(0, 1);
    }
    if (recordSummaryOnly) {
        diagnostics = diagnostics.map((record) => {
            const run = record.runs?.[0] || null;
            const lastEvent = run?.events?.at(-1) || null;
            return {
                key: record.key,
                rawLength: record.rawLength,
                run: run ? {
                    id: run.id,
                    startedAt: run.startedAt,
                    finishedAt: run.finishedAt,
                    version: run.version,
                    status: run.status,
                    reason: run.reason,
                    eventCount: run.eventCount,
                    selectedEventCount: run.selectedEventCount,
                    lastEvent
                } : null
            };
        });
    }

    process.stdout.write(`${JSON.stringify({
        filename,
        recordCount: records.length,
        diagnosticRecords: diagnostics
    }, null, 2)}\n`);
}

main();
