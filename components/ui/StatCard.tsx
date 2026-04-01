import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: number; // percentage change, positive or negative
  color?: 'blue' | 'green' | 'purple' | 'orange' | 'rose';
}

const colorMap = {
  blue: {
    iconBg: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
    iconColor: '#2563eb',
    trendPositive: '#059669',
    trendNegative: '#dc2626',
    accent: '#2563eb',
  },
  green: {
    iconBg: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
    iconColor: '#16a34a',
    trendPositive: '#059669',
    trendNegative: '#dc2626',
    accent: '#16a34a',
  },
  purple: {
    iconBg: 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)',
    iconColor: '#7c3aed',
    trendPositive: '#059669',
    trendNegative: '#dc2626',
    accent: '#7c3aed',
  },
  orange: {
    iconBg: 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)',
    iconColor: '#ea580c',
    trendPositive: '#059669',
    trendNegative: '#dc2626',
    accent: '#ea580c',
  },
  rose: {
    iconBg: 'linear-gradient(135deg, #fff1f2 0%, #ffe4e6 100%)',
    iconColor: '#e11d48',
    trendPositive: '#059669',
    trendNegative: '#dc2626',
    accent: '#e11d48',
  },
};

export default function StatCard({ label, value, icon, trend, color = 'blue' }: StatCardProps) {
  const c = colorMap[color];
  const trendPositive = trend !== undefined && trend >= 0;

  return (
    <div className="card-premium p-4 sm:p-5 flex items-start gap-3.5 sm:gap-4 group">
      {/* Icon */}
      <div
        className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform duration-200 group-hover:scale-105"
        style={{ background: c.iconBg }}
      >
        <div style={{ color: c.iconColor }}>
          {icon}
        </div>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="text-xs sm:text-[13px] font-medium text-slate-500 mb-0.5 truncate">{label}</p>
        <div className="flex items-baseline gap-2">
          <span className="text-xl sm:text-2xl font-bold text-slate-900" style={{ letterSpacing: '-0.025em' }}>
            {value}
          </span>
          {trend !== undefined && (
            <span
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px] font-semibold"
              style={{
                backgroundColor: trendPositive ? '#f0fdf4' : '#fef2f2',
                color: trendPositive ? c.trendPositive : c.trendNegative,
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                {trendPositive ? (
                  <path d="M5 2L8 6H2L5 2Z" />
                ) : (
                  <path d="M5 8L2 4H8L5 8Z" />
                )}
              </svg>
              {Math.abs(trend).toFixed(1)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
