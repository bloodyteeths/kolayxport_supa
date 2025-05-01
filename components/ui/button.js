import * as React from 'react';

export const Button = React.forwardRef(function Button({ className = '', variant = 'default', ...props }, ref) {
  const base = 'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none';
  const variants = {
    default: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500',
    outline: 'border border-gray-300 hover:bg-gray-100',
    ghost: 'hover:bg-gray-100',
  };
  const classes = `${base} ${variants[variant] || variants.default} ${className}`;
  return <button ref={ref} className={classes} {...props} />;
}); 