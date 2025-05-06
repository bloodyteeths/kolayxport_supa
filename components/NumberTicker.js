import React, { useEffect, useRef } from 'react';
import { motion, useSpring, useTransform, useInView } from 'framer-motion';

const NumberTicker = ({ 
  value,
  direction = 'up',
  delay = 0,
  className = '',
  formatter = (val) => Math.round(val).toLocaleString(),
  springConfig = { mass: 0.8, stiffness: 100, damping: 20 }
}) => {
  const MotionSpan = motion.span;
  const isInView = useInView(useRef(null), { once: true, margin: '-100px' });

  const spring = useSpring(direction === 'down' ? value : 0, springConfig);

  useEffect(() => {
    if (isInView) {
      spring.set(value);
    }
  }, [spring, value, isInView]);

  const displayValue = useTransform(spring, (current) => formatter(current));

  return (
    <MotionSpan className={className} ref={isInView.ref}>
      {displayValue}
    </MotionSpan>
  );
};

export default NumberTicker; 