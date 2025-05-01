import * as React from 'react';

export function Textarea({ label, className = '', rows = 3, ...props }) {
  return (
    <div className="grid gap-1">
      {label && <label className="text-sm font-medium">{label}</label>}
      <textarea
        rows={rows}
        className={`w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 ${className}`}
        {...props}
      />
    </div>
  );
} 