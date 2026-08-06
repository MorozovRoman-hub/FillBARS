(function initializeFillBARSOfficeExport(globalScope) {
    'use strict';

    const encoder = new TextEncoder();
    const decoder = new TextDecoder('utf-8');
    let crcTable = null;

    function decodeBase64(value) {
        const binary = globalScope.atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }
        return bytes;
    }

    function getCrcTable() {
        if (crcTable) return crcTable;
        crcTable = new Uint32Array(256);
        for (let index = 0; index < 256; index += 1) {
            let value = index;
            for (let bit = 0; bit < 8; bit += 1) {
                value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
            }
            crcTable[index] = value >>> 0;
        }
        return crcTable;
    }

    function crc32(bytes) {
        const table = getCrcTable();
        let crc = 0xFFFFFFFF;
        for (const byte of bytes) crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    function concatenate(chunks) {
        const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        return result;
    }

    function createZip(entries) {
        const localChunks = [];
        const centralChunks = [];
        const date = new Date();
        const dosDate = ((Math.max(1980, date.getFullYear()) - 1980) << 9)
            | ((date.getMonth() + 1) << 5) | date.getDate();
        const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5)
            | Math.floor(date.getSeconds() / 2);
        let localOffset = 0;

        for (const entry of entries) {
            const nameBytes = encoder.encode(entry.name);
            const dataBytes = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
            const checksum = crc32(dataBytes);
            const localHeader = new Uint8Array(30 + nameBytes.length);
            const localView = new DataView(localHeader.buffer);
            localView.setUint32(0, 0x04034B50, true);
            localView.setUint16(4, 20, true);
            localView.setUint16(6, 0x0800, true);
            localView.setUint16(8, 0, true);
            localView.setUint16(10, dosTime, true);
            localView.setUint16(12, dosDate, true);
            localView.setUint32(14, checksum, true);
            localView.setUint32(18, dataBytes.length, true);
            localView.setUint32(22, dataBytes.length, true);
            localView.setUint16(26, nameBytes.length, true);
            localView.setUint16(28, 0, true);
            localHeader.set(nameBytes, 30);
            localChunks.push(localHeader, dataBytes);

            const centralHeader = new Uint8Array(46 + nameBytes.length);
            const centralView = new DataView(centralHeader.buffer);
            centralView.setUint32(0, 0x02014B50, true);
            centralView.setUint16(4, 20, true);
            centralView.setUint16(6, 20, true);
            centralView.setUint16(8, 0x0800, true);
            centralView.setUint16(10, 0, true);
            centralView.setUint16(12, dosTime, true);
            centralView.setUint16(14, dosDate, true);
            centralView.setUint32(16, checksum, true);
            centralView.setUint32(20, dataBytes.length, true);
            centralView.setUint32(24, dataBytes.length, true);
            centralView.setUint16(28, nameBytes.length, true);
            centralView.setUint16(30, 0, true);
            centralView.setUint16(32, 0, true);
            centralView.setUint16(34, 0, true);
            centralView.setUint16(36, 0, true);
            centralView.setUint32(38, 0, true);
            centralView.setUint32(42, localOffset, true);
            centralHeader.set(nameBytes, 46);
            centralChunks.push(centralHeader);
            localOffset += localHeader.length + dataBytes.length;
        }

        const centralDirectory = concatenate(centralChunks);
        const endRecord = new Uint8Array(22);
        const endView = new DataView(endRecord.buffer);
        endView.setUint32(0, 0x06054B50, true);
        endView.setUint16(8, entries.length, true);
        endView.setUint16(10, entries.length, true);
        endView.setUint32(12, centralDirectory.length, true);
        endView.setUint32(16, localOffset, true);
        return concatenate([...localChunks, centralDirectory, endRecord]);
    }

    function escapeXml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    function fillXml(xml, values) {
        let result = xml;
        for (const [key, value] of Object.entries(values || {})) {
            result = result.split(`{{${key}}}`).join(escapeXml(value));
        }
        return result.replace(/\{\{[A-Za-z][A-Za-z0-9]*\}\}/g, '');
    }

    function createFilledPackage(templateName, values) {
        const template = globalScope.__FillBARSOfficeTemplates__?.[templateName];
        if (!Array.isArray(template) || template.length === 0) {
            throw new Error(`Office template is unavailable: ${templateName}`);
        }
        return createZip(template.map((entry) => {
            const bytes = decodeBase64(entry.data);
            if (!/\.(?:xml|rels)$/i.test(entry.name)) return { name: entry.name, data: bytes };
            let xml = fillXml(decoder.decode(bytes), values);
            if (templateName === 'docx' && entry.name === 'docProps/app.xml') {
                xml = xml.replace(/<Pages>\d+<\/Pages>/, '<Pages>1</Pages>');
            }
            if (templateName === 'xlsx' && /xl\/worksheets\/sheet\d+\.xml$/i.test(entry.name)) {
                xml = xml.replace(/(<x:worksheet[^>]*>)/,
                    '$1<x:sheetPr><x:pageSetUpPr fitToPage="1"/></x:sheetPr>');
                xml = xml.replace('</x:worksheet>',
                    '<x:pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="1"/></x:worksheet>');
            }
            return { name: entry.name, data: encoder.encode(xml) };
        }));
    }

    function download(bytes, mimeType, fileName) {
        const url = globalScope.URL.createObjectURL(new Blob([bytes], { type: mimeType }));
        const link = globalScope.document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.style.display = 'none';
        globalScope.document.body.appendChild(link);
        link.click();
        link.remove();
        globalScope.setTimeout(() => globalScope.URL.revokeObjectURL(url), 1000);
    }

    const api = {
        createDocx: (values) => createFilledPackage('docx', values),
        createXlsx: (values) => createFilledPackage('xlsx', values),
        downloadDocx(values, fileName) {
            download(this.createDocx(values),
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileName);
        },
        downloadXlsx(values, fileName) {
            download(this.createXlsx(values),
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName);
        },
        createZip,
        fillXml
    };
    globalScope.__FillBARSOfficeExport__ = api;
})(globalThis);
