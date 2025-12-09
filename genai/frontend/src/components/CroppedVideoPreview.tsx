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
    const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number } | null>(null);

    // Default crop to full frame if not provided
    const effectiveCrop = crop || { x: 0, y: 0, width: 1, height: 1 };

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const handleLoadedData = () => {
            // Get actual video dimensions
            setVideoDimensions({ width: video.videoWidth, height: video.videoHeight });
            video.currentTime = startTime;
            video.playbackRate = 2;
        };

        const handleSeeked = () => {
            video.playbackRate = 2;
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

    // Calculate the cropped region's aspect ratio using actual video dimensions
    let containerWidth = maxWidth;
    let containerHeight = maxWidth * 9 / 16; // Default 16:9 aspect

    if (videoDimensions) {
        // Calculate the actual pixel dimensions of the crop region
        const cropPixelWidth = effectiveCrop.width * videoDimensions.width;
        const cropPixelHeight = effectiveCrop.height * videoDimensions.height;
        const cropAspect = cropPixelWidth / cropPixelHeight;

        // Fit within maxWidth while respecting aspect ratio
        containerWidth = maxWidth;
        containerHeight = maxWidth / cropAspect;

        // Cap height at 200
        if (containerHeight > 200) {
            containerHeight = 200;
            containerWidth = 200 * cropAspect;
        }
    }

    // CSS-based cropping: scale video up and position it so the crop region fills the container
    // Scale factor: how much bigger the full video is compared to the container
    const scaleX = 1 / effectiveCrop.width;
    const scaleY = 1 / effectiveCrop.height;

    // Position: offset the video so the crop region aligns with container origin
    // The crop starts at (crop.x * videoWidth) in the original video
    // After scaling by scaleX, this position becomes (crop.x * scaleX * containerWidth)
    // We need to move it left by that amount
    const offsetX = -(effectiveCrop.x / effectiveCrop.width) * 100;
    const offsetY = -(effectiveCrop.y / effectiveCrop.height) * 100;

    return (
        <Box sx={{ bgcolor: 'black', border: `2px solid ${color}`, overflow: 'hidden' }}>
            {/* Container with dimensions matching crop aspect ratio */}
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
                        left: `${offsetX}%`,
                        top: `${offsetY}%`,
                        objectFit: 'fill'
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
