import { Docmem } from '../docmem_tools/docmem.js';

export class ParagraphImporter {
    async importFromFile(file) {
        const text = await file.text();
        const normalizedText = text.replace(/\r/g, '');

        const paragraphs = normalizedText.split(/\n(?:\s*\n)+/);
        const trimmedParagraphs = [];

        for (const paragraph of paragraphs) {
            const trimmed = paragraph.trim();
            if (trimmed.length > 0) {
                trimmedParagraphs.push(trimmed);
            }
        }

        if (trimmedParagraphs.length === 0) {
            throw new Error('No paragraphs found in file');
        }

        return trimmedParagraphs;
    }

    async createDocmemFromFile(file) {
        const paragraphs = await this.importFromFile(file);

        const filenameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const selectedRootId = `${filenameWithoutExt}.${timestamp}`;
        const docmem = new Docmem(selectedRootId);
        await docmem.ready();

        const rootNode = await docmem.getRoot();
        let createdCount = 0;

        for (const paragraph of paragraphs) {
            const order = await docmem.calculateOrderForAppend(rootNode.id);
            await docmem.createAndInsertNode(rootNode.id, paragraph, order, 'paragraph', 'source', 'upload', 0);
            createdCount++;
        }

        return { docmem, selectedRootId, createdCount };
    }
}
