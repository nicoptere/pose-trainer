'use client';

import React, { useState, useCallback } from 'react';
import { DndContext, DragOverlay, DragStartEvent, DragEndEvent, useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import { Box, Typography, TextField, Paper, InputAdornment, Button, Slider, IconButton, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, CircularProgress } from '@mui/material';
import { Search, Add, Close, Delete } from '@mui/icons-material';
import { useStore } from '../store/useStore';
import { DroppableClass } from './DroppableClass';
import { DraggableVideo } from './DraggableVideo';
import MediaBunny from './MediaBunny';

export default function ClassManager() {
    const classes = useStore((state) => state.classes);
    const videos = useStore((state) => state.videos);
    const moveVideo = useStore((state) => state.moveVideo);
    const deleteClass = useStore((state) => state.deleteClass);
    const deleteRecording = useStore((state) => state.deleteRecording);

    const [activeId, setActiveId] = useState<string | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [editingVideoId, setEditingVideoId] = useState<string | null>(null);
    const [clickedSubclipId, setClickedSubclipId] = useState<string | null>(null); // To trigger edit mode in MediaBunny
    const [zoomLevel, setZoomLevel] = useState(128);
    const [confirmDeleteVideoId, setConfirmDeleteVideoId] = useState<string | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);

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
                            <IconButton
                                color="secondary"
                                size="small"
                                sx={{ position: 'absolute', top: 5, right: 5, zIndex: 100, bgcolor: 'rgba(0,0,0,0.5)', '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' } }}
                                onClick={() => {
                                    setIsEditing(false);
                                    setEditingVideoId(null);
                                    setClickedSubclipId(null);
                                }}
                            >
                                <Close sx={{ color: 'white' }} />
                            </IconButton>
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
                                    ref={(el) => {
                                        if (el) {
                                            el.playbackRate = 1.0;
                                            el.defaultPlaybackRate = 1.0;
                                        }
                                    }}
                                    src={previewUrl}
                                    controls
                                    autoPlay
                                    style={{ maxWidth: '100%', maxHeight: '300px' }}
                                />
                                <Box sx={{ display: 'flex', gap: 1, width: '100%', justifyContent: 'center' }}>
                                    <Button fullWidth variant="contained" size="small" color="primary" onClick={() => {
                                        const vid = videos.find(v => v.url === previewUrl);
                                        if (vid) {
                                            setIsEditing(true);
                                            setEditingVideoId(vid.id);
                                        }
                                    }}>
                                        Edit
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

                            <Box
                                sx={{
                                    flex: 1,
                                    overflowY: 'auto',
                                    p: 1,
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    alignContent: 'flex-start',
                                    bgcolor: isDragOver ? 'rgba(0, 0, 255, 0.1)' : 'transparent',
                                    border: isDragOver ? '2px dashed #1976d2' : 'none',
                                    transition: 'all 0.2s'
                                }}
                                onDragOver={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setIsDragOver(true);
                                }}
                                onDragLeave={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setIsDragOver(false);
                                }}
                                onDrop={async (e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setIsDragOver(false);
                                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                                        const files = Array.from(e.dataTransfer.files);
                                        await useStore.getState().uploadFiles(files);
                                    }
                                }}
                            >
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
                                            onDelete={() => setConfirmDeleteVideoId(video.id)}
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
                            onClick={async () => {
                                if (searchTerm) {
                                    await useStore.getState().addClass(searchTerm);
                                    setSearchTerm('');
                                }
                            }}
                        >
                            Add
                        </Button>
                        <Button
                            variant="contained"
                            color="secondary"
                            disabled={isSyncing}
                            startIcon={isSyncing ? <CircularProgress size={20} color="inherit" /> : null}
                            onClick={async () => {
                                setIsSyncing(true);
                                try {
                                    await useStore.getState().syncDataset();
                                } finally {
                                    setIsSyncing(false);
                                }
                            }}
                        >
                            Commit
                        </Button>
                    </Box>

                    <Box sx={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {uniqueClassNames.map(clsName => {
                            const realClass = classes.find(c => c.name === clsName);
                            const classId = realClass ? realClass.id : clsName;
                            const classVideos = videos.filter(v => v.classId === classId);

                            return (
                                <DroppableClass
                                    key={classId}
                                    id={classId}
                                    title={`${clsName} (${classVideos.length})`}
                                    onDelete={classId !== 'Unsorted' ? deleteClass : undefined}
                                >
                                    {classVideos.map(video => (
                                        <DraggableVideo
                                            key={video.id}
                                            id={video.id}
                                            url={video.url}
                                            thumbnailUrl={video.thumbnailUrl}
                                            name={video.name}
                                            width={80}
                                            color={video.color}
                                            startTime={video.startTime}
                                            onClick={() => {
                                                if (video.parentVideoId) {
                                                    setIsEditing(true);
                                                    setEditingVideoId(video.parentVideoId);
                                                    setClickedSubclipId(video.id);
                                                } else {
                                                    setIsEditing(true);
                                                    setEditingVideoId(video.id);
                                                    setClickedSubclipId(null);
                                                }
                                            }}
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

            <Dialog
                open={!!confirmDeleteVideoId}
                onClose={() => setConfirmDeleteVideoId(null)}
            >
                <DialogTitle>Delete Video?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        Are you sure you want to delete this video? This action cannot be undone.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmDeleteVideoId(null)}>Cancel</Button>
                    <Button onClick={() => {
                        if (confirmDeleteVideoId) {
                            deleteRecording(confirmDeleteVideoId);
                            setConfirmDeleteVideoId(null);
                            setPreviewUrl(null);
                        }
                    }} color="error" autoFocus>
                        Delete
                    </Button>
                </DialogActions>
            </Dialog>
        </DndContext>
    );
}

function formatTime(s: number) {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}
