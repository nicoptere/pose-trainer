'use client';

import React, { useState, useCallback } from 'react';
import { DndContext, DragOverlay, DragStartEvent, DragEndEvent, useSensor, useSensors, PointerSensor, useDroppable } from '@dnd-kit/core';
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
    const updateClass = useStore((state) => state.updateClass);
    const deleteRecording = useStore((state) => state.deleteRecording);

    // --- Actions ---
    const handleRetrainClass = async (id: string, classVideos: typeof videos, realClass: typeof classes[0]) => {
        console.log(`Retraining class ${id}...`);

        // Check if all clips are committed (Optional check, button disabled if dirty, but good for batch)
        const uncommitted = classVideos.some(v => v.isCommitted === false);
        if (uncommitted) {
            console.warn(`Class ${id} has uncommitted videos. Skipping.`);
            return;
        }

        // Strictly select subclips belonging to this class (exclude source videos which might be dragged in but not clipped?)
        // Actually, if we drag a source video to a class, it BECOMES a subclip reference (parentVideoId is set) in moveVideo logic.
        // So checking parentVideoId is the correct way to identify "content to train on" vs "raw source".
        const validSubclips = classVideos.filter(v => v.parentVideoId && v.classId !== 'Unsorted');

        if (validSubclips.length === 0) {
            console.warn(`Class ${id} has no valid subclips (subclips in class folder). Skipping.`);
            return;
        }

        const subclip = validSubclips[0]; // Pick the first available subclip

        try {
            console.log(`[ClassManager] Service Call - Uploading Video: Name="${subclip.name}", Path="${subclip.url}" (Subclip ID: ${subclip.id})`);
            // Fetch video blob
            const response = await fetch(subclip.url);
            if (!response.ok) throw new Error('Failed to download video subclip');
            const blob = await response.blob();
            const file = new File([blob], `${realClass?.name || 'gesture'}.mp4`, { type: blob.type });

            // Import dynamically
            const { analyzeGestureVideo } = await import('../services/geminiService');
            // Assuming hasAudio defaults to true if undefined
            const description = await analyzeGestureVideo(file, realClass?.name || 'gesture', realClass?.hasAudio);

            // Update Store
            updateClass(id, { description, isDirty: true });

            console.log("Training complete for", id);
        } catch (e) {
            console.error("Training failed for", id, e);
        }
    };

    const handleRetrainAll = async () => {
        setIsSyncing(true);
        try {
            for (const cls of classes) {
                if (cls.name === 'Unsorted') continue;
                const clsVideos = videos.filter(v => v.classId === cls.id);
                // Skip if uncommitted videos exists to avoid partial state issues?
                // Or just try. handleRetrainClass checks.
                await handleRetrainClass(cls.id, clsVideos, cls);
            }
            // Sync once after all
            await useStore.getState().syncDataset();
        } finally {
            setIsSyncing(false);
        }
    };

    const handleToggleMuteAll = () => {
        // Check if any valid class is unmuted (hasAudio=true)
        const anyAudio = classes.some(c => c.name !== 'Unsorted' && c.hasAudio);
        // If any has audio, we Mute All (set false). Else Unmute All.
        const newValue = !anyAudio;
        classes.forEach(c => {
            if (c.name !== 'Unsorted' && c.hasAudio !== newValue) {
                updateClass(c.id, { hasAudio: newValue });
            }
        });
    };

    const [activeId, setActiveId] = useState<string | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [editingVideoId, setEditingVideoId] = useState<string | null>(null);
    const [clickedSubclipId, setClickedSubclipId] = useState<string | null>(null); // To trigger edit mode in MediaBunny
    const [columns, setColumns] = useState(2); // Grid columns, default 2
    const [confirmDeleteVideoId, setConfirmDeleteVideoId] = useState<string | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);
    const [collectionSearch, setCollectionSearch] = useState('');

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
        const activeIdStr = active.id as string;
        // Strip 'editor-' prefix if present from MediaBunny items
        const isFromEditor = activeIdStr.startsWith('editor-');
        const rawActiveId = activeIdStr.replace('editor-', '');

        if (over && rawActiveId !== over.id) {
            moveVideo(rawActiveId, over.id as string);

            // Auto-commit removed as per user request (manual commit via Upload button)
            // useStore.getState().commitFile();

            // Interrupt edition if dragged from editor
            if (isFromEditor) {
                setIsEditing(false);
                setEditingVideoId(null);
                setClickedSubclipId(null);
                setPreviewUrl(null);
            }
        }
        setActiveId(null);
    };

    // 1. Get Unsorted Videos (Left Panel) - ONLY root classes (not subclips)
    // Filter by collectionSearch
    const unsortedVideos = videos
        .filter(v => (v.classId === 'Unsorted' || !v.classId) && !v.parentVideoId)
        .filter(v => v.name.toLowerCase().includes(collectionSearch.toLowerCase()));

    // 2. Get Right Panel Classes (Filtered)
    const definedClasses = classes.filter(c => c.name !== 'Unsorted');

    // Apply Search Filter (Updated to include subclip names)
    const filteredClasses = definedClasses.filter(c => {
        const matchesName = c.name.toLowerCase().includes(searchTerm.toLowerCase());
        const classVideos = videos.filter(v => v.classId === c.id);
        const hasMatchingVideo = classVideos.some(v => v.name.toLowerCase().includes(searchTerm.toLowerCase()));
        return matchesName || hasMatchingVideo;
    });

    const uniqueClassNames = Array.from(new Set([
        ...filteredClasses.map(c => c.name)
    ]));

    // Droppable for Unsorted list
    const { setNodeRef: setUnsortedRef, isOver: isUnsortedOver } = useDroppable({
        id: 'Unsorted',
    });

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
                        borderRight: '1px solid rgba(0,0,0,0.12)',
                        bgcolor: 'background.paper'
                    }}
                >
                    {/* ... (Preview Code remains same) ... */}
                    {(isEditing || previewUrl) && (
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
                                        setPreviewUrl(null);
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
                                            setPreviewUrl(null);
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
                            ) : null}
                        </Box>
                    )}

                    {/* Inbox / Unsorted using direct droppable container */}
                    {!isEditing && (
                        <>
                            <Box sx={{ p: 1, bgcolor: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Typography variant="subtitle1" fontWeight="bold">
                                    Collection ({unsortedVideos.length})
                                </Typography>
                            </Box>

                            <Box
                                ref={setUnsortedRef}
                                sx={{
                                    flex: 1,
                                    overflowY: 'auto',
                                    p: 1,
                                    bgcolor: (isDragOver || isUnsortedOver) ? 'rgba(0, 0, 255, 0.1)' : 'transparent',
                                    border: (isDragOver || isUnsortedOver) ? '2px dashed #1976d2' : 'none',
                                    transition: 'all 0.2s',
                                    // Direct Grid Layout
                                    display: 'grid',
                                    gridTemplateColumns: `repeat(${columns}, 1fr)`,
                                    gap: 1,
                                    alignContent: 'start',
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
                                {unsortedVideos.map(video => (
                                    <DraggableVideo
                                        key={video.id}
                                        id={video.id}
                                        url={video.url}
                                        thumbnailUrl={video.thumbnailUrl}
                                        name={video.name}
                                        width="100%"
                                        color={video.color}
                                        isCommitted={video.isCommitted}
                                        onClick={() => setPreviewUrl(video.url)}
                                        onDelete={() => setConfirmDeleteVideoId(video.id)}
                                    />
                                ))}
                                {unsortedVideos.length === 0 && <Box sx={{ gridColumn: '1 / -1' }}><Typography variant="caption" color="text.secondary">No videos</Typography></Box>}
                            </Box>

                            {/* Search and Columns Slider at Bottom */}
                            <Box sx={{ p: 1, borderTop: '1px solid #ddd', display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <TextField
                                    fullWidth
                                    size="small"
                                    placeholder="Filter collection..."
                                    variant="standard"
                                    value={collectionSearch}
                                    onChange={(e) => setCollectionSearch(e.target.value)}
                                    InputProps={{
                                        startAdornment: (
                                            <InputAdornment position="start">
                                                <Search fontSize="small" />
                                            </InputAdornment>
                                        ),
                                    }}
                                />
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Typography variant="caption">Columns:</Typography>
                                    <Slider
                                        size="small"
                                        min={1}
                                        max={5}
                                        step={1}
                                        value={columns}
                                        onChange={(e, val) => setColumns(val as number)}
                                        marks
                                        aria-label="Columns"
                                        sx={{ flex: 1 }}
                                    />
                                </Box>
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
                    <Typography variant="h6" sx={{ mt: 1, fontWeight: 'bold' }}>Classes</Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {/* Row 1: Search & Add */}
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
                        </Box>
                        {/* Row 2: Bulk Actions */}
                        <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button
                                fullWidth
                                variant="contained"
                                color="primary"
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
                                UPLOAD ALL
                            </Button>
                            <Button
                                fullWidth
                                variant="outlined"
                                color="secondary"
                                disabled={isSyncing}
                                onClick={handleRetrainAll}
                            >
                                RETRAIN ALL
                            </Button>
                            <Button
                                fullWidth
                                variant="outlined"
                                color="inherit"
                                onClick={handleToggleMuteAll}
                            >
                                {classes.some(c => c.name !== 'Unsorted' && c.hasAudio) ? "MUTE ALL" : "UNMUTE ALL"}
                            </Button>
                        </Box>
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
                                    classData={realClass || {
                                        id: classId,
                                        name: clsName,
                                        count: classVideos.length,
                                        hasAudio: false,
                                        isDirty: false,
                                        caption: ''
                                    }}
                                    onDelete={classId !== 'Unsorted' ? deleteClass : undefined}
                                    onUpdate={updateClass}
                                    onCommit={async () => {
                                        setIsSyncing(true);
                                        await useStore.getState().commitFile();
                                        setIsSyncing(false);
                                    }}
                                    hasUncommitted={classVideos.some(v => v.isCommitted === false)}
                                    onCompute={async () => {
                                        setIsSyncing(true);
                                        await handleRetrainClass(classId, classVideos, realClass!);
                                        await useStore.getState().syncDataset();
                                        setIsSyncing(false);
                                    }}
                                >
                                    {classVideos.map(video => (
                                        <DraggableVideo
                                            key={video.id}
                                            id={video.id}
                                            url={video.url}
                                            thumbnailUrl={video.thumbnailUrl}
                                            name={video.name}
                                            width={80} // Fixed width for class list items
                                            color={video.color}
                                            startTime={video.startTime}
                                            isCommitted={video.isCommitted}
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
                                                    useStore.getState().updateVideo(video.id, { classId: 'Unsorted' });
                                                } else {
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
                        isCommitted={activeVideo.isCommitted}
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
