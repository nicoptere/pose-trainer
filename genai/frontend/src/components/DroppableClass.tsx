
'use client';

import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Paper, Typography, Box } from '@mui/material';

interface Props {
    id: string;
    title: string;
    children: React.ReactNode;
}

export function DroppableClass({ id, title, children }: Props) {
    const { isOver, setNodeRef } = useDroppable({
        id: id,
    });

    const style = {
        backgroundColor: isOver ? '#e3f2fd' : 'white',
        transition: 'background-color 0.2s',
    };

    return (
        <Paper
            ref={setNodeRef}
            elevation={1}
            sx={{ p: 1, minHeight: 100, minWidth: 100, ...style }}
        >
            <Typography variant="subtitle2" gutterBottom color={isOver ? 'primary' : 'textPrimary'} fontWeight="bold" sx={{ fontSize: '0.8rem' }}>
                {title}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>
                {children}
            </Box>
        </Paper>
    );
}
