'use client';

import React, { useRef, useState, useEffect } from 'react';
import { Box, IconButton, Slider, Typography, Paper } from '@mui/material';
import { PlayArrow, Pause, Add, Delete, Crop, Loop } from '@mui/icons-material';
import { useStore, VideoClip } from '../store/useStore';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

interface Props {
    videoUrl: string;
    videoId: string;
    onClose: () => void;
    activeSubclipId?: string | null;
}

// Draggable Thumbnail Component for DnD-Kit integration
function formatTime(s: number) {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function DraggableSubclipThumbnail({ clip, onDelete, onSelect, isEditing, onPlayPause }: {
    clip: VideoClip,
    onDelete: (id: string) => void,
    onSelect: (id: string) => void,
    isEditing: boolean,
    onPlayPause: (id: string) => void
}) {
    // Prefix ID to avoid conflict with ClassManager draggables
    const draggableId = `editor-${clip.id}`;
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: draggableId,
        data: {
            type: 'Video',
            clip,
            originalId: clip.id // Pass original ID for drop handler
        }
    });

    const isAssigned = clip.classId && clip.classId !== 'Unsorted';

    const style = {
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.3 : (isAssigned ? 0.5 : 1), // Ghost effect or dimmed if assigned
    };

    return (
        <Paper
            ref={setNodeRef}
            style={style}
            {...listeners}
            {...attributes}
            // Modified: Clicking thumbnail selects AND starts playing it
            onClick={() => {
                onSelect(clip.id);
                // Also trigger play pause logic (auto play)
                onPlayPause(clip.id);
            }}
            sx={{
                width: 100, // Fixed width for wrap
                height: 80,
                bgcolor: clip.color || '#444',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                cursor: 'grab',
                overflow: 'hidden',
                p: 0.5,
                border: isEditing ? '2px solid white' : '1px solid #666',
                flexShrink: 0,
                m: 0.5 // Margin for wrap spacing
            }}
        >
            {clip.thumbnailUrl ? (
                <img src={clip.thumbnailUrl} style={{ width: '100%', height: 50, objectFit: 'cover', marginBottom: 4 }} />
            ) : (
                <Box sx={{ width: '100%', height: 40, bgcolor: 'rgba(0,0,0,0.2)', mb: 0.5 }} />
            )}

            {/* Delete Button (Restored) */}
            <IconButton
                size="small"
                sx={{
                    position: 'absolute',
                    top: 2,
                    right: 2,
                    bgcolor: 'rgba(0,0,0,0.3)',
                    color: 'white',
                    p: 0.2,
                    '&:hover': { bgcolor: 'rgba(255,0,0,0.7)' },
                    zIndex: 10
                }}
                onClick={(e) => {
                    e.stopPropagation();
                    onDelete(clip.id);
                }}
                onPointerDown={(e) => e.stopPropagation()}
            >
                <Delete fontSize="small" sx={{ fontSize: '1rem' }} />
            </IconButton>

            <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', justifyContent: 'space-between', px: 0.5 }}>
                <Typography variant="caption" sx={{ color: 'white', fontWeight: 'bold', fontSize: '0.7rem' }}>
                    {clip.endTime !== undefined
                        ? `${formatTime(clip.endTime - (clip.startTime || 0))}s`
                        : 'Full'}
                </Typography>

                <IconButton
                    size="small"
                    sx={{ p: 0.2, bgcolor: 'rgba(0,0,0,0.3)', '&:hover': { bgcolor: 'rgba(0,0,0,0.5)' } }}
                    onClick={(e) => {
                        e.stopPropagation();
                        // This button now acts as a pause/play toggle specifically for this clip context? 
                        // User request: "add a pause button to the subclip thumbnail in the editor to pause the subclip in loop"
                        // But also: "on thumbnail click switch playback to the selected subclip"
                        // So clicking the MAIN thumbnail plays. Clicking this small button can toggle pause?

                        // Let's make this button a Toggle: Play if stopped/other, Pause if playing THIS clip
                        onPlayPause(clip.id);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                >
                    {/* We need to know if THIS clip is currently playing/looping to show Pause icon */}
                    {isEditing ? <Pause sx={{ color: 'white', fontSize: '0.9rem' }} /> : <PlayArrow sx={{ color: 'white', fontSize: '0.9rem' }} />}
                </IconButton>
            </Box>
        </Paper>
    );
}

export default function MediaBunny({ videoUrl, videoId, onClose, activeSubclipId }: Props) {
    const addSubclip = useStore(state => state.addSubclip);
    const updateVideo = useStore(state => state.updateVideo);
    const deleteRecording = useStore(state => state.deleteRecording);

    // Get all videos to avoid unstable selector reference
    const allVideos = useStore(state => state.videos);
    const parentVideo = allVideos.find(v => v.id === videoId);
    const existingSubclips = allVideos.filter(v => v.parentVideoId === videoId);

    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);

    // Loop State
    const [isLooping, setIsLooping] = useState(false);
    const [loopRegion, setLoopRegion] = useState<[number, number] | null>(null);

    // New Clip / Edit State
    const [isCreating, setIsCreating] = useState(false);
    const [editingClipId, setEditingClipId] = useState<string | null>(null);
    const [selection, setSelection] = useState<number[]>([0, 0]); // Start, End

    // Crop State
    const [isCropping, setIsCropping] = useState(false);
    const [crop, setCrop] = useState<{ x: number, y: number, width: number, height: number } | undefined>(undefined);
    const cropStartRef = useRef<{ x: number, y: number } | null>(null);
    const videoContainerRef = useRef<HTMLDivElement>(null);
    const [videoBoundsState, setVideoBoundsState] = useState<{
        offsetX: number;
        offsetY: number;
        width: number;
        height: number;
    } | null>(null);

    // Refs for stable access in event listeners
    const selectionRef = useRef<number[]>([0, 0]);
    const isDraggingRef = useRef(false);

    // Helper: Get actual video display bounds within container (accounting for object-fit:contain letterboxing)
    const getVideoBounds = () => {
        const video = videoRef.current;
        const container = videoContainerRef.current;
        if (!video || !container) return null;
        if (video.videoWidth === 0 || video.videoHeight === 0) return null; // Video not loaded yet

        const containerRect = container.getBoundingClientRect();
        const videoAspect = video.videoWidth / video.videoHeight;
        const containerAspect = containerRect.width / containerRect.height;

        let videoDisplayWidth: number, videoDisplayHeight: number;
        let offsetX = 0, offsetY = 0;

        if (videoAspect > containerAspect) {
            // Video is wider than container - letterboxing on top/bottom
            videoDisplayWidth = containerRect.width;
            videoDisplayHeight = containerRect.width / videoAspect;
            offsetY = (containerRect.height - videoDisplayHeight) / 2;
        } else {
            // Video is taller/narrower than container - letterboxing on left/right
            videoDisplayHeight = containerRect.height;
            videoDisplayWidth = containerRect.height * videoAspect;
            offsetX = (containerRect.width - videoDisplayWidth) / 2;
        }

        return {
            offsetX,
            offsetY,
            width: videoDisplayWidth,
            height: videoDisplayHeight,
            containerWidth: containerRect.width,
            containerHeight: containerRect.height
        };
    };

    // Sync Ref with State
    useEffect(() => {
        selectionRef.current = selection;
    }, [selection]);

    // Initialize Edit Mode if activeSubclipId provided
    useEffect(() => {
        if (activeSubclipId && existingSubclips.length > 0) {
            const clip = existingSubclips.find(c => c.id === activeSubclipId);
            if (clip && clip.startTime !== undefined) {
                setEditingClipId(clip.id);
                const newSel = [clip.startTime, clip.endTime || clip.startTime + 5.0];
                setSelection(newSel);
                selectionRef.current = newSel;
                setIsCreating(true);
                setCrop(clip.crop || { x: 0, y: 0, width: 1, height: 1 }); // Load crop or default full
                setIsCropping(true);
                // Also seek to start and update video bounds
                if (videoRef.current) {
                    videoRef.current.currentTime = clip.startTime;
                    setCurrentTime(clip.startTime);
                }
                // Update video bounds for crop overlay
                setTimeout(() => {
                    const bounds = getVideoBounds();
                    if (bounds) setVideoBoundsState(bounds);
                }, 100);
            }
        }
    }, [activeSubclipId, existingSubclips.length]);

    // Timeline Hover State
    const [timelineHoverTime, setTimelineHoverTime] = useState<number | null>(null);
    const [timelineHoverPos, setTimelineHoverPos] = useState({ x: 0, y: 0 });

    const handlePlayPause = () => {
        // Stop looping if user Manually toggles play/pause using the main button
        setIsLooping(false);
        setLoopRegion(null);

        if (videoRef.current) {
            if (isPlaying) videoRef.current.pause();
            else videoRef.current.play();
            setIsPlaying(!isPlaying);
        }
    };

    const handleTimeUpdate = () => {
        if (videoRef.current) {
            const time = videoRef.current.currentTime;
            setCurrentTime(time);

            // Handle Looping
            if (isLooping && loopRegion) {
                if (time >= loopRegion[1]) {
                    videoRef.current.currentTime = loopRegion[0];
                }
            }
        }
    };

    const handleLoadedMetadata = () => {
        if (videoRef.current) {
            setDuration(videoRef.current.duration);
            // Update video bounds after metadata loads
            const bounds = getVideoBounds();
            if (bounds) setVideoBoundsState(bounds);
        }
    };

    const handleStartCreation = () => {
        if (!videoRef.current) return;
        setEditingClipId(null); // Clear editing mode
        setCrop({ x: 0, y: 0, width: 1, height: 1 }); // Default to full screen
        setIsCropping(true); // Enable creation mode
        const start = videoRef.current.currentTime;
        const end = Math.min(start + 5.0, duration);
        const newSel = [start, end];
        setSelection(newSel);
        selectionRef.current = newSel;
        setIsCreating(true);
        videoRef.current.pause();
        setIsPlaying(false);
        setLoopRegion(null);
        setIsLooping(false);
    };

    const captureThumbnail = (time: number): string => {
        if (!videoRef.current) return '';
        const canvas = document.createElement('canvas');

        let sx = 0, sy = 0, sw = videoRef.current.videoWidth, sh = videoRef.current.videoHeight;

        if (crop) {
            sx = crop.x * sw;
            sy = crop.y * sh;
            sw = crop.width * sw;
            sh = crop.height * sh;
        }

        // Maintain aspect ratio or fixed size? 
        // For thumbnails let's keep it simple, just scale down the source region
        // We want consistent height maybe? Or just 1/4th of source?
        // If we crop a tiny area 1/4th might be too small. 
        // Let's aim for a target height of ~150px (similar to before which was Height/4 ~ 1080/4=270)

        const targetHeight = 150;
        const scale = targetHeight / sh;
        canvas.width = sw * scale;
        canvas.height = targetHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) return '';

        ctx.drawImage(videoRef.current, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.7);
    };

    const getRandomColor = () => {
        const hue = Math.floor(Math.random() * 360);
        return `hsl(${hue}, 70%, 60%)`;
    };

    // Consolidated Commit Function
    const commitChanges = async () => {
        if (!parentVideo || !videoRef.current) return;

        // Use REF for latest selection values during drag ending
        const currentSelection = selectionRef.current;

        // Use current selection start for thumbnail
        videoRef.current.currentTime = currentSelection[0];

        // Wait minor delay for seek
        await new Promise(r => setTimeout(r, 50));
        const thumbnail = captureThumbnail(currentSelection[0]);

        if (editingClipId) {
            updateVideo(editingClipId, {
                startTime: currentSelection[0],
                endTime: currentSelection[1],
                thumbnailUrl: thumbnail,
                crop: crop, // Save crop
                previewDirty: true
            });
            // We stay in edit mode
        } else {
            // Create New
            const color = getRandomColor();
            addSubclip(parentVideo, currentSelection[0], currentSelection[1], color, thumbnail, crop);
            setIsCreating(false);
            setCrop(undefined);
        }
    };

    const handleDeleteClip = (id: string) => {
        if (id === editingClipId) {
            setEditingClipId(null);
            setIsCreating(false);
            setCrop(undefined);
            setIsCropping(false);
        }
        deleteRecording(id);
    };

    const handleSeek = (e: Event, value: number | number[]) => {
        const time = value as number;
        // Stop looping on seek
        setIsLooping(false);
        setLoopRegion(null);

        if (videoRef.current) {
            videoRef.current.currentTime = time;
            setCurrentTime(time);
        }
    };

    // Updated Handler: Toggle behavior
    const handlePlaySubclipLoop = (subclipId: string) => {
        const clip = existingSubclips.find(c => c.id === subclipId);
        if (clip && clip.startTime !== undefined && clip.endTime !== undefined) {

            // If already editing this clip and playing...
            if (editingClipId === subclipId && isPlaying) {
                videoRef.current?.pause();
                setIsPlaying(false);
                return;
            }

            // Select the clip
            setEditingClipId(clip.id);
            setSelection([clip.startTime, clip.endTime]);
            selectionRef.current = [clip.startTime, clip.endTime];
            setCrop(clip.crop || { x: 0, y: 0, width: 1, height: 1 });
            setIsCreating(true);
            setIsCropping(true);

            // Set up looping
            setLoopRegion([clip.startTime, clip.endTime]);
            setIsLooping(true);

            // Start playing
            if (videoRef.current) {
                // If not already in range, seek
                if (videoRef.current.currentTime < clip.startTime || videoRef.current.currentTime > clip.endTime) {
                    videoRef.current.currentTime = clip.startTime;
                    setCurrentTime(clip.startTime);
                }
                videoRef.current.play();
                setIsPlaying(true);
            }
        }
    }

    // --- Crop Inputs ---
    const [cropDragMode, setCropDragMode] = useState<'create' | 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w' | null>(null);
    const [cropDragStart, setCropDragStart] = useState<{ x: number, y: number } | null>(null);
    const [initialCrop, setInitialCrop] = useState<{ x: number, y: number, width: number, height: number } | null>(null);

    const handleCropPointerDown = (e: React.PointerEvent, mode: 'create' | 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w' = 'create') => {
        if (!isCropping || !videoContainerRef.current) return;
        e.preventDefault();
        e.stopPropagation();

        const containerRect = videoContainerRef.current.getBoundingClientRect();
        // Calculate position as percentage of container
        const x = Math.max(0, Math.min(1, (e.clientX - containerRect.left) / containerRect.width));
        const y = Math.max(0, Math.min(1, (e.clientY - containerRect.top) / containerRect.height));

        setCropDragMode(mode);
        setCropDragStart({ x, y });

        if (mode === 'create') {
            setCrop({ x, y, width: 0, height: 0 });
            setInitialCrop({ x, y, width: 0, height: 0 });
        } else {
            setInitialCrop(crop || null);
        }
    };

    const handleCropPointerMove = (e: React.PointerEvent) => {
        if (!isCropping || !cropDragMode || !cropDragStart || !videoContainerRef.current || !initialCrop) return;
        e.preventDefault();
        e.stopPropagation();

        const containerRect = videoContainerRef.current.getBoundingClientRect();
        // Calculate position as percentage of container
        const currentX = Math.max(0, Math.min(1, (e.clientX - containerRect.left) / containerRect.width));
        const currentY = Math.max(0, Math.min(1, (e.clientY - containerRect.top) / containerRect.height));

        const deltaX = currentX - cropDragStart.x;
        const deltaY = currentY - cropDragStart.y;

        let newCrop = { ...initialCrop };

        if (cropDragMode === 'create') {
            const minX = Math.min(initialCrop.x, currentX);
            const minY = Math.min(initialCrop.y, currentY);
            const width = Math.abs(currentX - initialCrop.x);
            const height = Math.abs(currentY - initialCrop.y);
            newCrop = { x: minX, y: minY, width, height };
        } else if (cropDragMode === 'move') {
            newCrop.x += deltaX;
            newCrop.y += deltaY;
        } else if (cropDragMode === 'se') {
            newCrop.width += deltaX;
            newCrop.height += deltaY;
        } else if (cropDragMode === 'sw') {
            newCrop.x += deltaX;
            newCrop.width -= deltaX;
            newCrop.height += deltaY;
        } else if (cropDragMode === 'ne') {
            newCrop.y += deltaY;
            newCrop.width += deltaX;
            newCrop.height -= deltaY;
        } else if (cropDragMode === 'nw') {
            newCrop.x += deltaX;
            newCrop.y += deltaY;
            newCrop.width -= deltaX;
            newCrop.height -= deltaY;
        } else if (cropDragMode === 'n') {
            newCrop.y += deltaY;
            newCrop.height -= deltaY;
        } else if (cropDragMode === 's') {
            newCrop.height += deltaY;
        } else if (cropDragMode === 'w') {
            newCrop.x += deltaX;
            newCrop.width -= deltaX;
        } else if (cropDragMode === 'e') {
            newCrop.width += deltaX;
        }

        // Normalize negative width/height (flip) - simplified for now: just clamp min size
        if (newCrop.width < 0.01) newCrop.width = 0.01;
        if (newCrop.height < 0.01) newCrop.height = 0.01;

        // Clamp to boundaries
        if (newCrop.x < 0) newCrop.x = 0;
        if (newCrop.y < 0) newCrop.y = 0;
        if (newCrop.x + newCrop.width > 1) {
            if (cropDragMode === 'move') newCrop.x = 1 - newCrop.width;
            else newCrop.width = 1 - newCrop.x;
        }
        if (newCrop.y + newCrop.height > 1) {
            if (cropDragMode === 'move') newCrop.y = 1 - newCrop.height;
            else newCrop.height = 1 - newCrop.y;
        }

        setCrop(newCrop);
    };

    const handleCropPointerUp = () => {
        if (isCropping) {
            setCropDragMode(null);
            setCropDragStart(null);
            setInitialCrop(null);
            if (editingClipId) {
                commitChanges();
            }
        }
    };

    // Track Drag & Resize Logic
    const [dragMode, setDragMode] = useState<'move' | 'resize-start' | 'resize-end' | null>(null);
    const [dragStartX, setDragStartX] = useState<number | null>(null);
    const [initialSelection, setInitialSelection] = useState<number[] | null>(null);
    const timelineRef = useRef<HTMLDivElement>(null);

    const handleDragStart = (e: React.PointerEvent, mode: 'move' | 'resize-start' | 'resize-end') => {
        e.preventDefault();
        e.stopPropagation();
        setDragMode(mode);
        setDragStartX(e.clientX);
        setInitialSelection([...selection]);
        isDraggingRef.current = true;
    };

    useEffect(() => {
        const handlePointerMove = (e: PointerEvent) => {
            if (!dragMode || dragStartX === null || !initialSelection || !timelineRef.current) return;

            const rect = timelineRef.current.getBoundingClientRect();
            const deltaX = e.clientX - dragStartX;
            const deltaTime = (deltaX / rect.width) * duration;

            let [newStart, newEnd] = initialSelection;

            if (dragMode === 'move') {
                newStart += deltaTime;
                newEnd += deltaTime;
                if (newStart < 0) {
                    newEnd -= newStart;
                    newStart = 0;
                }
                if (newEnd > duration) {
                    newStart -= (newEnd - duration);
                    newEnd = duration;
                }
            } else if (dragMode === 'resize-start') {
                newStart += deltaTime;
                if (newStart < 0) newStart = 0;
                if (newStart > newEnd - 0.1) newStart = newEnd - 0.1;
            } else if (dragMode === 'resize-end') {
                newEnd += deltaTime;
                if (newEnd > duration) newEnd = duration;
                if (newEnd < newStart + 0.1) newEnd = newStart + 0.1;
            }

            // Secondary clamp safety
            newStart = Math.max(0, newStart);
            newEnd = Math.min(newEnd, duration);

            setSelection([newStart, newEnd]);
            selectionRef.current = [newStart, newEnd];

            if (videoRef.current) {
                const targetTime = dragMode === 'resize-end' ? newEnd : newStart;
                if (Math.abs(videoRef.current.currentTime - targetTime) > 0.1) {
                    videoRef.current.currentTime = targetTime;
                }
            }
        };

        const handlePointerUp = () => {
            if (dragMode) {
                setDragMode(null);
                setDragStartX(null);
                setInitialSelection(null);

                // Ensure we commit the FINAL ref value
                commitChanges();

                // Reset drag flag slightly later to prevent click conflicts immediately
                setTimeout(() => {
                    isDraggingRef.current = false;
                }, 100);
            }
        };

        if (dragMode) {
            window.addEventListener('pointermove', handlePointerMove);
            window.addEventListener('pointerup', handlePointerUp);
        }
        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [dragMode, dragStartX, initialSelection, duration]); // commitChanges omitted for stability

    // Timeline Click Handler
    const handleTimelineClick = (e: React.MouseEvent) => {
        if (isDraggingRef.current) return;

        // Only if clicked directly on the timeline (or bubbled up from markers who didn't stop propagation? Markers DO stop prop)
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const clickTime = (x / rect.width) * duration;

        // Stop looping on timeline click (seek)
        setIsLooping(false);
        setLoopRegion(null);

        // Find if we clicked on an existing clip
        // We iterate in reverse to find the "topmost" if overlap (though usually they are equal z)
        const clickedClip = [...existingSubclips].reverse().find(clip =>
            clip.startTime !== undefined && clip.endTime !== undefined &&
            clickTime >= clip.startTime && clickTime <= clip.endTime
        );

        if (clickedClip && clickedClip.startTime !== undefined && clickedClip.endTime !== undefined) {
            setEditingClipId(clickedClip.id);
            setSelection([clickedClip.startTime, clickedClip.endTime]);
            selectionRef.current = [clickedClip.startTime, clickedClip.endTime];
            setCrop(clickedClip.crop || { x: 0, y: 0, width: 1, height: 1 }); // Load crop or default full
            setIsCreating(true);
            setIsCropping(true);
        } else {
            // Clicked empty space - deselect
            setEditingClipId(null);
            setIsCreating(false);
            setCrop(undefined);
            setIsCropping(false);

            // Also Seek
            if (videoRef.current) {
                videoRef.current.currentTime = clickTime;
                setCurrentTime(clickTime);
            }
        }
    };

    // Preview Logic (Subclip Rollover)
    const [hoveredClip, setHoveredClip] = useState<VideoClip | null>(null);
    const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 });
    const previewVideoRef = useRef<HTMLVideoElement>(null);
    const timelinePreviewRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        if (hoveredClip && previewVideoRef.current && videoRef.current && hoveredClip.startTime !== undefined) {
            const start = hoveredClip.startTime;
            previewVideoRef.current.currentTime = start;
            previewVideoRef.current.playbackRate = 2.0;
            previewVideoRef.current.play().catch(() => { });
        }
    }, [hoveredClip]);

    // Idle Detection for "Collapsing" Editor Controls
    const [isUserIdle, setIsUserIdle] = useState(false);
    const idleTimer = useRef<NodeJS.Timeout | null>(null);

    const onUserActivity = () => {
        setIsUserIdle(false);
        if (idleTimer.current) clearTimeout(idleTimer.current);
        idleTimer.current = setTimeout(() => {
            if (isPlaying && !isCropping && !isCreating) { // Only hide if playing and not actively cropping
                setIsUserIdle(true);
            }
        }, 3000);
    };

    useEffect(() => {
        if (idleTimer.current) clearTimeout(idleTimer.current);
        onUserActivity(); // Start timer
        return () => {
            if (idleTimer.current) clearTimeout(idleTimer.current);
        }
    }, [isPlaying, isCropping, isCreating]);

    return (
        <Box
            sx={{ p: 2, bgcolor: '#000', color: 'white', borderRadius: 2, position: 'relative' }}
            onMouseMove={onUserActivity}
            onPointerDown={onUserActivity}
            onClick={onUserActivity}
        >

            {/* Main Player Container with Crop Overlay */}
            <Box
                ref={videoContainerRef}
                sx={{ position: 'relative', display: 'inline-block', width: '100%', bgcolor: '#111' }}
                onPointerDown={handleCropPointerDown}
                onPointerMove={handleCropPointerMove}
                onPointerUp={handleCropPointerUp}
                onPointerLeave={handleCropPointerUp}
                style={{ cursor: isCropping ? 'crosshair' : 'default' }}
            >
                <video
                    ref={videoRef}
                    src={videoUrl}
                    style={{ width: '100%', height: 'auto', display: 'block' }}
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onEnded={() => setIsPlaying(false)}
                    onClick={handlePlayPause}
                    crossOrigin="anonymous"
                />

                {/* Crop Overlay - Fade out when idle */}
                {crop && (
                    <Box sx={{
                        position: 'absolute',
                        left: `${crop.x * 100}%`,
                        top: `${crop.y * 100}%`,
                        width: `${crop.width * 100}%`,
                        height: `${crop.height * 100}%`,
                        border: `2px solid ${existingSubclips.find(c => c.id === editingClipId)?.color || '#00ff00'}`,
                        bgcolor: editingClipId ? `${existingSubclips.find(c => c.id === editingClipId)?.color}22` : 'rgba(0,255,0,0.1)',
                        pointerEvents: 'auto',
                        cursor: 'move',
                        boxSizing: 'border-box',
                        opacity: isUserIdle ? 0 : 1,
                        transition: 'opacity 0.5s ease',
                    }}
                        onPointerDown={(e) => handleCropPointerDown(e, 'move')}
                    >
                        {/* Resize Handles */}
                        {[
                            { mode: 'nw', top: -5, left: -5, cursor: 'nw-resize' },
                            { mode: 'ne', top: -5, right: -5, cursor: 'ne-resize' },
                            { mode: 'sw', bottom: -5, left: -5, cursor: 'sw-resize' },
                            { mode: 'se', bottom: -5, right: -5, cursor: 'se-resize' },
                            { mode: 'n', top: -5, left: '50%', transform: 'translateX(-50%)', cursor: 'n-resize' },
                            { mode: 's', bottom: -5, left: '50%', transform: 'translateX(-50%)', cursor: 's-resize' },
                            { mode: 'w', top: '50%', left: -5, transform: 'translateY(-50%)', cursor: 'w-resize' },
                            { mode: 'e', top: '50%', right: -5, transform: 'translateY(-50%)', cursor: 'e-resize' }
                        ].map((handle) => (
                            <Box
                                key={handle.mode}
                                sx={{
                                    position: 'absolute',
                                    width: 10,
                                    height: 10,
                                    bgcolor: existingSubclips.find(c => c.id === editingClipId)?.color || 'red',
                                    border: '1px solid white',
                                    ...handle
                                }}
                                onPointerDown={(e) => handleCropPointerDown(e, handle.mode as any)}
                            />
                        ))}
                    </Box>
                )}
            </Box>

            {/* Controls - Fade out when idle */}
            <Box sx={{
                opacity: isUserIdle ? 0 : 1,
                transition: 'opacity 0.5s ease',
                pointerEvents: isUserIdle ? 'none' : 'auto'
            }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                    <IconButton onClick={handlePlayPause} color="primary">
                        {isPlaying ? <Pause /> : <PlayArrow />}
                    </IconButton>
                    <Typography variant="caption">{formatTime(currentTime)} / {formatTime(duration)}</Typography>

                    <Slider
                        size="small"
                        min={0}
                        max={duration || 100}
                        value={currentTime}
                        onChange={handleSeek}
                        sx={{ flex: 1, mx: 2 }}
                    />
                </Box>

                {/* Timeline Editor Zone */}
                <Box
                    ref={timelineRef}
                    sx={{ position: 'relative', height: 60, mt: 2, bgcolor: '#222', borderRadius: 1, overflow: 'hidden', cursor: 'pointer' }}
                    onClick={handleTimelineClick}
                    onMouseMove={(e) => {
                        onUserActivity(); // Ensure moving on timeline keeps it awake
                        const rect = e.currentTarget.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const time = (x / rect.width) * duration;
                        setTimelineHoverTime(time);
                        setTimelineHoverPos({ x: e.clientX, y: rect.top - 100 });
                    }}
                    onMouseLeave={() => setTimelineHoverTime(null)}
                    // Double Click to create immediate subclip
                    onDoubleClick={async (e) => {
                        if (!parentVideo || !videoRef.current) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const startTime = (x / rect.width) * duration;
                        const endTime = Math.min(startTime + 5.0, duration);

                        // Capture thumbnail
                        videoRef.current.currentTime = startTime;
                        await new Promise(r => setTimeout(r, 200));
                        const thumbnail = captureThumbnail(startTime);

                        const color = getRandomColor();
                        const initialCrop = { x: 0, y: 0, width: 1, height: 1 };
                        const newId = addSubclip(parentVideo, startTime, endTime, color, thumbnail, initialCrop);

                        // Immediately select and edit the new clip
                        setEditingClipId(newId);
                        setSelection([startTime, endTime]);
                        selectionRef.current = [startTime, endTime];
                        setCrop(initialCrop);
                        setIsCreating(true);
                        setIsCropping(true); // Enable interaction

                        // Ensure UI is synced
                        if (videoRef.current) {
                            videoRef.current.currentTime = startTime;
                            setCurrentTime(startTime);
                        }
                    }}
                >
                    {/* Existing Clips Markers */}
                    {existingSubclips.map(clip => (
                        clip.startTime !== undefined && clip.endTime !== undefined && (
                            <Box
                                key={clip.id}
                                sx={{
                                    position: 'absolute',
                                    left: `${(clip.startTime / duration) * 100}%`,
                                    width: `${((clip.endTime - clip.startTime) / duration) * 100}%`,
                                    height: '100%',
                                    bgcolor: clip.color || 'gray',
                                    opacity: 0.6,
                                    border: editingClipId === clip.id ? '2px solid white' : 'none',
                                    boxSizing: 'border-box',
                                    borderLeft: '2px solid rgba(0,0,0,0.5)',
                                    borderRight: '2px solid rgba(0,0,0,0.5)',
                                    cursor: 'pointer',
                                    pointerEvents: isCreating ? 'none' : 'auto'
                                }}
                                onMouseDown={(e) => {
                                    e.stopPropagation();
                                    setEditingClipId(clip.id);
                                    setSelection([clip.startTime!, clip.endTime!]);
                                    selectionRef.current = [clip.startTime!, clip.endTime!];
                                    setIsCreating(true);
                                }}
                                onMouseEnter={(e) => {
                                    setHoveredClip(clip);
                                    setHoverPosition({ x: e.clientX, y: e.clientY - 150 });
                                }}
                                onMouseLeave={() => setHoveredClip(null)}
                            />
                        )
                    ))}

                    {/* Active Creation Zone (Overlay) */}
                    {isCreating && (
                        <Box sx={{
                            position: 'absolute',
                            left: 0, right: 0, top: 0, bottom: 0,
                            zIndex: 10,
                            pointerEvents: 'none'
                        }}>
                            {/* Selected Area - Full Height */}
                            <Box
                                sx={{
                                    position: 'absolute',
                                    left: `${(selection[0] / duration) * 100}%`,
                                    width: `${((selection[1] - selection[0]) / duration) * 100}%`,
                                    top: 0,
                                    bottom: 0,
                                    bgcolor: editingClipId ? 'rgba(255, 165, 0, 0.4)' : 'rgba(255, 255, 0, 0.4)',
                                    border: '2px solid white',
                                    boxSizing: 'border-box',
                                    pointerEvents: 'auto',
                                    cursor: dragMode === 'move' ? 'grabbing' : 'grab',
                                    display: 'flex',
                                    justifyContent: 'center',
                                    alignItems: 'center'
                                }}
                                onPointerDown={(e) => handleDragStart(e, 'move')}
                            >
                                <Box sx={{ width: 40, height: 4, bgcolor: 'rgba(255,255,255,0.5)', borderRadius: 2 }} />
                            </Box>

                            {/* Resume Left Handle (Start) */}
                            <Box
                                onPointerDown={(e) => handleDragStart(e, 'resize-start')}
                                sx={{
                                    position: 'absolute',
                                    left: `calc(${(selection[0] / duration) * 100}% - 10px)`,
                                    width: 20,
                                    top: 0, bottom: 0,
                                    cursor: 'ew-resize',
                                    zIndex: 12,
                                    pointerEvents: 'auto',
                                    display: 'flex', justifyContent: 'center', alignItems: 'center',
                                    '&:hover > div': { bgcolor: 'white' }
                                }}
                            >
                                <Box sx={{ width: 4, height: '60%', bgcolor: 'rgba(255,255,255,0.7)', borderRadius: 1 }} />
                            </Box>

                            {/* Resume Right Handle (End) */}
                            <Box
                                onPointerDown={(e) => handleDragStart(e, 'resize-end')}
                                sx={{
                                    position: 'absolute',
                                    left: `calc(${(selection[1] / duration) * 100}% - 10px)`,
                                    width: 20,
                                    top: 0, bottom: 0,
                                    cursor: 'ew-resize',
                                    zIndex: 12,
                                    pointerEvents: 'auto',
                                    display: 'flex', justifyContent: 'center', alignItems: 'center',
                                    '&:hover > div': { bgcolor: 'white' }
                                }}
                            >
                                <Box sx={{ width: 4, height: '60%', bgcolor: 'rgba(255,255,255,0.7)', borderRadius: 1 }} />
                            </Box>
                        </Box>
                    )}

                    {/* Global Playhead - RESTORED as requested */}
                    <Box sx={{
                        position: 'absolute',
                        left: `${(currentTime / duration) * 100}%`,
                        top: 0,
                        bottom: 0,
                        width: 2,
                        bgcolor: 'white', // Changed to white as requested
                        zIndex: 20,
                        pointerEvents: 'none'
                    }} />

                </Box>

                {/* List of clips below */}
                <Box sx={{ display: 'flex', gap: 1, mt: 2, overflowX: 'auto', pb: 1 }}>
                    {existingSubclips.map(clip => (
                        <DraggableSubclipThumbnail
                            key={clip.id}
                            clip={clip}
                            onDelete={handleDeleteClip}
                            onPlayPause={handlePlaySubclipLoop}
                            onSelect={(id) => {
                                setEditingClipId(id);
                                if (clip.startTime !== undefined) {
                                    setSelection([clip.startTime, clip.endTime || clip.startTime + 5.0]);
                                    selectionRef.current = [clip.startTime, clip.endTime || clip.startTime + 5.0];
                                    if (videoRef.current) {
                                        videoRef.current.currentTime = clip.startTime;
                                        setCurrentTime(clip.startTime);
                                    }
                                    setCrop(clip.crop || { x: 0, y: 0, width: 1, height: 1 });
                                    setIsCreating(true);
                                    setIsCropping(true);

                                    // Disable looping if just selecting
                                    setIsLooping(false);
                                    setLoopRegion(null);
                                }
                            }}
                            isEditing={editingClipId === clip.id}
                        />
                    ))}
                </Box>

                <Typography variant="caption" color="gray" sx={{ mt: 1, display: 'block' }}>
                    Double-click timeline to add clip. Drag yellow region to move/resize.
                </Typography>
            </Box>
        </Box>
    );
}


