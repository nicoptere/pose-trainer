'use client';

import React, { useRef, useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';

interface Props {
    videoUrl: string;
    startTime?: number;
    endTime?: number;
    crop?: { x: number; y: number; width: number; height: number };
    maxWidth?: number;
    color?: string;
}

function formatTime(s: number) {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function CroppedVideoPreview({
    videoUrl,
    startTime = 0,
    endTime,
    crop,
    maxWidth = 200,
    color = '#666'
}: Props) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [videoReady, setVideoReady] = useState(false);

    // Default crop to full frame if not provided
    const effectiveCrop = crop || { x: 0, y: 0, width: 1, height: 1 };

    // Calculate container dimensions to maintain crop aspect ratio
    // Assuming 16:9 source, crop aspect will follow
    const cropAspect = effectiveCrop.width / effectiveCrop.height;
    const containerWidth = maxWidth;
    const containerHeight = Math.min(containerWidth / cropAspect, 200);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const handleLoadedData = () => {
            video.currentTime = startTime;
            video.playbackRate = 2; // 2x speed
            setVideoReady(true);
        };

        const handleSeeked = () => {
            video.playbackRate = 2; // Ensure 2x speed
            video.play().catch(() => { });
        };

        const handleTimeUpdate = () => {
            if (endTime !== undefined && video.currentTime >= endTime) {
                video.currentTime = startTime;
            }
            if (video.currentTime < startTime) {
                video.currentTime = startTime;
            }
        };

        const handleCanPlay = () => {
            video.playbackRate = 2;
            video.play().catch(() => { });
        };

        video.addEventListener('loadeddata', handleLoadedData);
        video.addEventListener('seeked', handleSeeked);
        video.addEventListener('timeupdate', handleTimeUpdate);
        video.addEventListener('canplay', handleCanPlay);

        if (video.readyState >= 2) {
            handleLoadedData();
        }

        return () => {
            video.removeEventListener('loadeddata', handleLoadedData);
            video.removeEventListener('seeked', handleSeeked);
            video.removeEventListener('timeupdate', handleTimeUpdate);
            video.removeEventListener('canplay', handleCanPlay);
            video.pause();
        };
    }, [videoUrl, startTime, endTime]);

    // CSS-based cropping: scale video up and position it so the crop region fills the container
    const scaleX = 1 / effectiveCrop.width;
    const scaleY = 1 / effectiveCrop.height;
    const translateX = -effectiveCrop.x * 100 * scaleX;
    const translateY = -effectiveCrop.y * 100 * scaleY;

    return (
        <Box sx={{ bgcolor: 'black', border: `2px solid ${color}`, overflow: 'hidden' }}>
            {/* Container with fixed dimensions matching crop aspect ratio */}
            <Box sx={{
                width: containerWidth,
                height: containerHeight,
                overflow: 'hidden',
                position: 'relative'
            }}>
                <video
                    ref={videoRef}
                    src={videoUrl}
                    muted
                    loop
                    playsInline
                    style={{
                        position: 'absolute',
                        width: `${scaleX * 100}%`,
                        height: `${scaleY * 100}%`,
                        left: `${translateX}%`,
                        top: `${translateY}%`,
                        objectFit: 'cover'
                    }}
                />
            </Box>

            {/* Time label */}
            <Box sx={{ p: 0.5, bgcolor: 'rgba(0,0,0,0.8)' }}>
                <Typography variant="caption" color="white">
                    {formatTime(startTime)} - {endTime !== undefined ? formatTime(endTime) : 'End'}
                </Typography>
            </Box>
        </Box>
    );
}
