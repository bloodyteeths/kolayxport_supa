import * as React from 'react';

export function Card({ className = '', interactive = false, ...props }) {
  return (
    <div
      className={`rounded-xl bg-white border border-slate-200/60 shadow-card transition-all duration-200 ${
        interactive ? 'hover:shadow-card-hover hover:-translate-y-0.5 cursor-pointer' : 'hover:shadow-card-hover'
      } ${className}`}
      {...props}
    />
  );
}

export function CardContent({ className = '', ...props }) {
  return <div className={`p-5 sm:p-6 ${className}`} {...props} />;
}

export function CardHeader({ className = '', ...props }) {
  return <div className={`flex flex-col space-y-1.5 p-5 sm:p-6 pb-0 ${className}`} {...props} />;
}

export function CardTitle({ className = '', ...props }) {
  return <h3 className={`text-base font-semibold text-slate-900 tracking-tight ${className}`} {...props} />;
}

export function CardDescription({ className = '', ...props }) {
  return <p className={`text-sm text-slate-500 ${className}`} {...props} />;
}

export function CardFooter({ className = '', ...props }) {
  return <div className={`p-5 sm:p-6 pt-0 ${className}`} {...props} />;
}
