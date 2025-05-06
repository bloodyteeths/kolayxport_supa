import React from 'react';
import { motion } from 'framer-motion';
import useSidebar from '../hooks/useSidebar'; // Adjusted path

const SidebarToggle = () => {
  const { isOpen, toggleSidebar } = useSidebar();

  const variant = isOpen ? 'opened' : 'closed';

  const top = {
    closed: {
      rotate: 0,
      translateY: 0,
    },
    opened: {
      rotate: 45,
      translateY: 7, // Adjusted for a 24px icon size, typically lines are ~7-8px apart
    },
  };
  const center = {
    closed: {
      opacity: 1,
    },
    opened: {
      opacity: 0,
    },
  };
  const bottom = {
    closed: {
      rotate: 0,
      translateY: 0,
    },
    opened: {
      rotate: -45,
      translateY: -7, // Adjusted for a 24px icon size
    },
  };

  return (
    <button
      onClick={toggleSidebar}
      className="p-2 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 z-50"
      aria-label={isOpen ? "Close sidebar" : "Open sidebar"}
      aria-expanded={isOpen}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
        overflow="visible" // Allows lines to animate outside their initial bounds cleanly
        preserveAspectRatio="none"
      >
        <motion.line
          x1="4"
          x2="20"
          y1="6"
          y2="6"
          variants={top}
          animate={variant}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <motion.line
          x1="4"
          x2="20"
          y1="12"
          y2="12"
          variants={center}
          animate={variant}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <motion.line
          x1="4"
          x2="20"
          y1="18"
          y2="18"
          variants={bottom}
          animate={variant}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
};

export default SidebarToggle; 