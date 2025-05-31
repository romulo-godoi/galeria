// media_indexer_worker.js

/**
 * Extracts the first two words from a filename to be used as a prefix.
 * @param {string} fileName The name of the file.
 * @returns {string} The generated prefix or the original filename if parsing fails.
 */
function getFirstTwoWords(fileName) {
    if (!fileName) return '';
    const nameWithoutExtension = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
    const words = nameWithoutExtension.split(/[\s_.-]+/).filter(Boolean); // Split by common delimiters and remove empty strings
    return words.slice(0, 2).join(' ').trim() || nameWithoutExtension; // Take first two words or original name if empty
}

self.onmessage = function(event) {
    const { files } = event.data;

    if (!files) {
        self.postMessage({ type: 'error', message: 'No files data received.' });
        return;
    }

    try {
        const mediaIndexMap = new Map();
        for (let i = 0; i < files.length; i++) {
            // In a real worker, you might want to check for an abort signal periodically
            // if the operation is extremely long. For this example, we'll keep it straightforward.
            // if (event.data.signal?.aborted) { // Assuming signal info could be passed for cooperative abortion
            //     self.postMessage({ type: 'abort' });
            //     return;
            // }

            const fileItem = files[i];
            // Ensure prefix is available or compute it.
            // For this setup, we assume 'prefix' is passed if pre-computed,
            // or 'name' is always available to compute it.
            const prefix = fileItem.prefix || getFirstTwoWords(fileItem.name);
            const lowerCasePrefix = prefix.toLowerCase();

            if (!lowerCasePrefix) continue;

            if (!mediaIndexMap.has(lowerCasePrefix)) {
                mediaIndexMap.set(lowerCasePrefix, { covers: [], regulars: [] });
            }
            const entry = mediaIndexMap.get(lowerCasePrefix);
            if (fileItem.isCoverFile) {
                entry.covers.push(fileItem);
            } else {
                entry.regulars.push(fileItem);
            }
        }
        self.postMessage({ type: 'success', mediaIndex: mediaIndexMap });
    } catch (error) {
        self.postMessage({ type: 'error', message: error.message || 'Error building media index in worker.' });
    }
};
