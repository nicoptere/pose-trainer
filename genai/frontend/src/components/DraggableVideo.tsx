
'use client';

import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Card, CardMedia, Typography, Box } from '@mui/material';
import { CSS } from '@dnd-kit/utilities';

interface Props {
    id: string;
    url: string;
    name: string;
    onClick?: () => void;
}

export function DraggableVideo({ id, url, name, onClick }: Props) {
    const { attributes, listeners, setNodeRef, transform } = useDraggable({
        id: id,
        data: { type: 'video' }
    });

    const style = {
        transform: CSS.Translate.toString(transform),
        cursor: 'grab',
    };

    return (
        <div ref={setNodeRef} style={style} {...listeners} {...attributes} onClick={onClick}>
            <Card sx={{ width: 80, m: 0.5, boxShadow: 1 }}>
                <CardMedia
                    component="video"
                    src={url}
                    sx={{ height: 45, bgcolor: 'black' }}
                />
                <Box sx={{ p: 0.5 }}>
                    <Typography variant="caption" noWrap display="block" title={name} sx={{ fontSize: '0.6rem' }}>
                        {name}
                    </Typography>
                </Box>
            </Card>
        </div>
    );
}
