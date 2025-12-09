
'use client';

import React, { useState } from 'react';
import { Container, Typography, Box, Tabs, Tab } from '@mui/material';
import ClassManager from '../components/ClassManager';
import TestTab from '../components/TestTab';
import MetadataTab from '../components/MetadataTab';
import { useStore } from '../store/useStore';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function CustomTabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`simple-tabpanel-${index}`}
      {...other}
      style={{ height: '100%', display: value === index ? 'block' : 'none' }}
    >
      {value === index && (
        <Box sx={{ p: 1, height: '100%' }}>
          {children}
        </Box>
      )}
    </div>
  );
}

export default function Home() {
  const fetchDataset = useStore((state) => state.fetchDataset);
  const [tabIndex, setTabIndex] = useState(0);

  React.useEffect(() => {
    fetchDataset();
  }, []);

  const handleChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabIndex(newValue);
  };

  return (
    <Container maxWidth="xl" sx={{ py: 2, height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Typography variant="h5" component="h1" fontWeight="bold" color="primary" sx={{ mb: 1 }}>
          Google Gesture Lab
        </Typography>
        <Tabs value={tabIndex} onChange={handleChange} aria-label="lab tabs">
          <Tab label="Train (Dataset)" />
          <Tab label="Test (Live Camera)" />
          <Tab label="Export " />
        </Tabs>
      </Box>

      <Box sx={{ flex: 1, overflow: 'hidden' }}>
        <CustomTabPanel value={tabIndex} index={0}>
          <ClassManager />
        </CustomTabPanel>
        <CustomTabPanel value={tabIndex} index={1}>
          <TestTab />
        </CustomTabPanel>
        <CustomTabPanel value={tabIndex} index={2}>
          <MetadataTab />
        </CustomTabPanel>
      </Box>
    </Container>
  );
}
