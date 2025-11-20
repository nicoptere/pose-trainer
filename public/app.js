const videoElement = document.getElementsByClassName('input_video')[0];
const canvasElement = document.getElementsByClassName('output_canvas')[0];
const canvasCtx = canvasElement.getContext('2d');
const poseResult = document.getElementById('pose-result');
const confidenceBar = document.getElementById('confidence');
const loadingDiv = document.getElementById('loading');

let ortSession = null;
let labelData = null;

// Source selection
let currentSource = 'webcam';
let videoFileInput = null;
let processVideoBtn = null;

// Configuration for temporal window
const SEQUENCE_LENGTH = 30;
const TARGET_FPS = 7.5;
const INPUT_SIZE = 132;

// Pose sequence buffer
let poseBuffer = [];
let lastInferenceTime = 0;
const INFERENCE_INTERVAL = 1000 / TARGET_FPS;

// Cluster animations
let clusterAnimations = {};
let animationData = null;

// Cluster display
const clusterCanonicalPoses = {};
const clusterCanvases = {};
const clusterAnimationStates = {};
let animationLoopRunning = false;

// ============================================================================
// INITIALIZATION
// ============================================================================

async function init() {
    try {
        // Load labels
        const response = await fetch('gesture_classifier_labels.json');
        labelData = await response.json();
        console.log('Labels loaded:', labelData);

        // Load ONNX model
        ortSession = await ort.InferenceSession.create('./gesture_classifier.onnx');
        console.log('Model loaded successfully');

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

async function loadClusterAnimations() {
    try {
        const response = await fetch('cluster_animations.json');
        animationData = await response.json();
        clusterAnimations = animationData.animations;
        console.log(`Loaded animations for ${Object.keys(clusterAnimations).length} clusters`);
    } catch (e) {
        console.warn('Could not load cluster animations:', e);
    }
}

function initializeUI() {
    const sourceRadios = document.querySelectorAll('input[name="source"]');
    const fileUploadDiv = document.querySelector('.file-upload');
    videoFileInput = document.getElementById('video-file');
    processVideoBtn = document.getElementById('process-video-btn');

    sourceRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            currentSource = e.target.value;
            if (currentSource === 'file') {
                fileUploadDiv.style.display = 'flex';
                if (videoElement.srcObject) {
                    videoElement.srcObject.getTracks().forEach(track => track.stop());
                    videoElement.srcObject = null;
                }
            } else {
                fileUploadDiv.style.display = 'none';
                startCamera();
            }
        });
    });

    if (processVideoBtn) {
        processVideoBtn.addEventListener('click', processUploadedVideo);
    }
}

// ============================================================================
// VIDEO UPLOAD
// ============================================================================

async function processUploadedVideo() {
    const file = videoFileInput.files[0];
    if (!file) {
        alert('Please select a video file');
        return;
    }

    const videoURL = URL.createObjectURL(file);
    videoElement.src = videoURL;
    videoElement.style.display = 'block';
    videoElement.loop = false;
    videoElement.muted = true;

    loadingDiv.style.display = 'block';
    loadingDiv.innerText = 'Processing video...';
    poseResult.innerText = 'Processing...';
    poseBuffer = [];

    videoElement.onloadedmetadata = async () => {
        await videoElement.play();

        const processFrame = async () => {
            if (!videoElement.ended) {
                await pose.send({ image: videoElement });
                requestAnimationFrame(processFrame);
            } else {
                loadingDiv.style.display = 'none';
                poseResult.innerText = 'Video processing complete';
                URL.revokeObjectURL(videoURL);
            }
        };

        processFrame();
    };
}

// ============================================================================
// CLUSTER GALLERY
// ============================================================================

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
        drawSkeletonOnCanvas(canvas, null);
    }
}

function drawSkeletonOnCanvas(canvas, landmarks) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!landmarks) {
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ccc';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('No pose yet', canvas.width / 2, canvas.height / 2);
        return;
    }

    const width = canvas.width;
    const height = canvas.height;
    const padding = 20;

    const points = [];
    for (let i = 0; i < landmarks.length; i += 4) {
        points.push({
            x: landmarks[i] * (width - 2 * padding) + padding,
            y: landmarks[i + 1] * (height - 2 * padding) + padding,
            visibility: landmarks[i + 3]
        });
    }

    const connections = [
        [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
        [11, 23], [12, 24], [23, 24],
        [23, 25], [25, 27], [27, 29], [29, 31],
        [24, 26], [26, 28], [28, 30], [30, 32],
        [0, 1], [1, 2], [2, 3], [3, 7],
        [0, 4], [4, 5], [5, 6], [6, 8]
    ];

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

    ctx.fillStyle = '#764ba2';
    for (const point of points) {
        if (point.visibility > 0.5) {
            ctx.beginPath();
            ctx.arc(point.x, point.y, 3, 0, 2 * Math.PI);
            ctx.fill();
        }
    }
}

function startAnimationLoop() {
    if (animationLoopRunning) return;
    animationLoopRunning = true;

    for (let i = 0; i < labelData.num_classes; i++) {
        clusterAnimationStates[i] = {
            currentFrame: 0,
            lastUpdateTime: 0
        };
    }

    const ANIMATION_FPS = 10;
    const FRAME_INTERVAL = 1000 / ANIMATION_FPS;

    function animate() {
        const now = Date.now();

        for (let clusterId = 0; clusterId < labelData.num_classes; clusterId++) {
            const state = clusterAnimationStates[clusterId];
            const animation = clusterAnimations[clusterId];

            if (!animation || !animation.sequence || animation.sequence.length === 0) {
                continue;
            }

            if (now - state.lastUpdateTime >= FRAME_INTERVAL) {
                const frame = animation.sequence[state.currentFrame];
                const canvas = clusterCanvases[clusterId];
                if (canvas && frame) {
                    drawSkeletonOnCanvas(canvas, frame);
                }

                state.currentFrame = (state.currentFrame + 1) % animation.sequence.length;
                state.lastUpdateTime = now;
            }
        }

        requestAnimationFrame(animate);
    }

    animate();
}

// ============================================================================
// POSE DETECTION
// ============================================================================

function onResults(results) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.poseLandmarks) {
        drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS,
            { color: '#00FF00', lineWidth: 4 });
        drawLandmarks(canvasCtx, results.poseLandmarks,
            { color: '#FF0000', lineWidth: 2 });

        addLandmarksToBuffer(results.poseLandmarks);

        const now = Date.now();
        if (ortSession && now - lastInferenceTime >= INFERENCE_INTERVAL) {
            if (poseBuffer.length >= SEQUENCE_LENGTH) {
                predictGesture();
                lastInferenceTime = now;
            } else {
                const progress = Math.round((poseBuffer.length / SEQUENCE_LENGTH) * 100);
                poseResult.innerText = `Collecting poses... ${progress}%`;
            }
        }
    }

    canvasCtx.restore();
}

function addLandmarksToBuffer(landmarks) {
    const frame = [];
    for (const lm of landmarks) {
        frame.push(lm.x, lm.y, lm.z, lm.visibility);
    }

    poseBuffer.push(frame);

    if (poseBuffer.length > SEQUENCE_LENGTH) {
        poseBuffer.shift();
    }
}

async function predictGesture() {
    if (poseBuffer.length < SEQUENCE_LENGTH) {
        return;
    }

    try {
        const sequence = poseBuffer.slice(-SEQUENCE_LENGTH);

        const inputData = new Float32Array(SEQUENCE_LENGTH * INPUT_SIZE);
        for (let i = 0; i < SEQUENCE_LENGTH; i++) {
            for (let j = 0; j < INPUT_SIZE; j++) {
                inputData[i * INPUT_SIZE + j] = sequence[i][j];
            }
        }

        const inputTensor = new ort.Tensor('float32', inputData, [1, SEQUENCE_LENGTH, INPUT_SIZE]);

        const feeds = { input: inputTensor };
        const results = await ortSession.run(feeds);

        const classification = results.classification.data;

        let maxProb = -Infinity;
        let maxIdx = -1;
        for (let i = 0; i < classification.length; i++) {
            if (classification[i] > maxProb) {
                maxProb = classification[i];
                maxIdx = i;
            }
        }

        const expScores = Array.from(classification).map(x => Math.exp(x));
        const sumExp = expScores.reduce((a, b) => a + b, 0);
        const probabilities = expScores.map(x => x / sumExp);

        const confidence = probabilities[maxIdx];

        if (maxIdx >= 0 && maxIdx < labelData.num_classes) {
            const gestureName = labelData.class_names[maxIdx];
            poseResult.innerText = `Cluster ${maxIdx}: ${gestureName}`;

            confidenceBar.style.width = (confidence * 100) + '%';
            confidenceBar.style.backgroundColor = confidence > 0.7 ? '#4CAF50' :
                confidence > 0.4 ? '#FFC107' : '#F44336';
            confidenceBar.innerText = `${(confidence * 100).toFixed(1)}%`;

            // Highlight active cluster (don't update animation)
            document.querySelectorAll('.cluster-card').forEach(card => {
                card.classList.remove('active');
            });
            const activeCard = document.getElementById(`cluster-card-${maxIdx}`);
            if (activeCard) {
                activeCard.classList.add('active');
            }
        }

    } catch (e) {
        console.error('Inference error:', e);
        poseResult.innerText = 'Error: ' + e.message;
    }
}

// ============================================================================
// CAMERA
// ============================================================================

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

        videoElement.onloadedmetadata = () => {
            videoElement.play();
            console.log('Camera started successfully');
            loadingDiv.style.display = 'none';

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

        poseResult.innerText = 'Camera Error';
        loadingDiv.innerHTML = `
            <div style="text-align: left; max-width: 500px;">
                <h3>⚠️ Cannot Access Camera</h3>
                <p><strong>Error:</strong> ${error.name} - ${error.message}</p>
                <p><strong>Possible solutions:</strong></p>
                <ul style="text-align: left; padding-left: 20px;">
                    <li><strong>Close other apps</strong> using the camera (Zoom, Teams, Skype, OBS, etc.)</li>
                    <li><strong>Allow camera access</strong> when the browser prompts you</li>
                    <li><strong>Reload the page</strong> and try again</li>
                    <li><strong>Try a different browser</strong> (Chrome recommended)</li>
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

// ============================================================================
// START
// ============================================================================

init().then(() => {
    console.log('Model loaded, initializing UI...');
    initializeUI();
    startCamera();
});
