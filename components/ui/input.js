import * as React from 'react';

export function Input({ label, className = '', ...props }) {
  return (
    <div className="grid gap-1">
      {label && <label className="text-xs font-semibold text-gray-700 uppercase">{label}</label>}
      <input
        className={`w-full bg-white border border-gray-300 px-3 py-2 rounded-md shadow-sm text-sm placeholder-gray-400 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 ${className}`}
        {...props}
      />
    </div>
  );
} 