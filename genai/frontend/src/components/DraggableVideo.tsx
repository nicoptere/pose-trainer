'use client';

import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Card, CardMedia, Typography, Box, IconButton } from '@mui/material';
import { Delete } from '@mui/icons-material';
import { CSS } from '@dnd-kit/utilities';

interface Props {
    id: string;
    url: string;
    thumbnailUrl?: string; // Base64 or standard URL
    name: string;
    width?: number;
    onClick?: () => void;
    onHover?: (e: React.MouseEvent, videoId: string) => void;
    onLeave?: () => void;
    onDelete?: () => void;
    color?: string;
    startTime?: number;
    previewDirty?: boolean;
}

export function DraggableVideo({ id, url, thumbnailUrl, name, width = 80, onClick, onHover, onLeave, onDelete, color, startTime, previewDirty }: Props) {
    const { attributes, listeners, setNodeRef, transform } = useDraggable({
        id: id,
        data: { type: 'video' }
    });

    const style = {
        transform: CSS.Translate.toString(transform),
        cursor: 'grab',
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...listeners}
            {...attributes}
            onClick={onClick}
        >
            <Card
                onMouseEnter={(e) => onHover?.(e, id)}
                onMouseLeave={onLeave}
                sx={{
                    width: width,
                    m: 0.5,
                    boxShadow: 1,
                    position: 'relative',
                    border: color ? `2px solid ${color}` : 'none'
                }}>
                {thumbnailUrl ? (
                    <CardMedia
                        component="img"
                        src={thumbnailUrl}
                        sx={{ height: width * 0.56, bgcolor: 'black', objectFit: 'cover' }} // approx 16:9
                    />
                ) : (
                    <CardMedia
                        component="video"
                        src={url}
                        sx={{ height: width * 0.56, bgcolor: 'black' }}
                    />
                )}
                <Box sx={{ p: 0.5 }}>
                    <Typography variant="caption" noWrap display="block" title={name} sx={{ fontSize: '0.6rem' }}>
                        {name}
                    </Typography>
                </Box>

                {previewDirty && (
                    <Box sx={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        bgcolor: 'rgba(0,0,0,0.5)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}>
                        <Box sx={{
                            width: 16,
                            height: 16,
                            border: '2px solid white',
                            borderTop: '2px solid transparent',
                            borderRadius: '50%',
                            animation: 'spin 1s linear infinite'
                        }} />
                        <style>{`
                            @keyframes spin {
                                0% { transform: rotate(0deg); }
                                100% { transform: rotate(360deg); }
                            }
                         `}</style>
                    </Box>
                )}

                {onDelete && (
                    <IconButton
                        size="small"
                        sx={{
                            position: 'absolute',
                            top: 0,
                            right: 0,
                            bgcolor: 'rgba(0,0,0,0.5)',
                            color: 'white',
                            p: 0.2,
                            '&:hover': { bgcolor: 'rgba(255,0,0,0.7)' }
                        }}
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete();
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        <Delete fontSize="small" sx={{ fontSize: '1rem' }} />
                    </IconButton>
                )}
            </Card>
        </div>
    );
}
