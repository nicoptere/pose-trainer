import React, { useEffect, useRef, useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import { GestureClass } from '../store/useStore';

interface TimelineEvent {
    name: string;
    timestamp: number;
}

interface Props {
    classes: GestureClass[];
    events: TimelineEvent[];
    startTime: number;
    isRunning: boolean;
}

const TRACK_HEIGHT = 20; // Height of each class track
const PIXELS_PER_SECOND = 20;

// Consistent color generation
const stringToColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash) % 360;
    return `hsl(${h}, 70%, 50%)`;
};

export default function Timeline({ classes, events, startTime, isRunning }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [currentTime, setCurrentTime] = React.useState(Date.now());

    // Update current time for scrolling while running
    useEffect(() => {
        if (!isRunning) return;
        const interval = setInterval(() => setCurrentTime(Date.now()), 100);
        return () => clearInterval(interval);
    }, [isRunning]);

    // Derived session duration
    // If stopped, we ensure the duration covers the last event found
    const lastEventTime = useMemo(() => {
        if (events.length === 0) return startTime;
        return events[events.length - 1].timestamp;
    }, [events, startTime]);

    const effectiveTime = isRunning ? currentTime : Math.max(currentTime, lastEventTime);
    const sessionDuration = Math.max(1000, effectiveTime - startTime); // Minimum 1s duration

    const containerWidth = isRunning
        ? Math.max((sessionDuration / 1000) * PIXELS_PER_SECOND + 200, 600)
        : '100%';

    // Helper to position items
    const getPosition = (timestamp: number) => {
        const rel = timestamp - startTime;
        if (isRunning) {
            return `${(rel / 1000) * PIXELS_PER_SECOND}px`;
        } else {
            return `${(rel / sessionDuration) * 100}%`;
        }
    };

    // Auto-scroll to right
    useEffect(() => {
        if (isRunning && containerRef.current) {
            containerRef.current.scrollLeft = containerRef.current.scrollWidth;
        }
    }, [currentTime, isRunning, containerWidth]);

    // filter classes to those that are relevant (have descriptions or have events)
    const activeClasses = useMemo(() => classes.filter(c => c.description && c.description.trim().length > 0), [classes]);

    return (
        <Box sx={{
            display: 'flex',
            flexDirection: 'column',
            bgcolor: '#1e1e1e', // Dark background for timeline
            border: '1px solid #333',
            borderRadius: 1,
            overflow: 'hidden',
            height: '250px' // Fixed height container
        }}>
            <Box sx={{ p: 1, borderBottom: '1px solid #333', bgcolor: '#252526' }}>
                <Typography variant="caption" color="text.secondary">Live Timeline</Typography>
            </Box>

            <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                {/* Labels Column */}
                <Box sx={{
                    width: 100,
                    bgcolor: '#252526',
                    borderRight: '1px solid #333',
                    flexShrink: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    pt: 2 // Align with tracks (some padding)
                }}>
                    {activeClasses.map(c => (
                        <Box key={c.id} sx={{ height: TRACK_HEIGHT, px: 1, display: 'flex', alignItems: 'center' }}>
                            <Typography variant="caption" noWrap sx={{ color: stringToColor(c.name), fontSize: '10px' }}>
                                {c.name}
                            </Typography>
                        </Box>
                    ))}
                </Box>

                {/* Tracks Area */}
                <Box
                    ref={containerRef}
                    sx={{
                        flex: 1,
                        overflowX: 'auto',
                        overflowY: 'hidden',
                        position: 'relative',
                        bgcolor: '#1e1e1e'
                    }}
                >
                    <Box sx={{ width: containerWidth, position: 'relative', height: '100%', pt: 2 }}>
                        {/* Tracks Background Lines */}
                        {activeClasses.map((c, i) => (
                            <Box key={c.id} sx={{
                                position: 'absolute',
                                left: 0,
                                right: 0,
                                top: 16 + (i * TRACK_HEIGHT), // pt:2 is 16px
                                height: 1,
                                bgcolor: 'rgba(255,255,255,0.05)',
                                zIndex: 0
                            }} />
                        ))}

                        {/* Events */}
                        {events.map((ev, i) => {
                            const classIndex = activeClasses.findIndex(c => c.name === ev.name);
                            if (classIndex === -1) return null;

                            const left = getPosition(ev.timestamp);
                            const color = stringToColor(ev.name);
                            const relativeTime = ev.timestamp - startTime;

                            return (
                                <Box
                                    key={i}
                                    sx={{
                                        position: 'absolute',
                                        left: left,
                                        top: 16 + (classIndex * TRACK_HEIGHT) + 2, // +2 for vertical centering padding
                                        height: TRACK_HEIGHT - 4,
                                        width: isRunning ? 10 : `max(0.5%, 2px)`, // Scale width
                                        bgcolor: color,
                                        borderRadius: 1,
                                        zIndex: 1,
                                        boxShadow: '0 0 5px rgba(0,0,0,0.5)',
                                        opacity: 0.9,
                                        '&:hover': { opacity: 1, transform: 'scale(1.2)' }
                                    }}
                                    title={`${ev.name} @ ${(relativeTime / 1000).toFixed(1)}s`}
                                />
                            );
                        })}

                        {/* Current Time Indicator line */}
                        {isRunning && (
                            <Box sx={{
                                position: 'absolute',
                                left: getPosition(currentTime),
                                top: 0,
                                bottom: 0,
                                width: 1,
                                bgcolor: 'red',
                                zIndex: 2
                            }} />
                        )}
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}
