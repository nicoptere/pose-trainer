
'use client';

import React from 'react';
import { Box, Typography, Paper, Button } from '@mui/material';
import { Download } from '@mui/icons-material';
import { useStore } from '../store/useStore';

export default function MetadataTab() {
    const classes = useStore((state) => state.classes);
    const videos = useStore((state) => state.videos);

    // Construct the exportable dataset JSON
    const exportData = {
        metadata: {
            generatedAt: new Date().toISOString(),
            version: "1.0",
            description: "Gesture Recognition Dataset with Subclips"
        },
        classes: classes.map(c => ({
            id: c.id,
            name: c.name,
            // Only include videos that belong to this class
            videos: videos
                .filter(v => v.classId === c.id || (c.id === 'Unsorted' && v.classId === 'Unsorted'))
                .map(v => ({
                    filename: v.name,
                    path: v.id,
                    subclips: v.subclips
                }))
        }))
    };

    const jsonString = JSON.stringify(exportData, null, 2);

    const handleDownload = () => {
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'gesture-dataset-metadata.json';
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <Box sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6">Dataset Metadata</Typography>
                <Button variant="contained" startIcon={<Download />} onClick={handleDownload}>
                    Download JSON
                </Button>
            </Box>

            <Paper elevation={3} sx={{ flex: 1, p: 2, overflowY: 'auto', bgcolor: '#1e1e1e', color: '#d4d4d4', fontFamily: 'monospace' }}>
                <pre style={{ margin: 0 }}>
                    {jsonString}
                </pre>
            </Paper>
        </Box>
    );
}
