'use client';

import React, { useRef, useState, useEffect } from 'react';
import { Box, IconButton, Slider, Typography, Paper } from '@mui/material';
import { PlayArrow, Pause, Add, Delete, Close } from '@mui/icons-material';
import { useStore, VideoClip } from '../store/useStore';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

interface Props {
    videoUrl: string;
    videoId: string;
    onClose: () => void;
}

// Draggable Thumbnail Component for DnD-Kit integration
function DraggableSubclipThumbnail({ clip, onDelete }: { clip: VideoClip, onDelete: (id: string) => void }) {
    const { attributes, listeners, setNodeRef, transform } = useDraggable({
        id: clip.id,
        data: {
            type: 'Video',
            clip // Pass clip data so droppable knows what it is (if needed, though ID lookup is standard)
        }
    });

    const style = {
        transform: CSS.Translate.toString(transform),
    };

    return (
        <Paper
            ref={setNodeRef}
            style={style}
            {...listeners}
            {...attributes}
            sx={{
                minWidth: 100, height: 80,
                bgcolor: clip.color || '#444',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                cursor: 'grab',
                overflow: 'hidden',
                p: 0.5,
                border: '1px solid #666',
                flexShrink: 0
            }}
        >
            {clip.thumbnailUrl ? (
                <img src={clip.thumbnailUrl} style={{ width: '100%', height: 50, objectFit: 'cover', marginBottom: 4 }} />
            ) : (
                <Box sx={{ width: '100%', height: 40, bgcolor: 'rgba(0,0,0,0.2)', mb: 0.5 }} />
            )}

            <Typography variant="caption" sx={{ color: 'white', fontWeight: 'bold', fontSize: '0.7rem' }}>
                {formatTime((clip.endTime || 0) - (clip.startTime || 0))}s
            </Typography>

            <IconButton
                size="small"
                sx={{ position: 'absolute', top: 0, right: 0, p: 0.2, bgcolor: 'rgba(0,0,0,0.5)' }}
                onClick={(e) => { e.stopPropagation(); onDelete(clip.id); }}
                onPointerDown={(e) => e.stopPropagation()} // Prevent drag 
            >
                <Delete fontSize="small" sx={{ color: 'white' }} />
            </IconButton>
        </Paper>
    );
}

export default function MediaBunny({ videoUrl, videoId, onClose }: Props) {
    const addSubclip = useStore(state => state.addSubclip);
    const deleteRecording = useStore(state => state.deleteRecording);

    // Get all videos to avoid unstable selector reference
    const allVideos = useStore(state => state.videos);
    const parentVideo = allVideos.find(v => v.id === videoId);
    const existingSubclips = allVideos.filter(v => v.parentVideoId === videoId);

    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);

    // New Clip State
    const [isCreating, setIsCreating] = useState(false);
    const [selection, setSelection] = useState<number[]>([0, 0]); // Start, End

    // Timeline Hover State
    const [timelineHoverTime, setTimelineHoverTime] = useState<number | null>(null);
    const [timelineHoverPos, setTimelineHoverPos] = useState({ x: 0, y: 0 });

    const handlePlayPause = () => {
        if (videoRef.current) {
            if (isPlaying) videoRef.current.pause();
            else videoRef.current.play();
            setIsPlaying(!isPlaying);
        }
    };

    const handleTimeUpdate = () => {
        if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
    };

    const handleLoadedMetadata = () => {
        if (videoRef.current) setDuration(videoRef.current.duration);
    };

    const handleStartCreation = () => {
        if (!videoRef.current) return;
        const start = videoRef.current.currentTime;
        const end = Math.min(start + 2.0, duration);
        setSelection([start, end]);
        setIsCreating(true);
        videoRef.current.pause();
        setIsPlaying(false);
    };

    const captureThumbnail = (time: number): string => {
        if (!videoRef.current) return '';
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth / 4;
        canvas.height = videoRef.current.videoHeight / 4;
        const ctx = canvas.getContext('2d');
        if (!ctx) return '';
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.7);
    };

    const handleSaveClip = async () => {
        if (!parentVideo || !videoRef.current) return;
        videoRef.current.currentTime = selection[0];
        await new Promise(r => setTimeout(r, 200));
        const thumbnail = captureThumbnail(selection[0]);
        const color = getRandomColor();
        addSubclip(parentVideo, selection[0], selection[1], color, thumbnail);
        setIsCreating(false);
    };

    const getRandomColor = () => {
        const hue = Math.floor(Math.random() * 360);
        return `hsl(${hue}, 70%, 60%)`;
    };

    const handleDeleteClip = (id: string) => {
        deleteRecording(id);
    };

    const handleSeek = (e: Event, value: number | number[]) => {
        const time = value as number;
        if (videoRef.current) {
            videoRef.current.currentTime = time;
            setCurrentTime(time);
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
            previewVideoRef.current.playbackRate = 2.0; // 2x speed requested
            previewVideoRef.current.play().catch(() => { });
        }
    }, [hoveredClip]);

    // Timeline Frame Preview logic
    useEffect(() => {
        if (timelineHoverTime !== null && timelinePreviewRef.current) {
            timelinePreviewRef.current.currentTime = timelineHoverTime;
            // Seek only
        }
    }, [timelineHoverTime]);

    return (
        <Box sx={{ p: 2, bgcolor: '#000', color: 'white', borderRadius: 2, position: 'relative' }}>
            <IconButton
                onClick={onClose}
                sx={{ position: 'absolute', top: 5, right: 5, color: 'white', zIndex: 100, bgcolor: 'rgba(0,0,0,0.5)' }}
                size="small"
            >
                <Close />
            </IconButton>

            {/* Main Player */}
            <video
                ref={videoRef}
                src={videoUrl}
                style={{ width: '100%', maxHeight: 300, backgroundColor: '#111' }}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={() => setIsPlaying(false)}
                onClick={handlePlayPause}
                crossOrigin="anonymous"
            />

            {/* Controls */}
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

                <IconButton onClick={handleStartCreation} color="secondary" title="Create Subclip">
                    <Add />
                </IconButton>
            </Box>

            {/* Timeline Editor Zone */}
            <Box
                sx={{ position: 'relative', height: 60, mt: 2, bgcolor: '#222', borderRadius: 1, overflow: 'hidden', cursor: 'pointer' }}
                onMouseMove={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const time = (x / rect.width) * duration;
                    setTimelineHoverTime(time);
                    setTimelineHoverPos({ x: e.clientX, y: rect.top - 100 });
                }}
                onMouseLeave={() => setTimelineHoverTime(null)}
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
                                borderLeft: '2px solid rgba(0,0,0,0.5)',
                                borderRight: '2px solid rgba(0,0,0,0.5)',
                                cursor: 'move' // Indicate draggable (though only mocked for now)
                            }}
                            onMouseDown={(e) => {
                                e.stopPropagation();
                                alert("Timeline dragging is not yet fully implemented in Store.");
                            }}
                            /* Hover Logic for Preview */
                            onMouseEnter={(e) => {
                                setHoveredClip(clip);
                                setHoverPosition({ x: e.clientX, y: e.clientY - 150 });
                            }}
                            onMouseLeave={() => setHoveredClip(null)}
                        />
                    )
                ))}

                {/* Active Creation Zone */}
                {isCreating && (
                    <Box sx={{
                        position: 'absolute',
                        left: 0, right: 0, top: 0, bottom: 0,
                        zIndex: 10
                    }}>
                        <Slider
                            sx={{
                                position: 'absolute', top: 20, width: '100%',
                                '& .MuiSlider-thumb': { borderRadius: 1, width: 4, height: 20 },
                                '& .MuiSlider-track': { height: 40, top: -18, opacity: 0.5, bgcolor: 'yellow' },
                                '& .MuiSlider-valueLabel': { fontSize: '0.6rem', padding: '2px 4px' }
                            }}
                            min={0}
                            max={duration}
                            value={selection}
                            onChange={(e, val) => setSelection(val as number[])}
                            valueLabelDisplay="on"
                            valueLabelFormat={formatTime}
                        />
                        <Box sx={{ position: 'absolute', right: 5, top: 5, display: 'flex', gap: 1 }}>
                            <IconButton size="small" onClick={handleSaveClip} sx={{ bgcolor: 'white', '&:hover': { bgcolor: 'primary.light' } }}><Add fontSize="small" color="primary" /></IconButton>
                        </Box>
                    </Box>
                )}
            </Box>

            {/* Clip List Below - Draggable to Classes */}
            <Box sx={{ display: 'flex', gap: 1, mt: 2, overflowX: 'auto', pb: 1 }}>
                {existingSubclips.map(clip => (
                    <DraggableSubclipThumbnail
                        key={clip.id}
                        clip={clip}
                        onDelete={handleDeleteClip}
                    />
                ))}
            </Box>

            {/* Floating Preview Window (Clip Rollover) */}
            {hoveredClip && hoveredClip.startTime !== undefined && (
                <Paper sx={{
                    position: 'fixed',
                    left: hoverPosition.x,
                    top: hoverPosition.y,
                    width: 'auto',
                    maxWidth: 300,
                    height: 'auto',
                    zIndex: 9999,
                    bgcolor: 'black',
                    border: `2px solid ${hoveredClip.color}`,
                    overflow: 'hidden',
                    pointerEvents: 'none'
                }}>
                    <video
                        ref={previewVideoRef}
                        src={videoUrl}
                        style={{ maxWidth: '100%', maxHeight: 200, display: 'block' }}
                        muted
                        loop
                        onTimeUpdate={(e) => {
                            const vid = e.currentTarget;
                            if (vid.currentTime >= (hoveredClip.endTime || 0)) {
                                vid.currentTime = hoveredClip.startTime || 0;
                            }
                        }}
                    />
                </Paper>
            )}

            {/* Frame Preview Window (Timeline Hover) */}
            {timelineHoverTime !== null && (
                <Paper sx={{
                    position: 'fixed',
                    left: timelineHoverPos.x,
                    top: timelineHoverPos.y + 160,
                    width: 120,
                    height: 90,
                    zIndex: 9999,
                    bgcolor: 'black',
                    border: '1px solid white',
                    overflow: 'hidden',
                    pointerEvents: 'none',
                    display: 'flex', justifyContent: 'center', alignItems: 'center'
                }}>
                    <video
                        ref={timelinePreviewRef}
                        src={videoUrl}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        muted
                    />
                    <Typography variant="caption" sx={{ position: 'absolute', bottom: 0, bgcolor: 'rgba(0,0,0,0.7)', width: '100%', textAlign: 'center', color: 'white' }}>
                        {formatTime(timelineHoverTime)}
                    </Typography>
                </Paper>
            )}

        </Box>
    );
}

function formatTime(s: number) {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    const ms = Math.floor((s % 1) * 10);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
}
