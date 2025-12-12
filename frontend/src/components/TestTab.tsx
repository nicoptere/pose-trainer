
'use client';

import React from 'react';
import { Box, Typography, Button, Paper, Divider } from '@mui/material';
import VideoRecorder from './VideoRecorder';
import { PlayArrow } from '@mui/icons-material';

export default function TestTab() {
    return (
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 3, height: '100%' }}>

            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, flex: 1 }}>
                {/* Left: Camera Feed */}
                <Box>
                    <Typography variant="h6" gutterBottom>Live Camera</Typography>
                    <VideoRecorder />
                </Box>

                {/* Right: inference Placeholder */}
                <Paper elevation={3} sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Typography variant="h6">Real-time Inference</Typography>
                    <Box sx={{
                        flex: 1,
                        bgcolor: '#000',
                        borderRadius: 2,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white'
                    }}>
                        <Typography variant="body2" color="gray">Wait for inference results...</Typography>
                    </Box>

                    <Button variant="contained" color="secondary" startIcon={<PlayArrow />}>
                        Start Classification
                    </Button>

                    <Divider />

                    <Box>
                        <Typography variant="subtitle2">Last Prediction:</Typography>
                        <Typography variant="h4" color="primary">UNKNOWN</Typography>
                        <Typography variant="caption">Confidence: 0.0%</Typography>
                    </Box>
                </Paper>
            </Box>
        </Box>
    );
}
