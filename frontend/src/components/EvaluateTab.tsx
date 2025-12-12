'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
    Box,
    Button,
    Card,
    CardContent,
    CardActions,
    Typography,
    Grid,
    Chip,
    IconButton,
    CircularProgress,
    List,
    ListItem,
    ListItemText,
    ListItemIcon,
    Paper,
    Divider,
    Alert
} from '@mui/material';
import {
    PlayArrow,
    Stop,
    CheckCircle,
    ErrorOutline,
    VideoCameraFront,
    ModelTraining,
    ArrowBack
} from '@mui/icons-material';
import { useStore, GestureClass } from '../store/useStore';
import { analyzeGestureVideo, identifyGestureToolDeclaration } from '../services/geminiService';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { pcmTo16BitBase64 } from '../services/utils';

interface DetectedGesture {
    name: string;
    timestamp: number;
}

export default function EvaluateTab() {
    const { classes } = useStore();

    // -- Live Recognition State --
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [detectedGesture, setDetectedGesture] = useState<DetectedGesture | null>(null);
    const [debugLog, setDebugLog] = useState<string[]>([]);

    // Refs for Live Session
    const sessionRef = useRef<Promise<any> | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const intervalRef = useRef<number | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

    const addLog = (msg: string) => {
        setDebugLog(prev => [msg, ...prev].slice(0, 20));
    };

    // --- Live Recognition Logic ---
    const launchGemini = async () => {
        // Force refresh dataset to ensure latest descriptions are used
        await useStore.getState().fetchDataset();
        const freshClasses = useStore.getState().classes;
        const readyClasses = freshClasses.filter(c => c.description && c.description.trim().length > 0);
        const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
        if (!apiKey) {
            addLog("API Key missing");
            return;
        }

        const ai = new GoogleGenAI({ apiKey });

        const gestureDescriptions = readyClasses.map(g => `- Name: "${g.name}"\n  Description: ${g.description}`).join('\n');
        const systemInstruction = `
        You are an advanced real-time gesture recognition system.
        Your task is to watch the video stream and IDENTIFY if any of the following specific gestures are performed.
        
        KNOWN GESTURES:
        ${gestureDescriptions}

        INSTRUCTIONS:
        1. When you clearly see one of the KNOWN GESTURES performed, you MUST immediately call the 'identifyGesture' tool.
        2. Do not call the tool if the gesture is not clear or if it is a random movement.
        3. Only look for gestures in the list.
        4. Be responsive.
      `;

        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const audioContext = new AudioContextClass({ sampleRate: 16000 });
        audioContextRef.current = audioContext;

        const sessionPromise = ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            config: {
                responseModalities: [Modality.AUDIO],
                systemInstruction: systemInstruction,
                tools: [{ functionDeclarations: [identifyGestureToolDeclaration] }],
                speechConfig: {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
                }
            },
            callbacks: {
                onopen: () => {
                    addLog("Session Connected.");
                    setIsConnected(true);

                    // Stream Audio
                    if (!streamRef.current) return;
                    const source = audioContext.createMediaStreamSource(streamRef.current);
                    const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);

                    scriptProcessor.onaudioprocess = (e) => {
                        if (!sessionRef.current) return;
                        const inputData = e.inputBuffer.getChannelData(0);
                        const base64Audio = pcmTo16BitBase64(inputData);
                        sessionPromise.then(session => {
                            try {
                                session.sendRealtimeInput({
                                    media: { mimeType: 'audio/pcm;rate=16000', data: base64Audio }
                                });
                            } catch (e) { }
                        });
                    };
                    source.connect(scriptProcessor);
                    scriptProcessor.connect(audioContext.destination);
                    sourceRef.current = source;
                    processorRef.current = scriptProcessor;

                    // Stream Video
                    const canvas = canvasRef.current;
                    const video = videoRef.current;
                    if (!canvas || !video) return;

                    intervalRef.current = window.setInterval(() => {
                        if (!sessionRef.current) return;
                        const ctx = canvas.getContext('2d');
                        if (video.readyState === 4 && ctx) {
                            canvas.width = video.videoWidth;
                            canvas.height = video.videoHeight;
                            ctx.drawImage(video, 0, 0);
                            const base64Image = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];

                            sessionPromise.then(session => {
                                try {
                                    session.sendRealtimeInput({
                                        media: { mimeType: 'image/jpeg', data: base64Image }
                                    });
                                } catch (e) { }
                            });
                        }
                    }, 500);
                },
                onmessage: (msg: LiveServerMessage) => {
                    if (msg.toolCall?.functionCalls) {
                        for (const call of msg.toolCall.functionCalls) {
                            if (call.name === 'identifyGesture' && call.args) {
                                const name = call.args['gestureName'] as string;
                                const confidence = call.args['confidence'];
                                addLog(`DETECTED: ${name} (${confidence || 'N/A'})`);
                                setDetectedGesture({ name, timestamp: Date.now() });

                                sessionPromise.then(session => {
                                    session.sendToolResponse({
                                        functionResponses: {
                                            name: call.name,
                                            id: call.id,
                                            response: { result: "ok" }
                                        }
                                    });
                                });
                            }
                        }
                    }
                },
                onclose: () => {
                    addLog("Session closed.");
                    setIsConnected(false);
                    stopLiveSession();
                },
                onerror: (err) => {
                    addLog(`Error: ${err.message || String(err)}`);
                    stopLiveSession();
                }
            }
        });
        sessionRef.current = sessionPromise;
    };

    const stopLiveSession = () => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
        if (sourceRef.current) { try { sourceRef.current.disconnect(); } catch (e) { } sourceRef.current = null; }
        if (processorRef.current) { try { processorRef.current.disconnect(); } catch (e) { } processorRef.current = null; }
        if (audioContextRef.current) { try { audioContextRef.current.close(); } catch (e) { } audioContextRef.current = null; }
        // Do NOT stop the video streamRef here, so camera stays on when session stops.
        // if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }

        if (sessionRef.current) {
            sessionRef.current.then((s: any) => {
                try { s.close(); } catch (e) { }
            });
            sessionRef.current = null;
        }
        setIsConnected(false);
        addLog("Session Stopped.");
    };

    // Start Camera on Mount
    useEffect(() => {
        const initCamera = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: 640, height: 480 },
                    audio: true
                });
                streamRef.current = stream;

                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    // videoRef.current.play(); // autoPlay is on the element
                }
            } catch (e: any) {
                addLog("Camera access failed: " + e.message);
            }
        };
        initCamera();

        return () => {
            // Cleanup stream on unmount
            if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); }
            stopLiveSession();
        };
    }, []);

    return (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 2, p: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                {!isConnected ? (
                    <Button variant="contained" color="primary" onClick={launchGemini}>
                        Connect AI
                    </Button>
                ) : (
                    <Button variant="contained" color="error" onClick={stopLiveSession}>
                        Disconnect
                    </Button>
                )}
                <Chip
                    label={isConnected ? "CONNECTED" : "OFFLINE"}
                    color={isConnected ? "success" : "default"}
                    variant={isConnected ? "filled" : "outlined"}
                />
            </Box>

            <Box sx={{ flex: 1, display: 'flex', gap: 2, overflow: 'hidden' }}>
                {/* Main Video Area */}
                <Box sx={{ flex: 2, position: 'relative', bgcolor: 'black', borderRadius: 2, overflow: 'hidden' }}>
                    <video
                        ref={videoRef}
                        autoPlay
                        controls
                        playsInline
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                    <canvas ref={canvasRef} style={{ display: 'none' }} />

                    {detectedGesture && (Date.now() - detectedGesture.timestamp < 3000) && (
                        <Box sx={{
                            position: 'absolute',
                            top: 20,
                            right: 20,
                            bgcolor: 'rgba(33, 150, 243, 0.9)',
                            color: 'white',
                            p: 2,
                            borderRadius: 2,
                            boxShadow: 3,
                            animation: 'fadeIn 0.2s'
                        }}>
                            <Typography variant="overline">Detected</Typography>
                            <Typography variant="h4" fontWeight="bold">{detectedGesture.name}</Typography>
                        </Box>
                    )}
                </Box>

                {/* Sidebar / Logs */}
                <Paper sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', p: 2 }} elevation={3}>
                    <Typography variant="subtitle2" gutterBottom>Session Log</Typography>
                    <Divider sx={{ mb: 1 }} />
                    <List dense sx={{ flex: 1, overflowY: 'auto', bgcolor: '#f5f5f5', borderRadius: 1 }}>
                        {debugLog.map((log, i) => (
                            <ListItem key={i}>
                                <ListItemText primary={log} primaryTypographyProps={{ fontFamily: 'monospace', fontSize: '12px' }} />
                            </ListItem>
                        ))}
                    </List>
                </Paper>
            </Box>
        </Box>
    );
}
