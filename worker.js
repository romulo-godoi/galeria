// worker.js

// Constants (ensure these are consistent with the main script)
const CAPAS_FOLDER_NAME = 'Capas';
const ORIGINAIS_FOLDER_NAME = 'Originais';
const CAMINHO_FOLDER_NAMES = ['CAMINHO1', 'CAMINHO2', 'CAMINHO3', 'CAMINHO4', 'CAMINHO5'];
const MEDIA_FILE_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mpeg', '.mpg', '.m4v'];

// Helper functions (adapted from main script)
function isMediaFile(fileName) {
    if (!fileName || typeof fileName !== 'string') return false;
    return MEDIA_FILE_EXTENSIONS.some(ext => fileName.toLowerCase().endsWith(ext));
}

function getFirstTwoWords(text) {
    if (!text) return "";
    const words = text.trim().split(/\s+/);
    return words.slice(0, 2).join(" ");
}

// Main processing logic
self.onmessage = function(event) {
    const { filesData, rootDirName, signal } = event.data;

    if (signal) {
        signal.addEventListener('abort', () => {
            // console.log('Worker: Abort signal received. Terminating.');
            self.postMessage({ type: 'aborted' });
            self.close(); // Terminate the worker
        });
    }

    const mediaFiles = [];
    const mediaIndex = new Map();
    let processedCount = 0;

    try {
        if (!filesData || !rootDirName) {
            throw new Error("Worker: Missing filesData or rootDirName");
        }

        // console.log(`Worker: Received ${filesData.length} files to process. Root: ${rootDirName}`);

        for (let i = 0; i < filesData.length; i++) {
            if (signal && signal.aborted) {
                // console.log("Worker: Operation aborted during file processing loop.");
                self.postMessage({ type: 'aborted' });
                return; // Exit if aborted
            }

            const fileData = filesData[i];
            const fullPath = fileData.webkitRelativePath;

            if (!isMediaFile(fileData.name)) {
                // console.log(`Worker: Skipping non-media file: ${fileData.name}`);
                continue;
            }

            const pathParts = fullPath.split('/');
            // pathParts[0] is the rootDirName, so media content starts from pathParts[1]
            if (pathParts.length < 2) {
                // console.log(`Worker: Skipping file not in a subdirectory (e.g., directly in root): ${fullPath}`);
                continue; 
            }
            
            const mediaGroupName = pathParts[1];
            const isCoverFile = pathParts.includes(CAPAS_FOLDER_NAME);
            const isOriginal = pathParts.includes(ORIGINAIS_FOLDER_NAME);
            const isCaminho = CAMINHO_FOLDER_NAMES.some(folder => pathParts.includes(folder));

            // Determine the primary name for indexing (e.g., movie name)
            // This will be the name of the folder directly inside the rootDirName
            const indexKey = mediaGroupName;

            // console.log(`Worker: Processing ${fullPath}, indexKey: ${indexKey}, isCover: ${isCoverFile}, isOriginal: ${isOriginal}`);

            const fileEntry = {
                name: fileData.name,
                relativePath: fullPath, // Main thread will use this to get File object
                mediaGroupName: mediaGroupName,
                isCoverFile: isCoverFile,
                isOriginal: isOriginal,
                isCaminho: isCaminho,
                firstTwoWords: getFirstTwoWords(mediaGroupName)
            };
            mediaFiles.push(fileEntry);

            if (!mediaIndex.has(indexKey)) {
                mediaIndex.set(indexKey, {
                    name: indexKey,
                    files: [],
                    coverFile: null,
                    originalFiles: [],
                    firstTwoWords: getFirstTwoWords(indexKey)
                });
            }

            const existingEntry = mediaIndex.get(indexKey);
            existingEntry.files.push(fileEntry);

            if (isCoverFile && !existingEntry.coverFile) {
                existingEntry.coverFile = fileEntry;
            }
            if (isOriginal) {
                existingEntry.originalFiles.push(fileEntry);
            }
            
            processedCount++;
            if (processedCount % 100 === 0) { // Optional: Send progress update
                self.postMessage({ type: 'progress', processed: processedCount, total: filesData.length });
            }
        }

        // console.log("Worker: Processing complete.");
        // console.log("Worker: mediaFiles count:", mediaFiles.length);
        // console.log("Worker: mediaIndex size:", mediaIndex.size);
        // mediaIndex.forEach((value, key) => {
        //    console.log(`Worker: Index Key: ${key}, Files: ${value.files.length}, Cover: ${value.coverFile ? value.coverFile.name : 'None'}`);
        // });


        self.postMessage({
            type: 'result',
            mediaFiles: mediaFiles,
            mediaIndex: mediaIndex // Maps are structured cloneable
        });

    } catch (error) {
        console.error('Error in Web Worker:', error);
        self.postMessage({ type: 'error', message: error.message, stack: error.stack });
    } finally {
        // console.log("Worker: Closing self.");
        // self.close(); // Worker is done with its task, it can be closed.
        // Re-consider self.close() if the worker needs to handle multiple messages over time
        // For this specific task, after processing one batch, it's likely done.
        // However, if we want to reuse the worker for subsequent folder selections without re-creation,
        // then we should not self.close() here. The main thread will terminate it if needed.
    }
};

// console.log("Worker: worker.js loaded and ready.");
