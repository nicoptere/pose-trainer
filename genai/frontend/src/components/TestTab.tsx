'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Box, Typography, Paper, LinearProgress, Alert, Card, CardContent } from '@mui/material';
import Webcam from 'react-webcam';
import * as ort from 'onnxruntime-web';
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

export default function TestTab() {
    // State
    const [modelLoading, setModelLoading] = useState(true);
    const [modelError, setModelError] = useState<string | null>(null);
    const [labels, setLabels] = useState<string[]>([]);
    const [prediction, setPrediction] = useState<{ label: string; confidence: number } | null>(null);
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

                // 2. Load ONNX Model
                // Point to our backend proxy endpoint
                // We typically use fetch to get blob or arraybuffer if ONNX Runtime Web doesn't support relative URL to backend easily without CORS if separate domain
                // But here same origin or proxy. 
                // ort.InferenceSession.create can take a URL.
                const modelUrl = `${API_URL}/api/model/onnx`;

                // Configure ORT
                // Try using wasm backend
                ort.env.wasm.numThreads = 1;
                ort.env.wasm.simd = true;

                // Attempt to Create Session
                try {
                    const session = await ort.InferenceSession.create(modelUrl, {
                        executionProviders: ['wasm', 'webgl']
                    });
                    sessionRef.current = session;
                    console.log("ONNX Session created");
                } catch (e: any) {
                    console.error("ONNX Load Error", e);
                    // Fallback to fetch bytes
                    console.log("Falling back to arrayBuffer load");
                    const modelBytes = await fetch(modelUrl).then(r => r.arrayBuffer());
                    const session = await ort.InferenceSession.create(modelBytes);
                    sessionRef.current = session;
                }

                // 3. Load MediaPipe Pose from CDN dynamically
                // We can't use 'import' because module resolution fails.
                // We'll insert a script tag and wait for it to load.
                // Or better, use dynamic import() if ES modules supported, but for MP it's often easier to just load the classes.
                // Actually the @mediapipe/pose package is just a wrapper around the JS file.
                // The issue is Next.js failing to bundle it.
                // We will use the CDN version directly.

                // Check if Pose is already available on window
                if (!(window as any).Pose) {
                    await new Promise<void>((resolve, reject) => {
                        const script = document.createElement('script');
                        script.src = "https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/pose.js";
                        script.async = true;
                        script.crossOrigin = "anonymous";
                        script.onload = () => resolve();
                        script.onerror = () => reject(new Error("Failed to load MediaPipe Pose script"));
                        document.body.appendChild(script);
                    });
                }

                const PoseKlass = (window as any).Pose;
                if (!PoseKlass) throw new Error("MediaPipe Pose class not found after script load");

                const pose = new PoseKlass({
                    locateFile: (file: string) => {
                        return `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`;
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

                setModelLoading(false);
                startPredictionLoop();

            } catch (err: any) {
                console.error("Setup error:", err);
                setModelError(err.message || "Failed to load model resources. make sure you have trained a model.");
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
        const loop = async () => {
            if (
                webcamRef.current &&
                webcamRef.current.video &&
                webcamRef.current.video.readyState === 4 &&
                poseRef.current
            ) {
                const video = webcamRef.current.video;
                await poseRef.current.send({ image: video });
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

            setPrediction({ label, confidence });
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
                            <Typography variant="h3" color="primary" sx={{ my: 2 }}>
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
