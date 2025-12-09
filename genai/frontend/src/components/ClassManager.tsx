'use client';

import React, { useState } from 'react';
import { DndContext, DragOverlay, DragStartEvent, DragEndEvent, useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import { Box, Typography, TextField, Paper, InputAdornment, Button, Slider } from '@mui/material';
import { Search, Add } from '@mui/icons-material';
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
    const [editingVideoId, setEditingVideoId] = useState<string | null>(null);
    const [clickedSubclipId, setClickedSubclipId] = useState<string | null>(null); // To trigger edit mode in MediaBunny
    const [zoomLevel, setZoomLevel] = useState(128);
    const [hoveredVideoId, setHoveredVideoId] = useState<string | null>(null);
    const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });

    const handleVideoHover = (e: React.MouseEvent, id: string) => {
        setHoveredVideoId(id);
        setHoverPos({ x: e.clientX, y: e.clientY });
    };

    const hoveredVideoData = hoveredVideoId ? videos.find(v => v.id === hoveredVideoId) : null;

    // Handle prefixed IDs from MediaBunny draggable
    const activeVideoIdRaw = activeId ? (activeId.startsWith('editor-') ? activeId.replace('editor-', '') : activeId) : null;
    const activeVideo = activeVideoIdRaw ? videos.find(v => v.id === activeVideoIdRaw) : null;

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
        // Strip 'editor-' prefix if present from MediaBunny items
        const rawActiveId = (active.id as string).replace('editor-', '');

        if (over && rawActiveId !== over.id) {
            moveVideo(rawActiveId, over.id as string);
        }
        setActiveId(null);
    };

    // 1. Get Unsorted Videos (Left Panel) - ONLY root classes (not subclips)
    const unsortedVideos = videos.filter(v => (v.classId === 'Unsorted' || !v.classId) && !v.parentVideoId);

    // 2. Get Right Panel Classes (Filtered)
    const definedClasses = classes.filter(c => c.name !== 'Unsorted');

    // Apply Search Filter
    const filteredClasses = definedClasses.filter(c =>
        c.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const uniqueClassNames = Array.from(new Set([
        ...filteredClasses.map(c => c.name)
    ]));

    return (
        <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
        >
            <Box sx={{ display: 'flex', height: '100%', gap: 2 }}>

                {/* --- Left Column: Preview & Unsorted List --- */}
                <Box
                    sx={{
                        width: isEditing ? '50%' : '30%',
                        transition: 'width 0.3s ease',
                        display: 'flex',
                        flexDirection: 'column',
                        // Removed elevation and overflow:hidden to prevent artifacts
                        borderRight: '1px solid rgba(0,0,0,0.12)',
                        bgcolor: 'background.paper'
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
                                onClick={() => {
                                    setIsEditing(false);
                                    setEditingVideoId(null);
                                    setClickedSubclipId(null);
                                }}
                            >
                                Close Editor
                            </Button>
                        )}
                        {isEditing && editingVideoId ? (
                            <Box sx={{ width: '100%', height: '100%' }}>
                                <MediaBunny
                                    videoUrl={videos.find(v => v.id === editingVideoId)?.url || previewUrl || ''}
                                    videoId={editingVideoId}
                                    onClose={() => {
                                        setIsEditing(false);
                                        setEditingVideoId(null);
                                        setClickedSubclipId(null);
                                    }}
                                    activeSubclipId={clickedSubclipId}
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
                                    <Button variant="contained" size="small" color="primary" onClick={() => {
                                        const vid = videos.find(v => v.url === previewUrl);
                                        if (vid) {
                                            setIsEditing(true);
                                            setEditingVideoId(vid.id);
                                        }
                                    }}>
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
                                    Collection ({unsortedVideos.length})
                                </Typography>
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
                                            color={video.color}
                                            onClick={() => setPreviewUrl(video.url)}
                                            onHover={handleVideoHover}
                                            onLeave={() => setHoveredVideoId(null)}
                                        />
                                    ))}
                                    {unsortedVideos.length === 0 && <Typography variant="caption" color="text.secondary">No videos</Typography>}
                                </DroppableClass>
                            </Box>

                            {/* Zoom Slider at Bottom */}
                            <Box sx={{ p: 1, borderTop: '1px solid #ddd', display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography variant="caption">Size:</Typography>
                                <Slider
                                    size="small"
                                    min={64}
                                    max={256}
                                    value={zoomLevel}
                                    onChange={(e, val) => setZoomLevel(val as number)}
                                    aria-label="Thumbnail Zoom"
                                    sx={{ flex: 1 }}
                                />
                            </Box>
                        </>
                    )}
                </Box>

                {/* --- Right Column: Search & Classes --- */}
                <Box sx={{
                    width: isEditing ? '50%' : '70%',
                    transition: 'width 0.3s ease',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2
                }}>
                    <Box sx={{ display: 'flex', gap: 1 }}>
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
                        <Button
                            variant="outlined"
                            startIcon={<Add />}
                            disabled={!searchTerm}
                            onClick={() => {
                                if (searchTerm) {
                                    useStore.getState().addClass(searchTerm);
                                    setSearchTerm('');
                                }
                            }}
                        >
                            Add
                        </Button>
                    </Box>

                    <Box sx={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {uniqueClassNames.map(clsName => {
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
                                            width={80}
                                            color={video.color}
                                            onClick={() => {
                                                setPreviewUrl(video.url);
                                                if (video.parentVideoId) {
                                                    setEditingVideoId(video.parentVideoId);
                                                    setClickedSubclipId(video.id); // Triggers edit mode in MediaBunny
                                                    setIsEditing(true);
                                                }
                                            }}
                                            onHover={handleVideoHover}
                                            onLeave={() => setHoveredVideoId(null)}
                                            onDelete={() => {
                                                if (video.parentVideoId) {
                                                    // Start/End are defined, it's a subclip. Unassign to show in editor again.
                                                    useStore.getState().updateVideo(video.id, { classId: 'Unsorted' });
                                                } else {
                                                    // Root video in a class: Move back to Unsorted or Delete?
                                                    // "Remove from class" usually implies unassign.
                                                    useStore.getState().updateVideo(video.id, { classId: 'Unsorted' });
                                                }
                                            }}
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
                        color={activeVideo.color}
                    />
                ) : null}
            </DragOverlay>

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
                        ref={el => {
                            if (el && hoveredVideoData.startTime !== undefined) {
                                const start = hoveredVideoData.startTime || 0;
                                // Only loop if we have a defined end time
                                if (hoveredVideoData.endTime !== undefined) {
                                    const end = hoveredVideoData.endTime;
                                    const onTimeUpdate = () => {
                                        if (el.currentTime >= end) {
                                            el.currentTime = start;
                                        }
                                    };
                                    el.addEventListener('timeupdate', onTimeUpdate);
                                } else {
                                    // Full video, standard loop is fine, but maybe set start time once
                                    if (el.currentTime < start) el.currentTime = start;
                                }

                                if (Math.abs(el.currentTime - start) > 0.5 && el.currentTime < start) {
                                    el.currentTime = start;
                                }
                            }
                        }}
                        style={{ width: '100%', display: 'block' }}
                    />
                    <Box sx={{ p: 0.5, bgcolor: 'rgba(0,0,0,0.8)' }}>
                        <Typography variant="caption" color="white">
                            {hoveredVideoData.startTime !== undefined
                                ? `${formatTime(hoveredVideoData.startTime)} - ${hoveredVideoData.endTime !== undefined ? formatTime(hoveredVideoData.endTime) : 'End'}`
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
