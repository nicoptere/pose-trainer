'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Box, Typography, Paper, LinearProgress, Alert, Card, CardContent, FormControlLabel, Switch } from '@mui/material';
import Webcam from 'react-webcam';
import { GestureClassifier } from '../services/GestureClassifier';

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
    const requestRef = useRef<number>(0);
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

                    // Auto-scale to fit
                    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

                    // First pass: find bounds of the current frame
                    for (let i = 0; i < 33; i++) {
                        const pt = getPoint(i);
                        if (pt.x < minX) minX = pt.x;
                        if (pt.x > maxX) maxX = pt.x;
                        if (pt.y < minY) minY = pt.y;
                        if (pt.y > maxY) maxY = pt.y;
                    }

                    // Add padding
                    const padding = 0.5;
                    const contentW = maxX - minX || 1;
                    const contentH = maxY - minY || 1;

                    // Determine scale to fit
                    const scaleX = width / (contentW + padding);
                    const scaleY = height / (contentH + padding);
                    const scale = Math.min(scaleX, scaleY);

                    const centerX = (minX + maxX) / 2;
                    const centerY = (minY + maxY) / 2;

                    ctx.beginPath();
                    POSE_CONNECTIONS.forEach(([start, end]) => {
                        const p1 = getPoint(start);
                        const p2 = getPoint(end);

                        // Map: (val - center) * scale + CanvasCenter
                        const x1 = (p1.x - centerX) * scale + width / 2;
                        const y1 = (p1.y - centerY) * scale + height / 2;
                        const x2 = (p2.x - centerX) * scale + width / 2;
                        const y2 = (p2.y - centerY) * scale + height / 2;

                        ctx.moveTo(x1, y1);
                        ctx.lineTo(x2, y2);
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
    const [prediction, setPrediction] = useState<{
        label: string;
        confidence: number;
        index: number;
        all: Array<{ label: string; confidence: number; index: number }>;
        pose?: number[];
    } | null>(null);
    const [inferenceTime, setInferenceTime] = useState<number>(0);
    const [bufferStatus, setBufferStatus] = useState<number>(0);
    const [bufferingMsg, setBufferingMsg] = useState<string | null>(null);

    // Debug Controls
    const [flipInput, setFlipInput] = useState(true);
    const flipInputRef = useRef(true); // Ref to access current value in callbacks

    useEffect(() => {
        flipInputRef.current = flipInput;
    }, [flipInput]);

    const webcamRef = useRef<Webcam>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const poseRef = useRef<any>(null);
    const classifierRef = useRef<GestureClassifier | null>(null);
    const requestRef = useRef<number>(0);

    useEffect(() => {
        let mounted = true;

        const loadResources = async () => {
            try {
                if (!mounted) return;
                setModelLoading(true);

                // Initialize Gesture Classifier
                const classifier = new GestureClassifier({
                    onResult: (res) => { if (mounted) setPrediction(res); },
                    onBuffering: (count, msg) => {
                        if (mounted) {
                            setBufferStatus(count);
                            setBufferingMsg(msg);
                        }
                    },
                    onError: (err) => { if (mounted) setModelError(err); },
                    onLog: (msg) => console.log("[Classifier]", msg)
                });

                await classifier.init(API_URL);
                if (!mounted) {
                    classifier.destroy();
                    return;
                }

                setLabels(classifier.getLabels());
                classifierRef.current = classifier;

                try {
                    const animRes = await fetch(`${API_URL}/api/model/animations`);
                    if (animRes.ok && mounted) {
                        const animData = await animRes.json();
                        setAnimations(animData.animations);
                    }
                } catch (e) { console.warn("Animations load failed", e); }

                // 3. Load MediaPipe Pose (Main Thread)
                // Fix for "Module.arguments" error: Ensure global Module is clear
                if ((window as any).Module) {
                    console.warn("Clearing global Module before MediaPipe load");
                    (window as any).Module = undefined;
                }

                const mpPose = await import('@mediapipe/pose');
                if (!mounted) return;

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

                if (!mounted) {
                    pose.close();
                    return;
                }
                poseRef.current = pose;

                setModelLoading(false);
                startPredictionLoop();

            } catch (err: any) {
                console.error("Setup error:", err);
                if (mounted) {
                    setModelError(err.message || "Failed to load resources.");
                    setModelLoading(false);
                }
            }
        };

        loadResources();

        return () => {
            mounted = false;
            if (poseRef.current) poseRef.current.close();
            if (classifierRef.current) classifierRef.current.destroy();
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
        };
    }, []);

    const startPredictionLoop = useCallback(() => {
        const offscreenCanvas = document.createElement('canvas');
        let lastTime = 0;
        const FPS = 30;
        const interval = 1000 / FPS;

        const loop = async (currentTime: number) => {
            requestRef.current = requestAnimationFrame(loop);

            if (currentTime - lastTime < interval) return;
            lastTime = currentTime;

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
        };
        requestRef.current = requestAnimationFrame(loop);
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

            if (classifierRef.current) {
                classifierRef.current.process(landmarks, flipInputRef.current);
            }
        }
        ctx.restore();
    };

    return (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 2, p: 2 }}>
            <Typography variant="h5">Test Model (Realtime)</Typography>
            {modelLoading && <LinearProgress />}
            {modelError && <Alert severity="error">{modelError}</Alert>}

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                <FormControlLabel
                    control={
                        <Switch
                            checked={flipInput}
                            onChange={(e) => setFlipInput(e.target.checked)}
                            color="secondary"
                        />
                    }
                    label="Mirror Input to Model"
                />
                <Typography variant="caption" color="text.secondary">
                    (Toggle this if detection fails - matches webcam mirroring)
                </Typography>
            </Box>

            <Box sx={{ display: 'flex', gap: 2, flex: 1, minHeight: 0 }}>
                <Box sx={{ position: 'relative', flex: 2, bgcolor: 'black', borderRadius: 2, overflow: 'hidden' }}>
                    <Webcam
                        ref={webcamRef}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        videoConstraints={{ facingMode: "user" }}
                        mirrored
                    />
                    <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />

                    {/* Buffering Indicator Overlay */}
                    {bufferingMsg && (
                        <Box sx={{
                            position: 'absolute',
                            top: 10,
                            right: 10,
                            bgcolor: 'rgba(0,0,0,0.6)',
                            color: 'white',
                            px: 2,
                            py: 1,
                            borderRadius: 1
                        }}>
                            <Typography variant="caption">{bufferingMsg}</Typography>
                        </Box>
                    )}
                </Box>

                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Card sx={{ flex: 1 }}>
                        <CardContent sx={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
                            <Typography variant="body2" color="text.secondary">Top Predictions</Typography>

                            {prediction && prediction.pose && (
                                <Box sx={{ mb: 2, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                    <Typography variant="caption" color="text.secondary" gutterBottom>Live Model Input</Typography>
                                    <Box sx={{ bgcolor: 'black', borderRadius: 1, overflow: 'hidden', border: '1px solid #333' }}>
                                        <GesturePreview
                                            animation={{ sequence: [prediction.pose] }}
                                            width={100}
                                            height={100}
                                            color="#00FFFF"
                                        />
                                    </Box>
                                </Box>
                            )}

                            {prediction && prediction.all ? (
                                <Box sx={{ mt: 2, width: '100%' }}>
                                    {prediction.all.slice(0, 3).map((res, idx) => (
                                        <Box key={res.index} sx={{ mb: 2 }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                                                <Typography variant={idx === 0 ? "h6" : "body1"} fontWeight={idx === 0 ? "bold" : "normal"}>
                                                    {idx + 1}. {res.label}
                                                </Typography>
                                                <Typography variant="caption" fontWeight="bold">
                                                    {(res.confidence * 100).toFixed(1)}%
                                                </Typography>
                                            </Box>
                                            <LinearProgress
                                                variant="determinate"
                                                value={res.confidence * 100}
                                                color={idx === 0 ? (res.confidence > 0.7 ? "success" : "warning") : "primary"}
                                                sx={{ height: idx === 0 ? 8 : 4, borderRadius: 4, opacity: idx === 0 ? 1 : 0.6 }}
                                            />
                                        </Box>
                                    ))}

                                    {animations && prediction && animations[String(prediction.index)] && (
                                        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}>
                                            <GesturePreview
                                                animation={animations[String(prediction.index)]}
                                                width={100}
                                                height={100}
                                            />
                                        </Box>
                                    )}
                                </Box>
                            ) : (
                                <Typography variant="h5" align="center" color="text.secondary" sx={{ py: 4 }}>
                                    Waiting...
                                </Typography>
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
