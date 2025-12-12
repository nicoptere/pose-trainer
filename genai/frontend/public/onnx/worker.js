importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.1/dist/ort.min.js');

ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.1/dist/";
ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true;

let session = null;
let SEQUENCE_LENGTH = 30;
const INPUT_SIZE = 132;
let buffer = [];

// Normalization Logic
function normalizeSkeleton(landmarks) {
    // landmarks is array of {x, y, z, visibility}
    // Convert to simple objects if needed, but assuming input is compatible
    const coords = landmarks.map(lm => ({ x: lm.x, y: lm.y, z: lm.z }));

    const leftShoulder = coords[11];
    const rightShoulder = coords[12];
    const leftHip = coords[23];
    const rightHip = coords[24];

    // Check if keypoints exist
    if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) {
        return new Float32Array(132); // Return zeros if critical points missing
    }

    const shoulderMid = {
        x: (leftShoulder.x + rightShoulder.x) / 2,
        y: (leftShoulder.y + rightShoulder.y) / 2,
        z: (leftShoulder.z + rightShoulder.z) / 2
    };
    const hipMid = {
        x: (leftHip.x + rightHip.x) / 2,
        y: (leftHip.y + rightHip.y) / 2,
        z: (leftHip.z + rightHip.z) / 2
    };
    const torsoCenter = {
        x: (shoulderMid.x + hipMid.x) / 2,
        y: (shoulderMid.y + hipMid.y) / 2,
        z: (shoulderMid.z + hipMid.z) / 2
    };

    const torsoHeight = Math.sqrt(
        Math.pow(shoulderMid.x - hipMid.x, 2) +
        Math.pow(shoulderMid.y - hipMid.y, 2) +
        Math.pow(shoulderMid.z - hipMid.z, 2)
    ) || 1.0;

    const normalized = [];
    for (let i = 0; i < 33; i++) {
        const lm = landmarks[i] || { x: 0, y: 0, z: 0, visibility: 0 };
        const nx = (lm.x - torsoCenter.x) / torsoHeight;
        const ny = (lm.y - torsoCenter.y) / torsoHeight;
        const nz = (lm.z - torsoCenter.z) / torsoHeight;
        normalized.push(nx, ny, nz, lm.visibility !== undefined ? lm.visibility : 0);
    }

    return normalized;
}

self.onmessage = async (e) => {
    const { type, payload } = e.data;

    if (type === 'init') {
        const { modelUrl, sequenceLength } = payload;
        if (sequenceLength) SEQUENCE_LENGTH = sequenceLength;
        try {
            console.log("Initializing ONNX Session in Worker...");
            session = await ort.InferenceSession.create(modelUrl, {
                executionProviders: ['wasm']
            });
            console.log("ONNX Session Ready");
            self.postMessage({ type: 'ready' });
        } catch (err) {
            console.error(err);
            self.postMessage({ type: 'error', error: err.toString() });
        }
    }
    else if (type === 'process') {
        // payload: landmarks array
        if (!session) return;

        try {
            const frame = normalizeSkeleton(payload);
            buffer.push(frame);
            if (buffer.length > SEQUENCE_LENGTH) buffer.shift();

            if (buffer.length === SEQUENCE_LENGTH) {
                // Flatten
                const data = new Float32Array(SEQUENCE_LENGTH * INPUT_SIZE);
                for (let i = 0; i < SEQUENCE_LENGTH; i++) {
                    data.set(buffer[i], i * INPUT_SIZE);
                }

                // LOGGING FOR VERIFICATION
                self.postMessage({
                    type: 'log',
                    log: `Running inference on sequence: Shape [1, ${SEQUENCE_LENGTH}, ${INPUT_SIZE}]`
                });

                const tensor = new ort.Tensor('float32', data, [1, SEQUENCE_LENGTH, INPUT_SIZE]);
                const results = await session.run({ input: tensor });

                // Assuming output name is 'classification'
                // Or we can get the first output
                const outputName = session.outputNames[0]; // usually 'classification'
                const classification = results[outputName].data;

                // Send back the latest normalized frame for visualization
                const lastFrame = buffer[buffer.length - 1];

                self.postMessage({ type: 'result', classification: classification, pose: lastFrame });
            } else {
                self.postMessage({ type: 'buffering', count: buffer.length });
            }
        } catch (err) {
            console.error("Inference Error in Worker:", err);
        }
    }
    else if (type === 'reset') {
        buffer = [];
    }
};
