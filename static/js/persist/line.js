class LineImporter {
    async importFromFile(file) {
        const text = await file.text();
        
        const lines = text.split('\n');
        const trimmedLines = [];
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length > 0) {
                trimmedLines.push(trimmed);
            }
        }

        if (trimmedLines.length === 0) {
            throw new Error('No non-empty lines found in file');
        }

        return trimmedLines;
    }

    async createDocmemFromFile(file) {
        const lines = await this.importFromFile(file);
        
        const filenameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const selectedRootId = `${filenameWithoutExt}.${timestamp}`;
        const docmem = new Docmem(selectedRootId);
        await docmem.ready();

        const rootNode = docmem.getRoot();
        let createdCount = 0;

        for (const line of lines) {
            const order = docmem.calculateOrderForAppend(rootNode.id);
            await docmem.createAndInsertNode(rootNode.id, line, order, 'line', 'source', 'upload', 1);
            createdCount++;
        }

        return { docmem, selectedRootId, createdCount };
    }
}
