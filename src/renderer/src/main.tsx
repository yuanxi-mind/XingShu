import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LazyMotion, domAnimation, MotionConfig } from 'framer-motion';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('No root element');

createRoot(root).render(
  <StrictMode>
    <MotionConfig reducedMotion="user"><LazyMotion features={domAnimation}><App /></LazyMotion></MotionConfig>
  </StrictMode>
);
