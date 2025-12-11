'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Box, Typography, Paper, LinearProgress, Alert, Card, CardContent } from '@mui/material';
import Webcam from 'react-webcam';


import type * as ort from 'onnxruntime-web';
// import { Pose, Results } from '@mediapipe/pose'; // Removed static import
// Configuration
const SEQUENCE_LENGTH = 30;
const INPUT_SIZE = 132;
const TARGET_FPS = 15; // Limit inference frequency

// Define POSE_CONNECTIONS manually since we are removing the package import
const POSE_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8],
    [9, 9], [9, 10], [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21],
    [17, 19], [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
    [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28],
    [27, 29], [28, 30], [29, 31], [30, 32], [27, 31], [28, 32]
];

// Normalization Logic (Ported from run.py)
function normalizeSkeleton(landmarks: any[]): number[] {
    // MediaPipe landmarks: x, y, z, visibility
    // 33 landmarks
    const coords = [];
    for (let i = 0; i < 33; i++) {
        coords.push({
            x: landmarks[i].x,
            y: landmarks[i].y,
            z: landmarks[i].z
        });
    }

    const leftShoulder = coords[11];
    const rightShoulder = coords[12];
    const leftHip = coords[23];
    const rightHip = coords[24];

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

    // Calculate torso height (distance between shoulder mid and hip mid)
    const torsoHeight = Math.sqrt(
        Math.pow(shoulderMid.x - hipMid.x, 2) +
        Math.pow(shoulderMid.y - hipMid.y, 2) +
        Math.pow(shoulderMid.z - hipMid.z, 2)
    ) || 1.0;

    // Normalize
    const normalized = [];
    for (let i = 0; i < 33; i++) {
        const lm = landmarks[i];
        // Center and Scale
        const nx = (lm.x - torsoCenter.x) / torsoHeight;
        const ny = (lm.y - torsoCenter.y) / torsoHeight;
        const nz = (lm.z - torsoCenter.z) / torsoHeight;

        normalized.push(nx, ny, nz, lm.visibility);
    }

    return normalized;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

// --- Gesture Animation Preview Component ---
const GesturePreview = ({ animation, width = 120, height = 120, color = "#4ADE80" }: { animation: any, width?: number, height?: number, color?: string }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const requestRef = useRef<number>();
    const frameIndex = useRef(0);
    const startTimeRef = useRef<number>(0);

    useEffect(() => {
        if (!animation || !animation.sequence || animation.sequence.length === 0) return;

        const seq = animation.sequence;
        const fps = 12; // Target FPS for playback
        const interval = 1000 / fps;

        const animate = (time: number) => {
            if (time - startTimeRef.current > interval) {
                startTimeRef.current = time;
                frameIndex.current = (frameIndex.current + 1) % seq.length;

                const ctx = canvasRef.current?.getContext('2d');
                if (ctx) {
                    ctx.clearRect(0, 0, width, height);

                    // Landmarks are [x,y,z,v, ...]. 
                    // Classification.py extracts raw (0..1) coords from MediaPipe sequences.
                    const frameData = seq[frameIndex.current];

                    // Helper to get point
                    const getPoint = (idx: number) => {
                        // idx is landmark index (0..32)
                        // data is flat array
                        const base = idx * 4;
                        return { x: frameData[base], y: frameData[base + 1] };
                    };

                    ctx.strokeStyle = color;
                    ctx.lineWidth = 2;
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';

                    // Draw Connections
                    // Use the POSE_CONNECTIONS defined globally
                    ctx.beginPath();
                    POSE_CONNECTIONS.forEach(([start, end]) => {
                        const p1 = getPoint(start);
                        const p2 = getPoint(end);
                        // Check valid coords (approx 0..1)
                        // Draw scaled
                        if (p1.x > 0 && p2.x > 0) {
                            ctx.moveTo(p1.x * width, p1.y * height);
                            ctx.lineTo(p2.x * width, p2.y * height);
                        }
                    });
                    ctx.stroke();
                }
            }
            requestRef.current = requestAnimationFrame(animate);
        };

        requestRef.current = requestAnimationFrame(animate);
        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
        };
    }, [animation, width, height, color]);

    if (!animation) return <div style={{ width, height, background: 'rgba(0,0,0,0.2)', borderRadius: 8 }} />;

    return (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            style={{
                background: 'rgba(0,0,0,0.5)',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.1)'
            }}
        />
    );
};

export default function TestTab() {
    // State
    const [modelLoading, setModelLoading] = useState(true);
    const [modelError, setModelError] = useState<string | null>(null);
    const [labels, setLabels] = useState<string[]>([]);
    const [animations, setAnimations] = useState<any>(null); // Store animations map
    const [prediction, setPrediction] = useState<{ label: string; confidence: number; index: number } | null>(null);
    const [inferenceTime, setInferenceTime] = useState<number>(0);

    // Refs
    const webcamRef = useRef<Webcam>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const sessionRef = useRef<ort.InferenceSession | null>(null);
    const poseRef = useRef<any>(null); // Use any for dynamically loaded Pose class
    const poseBufferRef = useRef<number[][]>([]);
    const requestRef = useRef<number>(0);
    const lastInferenceTimeRef = useRef<number>(0);

    // Load Resources
    useEffect(() => {
        const loadResources = async () => {
            try {
                setModelLoading(true);

                // 1. Load Labels
                const labelsRes = await fetch(`${API_URL}/api/model/labels`);
                if (!labelsRes.ok) throw new Error("Failed to load labels");
                const labelsData = await labelsRes.json();
                setLabels(labelsData.class_names);

                // 1b. Load Animations (Optional)
                try {
                    const animRes = await fetch(`${API_URL}/api/model/animations`);
                    if (animRes.ok) {
                        const animData = await animRes.json();
                        setAnimations(animData.animations);
                    }
                } catch (e) {
                    console.warn("Animations not found or failed to load", e);
                }

                // 2. Load MediaPipe Pose from NPM

                // CRITICAL: Clean up global Module from ONNX Runtime if it leaked
                if ((window as any).Module) {
                    console.log("Cleaning up global Module before MediaPipe load");
                    (window as any).Module = undefined;
                }

                // Dynamic import to load the script from NPM package
                const mpPose = await import('@mediapipe/pose');

                const PoseKlass = mpPose.Pose;
                if (!PoseKlass) throw new Error("MediaPipe Pose class not found after dynamic import");

                const pose = new PoseKlass({
                    locateFile: (file: string) => {
                        return `/mediapipe/pose/${file}`;
                    }
                });

                pose.setOptions({
                    modelComplexity: 1,
                    smoothLandmarks: true,
                    enableSegmentation: false,
                    minDetectionConfidence: 0.5,
                    minTrackingConfidence: 0.5
                });

                pose.onResults(onPoseResults);
                poseRef.current = pose;


                // 3. Load ONNX Model AFTER MediaPipe
                // Import ONNX Runtime dynamically to avoid global scope pollution before MP loads
                const ort = await import('onnxruntime-web');

                const modelUrl = `${API_URL}/api/model/onnx`;

                // Configure ORT
                // Check if env exists (it might be on the module or global depending on version, but usually module export)
                if (ort.env && ort.env.wasm) {
                    ort.env.wasm.numThreads = 1;
                    ort.env.wasm.simd = true;
                }

                try {
                    // Use WASM only to prevent WebGL context conflicts with MediaPipe
                    const session = await ort.InferenceSession.create(modelUrl, {
                        executionProviders: ['wasm']
                    });
                    sessionRef.current = session;
                    console.log("ONNX Session created");
                } catch (e: any) {
                    console.error("ONNX Load Error", e);
                    console.log("Falling back to arrayBuffer load");
                    const modelBytes = await fetch(modelUrl).then(r => r.arrayBuffer());
                    const session = await ort.InferenceSession.create(modelBytes);
                    sessionRef.current = session;
                }

                setModelLoading(false);
                startPredictionLoop();

            } catch (err: any) {
                console.error("Setup error:", err);
                setModelError(err.message || "Failed to load model resources.");
                setModelLoading(false);
            }
        };

        loadResources();

        return () => {
            if (poseRef.current) poseRef.current.close();
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
            sessionRef.current = null;
        };
    }, []);

    // Frame Loop
    const startPredictionLoop = useCallback(() => {
        const offscreenCanvas = document.createElement('canvas'); // Reuse this if possible, but for now create here or ref?
        // Better to use a ref for the canvas to avoid creating it every frame

        const loop = async () => {
            if (
                webcamRef.current &&
                webcamRef.current.video &&
                webcamRef.current.video.readyState === 4 &&
                webcamRef.current.video.videoWidth > 0 &&
                webcamRef.current.video.videoHeight > 0 &&
                poseRef.current
            ) {
                const video = webcamRef.current.video;

                // Draw to intermediate canvas to strip obscure WebGL conflicts or dirty video states
                if (offscreenCanvas.width !== video.videoWidth) {
                    offscreenCanvas.width = video.videoWidth;
                    offscreenCanvas.height = video.videoHeight;
                }
                const ctx = offscreenCanvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

                    try {
                        // Pass the canvas element instead of video or bitmap
                        await poseRef.current.send({ image: offscreenCanvas });
                    } catch (e) {
                        console.error("Pose Send Error:", e);
                    }
                }
            }
            requestRef.current = requestAnimationFrame(loop);
        };
        loop();
    }, []);

    const onPoseResults = async (results: any) => {
        if (!canvasRef.current || !webcamRef.current?.video) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // 1. Draw
        const videoWidth = webcamRef.current.video.videoWidth;
        const videoHeight = webcamRef.current.video.videoHeight;
        canvas.width = videoWidth;
        canvas.height = videoHeight;

        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Manual Drawing to avoid dependency issues
        if (results.poseLandmarks) {
            const landmarks = results.poseLandmarks;

            // Draw connections
            ctx.strokeStyle = '#00FF00';
            ctx.lineWidth = 4;
            POSE_CONNECTIONS.forEach(([start, end]) => {
                const p1 = landmarks[start];
                const p2 = landmarks[end];
                if (p1 && p2 && (p1.visibility === undefined || p1.visibility > 0.5) && (p2.visibility === undefined || p2.visibility > 0.5)) {
                    ctx.beginPath();
                    ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
                    ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
                    ctx.stroke();
                }
            });

            // Draw landmarks
            ctx.fillStyle = '#FF0000';
            landmarks.forEach((lm: any) => {
                if (lm.visibility === undefined || lm.visibility > 0.5) {
                    ctx.beginPath();
                    ctx.arc(lm.x * canvas.width, lm.y * canvas.height, 2, 0, 2 * Math.PI);
                    ctx.fill();
                }
            });

            // 2. Buffer Logic
            const normalizedFrame = normalizeSkeleton(results.poseLandmarks);
            poseBufferRef.current.push(normalizedFrame);
            if (poseBufferRef.current.length > SEQUENCE_LENGTH) {
                poseBufferRef.current.shift();
            }

            // 3. Inference
            const now = Date.now();
            if (
                poseBufferRef.current.length === SEQUENCE_LENGTH &&
                sessionRef.current &&
                now - lastInferenceTimeRef.current > (1000 / TARGET_FPS)
            ) {
                // Call wrapper to avoid promise ignored warning if strict
                runInference().catch(console.error);
                lastInferenceTimeRef.current = now;
            }

            // Show Status
            if (poseBufferRef.current.length < SEQUENCE_LENGTH) {
                ctx.font = "20px Arial";
                ctx.fillStyle = "yellow";
                ctx.fillText(`Buffering: ${Math.round(poseBufferRef.current.length / SEQUENCE_LENGTH * 100)}%`, 10, 30);
            }
        }
        ctx.restore();
    };

    const runInference = async () => {
        const session = sessionRef.current;
        if (!session) return;

        try {
            const start = performance.now();

            // Flatten buffer: [SEQUENCE_LENGTH, INPUT_SIZE] -> Float32Array
            const data = new Float32Array(SEQUENCE_LENGTH * INPUT_SIZE);
            for (let i = 0; i < SEQUENCE_LENGTH; i++) {
                data.set(poseBufferRef.current[i], i * INPUT_SIZE);
            }

            // Dynamic ort import needed for Tensor constructor if not globally available
            const ort = await import('onnxruntime-web');
            const tensor = new ort.Tensor('float32', data, [1, SEQUENCE_LENGTH, INPUT_SIZE]);
            const feeds = { input: tensor };

            const results = await session.run(feeds);
            const classification = results.classification.data as Float32Array;

            // Softmax
            let maxProb = -Infinity;
            let maxIdx = -1;
            const expScores = [];
            let sumExp = 0;

            for (let i = 0; i < classification.length; i++) {
                const val = classification[i];
                const exp = Math.exp(val);
                expScores.push(exp);
                sumExp += exp;
                if (val > maxProb) {
                    maxProb = val;
                    maxIdx = i;
                }
            }

            const confidence = expScores[maxIdx] / sumExp;
            const label = labels[maxIdx] || `Class ${maxIdx}`;

            setPrediction({ label, confidence, index: maxIdx });
            setInferenceTime(performance.now() - start);

        } catch (e) {
            console.error("Inference Error", e);
        }
    };

    return (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 2, p: 2 }}>
            <Typography variant="h5">Test Model (Realtime)</Typography>

            {modelLoading && <LinearProgress />}
            {modelError && <Alert severity="error">{modelError}</Alert>}

            <Box sx={{ display: 'flex', gap: 2, flex: 1, minHeight: 0 }}>
                {/* Video Area */}
                <Box sx={{ position: 'relative', flex: 2, bgcolor: 'black', borderRadius: 2, overflow: 'hidden' }}>
                    <Webcam
                        ref={webcamRef}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        videoConstraints={{ facingMode: "user" }}
                        mirrored
                    />
                    <canvas
                        ref={canvasRef}
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%'
                        }}
                    />
                </Box>

                {/* Result Area */}
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Card sx={{ flex: 1 }}>
                        <CardContent sx={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
                            <Typography variant="body2" color="text.secondary">Prediction</Typography>

                            {/* Preview Animation */}
                            {animations && prediction && animations[String(prediction.index)] && (
                                <Box sx={{ my: 2 }}>
                                    <GesturePreview animation={animations[String(prediction.index)]} />
                                </Box>
                            )}

                            <Typography variant="h3" color="primary" sx={{ my: 1 }}>
                                {prediction ? prediction.label : "Waiting..."}
                            </Typography>
                            {prediction && (
                                <Box sx={{ width: '100%' }}>
                                    <Typography variant="body2" gutterBottom>
                                        Confidence: {(prediction.confidence * 100).toFixed(1)}%
                                    </Typography>
                                    <LinearProgress
                                        variant="determinate"
                                        value={prediction.confidence * 100}
                                        color={prediction.confidence > 0.7 ? "success" : "warning"}
                                        sx={{ height: 10, borderRadius: 5 }}
                                    />
                                </Box>
                            )}
                            <Typography variant="caption" sx={{ mt: 2, display: 'block' }}>
                                Inference: {inferenceTime.toFixed(1)}ms
                            </Typography>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent>
                            <Typography variant="h6" gutterBottom>Classes</Typography>
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                {labels.map((l, i) => (
                                    <Paper
                                        key={l}
                                        elevation={0}
                                        sx={{
                                            px: 1,
                                            py: 0.5,
                                            bgcolor: prediction?.label === l ? 'primary.light' : 'action.hover',
                                            color: prediction?.label === l ? 'white' : 'inherit',
                                            border: '1px solid',
                                            borderColor: 'divider'
                                        }}
                                    >
                                        <Typography variant="caption">{l}</Typography>
                                    </Paper>
                                ))}
                            </Box>
                        </CardContent>
                    </Card>
                </Box>
            </Box>
        </Box>
    );
}
