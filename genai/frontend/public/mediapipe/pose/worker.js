
// Web Worker for MediaPipe Pose
// Handles pose detection in a separate thread to avoid conflicts with global scope

importScripts('pose.js');

let pose = null;

self.onmessage = async function (e) {
    const { type, payload } = e.data;

    if (type === 'init') {
        try {
            console.log("Initializing MediaPipe Pose in Worker...");
            pose = new self.Pose({
                locateFile: (file) => {
                    // Files are in the same directory as this worker
                    return file;
                }
            });

            pose.setOptions({
                modelComplexity: 1,
                smoothLandmarks: true,
                enableSegmentation: false,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });

            pose.onResults((results) => {
                // Post results back to main thread
                // We strip the image data to avoid overhead, we only need landmarks
                const simpleResults = {
                    poseLandmarks: results.poseLandmarks,
                    poseWorldLandmarks: results.poseWorldLandmarks
                };
                self.postMessage({ type: 'results', results: simpleResults });
            });

            await pose.initialize();
            console.log("MediaPipe Pose Initialized in Worker");
            self.postMessage({ type: 'ready' });

        } catch (err) {
            console.error("Worker Initialization Error:", err);
            self.postMessage({ type: 'error', error: err.toString() });
        }
    } else if (type === 'frame') {
        if (!pose) return;
        try {
            // payload is the OffscreenCanvas or ImageBitmap
            await pose.send({ image: payload });
        } catch (err) {
            console.error("Worker Inference Error:", err);
            // self.postMessage({ type: 'error', error: err.toString() });
        }
    } else if (type === 'close') {
        if (pose) pose.close();
        close();
    }
};
