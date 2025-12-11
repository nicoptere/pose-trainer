'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Box, Typography, Paper, LinearProgress, Alert, Card, CardContent } from '@mui/material';
import Webcam from 'react-webcam';

// Define POSE_CONNECTIONS manually
const POSE_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8],
    [9, 9], [9, 10], [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21],
    [17, 19], [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
    [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28],
    [27, 29], [28, 30], [29, 31], [30, 32], [27, 31], [28, 32]
];

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

                    const frameData = seq[frameIndex.current];
                    const getPoint = (idx: number) => {
                        const base = idx * 4;
                        return { x: frameData[base], y: frameData[base + 1] };
                    };

                    ctx.strokeStyle = color;
                    ctx.lineWidth = 2;
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';

                    ctx.beginPath();
                    POSE_CONNECTIONS.forEach(([start, end]) => {
                        const p1 = getPoint(start);
                        const p2 = getPoint(end);
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
    const [modelLoading, setModelLoading] = useState(true);
    const [modelError, setModelError] = useState<string | null>(null);
    const [labels, setLabels] = useState<string[]>([]);
    const [animations, setAnimations] = useState<any>(null);
    const [prediction, setPrediction] = useState<{ label: string; confidence: number; index: number } | null>(null);
    const [inferenceTime, setInferenceTime] = useState<number>(0);
    const [bufferStatus, setBufferStatus] = useState<number>(0);

    const webcamRef = useRef<Webcam>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const poseRef = useRef<any>(null);
    const onnxWorkerRef = useRef<Worker | null>(null);
    const requestRef = useRef<number>(0);

    useEffect(() => {
        const loadResources = async () => {
            try {
                setModelLoading(true);

                // 1. Load Data
                const labelsRes = await fetch(`${API_URL}/api/model/labels`);
                if (!labelsRes.ok) throw new Error("Failed to load labels");
                const labelsData = await labelsRes.json();
                setLabels(labelsData.class_names);

                try {
                    const animRes = await fetch(`${API_URL}/api/model/animations`);
                    if (animRes.ok) {
                        const animData = await animRes.json();
                        setAnimations(animData.animations);
                    }
                } catch (e) { console.warn("Animations load failed", e); }

                // 2. Initialize ONNX Worker
                onnxWorkerRef.current = new Worker('/onnx/worker.js');
                const modelUrl = `${API_URL}/api/model/onnx`;

                onnxWorkerRef.current.postMessage({ type: 'init', payload: { modelUrl } });

                onnxWorkerRef.current.onmessage = (e) => {
                    const { type, classification, error, count } = e.data;
                    if (type === 'ready') {
                        console.log("ONNX Worker Ready");
                    } else if (type === 'result') {
                        processClassification(classification);
                    } else if (type === 'buffering') {
                        setBufferStatus(count);
                    } else if (type === 'error') {
                        console.error("ONNX Worker Error:", error);
                    }
                };

                // 3. Load MediaPipe Pose (Main Thread)
                if ((window as any).Module) {
                    (window as any).Module = undefined;
                }
                const mpPose = await import('@mediapipe/pose');
                const PoseKlass = mpPose.Pose;
                const pose = new PoseKlass({
                    locateFile: (file: string) => `/mediapipe/pose/${file}`
                });

                pose.setOptions({
                    modelComplexity: 1,
                    smoothLandmarks: true,
                    enableSegmentation: false,
                    minDetectionConfidence: 0.5,
                    minTrackingConfidence: 0.5
                });
                pose.onResults(onPoseResults);
                await pose.initialize();
                poseRef.current = pose;

                setModelLoading(false);
                startPredictionLoop();

            } catch (err: any) {
                console.error("Setup error:", err);
                setModelError(err.message || "Failed to load resources.");
                setModelLoading(false);
            }
        };

        loadResources();

        return () => {
            if (poseRef.current) poseRef.current.close();
            if (onnxWorkerRef.current) onnxWorkerRef.current.terminate();
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
        };
    }, []);

    const processClassification = (classification: Float32Array) => {
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

        setPrediction(prev => {
            return { label: `Class ${maxIdx}`, confidence, index: maxIdx };
        });
    };

    const startPredictionLoop = useCallback(() => {
        const offscreenCanvas = document.createElement('canvas');
        const loop = async () => {
            if (webcamRef.current?.video?.readyState === 4 && poseRef.current) {
                const video = webcamRef.current.video;
                if (offscreenCanvas.width !== video.videoWidth) {
                    offscreenCanvas.width = video.videoWidth;
                    offscreenCanvas.height = video.videoHeight;
                }
                const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
                if (ctx) {
                    ctx.save();
                    ctx.translate(video.videoWidth, 0);
                    ctx.scale(-1, 1);
                    ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
                    ctx.restore();
                    try {
                        await poseRef.current.send({ image: offscreenCanvas });
                    } catch (e) { }
                }
            }
            requestRef.current = requestAnimationFrame(loop);
        };
        loop();
    }, []);

    const onPoseResults = (results: any) => {
        if (!canvasRef.current || !webcamRef.current?.video) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (results.poseLandmarks) {
            const landmarks = results.poseLandmarks;
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
            ctx.fillStyle = '#FF0000';
            landmarks.forEach((lm: any) => {
                if (lm.visibility === undefined || lm.visibility > 0.5) {
                    ctx.beginPath();
                    ctx.arc(lm.x * canvas.width, lm.y * canvas.height, 2, 0, 2 * Math.PI);
                    ctx.fill();
                }
            });

            if (onnxWorkerRef.current) {
                // Remove complex objects (just keys needed)
                const safeLandmarks = landmarks.map((l: any) => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility }));
                onnxWorkerRef.current.postMessage({ type: 'process', payload: safeLandmarks });
            }
        }
        ctx.restore();
    };

    return (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 2, p: 2 }}>
            <Typography variant="h5">Test Model (Realtime)</Typography>
            {modelLoading && <LinearProgress />}
            {modelError && <Alert severity="error">{modelError}</Alert>}

            <Box sx={{ display: 'flex', gap: 2, flex: 1, minHeight: 0 }}>
                <Box sx={{ position: 'relative', flex: 2, bgcolor: 'black', borderRadius: 2, overflow: 'hidden' }}>
                    <Webcam
                        ref={webcamRef}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        videoConstraints={{ facingMode: "user" }}
                        mirrored
                    />
                    <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
                </Box>

                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Card sx={{ flex: 1 }}>
                        <CardContent sx={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
                            <Typography variant="body2" color="text.secondary">Prediction</Typography>
                            {animations && prediction && animations[String(prediction.index)] && (
                                <Box sx={{ my: 2 }}>
                                    <GesturePreview animation={animations[String(prediction.index)]} />
                                </Box>
                            )}
                            <Typography variant="h3" color="primary" sx={{ my: 1 }}>
                                {prediction ? (labels[prediction.index] || prediction.label) : "Waiting..."}
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
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent>
                            <Typography variant="h6" gutterBottom>Classes</Typography>
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                                {labels.map((l, i) => {
                                    const anim = animations ? animations[String(i)] : null;
                                    const isSelected = prediction?.index === i;
                                    return (
                                        <Paper
                                            key={l}
                                            elevation={0}
                                            sx={{
                                                p: 1,
                                                bgcolor: isSelected ? 'primary.light' : 'action.hover',
                                                color: isSelected ? 'white' : 'inherit',
                                                border: '1px solid',
                                                borderColor: 'divider',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                alignItems: 'center',
                                                minWidth: 80
                                            }}
                                        >
                                            {anim && (
                                                <Box sx={{ mb: 1, bgcolor: 'black', borderRadius: 1, overflow: 'hidden' }}>
                                                    <GesturePreview
                                                        animation={anim}
                                                        width={80}
                                                        height={80}
                                                        color={isSelected ? '#ffffff' : '#4ADE80'}
                                                    />
                                                </Box>
                                            )}
                                            <Typography variant="caption" align="center">{l}</Typography>
                                        </Paper>
                                    );
                                })}
                            </Box>
                        </CardContent>
                    </Card>
                </Box>
            </Box>
        </Box>
    );
}
