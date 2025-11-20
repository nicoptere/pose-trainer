const videoElement = document.getElementsByClassName('input_video')[0];
const canvasElement = document.getElementsByClassName('output_canvas')[0];
const canvasCtx = canvasElement.getContext('2d');
const poseResult = document.getElementById('pose-result');
const confidenceBar = document.getElementById('confidence');
const loadingDiv = document.getElementById('loading');

let ortSession = null;
let labelData = null;

// Configuration for temporal window
const SEQUENCE_LENGTH = 30;  // Number of frames (from config.SEQUENCE_LENGTH)
const TARGET_FPS = 7.5;       // Target FPS for gesture detection (30 frames / 4 seconds)
const INPUT_SIZE = 132;       // 33 landmarks * 4 features

// Pose sequence buffer
let poseBuffer = [];
let lastInferenceTime = 0;
const INFERENCE_INTERVAL = 1000 / TARGET_FPS;  // Milliseconds between inferences

// Load labels and model
async function init() {
    try {
        // Load labels
        const response = await fetch('gesture_classifier_labels.json');
        labelData = await response.json();
        console.log('Labels loaded:', labelData);

        // Load ONNX model (gesture classifier)
        ortSession = await ort.InferenceSession.create('./gesture_classifier.onnx');
        console.log('Model loaded successfully');
        console.log('Model inputs:', ortSession.inputNames);
        console.log('Model outputs:', ortSession.outputNames);

        loadingDiv.style.display = 'none';
        poseResult.innerText = 'Ready - Perform a gesture!';
    } catch (e) {
        console.error('Failed to init:', e);
        poseResult.innerText = 'Error loading model: ' + e.message;
        loadingDiv.innerText = 'Error: ' + e.message;
    }
}

function onResults(results) {
    // Draw video and pose
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.poseLandmarks) {
        // Draw pose overlay
        drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS,
            { color: '#00FF00', lineWidth: 4 });
        drawLandmarks(canvasCtx, results.poseLandmarks,
            { color: '#FF0000', lineWidth: 2 });

        // Add landmarks to buffer
        addLandmarksToBuffer(results.poseLandmarks);

        // Run inference if enough time has passed and buffer is ready
        const now = Date.now();
        if (ortSession && now - lastInferenceTime >= INFERENCE_INTERVAL) {
            if (poseBuffer.length >= SEQUENCE_LENGTH) {
                predictGesture();
                lastInferenceTime = now;
            } else {
                // Show buffer filling status
                const progress = Math.round((poseBuffer.length / SEQUENCE_LENGTH) * 100);
                poseResult.innerText = `Collecting poses... ${progress}%`;
            }
        }
    }

    canvasCtx.restore();
}

function addLandmarksToBuffer(landmarks) {
    // Flatten landmarks: [x0, y0, z0, v0, x1, y1, z1, v1, ...] = 132 values
    const frame = [];
    for (const lm of landmarks) {
        frame.push(lm.x, lm.y, lm.z, lm.visibility);
    }

    // Add to buffer
    poseBuffer.push(frame);

    // Keep only the last SEQUENCE_LENGTH frames (sliding window)
    if (poseBuffer.length > SEQUENCE_LENGTH) {
        poseBuffer.shift();  // Remove oldest frame
    }
}

async function predictGesture() {
    if (poseBuffer.length < SEQUENCE_LENGTH) {
        return;
    }

    try {
        // Take the last SEQUENCE_LENGTH frames
        const sequence = poseBuffer.slice(-SEQUENCE_LENGTH);

        // Create input tensor: shape [1, SEQUENCE_LENGTH, INPUT_SIZE]
        const inputData = new Float32Array(SEQUENCE_LENGTH * INPUT_SIZE);
        for (let i = 0; i < SEQUENCE_LENGTH; i++) {
            for (let j = 0; j < INPUT_SIZE; j++) {
                inputData[i * INPUT_SIZE + j] = sequence[i][j];
            }
        }

        const inputTensor = new ort.Tensor('float32', inputData, [1, SEQUENCE_LENGTH, INPUT_SIZE]);

        // Run inference
        const feeds = { input: inputTensor };
        const results = await ortSession.run(feeds);

        // Get classification output
        const classification = results.classification.data;

        // Find max probability
        let maxProb = -Infinity;
        let maxIdx = -1;
        for (let i = 0; i < classification.length; i++) {
            if (classification[i] > maxProb) {
                maxProb = classification[i];
                maxIdx = i;
            }
        }

        // Apply softmax for better probabilities
        const expScores = Array.from(classification).map(x => Math.exp(x));
        const sumExp = expScores.reduce((a, b) => a + b, 0);
        const probabilities = expScores.map(x => x / sumExp);

        const confidence = probabilities[maxIdx];

        // Display result
        if (maxIdx >= 0 && maxIdx < labelData.num_classes) {
            const gestureName = labelData.class_names[maxIdx];
            poseResult.innerText = `Cluster ${maxIdx}: ${gestureName}`;

            // Update confidence bar
            confidenceBar.style.width = (confidence * 100) + '%';
            confidenceBar.style.backgroundColor = confidence > 0.7 ? '#4CAF50' :
                confidence > 0.4 ? '#FFC107' : '#F44336';
            confidenceBar.innerText = `${(confidence * 100).toFixed(1)}%`;
        }

    } catch (e) {
        console.error('Inference error:', e);
        poseResult.innerText = 'Error: ' + e.message;
    }
}

// Initialize MediaPipe Pose
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

// Alternative camera initialization with better error handling
async function startCamera() {
    try {
        // Method 1: Try MediaPipe Camera utility
        const camera = new Camera(videoElement, {
            onFrame: async () => {
                await pose.send({ image: videoElement });
            },
            width: 1280,
            height: 720
        });

        await camera.start();
        console.log('Camera started successfully using MediaPipe Camera utility');

    } catch (error) {
        console.warn('MediaPipe Camera failed, trying getUserMedia fallback:', error);

        // Method 2: Fallback to getUserMedia
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    facingMode: 'user'
                }
            });

            videoElement.srcObject = stream;
            videoElement.play();

            // Send frames to pose detection
            const sendFrame = async () => {
                if (videoElement.readyState === videoElement.HAVE_ENOUGH_DATA) {
                    await pose.send({ image: videoElement });
                }
                requestAnimationFrame(sendFrame);
            };

            videoElement.addEventListener('loadeddata', () => {
                console.log('Camera started successfully using getUserMedia');
                sendFrame();
            });

        } catch (fallbackError) {
            console.error('Both camera methods failed:', fallbackError);

            // Show user-friendly error message
            poseResult.innerText = 'Camera Error';
            loadingDiv.innerHTML = `
                <div style="text-align: left; max-width: 500px;">
                    <h3>⚠️ Cannot Access Camera</h3>
                    <p><strong>Possible solutions:</strong></p>
                    <ul style="text-align: left; padding-left: 20px;">
                        <li>Close other apps using the camera (Zoom, Teams, Skype, etc.)</li>
                        <li>Refresh the page and allow camera access when prompted</li>
                        <li>Check browser settings to ensure camera permissions are granted</li>
                        <li>Try a different browser (Chrome recommended)</li>
                        <li>Restart your browser</li>
                    </ul>
                    <p style="margin-top: 15px; font-size: 0.9em; color: #ff6b6b;">
                        <strong>Error:</strong> ${fallbackError.message}
                    </p>
                </div>
            `;
            loadingDiv.style.display = 'block';
            loadingDiv.style.background = 'rgba(30, 30, 30, 0.95)';
            loadingDiv.style.padding = '30px';
            loadingDiv.style.fontSize = '14px';
        }
    }
}

// Start everything
init().then(() => {
    console.log('Starting camera...');
    startCamera();
});
