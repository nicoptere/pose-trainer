
'use client';

import React, { useState } from 'react';
import { DndContext, DragOverlay, DragStartEvent, DragEndEvent, useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import { Box, Typography, TextField, Paper, InputAdornment, Button, Slider } from '@mui/material';
import { Search } from '@mui/icons-material';
import { useStore } from '../store/useStore';
import { DroppableClass } from './DroppableClass';
import { DraggableVideo } from './DraggableVideo';
import MediaBunny from './MediaBunny';

export default function ClassManager() {
    const classes = useStore((state) => state.classes);
    const videos = useStore((state) => state.videos);
    const moveVideo = useStore((state) => state.moveVideo);

    const [activeId, setActiveId] = useState<string | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [zoomLevel, setZoomLevel] = useState(128);
    const [hoveredVideoId, setHoveredVideoId] = useState<string | null>(null);
    const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });

    const handleVideoHover = (e: React.MouseEvent, id: string) => {
        setHoveredVideoId(id);
        setHoverPos({ x: e.clientX, y: e.clientY });
    };

    const hoveredVideoData = hoveredVideoId ? videos.find(v => v.id === hoveredVideoId) : null;

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

    // 1. Get Unsorted Videos (Left Panel) - ONLY root classes (not subclips)
    const unsortedVideos = videos.filter(v => (v.classId === 'Unsorted' || !v.classId) && !v.parentVideoId);

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

                {/* --- Left Column: Preview & Unsorted List --- */}
                {/* Width transitions between 30% and 50% */}
                <Paper
                    elevation={3}
                    sx={{
                        width: isEditing ? '50%' : '30%',
                        transition: 'width 0.3s ease',
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden'
                    }}
                >

                    {/* Video Preview Area / MediaBunny Editor */}
                    <Box sx={{ p: 2, bgcolor: '#000', flex: isEditing ? 1 : '0 0 auto', minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 1, position: 'relative' }}>
                        {isEditing && (
                            <Button
                                variant="contained"
                                color="secondary"
                                size="small"
                                sx={{ position: 'absolute', top: 5, right: 5, zIndex: 100 }}
                                onClick={() => setIsEditing(false)}
                            >
                                Close Editor
                            </Button>
                        )}
                        {isEditing && previewUrl ? (
                            <Box sx={{ width: '100%', height: '100%' }}>
                                <MediaBunny
                                    videoUrl={previewUrl}
                                    videoId={videos.find(v => v.url === previewUrl)?.id || ''}
                                    onClose={() => setIsEditing(false)}
                                />
                            </Box>
                        ) : previewUrl ? (
                            <>
                                <video
                                    src={previewUrl}
                                    controls
                                    autoPlay
                                    style={{ maxWidth: '100%', maxHeight: '300px' }}
                                />
                                <Box sx={{ display: 'flex', gap: 1, width: '100%', justifyContent: 'center' }}>
                                    <Button variant="contained" size="small" color="primary" onClick={() => setIsEditing(true)}>
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

                    {/* Inbox / Unsorted only shows root videos, not subclips */}
                    {!isEditing && (
                        <>
                            <Box sx={{ p: 1, bgcolor: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Typography variant="subtitle1" fontWeight="bold">
                                    Inbox ({unsortedVideos.length})
                                </Typography>
                                {/* Zoom Slider */}
                                <Box sx={{ width: 100, display: 'flex', alignItems: 'center' }}>
                                    <Slider
                                        size="small"
                                        min={64}
                                        max={512}
                                        value={zoomLevel}
                                        onChange={(e, val) => setZoomLevel(val as number)}
                                        aria-label="Thumbnail Zoom"
                                    />
                                </Box>
                            </Box>

                            <Box sx={{ flex: 1, overflowY: 'auto', p: 1, display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start' }}>
                                <DroppableClass id="Unsorted" title="">
                                    {unsortedVideos.map(video => (
                                        <DraggableVideo
                                            key={video.id}
                                            id={video.id}
                                            url={video.url}
                                            thumbnailUrl={video.thumbnailUrl}
                                            name={video.name}
                                            width={zoomLevel}
                                            onClick={() => setPreviewUrl(video.url)}
                                            onHover={handleVideoHover}
                                            onLeave={() => setHoveredVideoId(null)}
                                        />
                                    ))}
                                    {unsortedVideos.length === 0 && <Typography variant="caption" color="text.secondary">No videos</Typography>}
                                </DroppableClass>
                            </Box>
                        </>
                    )}
                </Paper>


                {/* --- Right Column: Search & Classes --- */}
                {/* Width transitions between 70% and 50% */}
                <Box sx={{
                    width: isEditing ? '50%' : '70%',
                    transition: 'width 0.3s ease',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2
                }}>

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
                                            thumbnailUrl={video.thumbnailUrl}
                                            name={video.name}
                                            width={80} // Keep standard size for class list?
                                            onClick={() => setPreviewUrl(video.url)}
                                            onHover={handleVideoHover}
                                            onLeave={() => setHoveredVideoId(null)}
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
                    <DraggableVideo
                        id={activeVideo.id}
                        url={activeVideo.url}
                        thumbnailUrl={activeVideo.thumbnailUrl}
                        name={activeVideo.name}
                        width={80}
                    />
                ) : null}
            </DragOverlay>

            {/* Hover Preview Popup */}
            {hoveredVideoData && (
                <Paper sx={{
                    position: 'fixed',
                    left: hoverPos.x + 20,
                    top: hoverPos.y,
                    width: 200,
                    zIndex: 9999,
                    pointerEvents: 'none',
                    bgcolor: 'black',
                    border: '1px solid white',
                    overflow: 'hidden'
                }}>
                    <video
                        src={hoveredVideoData.url}
                        autoPlay
                        loop
                        muted
                        style={{ width: '100%', display: 'block' }}
                    />
                    <Box sx={{ p: 0.5, bgcolor: 'rgba(0,0,0,0.8)' }}>
                        <Typography variant="caption" color="white">
                            {hoveredVideoData.startTime !== undefined
                                ? `${formatTime(hoveredVideoData.startTime)} - ${formatTime(hoveredVideoData.endTime || 0)}`
                                : formatTime(0)
                            }
                        </Typography>
                    </Box>
                </Paper>
            )}

        </DndContext>
    );
}

function formatTime(s: number) {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}
