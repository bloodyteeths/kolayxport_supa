import React from 'react';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  message?: string;
  action?: React.ReactNode;
}

export default function EmptyState({ icon, title, message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      {/* Icon with gradient circle */}
      <div
        className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl flex items-center justify-center mb-5"
        style={{ background: 'linear-gradient(135deg, #eff6ff 0%, #e0e7ff 100%)' }}
      >
        <div className="text-blue-600">
          {icon}
        </div>
      </div>

      <h3 className="text-base sm:text-lg font-semibold text-slate-800 mb-1.5" style={{ letterSpacing: '-0.01em' }}>
        {title}
      </h3>

      {message && (
        <p className="text-sm text-slate-500 max-w-sm mb-5">
          {message}
        </p>
      )}

      {action && (
        <div>{action}</div>
      )}
    </div>
  );
}
