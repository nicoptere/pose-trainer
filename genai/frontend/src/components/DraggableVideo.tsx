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
    width?: number | string;
    onClick?: () => void;
    onHover?: (e: React.MouseEvent, videoId: string) => void;
    onLeave?: () => void;
    onDelete?: () => void;
    color?: string;
    startTime?: number;
    // previewDirty removed from props as throbber is removed
}

export function DraggableVideo({ id, url, thumbnailUrl, name, width = 80, onClick, onHover, onLeave, onDelete, color, startTime }: Props) {
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
            style={{ ...style, width: '100%', minWidth: 0 }}
            {...listeners}
            {...attributes}
            onClick={onClick}
        >
            <Card
                onMouseEnter={(e) => onHover?.(e, id)}
                onMouseLeave={onLeave}
                sx={{
                    width: width,
                    // Remove margin as Grid gap handles spacing
                    // m: 0.5, 
                    boxShadow: 1,
                    position: 'relative',
                    border: color ? `2px solid ${color}` : 'none'
                }}>
                {thumbnailUrl ? (
                    <CardMedia
                        component="img"
                        src={thumbnailUrl}
                        sx={{ aspectRatio: '16/9', bgcolor: 'black', objectFit: 'cover', width: '100%' }}
                    />
                ) : (
                    <CardMedia
                        component="video"
                        src={url}
                        sx={{ aspectRatio: '16/9', bgcolor: 'black', width: '100%' }}
                    />
                )}
                <Box sx={{ p: 0.5 }}>
                    <Typography variant="caption" noWrap display="block" title={name} sx={{ fontSize: '0.6rem' }}>
                        {name}
                    </Typography>
                </Box>

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
