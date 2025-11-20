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

        // Load cluster animations
        await loadClusterAnimations();

        // Initialize cluster gallery
        initializeClusterGallery();

        // Start animation loop
        startAnimationLoop();

        poseResult.innerText = 'Ready - Perform a gesture!';
    } catch (e) {
        console.error('Failed to init:', e);
        poseResult.innerText = 'Error loading model: ' + e.message;
        loadingDiv.innerText = 'Error: ' + e.message;
    }
}

// Store cluster animations
let clusterAnimations = {};
let animationData = null;

async function loadClusterAnimations() {
    try {
        const response = await fetch('cluster_animations.json');
        animationData = await response.json();
        clusterAnimations = animationData.animations;
        console.log(`Loaded animations for ${Object.keys(clusterAnimations).length} clusters`);
    } catch (e) {
        console.warn('Could not load cluster animations:', e);
        console.log('Cluster cards will show static poses instead of animations');
    }
}

// Store canonical poses for each cluster
const clusterCanonicalPoses = {};
const clusterCanvases = {};

function initializeClusterGallery() {
    const grid = document.getElementById('cluster-grid');
    grid.innerHTML = '';

    for (let i = 0; i < labelData.num_classes; i++) {
        const card = document.createElement('div');
        card.className = 'cluster-card';
        card.id = `cluster-card-${i}`;

        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 150;
        canvas.id = `cluster-canvas-${i}`;

        const name = document.createElement('div');
        name.className = 'cluster-name';
        name.textContent = labelData.class_names[i];

        const id = document.createElement('div');
        id.className = 'cluster-id';
        id.textContent = `Cluster ${i}`;

        card.appendChild(canvas);
        card.appendChild(name);
        card.appendChild(id);
        grid.appendChild(card);

        clusterCanvases[i] = canvas;

        // Initialize with empty pose
        drawSkeletonOnCanvas(canvas, null);
    }
}

function drawSkeletonOnCanvas(canvas, landmarks) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!landmarks) {
        // Draw placeholder
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ccc';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('No pose yet', canvas.width / 2, canvas.height / 2);
        return;
    }

    // Scale and center the landmarks
    const width = canvas.width;
    const height = canvas.height;
    const padding = 20;

    // Convert landmarks to canvas coordinates
    const points = [];
    for (let i = 0; i < landmarks.length; i += 4) {
        points.push({
            x: landmarks[i] * (width - 2 * padding) + padding,
            y: landmarks[i + 1] * (height - 2 * padding) + padding,
            visibility: landmarks[i + 3]
        });
    }

    // MediaPipe pose connections
    const connections = [
        [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], // Arms
        [11, 23], [12, 24], [23, 24], // Torso
        [23, 25], [25, 27], [27, 29], [29, 31], // Left leg
        [24, 26], [26, 28], [28, 30], [30, 32], // Right leg
        [0, 1], [1, 2], [2, 3], [3, 7], // Face left
        [0, 4], [4, 5], [5, 6], [6, 8] // Face right
    ];

    // Draw connections
    ctx.strokeStyle = '#667eea';
    ctx.lineWidth = 2;
    for (const [i, j] of connections) {
        if (i < points.length && j < points.length) {
            if (points[i].visibility > 0.5 && points[j].visibility > 0.5) {
                ctx.beginPath();
                ctx.moveTo(points[i].x, points[i].y);
                ctx.lineTo(points[j].x, points[j].y);
                ctx.stroke();
            }
        }
    }

    // Draw joints
    ctx.fillStyle = '#764ba2';
    for (const point of points) {
        if (point.visibility > 0.5) {
            ctx.beginPath();
            ctx.arc(point.x, point.y, 3, 0, 2 * Math.PI);
            ctx.fill();
        }
    }
}

function updateClusterPose(clusterId, landmarks) {
    // Store or update canonical pose
    if (!clusterCanonicalPoses[clusterId]) {
        clusterCanonicalPoses[clusterId] = landmarks;
    } else {
        // Average with existing pose (simple moving average)
        const alpha = 0.1; // Weight for new pose
        for (let i = 0; i < landmarks.length; i++) {
            clusterCanonicalPoses[clusterId][i] =
                (1 - alpha) * clusterCanonicalPoses[clusterId][i] + alpha * landmarks[i];
        }
    }

    // Redraw the skeleton
    const canvas = clusterCanvases[clusterId];
    if (canvas) {
        drawSkeletonOnCanvas(canvas, clusterCanonicalPoses[clusterId]);
    }

    // Highlight active cluster
    document.querySelectorAll('.cluster-card').forEach(card => {
        card.classList.remove('active');
    });
    const activeCard = document.getElementById(`cluster-card-${clusterId}`);
    if (activeCard) {
        activeCard.classList.add('active');
    }
}

// Animation state
const clusterAnimationStates = {};
let animationLoopRunning = false;

function startAnimationLoop() {
    if (animationLoopRunning) return;
    animationLoopRunning = true;

    // Initialize animation state for each cluster
    for (let i = 0; i < labelData.num_classes; i++) {
        clusterAnimationStates[i] = {
            currentFrame: 0,
            lastUpdateTime: 0
        };
    }

    // Animation loop at ~10 FPS
    const ANIMATION_FPS = 10;
    const FRAME_INTERVAL = 1000 / ANIMATION_FPS;

    function animate() {
        const now = Date.now();

        // Update each cluster's animation
        for (let clusterId = 0; clusterId < labelData.num_classes; clusterId++) {
            const state = clusterAnimationStates[clusterId];
            const animation = clusterAnimations[clusterId];

            if (!animation || !animation.sequence || animation.sequence.length === 0) {
                continue;
            }

            // Check if it's time to update this animation
            if (now - state.lastUpdateTime >= FRAME_INTERVAL) {
                // Get current frame
                const frame = animation.sequence[state.currentFrame];

                // Draw it
                const canvas = clusterCanvases[clusterId];
                if (canvas && frame) {
                    drawSkeletonOnCanvas(canvas, frame);
                }

                // Advance to next frame (loop)
                state.currentFrame = (state.currentFrame + 1) % animation.sequence.length;
                state.lastUpdateTime = now;
            }
        }

        requestAnimationFrame(animate);
    }

    animate();
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

            // Update cluster visualization with current pose
            if (poseBuffer.length > 0) {
                const latestPose = poseBuffer[poseBuffer.length - 1];
                updateClusterPose(maxIdx, latestPose);
            }
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

// Camera initialization using getUserMedia directly
async function startCamera() {
    try {
        console.log('Requesting camera access...');

        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'user'
            }
        });

        videoElement.srcObject = stream;

        // Wait for video to be ready
        videoElement.onloadedmetadata = () => {
            videoElement.play();
            console.log('Camera started successfully');
            loadingDiv.style.display = 'none';

            // Start sending frames to pose detection
            const sendFrame = async () => {
                if (videoElement.readyState === videoElement.HAVE_ENOUGH_DATA) {
                    await pose.send({ image: videoElement });
                }
                requestAnimationFrame(sendFrame);
            };

            sendFrame();
        };

    } catch (error) {
        console.error('Camera access failed:', error);

        // Show user-friendly error message
        poseResult.innerText = 'Camera Error';
        loadingDiv.innerHTML = `
            <div style="text-align: left; max-width: 500px;">
                <h3>⚠️ Cannot Access Camera</h3>
                <p><strong>Error:</strong> ${error.name} - ${error.message}</p>
                <p><strong>Possible solutions:</strong></p>
                <ul style="text-align: left; padding-left: 20px;">
                    <li><strong>Close other apps</strong> using the camera (Zoom, Teams, Skype, OBS, etc.)</li>
                    <li><strong>Allow camera access</strong> when the browser prompts you</li>
                    <li><strong>Check browser settings:</strong>
                        <ul style="margin-top: 5px;">
                            <li>Chrome: Settings → Privacy → Camera</li>
                            <li>Firefox: Settings → Privacy → Permissions</li>
                        </ul>
                    </li>
                    <li><strong>Reload the page</strong> and try again</li>
                    <li><strong>Try a different browser</strong> (Chrome recommended)</li>
                    <li><strong>Check if camera is working</strong> in another app first</li>
                </ul>
            </div>
        `;
        loadingDiv.style.display = 'block';
        loadingDiv.style.background = 'rgba(30, 30, 30, 0.95)';
        loadingDiv.style.padding = '30px';
        loadingDiv.style.fontSize = '14px';
        loadingDiv.style.textAlign = 'left';
    }
}

// Start everything
init().then(() => {
    console.log('Model loaded, starting camera...');
    startCamera();
});
