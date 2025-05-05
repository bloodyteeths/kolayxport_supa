import * as React from 'react';

export function Tabs({ defaultValue, children }) {
  const [activeTab, setActiveTab] = React.useState(defaultValue);

  const context = React.useMemo(() => ({ activeTab, setActiveTab }), [activeTab]);
  return <TabsContext.Provider value={context}>{children}</TabsContext.Provider>;
}

const TabsContext = React.createContext();

function useTabs() {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error('Tabs components must be used within <Tabs>');
  return ctx;
}

export function TabsList({ className = '', ...props }) {
  return <div className={`flex border-b border-gray-200 ${className}`} {...props} />;
}

export function TabsTrigger({ value, children, className = '', ...props }) {
  const { activeTab, setActiveTab } = useTabs();
  const isActive = activeTab === value;
  return (
    <button
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
        ${isActive
          ? 'border-blue-600 text-blue-600 focus:outline-none'
          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 focus:outline-none focus:text-gray-700 focus:border-gray-300'
        }
        ${className}`}
      onClick={() => setActiveTab(value)}
      {...props}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, children, className = '', ...props }) {
  const { activeTab } = useTabs();
  if (activeTab !== value) return null;
  return <div className={`mt-6 ${className}`} {...props}>{children}</div>;
} 