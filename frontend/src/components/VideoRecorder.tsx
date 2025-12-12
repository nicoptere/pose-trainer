
'use client';

import React, { useRef, useState } from 'react';
import { Box, Button, Typography, Paper } from '@mui/material';
import { Camera, StopCircle } from '@mui/icons-material';
import { useStore } from '../store/useStore';

export default function VideoRecorder() {
    const videoRef = useRef<HTMLVideoElement>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const addRecording = useStore((state) => state.addRecording);

    const startCamera = async () => {
        try {
            const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            setStream(s);
            if (videoRef.current) {
                videoRef.current.srcObject = s;
            }
        } catch (err) {
            console.error("Error accessing webcam:", err);
        }
    };

    const startRecording = () => {
        if (!stream) return;
        const chunks: BlobPart[] = [];
        const mimeType = 'video/webm;codecs=vp8'; // Standard web format
        const recorder = new MediaRecorder(stream, { mimeType });

        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = () => {
            const blob = new Blob(chunks, { type: mimeType });
            addRecording(blob);
        };

        recorder.start();
        setIsRecording(true);
        mediaRecorderRef.current = recorder;
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
        }
    };

    React.useEffect(() => {
        startCamera();
        return () => {
            stream?.getTracks().forEach(t => t.stop());
        };
    }, []);

    return (
        <Paper elevation={3} sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="h6">Live Capture</Typography>
            <Box sx={{
                width: '100%',
                height: '300px',
                bgcolor: 'black',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                overflow: 'hidden',
                borderRadius: 2
            }}>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video
                    ref={videoRef}
                    autoPlay
                    muted
                    playsInline
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
            </Box>
            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                {!isRecording ? (
                    <Button
                        variant="contained"
                        color="error"
                        startIcon={<Camera />}
                        onClick={startRecording}
                    >
                        Record
                    </Button>
                ) : (
                    <Button
                        variant="contained"
                        color="secondary"
                        startIcon={<StopCircle />}
                        onClick={stopRecording}
                    >
                        Stop
                    </Button>
                )}
            </Box>
        </Paper>
    );
}
