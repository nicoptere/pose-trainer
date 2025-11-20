const videoElement = document.getElementsByClassName('input_video')[0];
const canvasElement = document.getElementsByClassName('output_canvas')[0];
const canvasCtx = canvasElement.getContext('2d');
const poseResult = document.getElementById('pose-result');
const loadingDiv = document.getElementById('loading');

let ortSession = null;
let labels = [];

// Load labels and model
async function init() {
    try {
        // Load labels
        const response = await fetch('labels.json');
        labels = await response.json();
        console.log('Labels loaded:', labels);

        // Load ONNX model
        ortSession = await ort.InferenceSession.create('./model.onnx');
        console.log('Model loaded');
        loadingDiv.style.display = 'none';
    } catch (e) {
        console.error('Failed to init:', e);
        poseResult.innerText = 'Error loading model';
    }
}

function onResults(results) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.poseLandmarks) {
        drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS,
            { color: '#00FF00', lineWidth: 4 });
        drawLandmarks(canvasCtx, results.poseLandmarks,
            { color: '#FF0000', lineWidth: 2 });

        if (ortSession) {
            predictPose(results.poseLandmarks);
        }
    }
    canvasCtx.restore();
}

async function predictPose(landmarks) {
    // Flatten landmarks: [x0, y0, z0, v0, x1, y1, z1, v1, ...]
    const inputData = [];
    for (const lm of landmarks) {
        inputData.push(lm.x);
        inputData.push(lm.y);
        inputData.push(lm.z);
        inputData.push(lm.visibility);
    }

    // Create tensor
    const inputTensor = new ort.Tensor('float32', Float32Array.from(inputData), [1, 132]);

    // Run inference
    try {
        const feeds = { input: inputTensor }; // 'input' must match the input name in export
        const results = await ortSession.run(feeds);
        const output = results.output.data; // 'output' must match output name

        // Find max
        let maxVal = -Infinity;
        let maxIdx = -1;
        for (let i = 0; i < output.length; i++) {
            if (output[i] > maxVal) {
                maxVal = output[i];
                maxIdx = i;
            }
        }

        if (maxIdx >= 0 && maxIdx < labels.length) {
            poseResult.innerText = labels[maxIdx];
        }
    } catch (e) {
        console.error('Inference error:', e);
    }
}

const pose = new Pose({
    locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
    }
});
pose.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    enableSegmentation: false,
    smoothSegmentation: false,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});
pose.onResults(onResults);

const camera = new Camera(videoElement, {
    onFrame: async () => {
        await pose.send({ image: videoElement });
    },
    width: 1280,
    height: 720
});

init().then(() => {
    camera.start();
});
