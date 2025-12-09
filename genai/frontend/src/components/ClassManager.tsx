
'use client';

import React, { useState } from 'react';
import { DndContext, DragOverlay, DragStartEvent, DragEndEvent, useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import { Box, Typography, TextField, Paper, InputAdornment, Button } from '@mui/material';
import { Search } from '@mui/icons-material';
import { useStore } from '../store/useStore';
import { DroppableClass } from './DroppableClass';
import { DraggableVideo } from './DraggableVideo';

export default function ClassManager() {
    const classes = useStore((state) => state.classes);
    const videos = useStore((state) => state.videos);
    const moveVideo = useStore((state) => state.moveVideo);

    const [activeId, setActiveId] = useState<string | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    const activeVideo = activeId ? videos.find(v => v.id === activeId) : null;

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        })
    );

    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id as string);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            moveVideo(active.id as string, over.id as string);
        }
        setActiveId(null);
    };

    // 1. Get Unsorted Videos (Left Panel)
    const unsortedVideos = videos.filter(v => v.classId === 'Unsorted' || !v.classId);

    // 2. Get Right Panel Classes (Filtered)
    // Filter out 'Unsorted' from the main class list as it's handled separately on the left
    const definedClasses = classes.filter(c => c.name !== 'Unsorted');

    // Apply Search Filter
    const filteredClasses = definedClasses.filter(c =>
        c.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Explicitly add predefined classes if they don't exist in store yet, so they are droppable
    const predefinedNames = ['Squat', 'JumpingJack', 'Lunge'];
    // Merge existing filtered classes with missing predefined ones (if they match search)
    // This logic is a bit complex: we want to show predefined slots even if empty, BUT only if they match search.
    const displayClasses = [...filteredClasses];

    predefinedNames.forEach(name => {
        if (!displayClasses.find(c => c.name === name) &&
            classes.find(c => c.name !== name)) { // If not in store
            // Actually, the store usually initializes with these. 
            // Let's rely on the store having them or the logic below to synthesize them if needed.
            // For simplicity, let's just stick to what's in the store + synthesized ones loop below.
        }
    });

    // We will map over a union of store classes and predefined strings to ensure they appear
    const uniqueClassNames = Array.from(new Set([
        ...filteredClasses.map(c => c.name),
        ...predefinedNames.filter(n => n.toLowerCase().includes(searchTerm.toLowerCase()))
    ]));


    return (
        <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
        >
            <Box sx={{ display: 'flex', height: '100%', gap: 2 }}>

                {/* --- Left Column (30%): Preview & Unsorted List --- */}
                <Paper elevation={3} sx={{ width: '30%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

                    {/* Video Preview Area */}
                    <Box sx={{ p: 2, bgcolor: '#000', minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 1 }}>
                        {previewUrl ? (
                            <>
                                <video
                                    src={previewUrl}
                                    controls
                                    autoPlay
                                    style={{ maxWidth: '100%', maxHeight: '200px' }}
                                />
                                <Box sx={{ display: 'flex', gap: 1, width: '100%', justifyContent: 'center' }}>
                                    <Button variant="contained" size="small" color="primary">
                                        Edit
                                    </Button>
                                    <Button variant="outlined" size="small" color="error">
                                        Remove
                                    </Button>
                                </Box>
                            </>
                        ) : (
                            <Typography variant="body2" color="grey.500">Select a video to preview</Typography>
                        )}
                    </Box>

                    <Typography variant="subtitle1" fontWeight="bold" sx={{ p: 1, bgcolor: '#f5f5f5' }}>
                        Inbox ({unsortedVideos.length})
                    </Typography>

                    {/* Scrollable Unsorted List */}
                    <Box sx={{ flex: 1, overflowY: 'auto', p: 1, display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start' }}>
                        <DroppableClass id="Unsorted" title="">
                            {unsortedVideos.map(video => (
                                <DraggableVideo
                                    key={video.id}
                                    id={video.id}
                                    url={video.url}
                                    name={video.name}
                                    onClick={() => setPreviewUrl(video.url)}
                                />
                            ))}
                            {unsortedVideos.length === 0 && <Typography variant="caption" color="text.secondary">No videos</Typography>}
                        </DroppableClass>
                    </Box>
                </Paper>


                {/* --- Right Column (70%): Search & Classes --- */}
                <Box sx={{ width: '70%', display: 'flex', flexDirection: 'column', gap: 2 }}>

                    {/* Search Bar */}
                    <TextField
                        fullWidth
                        size="small"
                        placeholder="Search classes..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <Search />
                                </InputAdornment>
                            ),
                        }}
                    />

                    {/* Vertical List of Classes */}
                    <Box sx={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {uniqueClassNames.map(clsName => {
                            // Resolve ID
                            const realClass = classes.find(c => c.name === clsName);
                            const classId = realClass ? realClass.id : clsName;

                            const classVideos = videos.filter(v => v.classId === classId);

                            return (
                                <DroppableClass key={classId} id={classId} title={`${clsName} (${classVideos.length})`}>
                                    {classVideos.map(video => (
                                        <DraggableVideo
                                            key={video.id}
                                            id={video.id}
                                            url={video.url}
                                            name={video.name}
                                            onClick={() => setPreviewUrl(video.url)}
                                        />
                                    ))}
                                </DroppableClass>
                            );
                        })}
                    </Box>

                </Box>

            </Box>

            <DragOverlay>
                {activeVideo ? (
                    <DraggableVideo id={activeVideo.id} url={activeVideo.url} name={activeVideo.name} />
                ) : null}
            </DragOverlay>

        </DndContext>
    );
}
